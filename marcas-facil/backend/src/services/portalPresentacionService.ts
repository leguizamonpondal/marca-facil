/**
 * Portal de Trámites del INPI — firma, VEP y conciliación de pagos
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Cierra el circuito que el Web Service NO cubre. Según el propio INPI
 * (soporte informática, 14/09/2026): *"el WS es solo para la carga de los
 * trámites, el resto del circuito firma, generación de VEP debe realizarse
 * desde el portal de trámites"*.
 *
 *   1. Cargar la solicitud   → Web Service   (inpiWsService.ts)
 *   2. Firmar                → ESTE ARCHIVO
 *   3. Generar el VEP        → ESTE ARCHIVO
 *   4. Cobrar y conciliar    → ESTE ARCHIVO
 *
 * ── La arquitectura, y por qué es así ──────────────────────────────────────
 *
 * Protocolo obtenido de una captura HAR de tráfico real (18/09/2026), no de
 * documentación: el INPI no publica ninguna. Ver en el Project
 * `protocolo-http-firma-vep.md` y `protocolo-login-afip-inpi.md`.
 *
 * El hallazgo que define el diseño: **el portal no usa token anti-CSRF**. Sus
 * endpoints solo exigen la cookie de sesión y `X-Requested-With`. Por lo tanto
 * el navegador hace falta ÚNICAMENTE para el login:
 *
 *   · LOGIN  → Playwright. ARCA corre sobre JSF y exige un `javax.faces.
 *              ViewState` que se regenera en cada paso del formulario, así que
 *              no se puede replicar con fetch a secas.
 *   · RESTO  → fetch con la cookie. Sin DOM, sin selectores, sin esperas.
 *
 * Eso importa para el mantenimiento: lo que se rompe cuando el INPI rediseña
 * una pantalla son los selectores. Acá hay uno solo —el login— y apunta a
 * ARCA, que cambia mucho menos que el portal del INPI.
 *
 * ── Advertencias ───────────────────────────────────────────────────────────
 *
 * ⚠️ La Clave Fiscal NUNCA se loguea, ni siquiera enmascarada, ni en nivel
 *    debug. Tampoco se persiste: vive en variables de entorno.
 *
 * ⚠️ Ante un login fallido NO se reintenta en bucle. ARCA muestra captcha
 *    después de varios intentos y termina bloqueando la clave. Dos fallos y se
 *    corta con aviso.
 */
import { chromium } from 'playwright';
import { logger } from '../utils/logger';

// ── Configuración ────────────────────────────────────────────────────────────

const PORTAL = process.env.INPI_PORTAL_BASE || 'https://portaltramites.inpi.gob.ar';
const ARCA_SSO =
  process.env.ARCA_SSO_URL ||
  'https://auth.afip.gob.ar/contribuyente_/?action=SYSTEM&system=inpi_portal';

/**
 * Credenciales de Clave Fiscal del agente. Distintas de INPI_WS_CUIT /
 * INPI_WS_CLAVE, que son las del Web Service: el INPI entrega dos juegos
 * separados y no son intercambiables.
 */
const PORTAL_CUIT = () => (process.env.INPI_PORTAL_CUIT || '').replace(/\D/g, '');
const PORTAL_CLAVE = () => process.env.INPI_PORTAL_CLAVE || '';

/** Margen de seguridad para reautenticar antes de que el portal nos eche. */
const SESION_TTL_MS = Number(process.env.INPI_PORTAL_SESION_TTL_MS || 20 * 60 * 1000);

const TIMEOUT_LOGIN_MS = Number(process.env.INPI_PORTAL_LOGIN_TIMEOUT_MS || 60_000);
const TIMEOUT_HTTP_MS = Number(process.env.INPI_PORTAL_HTTP_TIMEOUT_MS || 45_000);

// ── Tipos ────────────────────────────────────────────────────────────────────

/**
 * Los nombres son los del portal, a propósito. Cuando un cliente llame por
 * teléfono va a leer la pestaña que tiene delante; conviene que la base diga
 * lo mismo que su pantalla.
 */
