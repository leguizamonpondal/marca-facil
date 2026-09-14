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
 * ConsultaDenominacion y ConsultaCuitOTitular devuelven la misma forma:
 *   total (int) · estado (string) · rows → GrillaMarcas[]
 */
function parsearGrillaMarcas(xml: string, operacion: string): MarcaINPI[] {
  const total = textoDe(xml, 'total');
  const estadoConsulta = textoDe(xml, 'estado');
  const filas = bloquesDe(xml, 'GrillaMarcas');

  logger.info(
    `[INPI-WS] ${operacion} → total="${total}" estado="${estadoConsulta}" filas=${filas.length}`
  );

  return filas.map((fila) => {
    const claseTexto = textoDe(fila, 'Clase');
    const clase = parseInt(claseTexto, 10);
    return {
      acta: textoDe(fila, 'Acta'),
      denominacion: textoDe(fila, 'Denominacion'),
      claseNiza: Number.isFinite(clase) ? clase : 0,
      tipoMarca: textoDe(fila, 'Tipo_Marca'),
      titular: textoDe(fila, 'Titulares'),
      nroResolucion: textoDe(fila, 'Numero_Resolucion'),
      estado: textoDe(fila, 'Estado'),
      fechaSolicitud: soloFecha(textoDe(fila, 'Fecha_Ingreso')),
    } as MarcaINPI;
  });
}

// ── Operaciones públicas (sin credenciales) ───────────────────────────────────

/**
 * Busca marcas por denominación.
 * Operación pública: no requiere CUIT ni clave.
 */
export async function consultarDenominacionWS(denominacion: string): Promise<MarcaINPI[]> {
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
export async function consultarCuitOTitularWS(params: {
  cuit?: string;
  titular?: string;
}): Promise<MarcaINPI[]> {
  const cuit = (params.cuit || '').replace(/[^\d]/g, '');
  const titular = (params.titular || '').trim();

  if (!cuit && !titular) return [];

  const xml = await llamarSoap(
    'ConsultaCuitOTitular',
    `<tem:cuit>${escaparXml(cuit)}</tem:cuit>` +
      `<tem:titular>${escaparXml(titular)}</tem:titular>`
  );
  return parsearGrillaMarcas(xml, 'ConsultaCuitOTitular');
}

/** Atajo por titular. */
export async function buscarPorTitularWS(titular: string): Promise<MarcaINPI[]> {
  return consultarCuitOTitularWS({ titular });
}

/** Atajo por CUIT. */
export async function buscarPorCuitWS(cuit: string): Promise<MarcaINPI[]> {
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
