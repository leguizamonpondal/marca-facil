/**
 * Cliente del Web Service oficial del INPI (SOAP)
 * ------------------------------------------------------------------
 * Endpoint:  https://ws.inpi.gob.ar/wsinpi.asmx
 * WSDL:      https://ws.inpi.gob.ar/wsinpi.asmx?WSDL
 * Doc:       https://portaltramites.inpi.gob.ar/Home/SolicitudWS
 *
 * Reemplaza el scraping con Playwright para las consultas de marcas.
 *
 * IMPORTANTE — operaciones públicas:
 *   ConsultaDenominacion   → NO requiere credenciales
 *   ConsultaCuitOTitular   → NO requiere credenciales
 *   ConsultaNotificaciones → SÍ requiere (nodo `datosUsuario`, minúscula)
 *   Ingresar_*             → SÍ requiere (nodo `DatosUsuario`, mayúscula)
 *
 * Por eso este módulo se puede usar en producción sin esperar el alta del INPI.
 */
import axios from 'axios';
import { logger } from '../utils/logger';
import type { MarcaINPI } from './inpiService';

const WS_URL = process.env.INPI_WS_URL || 'https://ws.inpi.gob.ar/wsinpi.asmx';
const NS = 'http://tempuri.org/';
const TIMEOUT_MS = Number(process.env.INPI_WS_TIMEOUT_MS || 45000);

// ── Helpers XML ───────────────────────────────────────────────────────────────