export type EstadoTramite =
  | 'incompletos'      // borrador, carga sin terminar
  | 'para_firmar'      // cargado por WS, esperando firma
  | 'para_ingresar'    // firmado, todavía sin VEP
  | 'en_proceso'       // VEP generado, esperando el pago
  | 'ingresados';      // pago acreditado, trámite ingresado

const ESTADO_CODIGO: Record<EstadoTramite, number> = {
  incompletos: 1,
  para_firmar: 2,
  para_ingresar: 6,
  en_proceso: 3,
  ingresados: 4,
};

export interface ComprobantePago {
  /** Nro de E-RECAUDA. Es la clave de conciliación: el mismo número que el
   *  `Identificador` impreso en el volante PDF. */
  nroERecauda: string;
  /** Texto crudo del portal: "Q-ERECAUDA - GENERADO", "CONFIRMADO", … */
  estadoVep: string;
  /** true solo cuando el portal dio el pago por acreditado. */
  pagado: boolean;
  montoPesos: number;
  presentacion?: string;
  usuarioCarga?: string;
}

export interface ResultadoPresentacion {
  idSolicitud: string;
  firmado: boolean;
  montoPesos: number;
  nroERecauda?: string;
  /** El volante con el QR, para mandarle al cliente. */
  volantePdf?: Buffer;
  advertencias: string[];
}

export class ErrorPortal extends Error {
  constructor(message: string, public readonly paso: string, public readonly detalle?: string) {
    super(message);
    this.name = 'ErrorPortal';
  }
}

// ── Sesión ───────────────────────────────────────────────────────────────────

interface Sesion {
  cookie: string;
  creadaEn: number;
  cuit: string;
}

let sesionActual: Sesion | null = null;
/** Serializa los logins concurrentes: sin esto, tres presentaciones simultáneas
 *  abren tres navegadores y disparan las alarmas de ARCA. */
let loginEnCurso: Promise<Sesion> | null = null;

function sesionVigente(): Sesion | null {
  if (!sesionActual) return null;
  if (Date.now() - sesionActual.creadaEn > SESION_TTL_MS) return null;
  return sesionActual;
}

export function invalidarSesion(): void {
  sesionActual = null;
}

/**
 * Login por Clave Fiscal. Único punto del servicio que usa un navegador.
 *
 * El circuito real (verificado): ARCA pide usuario, después clave, y responde
 * con un formulario auto-enviado que lleva un token SSO firmado al portal del
 * INPI. Ese token vive 300 segundos, así que hay que consumirlo en el acto —
 * no sirve guardarlo. El portal encadena entonces tres redirects
 * (ListaUsuarios → VerificacionUsuario → IniciarSesion) y deja la cookie.
 */
