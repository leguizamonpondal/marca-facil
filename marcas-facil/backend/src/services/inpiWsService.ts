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
 * Modo de coincidencia del nombre del titular, equivalente al desplegable
 * del buscador del portal del INPI.
 */
export type ModoBusquedaTitular = 'empieza' | 'contiene';

/**
 * ⚠️ COMPORTAMIENTO NO DOCUMENTADO POR EL INPI
 *
 * El WS hace, de fábrica, una búsqueda de tipo "EMPIEZA CON": buscar
 * "INNOVATE" no encuentra "NIKE INNOVATE C.V".
 *
 * Verificado el 14/09/2026 que el servicio interpola el texto en una consulta
 * SQL LIKE, de modo que anteponer "%" activa el modo "CONTIENE":
 *   titular="INNOVATE"   →   0 resultados
 *   titular="%INNOVATE"  → 196 resultados
 *
 * Esto NO está documentado, así que puede dejar de funcionar sin aviso. Por eso
 * el modo por defecto es 'empieza' (el nativo): si el INPI cambiara la
 * implementación, se degrada a menos resultados en vez de romperse. Está
 * pendiente pedirle al INPI que confirme si hay un modo oficial.
 */
function prepararTitular(titular: string, modo: ModoBusquedaTitular): string {
  // Se quitan los comodines que venga escribiendo el usuario: si alguien busca
  // "50% OFF SA", ese % no debe interpretarse como comodín.
  const limpio = titular.replace(/[%_]/g, ' ').replace(/\s+/g, ' ').trim();
  if (limpio !== titular.trim()) {
    logger.warn(`[INPI-WS] Se quitaron comodines del titular: "${titular}" → "${limpio}"`);
  }
  return modo === 'contiene' && limpio ? `%${limpio}` : limpio;
}

export async function consultarCuitOTitularWS(params: {
  cuit?: string;
  titular?: string;
  modo?: ModoBusquedaTitular;
}): Promise<MarcaINPIWS[]> {
  const cuit = (params.cuit || '').replace(/[^\d]/g, '');
  const modo: ModoBusquedaTitular = params.modo === 'contiene' ? 'contiene' : 'empieza';
  const titular = prepararTitular(params.titular || '', modo);

  if (!cuit && !titular) return [];

  const xml = await llamarSoap(
    'ConsultaCuitOTitular',
    `<tem:cuit>${escaparXml(cuit)}</tem:cuit>` +
      `<tem:titular>${escaparXml(titular)}</tem:titular>`
  );
  return parsearGrillaMarcas(xml, `ConsultaCuitOTitular[${modo}]`);
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

/** Atajo por titular. `modo` por defecto: 'empieza' (ver prepararTitular). */
export async function buscarPorTitularWS(
  titular: string,
  modo: ModoBusquedaTitular = 'empieza'
): Promise<MarcaINPIWS[]> {
  return consultarCuitOTitularWS({ titular, modo });
}

/** Atajo por CUIT. */
export async function buscarPorCuitWS(cuit: string): Promise<MarcaINPIWS[]> {
  return consultarCuitOTitularWS({ cuit });
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