/** Escapa un valor para insertarlo como texto dentro de un nodo XML. */
function escaparXml(valor: unknown): string {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Decodifica entidades XML. El &amp; va último a propósito. */
function decodificarEntidades(texto: string): string {
  return texto
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

/**
 * Extrae el texto de un nodo, tolerando cualquier prefijo de namespace
 * y nodos autocerrados (<Tag/> → cadena vacía).
 */
function textoDe(xml: string, tag: string): string {
  const autoCerrado = new RegExp(`<(?:[\\w.-]+:)?${tag}\\b[^>]*/>`, 'i');
  if (autoCerrado.test(xml) && !new RegExp(`<(?:[\\w.-]+:)?${tag}\\b[^>]*[^/]>`, 'i').test(xml)) {
    return '';
  }
  const re = new RegExp(`<(?:[\\w.-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${tag}>`, 'i');
  const m = xml.match(re);
  if (!m) return '';
  const crudo = m[1] ?? '';
  const cdata = crudo.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return decodificarEntidades((cdata ? cdata[1] : crudo).trim());
}

/** Devuelve el contenido interno de cada repetición de un nodo. */
function bloquesDe(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:[\\w.-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${tag}>`, 'gi');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1] ?? '');
  return out;
}

/** Normaliza un dateTime del INPI (2020-05-14T00:00:00) a YYYY-MM-DD. */
function soloFecha(valor: string): string | undefined {
  if (!valor) return undefined;
  const m = valor.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : valor;
}

// ── Estados de marca ──────────────────────────────────────────────────────────
/**
 * El campo `Estado` del INPI es inconsistente: a veces viene como código de una
 * letra ("C" = concedida, "N" = denegada), a veces con la palabra completa
 * ("Abandonada", "Caduca"), y en trámite viene vacío o con un guion.
 *
 * ⚠️ OJO CON LA PALABRA "VIGENTE" — significa dos cosas distintas:
 *
 *   1. La "vigencia" del INPI: el check SOLO VIGENTES del portal, que combina
 *      estado Y vencimiento. El Web Service YA aplica ese filtro por su cuenta
 *      (verificado 14/09/2026: titular "NIKE" da 202 tanto en el WS como en el
 *      portal con el check tildado, contra 616 sin filtrar).
 *
 *   2. `obstaculiza` (este campo): si el antecedente debe pesar en el análisis
 *      de confundibilidad. Es una clasificación NUESTRA, no del INPI.
 *
 * Las dos no coinciden siempre: el portal incluye entre sus "vigentes" alguna
 * marca denegada. Por eso este campo sirve para MARCAR cada resultado en
 * pantalla, pero no para recortar la lista (ver nota en filtrarObstaculizantes).
 */
export interface EstadoMarca {
  crudo: string;         // valor original devuelto por el INPI
  etiqueta: string;      // texto legible para mostrar al usuario
  obstaculiza: boolean;  // true = puede obstaculizar un nuevo registro
}

const TABLA_ESTADOS: Record<string, { etiqueta: string; obstaculiza: boolean }> = {
  C:          { etiqueta: 'Concedida',  obstaculiza: true },
  CONCEDIDA:  { etiqueta: 'Concedida',  obstaculiza: true },
  REGISTRADA: { etiqueta: 'Concedida',  obstaculiza: true },
  N:          { etiqueta: 'Denegada',   obstaculiza: false },
  DENEGADA:   { etiqueta: 'Denegada',   obstaculiza: false },
  RECHAZADA:  { etiqueta: 'Denegada',   obstaculiza: false },
  NULA:       { etiqueta: 'Nula',       obstaculiza: false },
  ABANDONADA: { etiqueta: 'Abandonada', obstaculiza: false },
  CADUCA:     { etiqueta: 'Caduca',     obstaculiza: false },
  CADUCADA:   { etiqueta: 'Caduca',     obstaculiza: false },
  DESISTIDA:  { etiqueta: 'Desistida',  obstaculiza: false },
};

export function normalizarEstado(crudo: string): EstadoMarca {
  const original = (crudo || '').trim();

  // Vacío o guion = en trámite (así lo muestra el portal del INPI)
  if (!original || /^-+$/.test(original)) {
    return { crudo: original, etiqueta: 'En trámite', obstaculiza: true };
  }

  const clave = original
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // quita tildes
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  const conocido = TABLA_ESTADOS[clave];
  if (conocido) {
    return { crudo: original, etiqueta: conocido.etiqueta, obstaculiza: conocido.obstaculiza };
  }

  // Estado desconocido: se muestra tal cual y se asume VIGENTE a propósito.
  // En un análisis de factibilidad es preferible señalar de más que descartar
  // por error un antecedente que sí obstaculiza.
  logger.warn(`[INPI-WS] Estado desconocido: "${original}" — se asume que obstaculiza`);
  return { crudo: original, etiqueta: original, obstaculiza: true };
}

// ── Titulares ─────────────────────────────────────────────────────────────────
export interface TitularMarca {
  nombre: string;
  porcentaje: number | null;
}

/**
 * El INPI devuelve los titulares en un solo string con el porcentaje pegado:
 *   "NIKE INTERNATIONAL LTD. 100.00%"
 *   "PEREZ, JUAN 33.34% -   LEIS, GRACIELA 33.33% -   POLAK, CARLOS 33.33%"
 *
 * Se extrae cada par nombre/porcentaje. Si no hay porcentajes, se devuelve el
 * string completo como un único titular.
 */
export function parsearTitulares(crudo: string): TitularMarca[] {
  const texto = (crudo || '').replace(/\s+/g, ' ').trim();
  if (!texto) return [];

  const out: TitularMarca[] = [];
  const re = /([^%]+?)\s+(\d+(?:[.,]\d+)?)\s*%/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(texto)) !== null) {
    const nombre = m[1].replace(/^[\s\-–]+/, '').replace(/[\s\-–]+$/, '').trim();
    if (nombre) out.push({ nombre, porcentaje: parseFloat(m[2].replace(',', '.')) });
  }

  return out.length > 0 ? out : [{ nombre: texto, porcentaje: null }];
}

// ── Llamada SOAP genérica ─────────────────────────────────────────────────────

class InpiWsError extends Error {
  constructor(message: string, public readonly operacion: string) {
    super(message);
    this.name = 'InpiWsError';
  }
}

/**
 * Ejecuta una operación SOAP 1.2 contra el WS del INPI.
 * @param operacion nombre exacto de la operación (respetar mayúsculas)
 * @param cuerpoInterno XML de los parámetros, ya escapados
 */
async function llamarSoap(operacion: string, cuerpoInterno: string): Promise<string> {
  const sobre =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:tem="${NS}">` +
    `<soap:Header/>` +
    `<soap:Body>` +
    `<tem:${operacion}>${cuerpoInterno}</tem:${operacion}>` +
    `</soap:Body>` +
    `</soap:Envelope>`;

  const inicio = Date.now();
  let respuesta: string;

  try {
    const { data } = await axios.post(WS_URL, sobre, {
      timeout: TIMEOUT_MS,
      responseType: 'text',
      transformResponse: [(d) => d],
      headers: {
        'Content-Type': `application/soap+xml; charset=utf-8; action="${NS}${operacion}"`,
        Accept: 'application/soap+xml, text/xml, */*',
      },
      // El INPI puede devolver 500 con un SOAP Fault legible: lo queremos parsear.
      validateStatus: (s) => s === 200 || s === 500,
    });
    respuesta = typeof data === 'string' ? data : String(data);
  } catch (err: any) {
    const detalle = err?.code === 'ECONNABORTED'
      ? `timeout de ${TIMEOUT_MS}ms`
      : err?.message || 'error de red';
    logger.error(`[INPI-WS] ${operacion} falló: ${detalle}`);
    throw new InpiWsError(`No se pudo conectar con el servicio del INPI (${detalle})`, operacion);
  }

  logger.info(`[INPI-WS] ${operacion} respondió en ${Date.now() - inicio}ms (${respuesta.length} bytes)`);

  // SOAP Fault: 1.2 usa <Reason><Text>, 1.1 usa <faultstring>
  if (/<(?:[\w.-]+:)?Fault\b/i.test(respuesta)) {
    const motivo =
      textoDe(respuesta, 'Text') ||
      textoDe(respuesta, 'faultstring') ||
      'el servicio devolvió un error sin descripción';
    logger.error(`[INPI-WS] ${operacion} — SOAP Fault: ${motivo}`);
    throw new InpiWsError(`El INPI rechazó la consulta: ${motivo}`, operacion);
  }

  return respuesta;
}

// ── Parseo de GrillaMarcas ────────────────────────────────────────────────────

/**
 * Resultado del WS: la interface MarcaINPI de siempre, más los campos
 * derivados que necesita la pantalla de factibilidad.
 */
export interface MarcaINPIWS extends MarcaINPI {
  /** Valor original del INPI ("C", "N", "-", "Denegada"...) */
  estadoCrudo: string;
  /** true si el estado indica un antecedente que puede obstaculizar el registro */
  estadoObstaculiza: boolean;
  /** Titulares separados, con su porcentaje */
  titulares: TitularMarca[];
}

/**
 * ConsultaDenominacion y ConsultaCuitOTitular devuelven la misma forma:
 *   total (int) · estado (string) · rows → GrillaMarcas[]
 */
function parsearGrillaMarcas(xml: string, operacion: string): MarcaINPIWS[] {
  const total = textoDe(xml, 'total');
  const estadoConsulta = textoDe(xml, 'estado');
  const filas = bloquesDe(xml, 'GrillaMarcas');

  logger.info(
    `[INPI-WS] ${operacion} → total="${total}" estado="${estadoConsulta}" filas=${filas.length}`
  );

  return filas.map((fila) => {
    const clase = parseInt(textoDe(fila, 'Clase'), 10);
    const titularCrudo = textoDe(fila, 'Titulares');
    const estado = normalizarEstado(textoDe(fila, 'Estado'));

    // El INPI usa "-" como marcador de "sin dato" (nro de resolución de un
    // trámite todavía en curso, por ejemplo). Se normaliza a cadena vacía.
    const sinDato = (v: string) => (/^-+$/.test(v.trim()) ? '' : v);

    return {
      acta: textoDe(fila, 'Acta'),
      denominacion: textoDe(fila, 'Denominacion'),
      claseNiza: Number.isFinite(clase) ? clase : 0,
      tipoMarca: sinDato(textoDe(fila, 'Tipo_Marca')),
      titular: titularCrudo,
      nroResolucion: sinDato(textoDe(fila, 'Numero_Resolucion')),
      estado: estado.etiqueta,
      estadoCrudo: estado.crudo,
      estadoObstaculiza: estado.obstaculiza,
      titulares: parsearTitulares(titularCrudo),
      fechaSolicitud: soloFecha(textoDe(fila, 'Fecha_Ingreso')),
    } as MarcaINPIWS;
  });
}

// ── Operaciones públicas (sin credenciales) ───────────────────────────────────

/**
 * Busca marcas por denominación.
 * Operación pública: no requiere CUIT ni clave.
 */
export async function consultarDenominacionWS(denominacion: string): Promise<MarcaINPIWS[]> {
  const termino = (denominacion || '').trim();
  if (!termino) return [];

  const xml = await llamarSoap(
    'ConsultaDenominacion',
    `<tem:Denominacion>${escaparXml(termino)}</tem:Denominacion>`
  );
  return parsearGrillaMarcas(xml, 'ConsultaDenominacion');
}

/**
 * Busca marcas por CUIT o por nombre de titular.
 *
 * Los DOS nodos se envían siempre; el que no se usa va vacío
 * (así lo muestra el ejemplo oficial del INPI — omitirlo puede dar error
 * de referencia nula del lado del servicio).
 */
/**
 * ⚠️ EL WEB SERVICE SOLO HACE "EMPIEZA CON". NO TIENE MODO "CONTIENE".
 *
 * `ConsultaCuitOTitular` busca de fábrica por prefijo: "INNOVATE" no encuentra
 * "NIKE INNOVATE C.V".
 *
 * El 14/09/2026 se detectó que anteponer "%" al titular activaba una búsqueda
 * parcial (196 resultados contra 0). El INPI lo desautorizó expresamente por
 * correo el 15/09/2026:
 *
 *   "No es oficial ni está soportado. Es un efecto colateral de base de datos
 *    del buscador subyacente, no expuesto por la API. No debe usarse en
 *    desarrollos productivos: puede dejar de funcionar sin aviso ante
 *    cualquier actualización."
 *
 * El riesgo no es que rompa: es que **degrade en silencio**. Una búsqueda de
 * antecedentes pasaría de 240 a 202 resultados sin error visible, y se firmaría
 * un estudio de factibilidad con 38 marcas faltantes.
 *
 * 🚫 NO REINTRODUCIR EL "%". Para búsqueda parcial de titular existe un camino
 * oficial: el portal expone "CONTIENE" en su desplegable, y el scraper lo usa
 * con `TipoBusquedaTitular: '1'` (ver `buscarPorTitularINPI` en inpiService.ts).
 */
function prepararTitular(titular: string): string {
  // Se quitan los comodines que venga escribiendo el usuario: si alguien busca
  // "50% OFF SA", ese % no debe llegar al servicio.
  const limpio = titular.replace(/[%_]/g, ' ').replace(/\s+/g, ' ').trim();
  if (limpio !== titular.trim()) {
    logger.warn(`[INPI-WS] Se quitaron comodines del titular: "${titular}" → "${limpio}"`);
  }
  return limpio;
}

export async function consultarCuitOTitularWS(params: {
  cuit?: string;
  titular?: string;
}): Promise<MarcaINPIWS[]> {
  const cuit = (params.cuit || '').replace(/[^\d]/g, '');
  const titular = prepararTitular(params.titular || '');

  if (!cuit && !titular) return [];

  const xml = await llamarSoap(
    'ConsultaCuitOTitular',
    `<tem:cuit>${escaparXml(cuit)}</tem:cuit>` +
      `<tem:titular>${escaparXml(titular)}</tem:titular>`
  );
  return parsearGrillaMarcas(xml, 'ConsultaCuitOTitular[empieza]');
}

/**
 * Deja solo los antecedentes que pueden obstaculizar un nuevo registro.
 *
 * ⚠️ NO se aplica por defecto, a propósito. El Web Service ya devuelve el mismo
 * conjunto que el portal del INPI con el check "SOLO VIGENTES" tildado
 * (verificado: titular "NIKE" → 202 en ambos, contra 616 sin filtrar).
 *
 * Filtrar de nuevo acá haría que la app mostrara un número distinto al del
 * portal, que es la referencia con la que trabaja el profesional. Queda
 * disponible para quien quiera un criterio más estricto, pero la lista se
 * devuelve completa y cada resultado se marca con `estadoObstaculiza`.
 */
export function filtrarObstaculizantes<T extends { estadoObstaculiza: boolean }>(marcas: T[]): T[] {
  return marcas.filter((m) => m.estadoObstaculiza);
}

/**
 * Atajo por titular. **Siempre "empieza con"** — el WS no soporta otra cosa.
 * Para búsqueda parcial usar el scraper del portal (ver nota en prepararTitular).
 */
export async function buscarPorTitularWS(titular: string): Promise<MarcaINPIWS[]> {
  return consultarCuitOTitularWS({ titular });
}

/** Atajo por CUIT. */
export async function buscarPorCuitWS(cuit: string): Promise<MarcaINPIWS[]> {
  return consultarCuitOTitularWS({ cuit });
}

// ═══════════════════════════════════════════════════════════════════════════════
// INGRESO DE TRÁMITES — Ingresar_MarcasNuevas (trámite 1)
// ═══════════════════════════════════════════════════════════════════════════════
//
// ⚠️ Esta operación SOLO CARGA el trámite. NO lo firma ni lo paga.
// Queda en "Mis Trámites" del portal, sin validez legal y sin generar arancel,
// hasta que un titular o representante lo firme con su Clave Fiscal y se pague
// el VEP (confirmado por el INPI, 15/09/2026).
//
// 📋 Códigos: tomados del Excel oficial de equivalencias del INPI.

/** `Id_Tipo_Domicilio` — 1 = Real · 2 = Legal. El INPI pide los dos por titular. */
export type TipoDomicilioINPI = 1 | 2;

/** `Id_Titular_Tipo` — 1 = Física · 2 = Jurídica · 3 = Extranjero · 4 = Pyme */
export type TipoTitularINPI = 1 | 2 | 3 | 4;

export interface DomicilioWS {
  tipo: TipoDomicilioINPI;
  idPais?: number;        // 9 = ARGENTINA
  idProvincia?: number;   // 1 = CABA · 24 = Buenos Aires
  localidad: string;
  domicilio: string;
  numero: string | number;
  codPostal?: string;
}

export interface TitularWS {
  nomApe: string;
  porcentaje: number;
  cuit: string;
  email: string;
  idTitularTipo: TipoTitularINPI;
  /** `ID_Genero` — 1 = Masculino · 2 = Femenino · 3 = Otro. 0 en personas jurídicas. */
  genero?: 0 | 1 | 2 | 3;
  /** `Id_Documento` — 1 = DNI · 2 = CL · 3 = LE · 4 = LC. Solo persona física. */
  tipoDni?: 1 | 2 | 3 | 4;
  numDni?: string;
  /** `Id_EstadoCivil` — 1 = Soltero/a · 2 = Casado/a · 3 = Viudo/a · 4 = Divorciado/a */
  estadoCivil?: 1 | 2 | 3 | 4;
  /** Presente en el ejemplo oficial con valor 1; el manual no lo documenta. */
  tipo?: number;
  domicilios: DomicilioWS[];
}

/**
 * Nodo `Solicitantes` — quién presenta, cuando NO es el titular.
 *
 * El manual: *"Se valida en marcas cuando el CUIT del titular difiere del
 * usuario."* Es exactamente el caso de MARCA FÁCIL: Honorio carga con sus
 * credenciales y el titular es el cliente.
 *
 * ⚠️ El ejemplo oficial del INPI **esquiva este caso a propósito** ("el usuario
 * que ingresa coincide con el primer titular para no requerir Solicitantes"),
 * así que no hay ejemplo oficial de esta combinación. De ahí la prueba real.
 */
export interface SolicitanteWS {
  /** "A" = agente · "P" = particular */
  tipoPersona: 'A' | 'P';
  poderInscriptivo: 'SI' | 'NO';
  aceptaFacultades: boolean;
  email: string;
  nombre?: string;          // obligatorio si tipoPersona = "P"
  cuit?: string;            // obligatorio si tipoPersona = "P"
  nroSolicitante?: number;  // obligatorio si tipoPersona = "A" — nro de agente
  nroPoder?: string;        // obligatorio si poderInscriptivo = "SI"
  fecha?: string;           // idem — YYYY-MM-DD
}

/**
 * Nodo `Documentacion` — `idIndice` según el Excel, solapa DOCUMENTACION,
 * fila "MarcasNuevas":
 *   3 = Acompaña Documento de Prioridad
 *   6 = Acompaña Poder            ← acá va el poder especial firmado
 *  20 = Otros
 *  24 = Ratifica Gestión
 * 1199 = Reglamento Uso Marca Colectiva
 * 1205 = Archivos Descriptivos para Marcas no Tradicionales
 * 1359 = Certificado PYME
 */
export interface DocumentoWS {
  idIndice: number;
  /** Contenido del archivo en base64, sin el prefijo `data:`. */
  documentoBase64: string;
}

export interface MarcaNuevaWS {
  denominacion: string;
  clase: number;
  /** `Cod_TipoMarca` — 1 = Denominativa · 2 = Figurativa · 3 = Mixta. Default 1. */
  tipoMarca?: number;
  /** Productos/servicios que se reivindican. */
  observacionesProteccion?: string;
  titulares: TitularWS[];
  solicitantes?: SolicitanteWS[];
  documentacion?: DocumentoWS[];
}

export interface RespuestaIngresoWS {
  ok: boolean;
  /** Identificador de gestión. Es el número con el que el trámite aparece en
   *  "Mis Trámites" para firmarse. `null` si la respuesta no trae `orden:`. */
  orden: number | null;
  /** Mensaje legible: "OK" o los errores de validación concatenados. */
  mensaje: string;
  /** El string tal como lo devolvió el INPI, para logs y diagnóstico. */
  crudo: string;
}

/**
 * Parsea la respuesta de cualquier `Ingresar_*`.
 *
 * Formato confirmado por el INPI (15/09/2026):
 *   éxito  → "OK, orden:N"   (N = identificador de gestión)
 *   error  → "<mensajes de validación concatenados>, orden:-1"
 *
 * No hay catálogo de códigos: los errores son descripciones legibles de las
 * reglas de negocio (CUIT inválido, porcentajes ≠ 100%, adjuntos faltantes).
 * Por eso el mensaje se puede mostrar al usuario tal cual.
 */
export function parsearRespuestaIngreso(crudo: string): RespuestaIngresoWS {
  const texto = (crudo || '').trim();
  const m = texto.match(/orden\s*:\s*(-?\d+)/i);
  const orden = m ? parseInt(m[1], 10) : null;

  // El mensaje es todo lo que precede a ", orden:N"
  const mensaje = (m ? texto.slice(0, m.index).replace(/,\s*$/, '') : texto).trim() || texto;

  return {
    ok: orden !== null && orden > 0,
    orden: orden !== null && orden > 0 ? orden : orden,
    mensaje,
    crudo: texto,
  };
}

function xmlDomicilio(d: DomicilioWS): string {
  return (
    `<tem:Domicilios>` +
    `<tem:Id_Tipo_Domicilio>${d.tipo}</tem:Id_Tipo_Domicilio>` +
    `<tem:Id_Pais>${d.idPais ?? 9}</tem:Id_Pais>` +
    `<tem:idProvincia>${d.idProvincia ?? 1}</tem:idProvincia>` +
    `<tem:Localidad>${escaparXml(d.localidad)}</tem:Localidad>` +
    `<tem:Domicilio>${escaparXml(d.domicilio)}</tem:Domicilio>` +
    `<tem:Numero>${escaparXml(d.numero)}</tem:Numero>` +
    (d.codPostal ? `<tem:Cod_Postal>${escaparXml(d.codPostal)}</tem:Cod_Postal>` : '') +
    `</tem:Domicilios>`
  );
}

function xmlTitular(t: TitularWS): string {
  const esFisica = t.idTitularTipo === 1;
  return (
    `<tem:Titulares>` +
    `<tem:NomApe>${escaparXml(t.nomApe)}</tem:NomApe>` +
    `<tem:Porcentaje>${t.porcentaje}</tem:Porcentaje>` +
    (esFisica && t.tipoDni ? `<tem:Tipo_Dni>${t.tipoDni}</tem:Tipo_Dni>` : '') +
    (esFisica && t.numDni ? `<tem:Num_Dni>${escaparXml(t.numDni)}</tem:Num_Dni>` : '') +
    `<tem:Nro_Cuit>${escaparXml((t.cuit || '').replace(/\D/g, ''))}</tem:Nro_Cuit>` +
    (esFisica && t.estadoCivil ? `<tem:Estado_Civil>${t.estadoCivil}</tem:Estado_Civil>` : '') +
    `<tem:Email>${escaparXml(t.email)}</tem:Email>` +
    `<tem:Id_Titular_Tipo>${t.idTitularTipo}</tem:Id_Titular_Tipo>` +
    `<tem:Genero>${t.genero ?? (esFisica ? 1 : 0)}</tem:Genero>` +
    `<tem:Tipo>${t.tipo ?? 1}</tem:Tipo>` +
    `<tem:Domicilios>${t.domicilios.map(xmlDomicilio).join('')}</tem:Domicilios>` +
    `</tem:Titulares>`
  );
}

function xmlSolicitante(s: SolicitanteWS): string {
  return (
    `<tem:Solicitantes>` +
    `<tem:TipoPersona>${escaparXml(s.tipoPersona)}</tem:TipoPersona>` +
    `<tem:PoderInscriptivo>${escaparXml(s.poderInscriptivo)}</tem:PoderInscriptivo>` +
    `<tem:aceptaFacultades>${s.aceptaFacultades ? 'true' : 'false'}</tem:aceptaFacultades>` +
    `<tem:Email>${escaparXml(s.email)}</tem:Email>` +
    (s.nombre ? `<tem:Nombre>${escaparXml(s.nombre)}</tem:Nombre>` : '') +
    (s.cuit ? `<tem:cuit>${escaparXml(s.cuit.replace(/\D/g, ''))}</tem:cuit>` : '') +
    (s.nroSolicitante != null ? `<tem:NroSolicitante>${s.nroSolicitante}</tem:NroSolicitante>` : '') +
    (s.nroPoder ? `<tem:NroPoder>${escaparXml(s.nroPoder)}</tem:NroPoder>` : '') +
    (s.fecha ? `<tem:Fecha>${escaparXml(s.fecha)}</tem:Fecha>` : '') +
    `</tem:Solicitantes>`
  );
}

/**
 * Carga una solicitud de marca nueva en el INPI.
 *
 * Requiere credenciales del WS (`INPI_WS_CUIT` + `INPI_WS_CLAVE`), que son
 * **distintas de la Clave Fiscal de ARCA**. La Clave Fiscal no interviene acá:
 * hace falta después, en el portal, para firmar.
 */
export async function ingresarMarcaNuevaWS(marca: MarcaNuevaWS): Promise<RespuestaIngresoWS> {
  const cuitUsuario = (process.env.INPI_WS_CUIT || '').replace(/\D/g, '');
  const claveUsuario = process.env.INPI_WS_CLAVE || '';

  if (!cuitUsuario || !claveUsuario) {
    throw new InpiWsError(
      'Faltan las credenciales del WS del INPI (INPI_WS_CUIT / INPI_WS_CLAVE)',
      'Ingresar_MarcasNuevas'
    );
  }

  const suma = marca.titulares.reduce((a, t) => a + Number(t.porcentaje || 0), 0);
  if (Math.abs(suma - 100) > 0.01) {
    throw new InpiWsError(
      `Los porcentajes de los titulares deben sumar 100 (suman ${suma})`,
      'Ingresar_MarcasNuevas'
    );
  }

  const cuerpo =
    `<tem:MarcaNueva>` +
      `<tem:Solicitud>` +
        `<tem:TipoS>${marca.tipoMarca ?? 1}</tem:TipoS>` +
        `<tem:Denominacion>${escaparXml(marca.denominacion)}</tem:Denominacion>` +
        `<tem:Clase>${marca.clase}</tem:Clase>` +
      `</tem:Solicitud>` +
      `<tem:Titulares>${marca.titulares.map(xmlTitular).join('')}</tem:Titulares>` +
      // Tipo_Proteccion: "S" es el único válido para marcas nuevas (Excel oficial)
      `<tem:Proteccion>` +
        `<tem:Tipo_Proteccion>S</tem:Tipo_Proteccion>` +
        `<tem:Observaciones>${escaparXml(marca.observacionesProteccion || '')}</tem:Observaciones>` +
      `</tem:Proteccion>` +
      // Los nodos de lista se mandan aunque vayan vacíos: el manual advierte que
      // omitirlos puede dar error de referencia nula del lado del servicio.
      (marca.solicitantes?.length
        ? `<tem:Solicitantes>${marca.solicitantes.map(xmlSolicitante).join('')}</tem:Solicitantes>`
        : `<tem:Solicitantes/>`) +
      (marca.documentacion?.length
        ? `<tem:Documentacion>${marca.documentacion
            .map((d) =>
              `<tem:Documentacion>` +
              `<tem:Documento>${d.documentoBase64}</tem:Documento>` +
              `<tem:idIndice>${d.idIndice}</tem:idIndice>` +
              `</tem:Documentacion>`
            )
            .join('')}</tem:Documentacion>`
        : `<tem:Documentacion/>`) +
      `<tem:DatosUsuario>` +
        `<tem:Cuit>${cuitUsuario}</tem:Cuit>` +
        `<tem:Activa>true</tem:Activa>` +
        `<tem:Clave>${escaparXml(claveUsuario)}</tem:Clave>` +
      `</tem:DatosUsuario>` +
    `</tem:MarcaNueva>`;

  const xml = await llamarSoap('Ingresar_MarcasNuevas', cuerpo);

  // La respuesta es un string simple dentro de Ingresar_MarcasNuevasResult
  const crudo =
    textoDe(xml, 'Ingresar_MarcasNuevasResult') ||
    textoDe(xml, 'Ingresar_MarcasNuevasResponse') ||
    xml;

  const res = parsearRespuestaIngreso(crudo);

  if (res.ok) {
    logger.info(`[INPI-WS] Marca "${marca.denominacion}" cl.${marca.clase} cargada — gestión ${res.orden}`);
  } else {
    logger.warn(`[INPI-WS] Carga rechazada para "${marca.denominacion}": ${res.mensaje}`);
  }
  return res;
}

// ── Diagnóstico ───────────────────────────────────────────────────────────────

/**
 * Verifica que el WS del INPI esté accesible y respondiendo.
 * Usa una denominación improbable para no traer un resultset grande.
 */
export async function verificarWS(): Promise<{
  ok: boolean;
  mensaje: string;
  latenciaMs?: number;
}> {
  const inicio = Date.now();
  try {
    await consultarDenominacionWS('ZZQXWV');
    return { ok: true, mensaje: 'WS del INPI accesible', latenciaMs: Date.now() - inicio };
  } catch (err: any) {
    return { ok: false, mensaje: err?.message || 'error desconocido', latenciaMs: Date.now() - inicio };
  }
}

export { InpiWsError };