async function autenticar(): Promise<Sesion> {
  const cuit = PORTAL_CUIT();
  const clave = PORTAL_CLAVE();

  if (!cuit || !clave) {
    throw new ErrorPortal(
      'Faltan las credenciales del portal',
      'configuracion',
      'Definir INPI_PORTAL_CUIT e INPI_PORTAL_CLAVE en el entorno.'
    );
  }

  logger.info(`[Portal] Autenticando en ARCA con CUIT ${cuit}`);
  const inicio = Date.now();

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      locale: 'es-AR',
      timezoneId: 'America/Argentina/Buenos_Aires',
      viewport: { width: 1280, height: 800 },
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUT_LOGIN_MS);

    await page.goto(ARCA_SSO, { waitUntil: 'domcontentloaded' });

    // Paso 1 — usuario. El campo puede venir precargado por ARCA, así que se
    // limpia antes de escribir en vez de tipear encima.
    await page.fill('input[name="F1:username"]', '');
    await page.fill('input[name="F1:username"]', cuit);
    await page.click('input[name="F1:btnSiguiente"]');

    // Paso 2 — clave. Aparece con el ViewState ya renovado por el servidor;
    // Playwright lo reenvía solo al postear el formulario.
    await page.waitForSelector('input[name="F1:password"]', { state: 'visible' });

    // El captcha viaja vacío en condiciones normales. Si ARCA lo exige, no hay
    // nada que hacer automáticamente: se corta acá y se avisa.
    const captcha = page.locator('input[name="F1:captcha"]');
    if ((await captcha.count()) > 0 && (await captcha.first().isVisible())) {
      throw new ErrorPortal(
        'ARCA está pidiendo captcha',
        'login',
        'Suele pasar tras varios intentos fallidos o ante tráfico inusual. ' +
          'Hay que entrar a mano una vez desde un navegador y reintentar más tarde. ' +
          'NO reintentar automáticamente: se arriesga el bloqueo de la clave.'
      );
    }

    await page.fill('input[name="F1:password"]', clave);
    await page.click('input[name="F1:btnIngresar"]');

    // El SSO + los tres redirects del portal terminan en la home.
    await page.waitForURL((url) => url.hostname.includes('portaltramites.inpi.gob.ar'), {
      timeout: TIMEOUT_LOGIN_MS,
    });
    await page.waitForLoadState('domcontentloaded');

    // Verificación positiva: si seguimos en ARCA o el portal nos devolvió a la
    // pantalla de ingreso, la clave no entró.
    const urlFinal = page.url();
    if (!urlFinal.includes('portaltramites.inpi.gob.ar') || /\/Ingreso\/(Index)?$/i.test(urlFinal)) {
      throw new ErrorPortal(
        'El login no llegó al portal',
        'login',
        `Terminó en ${urlFinal}. Revisar que la Clave Fiscal sea la vigente y que ` +
          'el servicio "inpi_portal" siga habilitado en ARCA.'
      );
    }

    const cookies = await context.cookies();
    const cookie = cookies
      .filter((c) => c.domain.includes('inpi.gob.ar'))
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');

    if (!cookie) {
      throw new ErrorPortal('El portal no entregó cookie de sesión', 'login');
    }

    logger.info(`[Portal] Sesión abierta en ${Date.now() - inicio} ms`);
    return { cookie, creadaEn: Date.now(), cuit };
  } finally {
    await browser.close();
  }
}

async function obtenerSesion(forzar = false): Promise<Sesion> {
  if (!forzar) {
    const vigente = sesionVigente();
    if (vigente) return vigente;
  }
  if (loginEnCurso) return loginEnCurso;

  loginEnCurso = autenticar()
    .then(async (s) => {
      sesionActual = s;
      await calentarSesion(s);
      return s;
    })
    .finally(() => {
      loginEnCurso = null;
    });

  return loginEnCurso;
}

/**
 * Visita `/Home/MisTramites` una vez después del login.
 *
 * Por qué: en el tráfico real el navegador SIEMPRE carga esa página antes de
 * pedir `getTramites`, y el portal parece llevar estado de sesión del lado del
 * servidor (qué pantalla estás mirando). Pedir la grilla "en frío" devolvía
 * tablas vacías. Es una sola petición y se hace una vez por sesión.
 *
 * No es crítica: si falla, se sigue igual y el error aparecerá más adelante con
 * mejor contexto.
 */
async function calentarSesion(sesion: Sesion): Promise<void> {
  try {
    await fetch(`${PORTAL}/Home/MisTramites`, {
      headers: {
        Cookie: sesion.cookie,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-419,es;q=0.9',
      },
      redirect: 'follow',
    });
  } catch (err: any) {
    logger.warn(`[Portal] No se pudo precargar MisTramites: ${err?.message}`);
  }
}

// ── Cliente HTTP del portal ──────────────────────────────────────────────────

/**
 * Cuando la sesión caduca, el portal no devuelve 401: redirige al login y
 * responde HTML con 200. Detectarlo por el contenido es la única forma.
 */
function pareceLogin(texto: string, contentType: string): boolean {
  if (contentType.includes('application/json')) return false;
  return /Ingreso\/Index|auth\.afip\.gob\.ar|Clave Fiscal/i.test(texto);
}

interface OpcionesPeticion {
  metodo?: 'GET' | 'POST';
  json?: unknown;
  form?: Record<string, string>;
  binario?: boolean;
}

async function portalRequest(
  ruta: string,
  opts: OpcionesPeticion = {},
  reintento = false
): Promise<{ texto: string; buffer?: Buffer; contentType: string }> {
  const sesion = await obtenerSesion();
  const metodo = opts.metodo || (opts.json || opts.form ? 'POST' : 'GET');

  const headers: Record<string, string> = {
    Cookie: sesion.cookie,
    'X-Requested-With': 'XMLHttpRequest',
    Accept: opts.binario ? '*/*' : 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'es-419,es;q=0.9',
    Origin: PORTAL,
    Referer: `${PORTAL}/Home/MisTramites`,
  };

  let body: string | undefined;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json; charset=UTF-8';
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    body = new URLSearchParams(opts.form).toString();
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_HTTP_MS);

  let res: Response;
  try {
    res = await fetch(`${PORTAL}${ruta}`, {
      method: metodo,
      headers,
      body,
      redirect: 'follow',
      signal: controller.signal,
    });
  } catch (err: any) {
    throw new ErrorPortal(
      `No se pudo contactar al portal (${ruta})`,
      'red',
      err?.name === 'AbortError' ? `Timeout de ${TIMEOUT_HTTP_MS} ms` : err?.message
    );
  } finally {
    clearTimeout(timer);
  }

  const contentType = res.headers.get('content-type') || '';

  if (opts.binario) {
    const buffer = Buffer.from(await res.arrayBuffer());
    // Un PDF empieza con "%PDF". Si vino HTML, la sesión se cayó.
    if (buffer.subarray(0, 4).toString() !== '%PDF') {
      const texto = buffer.toString('utf8', 0, 2000);
      if (!reintento && pareceLogin(texto, contentType)) {
        invalidarSesion();
        await obtenerSesion(true);
        return portalRequest(ruta, opts, true);
      }
      throw new ErrorPortal(`El portal no devolvió un PDF en ${ruta}`, 'descarga', texto.slice(0, 300));
    }
    return { texto: '', buffer, contentType };
  }

  const texto = await res.text();

  if (!reintento && pareceLogin(texto, contentType)) {
    logger.warn('[Portal] La sesión caducó — reautenticando');
    invalidarSesion();
    await obtenerSesion(true);
    return portalRequest(ruta, opts, true);
  }

  if (!res.ok) {
    throw new ErrorPortal(`El portal respondió ${res.status} en ${ruta}`, 'http', texto.slice(0, 300));
  }

  return { texto, contentType };
}

/** Las respuestas JSON del portal son a veces un string suelto: `"40569"`. */
function parsearJson(texto: string): any {
  try {
    return JSON.parse(texto);
  } catch {
    return texto;
  }
}

// ── Operaciones ──────────────────────────────────────────────────────────────

/** Los IDs viajan separados por coma, tal como los manda el portal. */
function listaIds(ids: string | string[]): string {
  return (Array.isArray(ids) ? ids : [ids]).map((i) => String(i).trim()).filter(Boolean).join(',');
}

/**
 * Precondición dura de la firma. Si devuelve false hay que abortar antes de
 * tocar nada más: seguir adelante deja el trámite a medio camino.
 */
export async function puedeFirmar(ids: string | string[]): Promise<boolean> {
  const sesion = await obtenerSesion();
  const { texto } = await portalRequest('/Home/ValidacionCUITFirmante', {
    json: { ids: listaIds(ids), cuitActual: Number(sesion.cuit) },
  });
  const r = parsearJson(texto);
  return r?.data === true;
}

/**
 * Firma uno o varios trámites. `rfaccion: 6` es la acción de firma.
 * El trámite pasa de "Trámites para Firmar" a "Trámites para Ingresar".
 */
export async function firmarTramites(ids: string | string[]): Promise<string> {
  const lista = listaIds(ids);

  if (!(await puedeFirmar(lista))) {
    throw new ErrorPortal(
      `El portal no habilita la firma de ${lista}`,
      'firma',
      'Verificar que el trámite exista, que esté en "Trámites para Firmar" y que ' +
        'el CUIT configurado sea el que lo cargó.'
    );
  }

  const { texto } = await portalRequest('/ERecauda/ProcesarIndex', {
    json: {
      rfaccion: '6',
      rfcuitpagador: '',
      rfactas: lista,
      rfmontoTotal: '0',
      rfRgBancos: '-1',
      rfpago: 'n',
    },
  });

  const mensaje = String(parsearJson(texto));
  if (/error/i.test(mensaje)) {
    throw new ErrorPortal(`El portal rechazó la firma de ${lista}`, 'firma', mensaje);
  }

  logger.info(`[Portal] Firmado ${lista}: ${mensaje}`);
  return mensaje;
}

/** Arancel en pesos, ya con el valor UMAPI del mes aplicado por el INPI. */
export async function calcularMonto(ids: string | string[]): Promise<number> {
  const { texto } = await portalRequest('/erecauda/CalcularMonto', {
    json: { rfactas: listaIds(ids) },
  });
  const monto = Number(String(parsearJson(texto)).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(monto) || monto <= 0) {
    throw new ErrorPortal('El portal devolvió un arancel inválido', 'arancel', texto.slice(0, 200));
  }
  return monto;
}

/**
 * Genera el VEP con QR **a nombre del cliente**.
 *
 * Esto es lo que resuelve el problema del modelo de negocio: como el ingreso
 * de la app es una suscripción mensual, el estudio no puede adelantar el
 * arancel de cada presentación. El portal permite emitir el volante contra el
 * CUIT de un tercero, y el QR lo paga el cliente desde Mercado Pago, Cuenta DNI
 * o E-Pagos.
 *
 * ⚠️ El VEP vence el primer día hábil siguiente al de su generación. Si no se
 *    paga hay que volver a cargar el trámite.
 */
export async function generarVepQR(
  ids: string | string[],
  cuitPagador: string,
  montoEsperado?: number
): Promise<number> {
  const lista = listaIds(ids);
  const cuit = String(cuitPagador).replace(/\D/g, '');

  if (cuit.length !== 11) {
    throw new ErrorPortal(`CUIT del pagador inválido: "${cuitPagador}"`, 'vep');
  }

  const monto = await calcularMonto(lista);

  // Control cruzado contra nuestro propio cálculo (UMAPI × valor del mes). Si
  // no coinciden, algo cambió del lado del INPI: mejor frenar que emitir un
  // volante por el importe equivocado.
  if (montoEsperado !== undefined && Math.abs(monto - montoEsperado) > 1) {
    throw new ErrorPortal(
      `El arancel del portal no coincide con el calculado`,
      'arancel',
      `Portal: $${monto} · Calculado: $${montoEsperado}. Revisar el valor UMAPI del mes.`
    );
  }

  // Validaciones que el portal dispara siempre, aunque sean de patentes y de
  // renovaciones. Replicarlas es gratis y nos cubre si empieza a exigirlas.
  await portalRequest('/Home/ValidarAnualidadesConVep', { form: { idsol: lista } });
  await portalRequest('/Home/TieneRenovacionesVencidas', { json: { ids: lista } });

  const { texto } = await portalRequest('/ERecauda/ProcesarIndex', {
    json: {
      // Sí, es un string con una URL adentro y no un número: el JavaScript del
      // portal pasa la ruta como si fuera el código de acción. Va tal cual.
      rfaccion: '/ERecauda/ProcesarIndex?accion=3',
      rfcuitpagador: cuit,
      rfactas: lista,
      rfmontoTotal: String(monto),
      rfRgBancos: '0000',   // "0000" = QR. Un código de banco real daría VEP bancario.
      rfpago: 'QR',
    },
  });

  const mensaje = String(parsearJson(texto));
  if (/error/i.test(mensaje)) {
    throw new ErrorPortal(`El portal rechazó la generación del VEP`, 'vep', mensaje);
  }

  logger.info(`[Portal] VEP generado para ${lista} — $${monto} a CUIT ${cuit}`);
  return monto;
}

/**
 * Lee una de las grillas de "Mis Trámites".
 *
 * `en_proceso` (estado 3) es el feed de conciliación: trae el Nro de E-Recauda
 * junto al estado del VEP.
 */
/**
 * Devuelve el HTML crudo de una grilla, sin parsear. Solo para diagnóstico:
 * cuando una lista vuelve vacía hay que poder distinguir entre "el portal no
 * devolvió nada", "devolvió la pantalla de login" y "el parser falló".
 */
export async function obtenerGrillaCruda(
  estado: EstadoTramite,
  take = 200
): Promise<{ largo: number; tieneTabla: boolean; pareceLogin: boolean; muestra: string }> {
  const { texto, contentType } = await portalRequest(
    `/Home/getTramites?estado=${ESTADO_CODIGO[estado]}&skip=0&take=${take}`,
    { metodo: 'GET' }
  );
  return {
    largo: texto.length,
    tieneTabla: /<tbody[\s>]/i.test(texto),
    pareceLogin: pareceLogin(texto, contentType),
    muestra: texto.slice(0, 3000),
  };
}

export interface SolicitudGrilla {
  idSolicitud: string;
  clase?: number;
  acta?: string;
  descripcion?: string;
}

/**
 * Parsea las grillas de SOLICITUDES (incompletos, para firmar, para ingresar).
 *
 * Son otra tabla que la de comprobantes y necesitan otro parser: acá no hay Nro
 * de E-Recauda todavía. El ancla es el atributo `data-idsol` de cada fila, que
 * es justo el ID que después se usa para firmar.
 */
export function parsearGrillaSolicitudes(html: string): SolicitudGrilla[] {
  const out: SolicitudGrilla[] = [];
  const vistos = new Set<string>();

  for (const m of html.matchAll(/<tr[^>]*\bdata-idsol="(\d+)"([^>]*)>([\s\S]*?)<\/tr>/gi)) {
    const idSolicitud = m[1];
    if (vistos.has(idSolicitud)) continue;
    vistos.add(idSolicitud);

    const clase = m[2].match(/data-clase="(\d+)"/i);
    const celdas = [...m[3].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) =>
      c[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
    );

    out.push({
      idSolicitud,
      clase: clase ? Number(clase[1]) : undefined,
      // El acta llega recién cuando el INPI ingresa el trámite; antes es "0".
      acta: celdas.find((c) => /^\d{7,8}$/.test(c) && c !== idSolicitud),
      descripcion: celdas.find((c) => /[A-Za-zÁÉÍÓÚÑ]{3,}/.test(c) && c.length < 120),
    });
  }

  return out;
}

/** Lista las solicitudes de una grilla (no los comprobantes de pago). */
export async function listarSolicitudes(
  estado: EstadoTramite = 'para_firmar',
  take = 200
): Promise<SolicitudGrilla[]> {
  const { texto } = await portalRequest(
    `/Home/getTramites?estado=${ESTADO_CODIGO[estado]}&skip=0&take=${take}`,
    { metodo: 'GET' }
  );
  return parsearGrillaSolicitudes(texto);
}

export async function listarComprobantes(
  estado: EstadoTramite = 'en_proceso',
  take = 200
): Promise<ComprobantePago[]> {
  const { texto } = await portalRequest(
    `/Home/getTramites?estado=${ESTADO_CODIGO[estado]}&skip=0&take=${take}`,
    { metodo: 'GET' }
  );
  return parsearGrillaComprobantes(texto);
}

/**
 * Parser de la grilla. Se hace por regex a propósito: agregar un parser de DOM
 * por cinco columnas no se justifica, y la estructura de la tabla es estable
 * desde hace años.
 */
export function parsearGrillaComprobantes(html: string): ComprobantePago[] {
  const filas = html.split(/<tr[\s>]/i).slice(1);
  const out: ComprobantePago[] = [];

  for (const fila of filas) {
    const celdas = [...fila.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
      m[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
        .replace(/&amp;/g, '&')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    );
    if (celdas.length < 6) continue;

    // Nro de E-Recauda: 12 dígitos, en la primera celda que sea solo numérica.
    const nro = celdas.find((c) => /^\d{10,14}$/.test(c));
    if (!nro) continue;

    const estadoVep = celdas.find((c) => /erecauda|generado|confirmado|pagad|anulad/i.test(c)) || '';
    const montoTxt = celdas.find((c) => /^\$/.test(c)) || '0';
    const presentacion = celdas.find((c) => /\d{2}\/\d{2}\/\d{4}/.test(c));
    const usuarioCarga = celdas.find((c) => /[A-Za-zÁÉÍÓÚÑ]{4,}\s+[A-Za-zÁÉÍÓÚÑ]{4,}/.test(c));

    out.push({
      nroERecauda: nro,
      estadoVep,
      // El portal marca el pago acreditado como "Confirmado". "GENERADO"
      // significa emitido y todavía impago.
      pagado: /confirmad|acreditad|pagad/i.test(estadoVep),
      montoPesos: Number(montoTxt.replace(/[^\d]/g, '')) || 0,
      presentacion,
      usuarioCarga,
    });
  }

  return out;
}

/** El volante PDF con el QR — el archivo que se le manda al cliente. */
export async function descargarVolante(nroERecauda: string): Promise<Buffer> {
  const nro = String(nroERecauda).replace(/\D/g, '');
  const { buffer } = await portalRequest(
    `/ERecauda/Consulta?Id_Comprobante=${nro}`,
    { metodo: 'GET', binario: true }
  );
  return buffer!;
}

/**
 * Elimina una solicitud cargada (`rfaccion: 4`).
 *
 * Pensado para limpiar los trámites de prueba. El espacio delante del ID no es
 * un descuido: así lo manda el propio portal.
 */
export async function eliminarSolicitud(idSolicitud: string): Promise<string> {
  const { texto } = await portalRequest('/ERecauda/ProcesarIndex', {
    json: {
      rfaccion: 4,
      rfcuitpagador: '',
      rfactas: ` ${String(idSolicitud).trim()}`,
      rfmontoTotal: 0,
      rfRgBancos: 0,
      rfpago: 0,
    },
  });
  const mensaje = String(parsearJson(texto));
  logger.warn(`[Portal] Solicitud ${idSolicitud} eliminada: ${mensaje}`);
  return mensaje;
}

// ── Orquestación ─────────────────────────────────────────────────────────────

/**
 * El circuito completo, de la carga por WS al volante en la mano del cliente.
 *
 * Los pasos son secuenciales y el orden importa: no se puede calcular el
 * arancel de un trámite sin firmar, ni generar el VEP antes de tener el monto.
 *
 * Diseño deliberado: **si falla la lectura del Nro de E-Recauda o la descarga
 * del volante, NO se lanza excepción.** Para ese momento el VEP ya existe y el
 * trámite ya está firmado; tirar un error haría que el llamador lo diera por
 * fracasado y reintentara, generando un segundo VEP por el mismo trámite. Esos
 * dos pasos son de lectura y se recuperan después con `listarComprobantes()`.
 */
export async function presentarYGenerarVep(
  idSolicitud: string,
  cuitPagador: string,
  montoEsperado?: number
): Promise<ResultadoPresentacion> {
  const id = String(idSolicitud).trim();
  const advertencias: string[] = [];

  await firmarTramites(id);
  const montoPesos = await generarVepQR(id, cuitPagador, montoEsperado);

  const resultado: ResultadoPresentacion = {
    idSolicitud: id,
    firmado: true,
    montoPesos,
    advertencias,
  };

  try {
    const comprobantes = await listarComprobantes('en_proceso');
    // El recién generado es el más nuevo por el importe correspondiente. El
    // portal ordena la grilla por fecha descendente.
    const propio = comprobantes.find((c) => c.montoPesos === montoPesos && !c.pagado);
    if (propio) {
      resultado.nroERecauda = propio.nroERecauda;
      resultado.volantePdf = await descargarVolante(propio.nroERecauda);
    } else {
      advertencias.push(
        'El VEP se generó pero no se pudo identificar su Nro de E-Recauda en la grilla. ' +
          'Recuperarlo con listarComprobantes("en_proceso").'
      );
    }
  } catch (err: any) {
    advertencias.push(`El VEP se generó, pero falló la descarga del volante: ${err?.message}`);
    logger.error(`[Portal] Volante no descargado para ${id}: ${err?.message}`);
  }

  return resultado;
}

/**
 * Rutina de conciliación. Devuelve los comprobantes que el portal da por
 * cobrados, para cruzarlos contra la base y avanzar el estado del trámite.
 *
 * Nota operativa: el portal advierte que la acreditación "puede demorar hasta
 * 15 días". En la experiencia del estudio impacta dentro de las 24 horas. La
 * rutina se diseña para el caso normal —correr a diario— pero el mensaje al
 * cliente no debe prometer un plazo: "normalmente al día siguiente".
 */
export async function conciliarPagos(): Promise<{
  pagados: ComprobantePago[];
  pendientes: ComprobantePago[];
}> {
  const enProceso = await listarComprobantes('en_proceso');
  return {
    pagados: enProceso.filter((c) => c.pagado),
    pendientes: enProceso.filter((c) => !c.pagado),
  };
}
