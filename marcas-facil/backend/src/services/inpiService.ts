/**
 * Servicio de integración con el portal INPI (Trámites en Línea)
 * Autenticación vía ARCA (ex-AFIP) Clave Fiscal nivel 2+
 *
 * URLs configurables vía variables de entorno:
 *   ARCA_AUTH_URL    — portal de login ARCA (default: auth.afip.gob.ar)
 *   INPI_PORTAL_URL  — portal trámites INPI
 *
 * ⚠ Las credenciales CUIT/Clave Fiscal nunca se persisten en BD.
 *   Se reciben en el request, se usan y se descartan al cerrar el browser.
 */
import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { logger } from '../utils/logger';
 
// ── Utilidades ───────────────────────────────────────────────────────────────
/** Convierte el formato de fecha .NET /Date(ms)/ a string ISO o vacío */
function parseDotNetDate(val: any): string | undefined {
  if (!val) return undefined;
  const s = String(val);
  const m = s.match(/\/Date\((-?\d+)\)\//);
  if (m) {
    const ms = parseInt(m[1]);
    if (isNaN(ms) || ms < -2208988800000) return undefined; // anterior a 1900 → ignorar
    return new Date(ms).toISOString().slice(0, 10); // "YYYY-MM-DD"
  }
  return s || undefined;
}
 
// ── URLs ─────────────────────────────────────────────────────────────────────
const ARCA_AUTH_URL =
  process.env.ARCA_AUTH_URL ||
  'https://auth.afip.gob.ar/contribuyente_/login.xhtml';
const INPI_PORTAL_URL =
  process.env.INPI_PORTAL_URL ||
  'https://portaltramitesline.inpi.gob.ar/';
 
// ── Tipos ────────────────────────────────────────────────────────────────────
export interface CredencialesARCA {
  cuit: string;      // sin guiones: "20123456789"
  claveFiscal: string;
}
 
export interface EstadoActa {
  acta: string;
  denominacion: string;
  claseNiza: number;
  tipoMarca: string;
  estado: string;
  titular: string;
  fechaSolicitud?: string;
  fechaPublicacion?: string;
  observaciones?: string;
  raw?: Record<string, string>;  // todos los campos que devuelva el portal
}
 
export interface ResultadoSolicitud {
  acta: string;             // número de acta asignado por INPI
  fechaPresentacion: string;
  comprobante?: string;     // URL o texto del comprobante
  mensaje: string;
}
 
export interface PasosSolicitud {
  paso: number;
  descripcion: string;
  estado: 'pendiente' | 'completado' | 'error';
  detalle?: string;
}
 
// ── Helper: launch con opciones ───────────────────────────────────────────────
async function lanzarBrowser(): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
  });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
 
  // Ocultar señales de automatización
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
 
  return { browser, context, page };
}
 
// ── Autenticación ARCA ────────────────────────────────────────────────────────
/**
 * Navega al portal ARCA, ingresa CUIT + Clave Fiscal y espera
 * la redirección de vuelta al portal INPI.
 *
 * El portal AFIP/ARCA usa un formulario de dos pasos:
 *   1. Pantalla CUIT → Continuar
 *   2. Pantalla Clave Fiscal → Ingresar
 */
async function autenticarARCA(page: Page, creds: CredencialesARCA): Promise<void> {
  logger.info('[INPI] Iniciando autenticación ARCA');
 
  // Paso 1: cargar el portal INPI y hacer click en "Acceder con Clave Fiscal"
  await page.goto(INPI_PORTAL_URL, { waitUntil: 'networkidle', timeout: 30_000 });
 
  // Buscar el botón de login ARCA/AFIP en INPI
  const loginBtn = page.locator('a[href*="afip"], a[href*="arca"], button:has-text("Clave Fiscal"), a:has-text("Clave Fiscal"), a:has-text("AFIP"), a:has-text("ARCA")').first();
  if (await loginBtn.count() === 0) {
    // Intentar URL directa del servicio INPI en AFIP
    await page.goto(ARCA_AUTH_URL, { waitUntil: 'networkidle', timeout: 30_000 });
  } else {
    await loginBtn.click();
    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30_000 });
  }
 
  // Paso 2: pantalla CUIT
  await page.waitForSelector('input[name="F1:username"], input[id*="cuit"], input[type="text"]', { timeout: 15_000 });
  const inputCuit = page.locator('input[name="F1:username"], input[id*="cuit"]').first();
  await inputCuit.fill(creds.cuit);
  await page.click('input[name="F1:btnSiguiente"], button[id*="siguiente"], input[value="Siguiente"]');
 
  // Paso 3: pantalla Clave Fiscal
  await page.waitForSelector('input[name="F1:password"], input[type="password"]', { timeout: 15_000 });
  await page.fill('input[name="F1:password"], input[type="password"]', creds.claveFiscal);
  await page.click('input[name="F1:btnIngresar"], button[id*="ingresar"], input[value="Ingresar"]');
 
  // Esperar redirect de vuelta (INPI o selector de servicios ARCA)
  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30_000 });
 
  // Si hay pantalla de selección de servicio INPI, hacer click
  const inpiLink = page.locator('a:has-text("INPI"), a[href*="inpi"]').first();
  if (await inpiLink.count() > 0) {
    await inpiLink.click();
    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30_000 });
  }
 
  logger.info('[INPI] Autenticación ARCA completada');
}
 
// ── Consulta de estado de acta ────────────────────────────────────────────────
export async function consultarEstadoActa(
  acta: string,
  creds: CredencialesARCA,
): Promise<EstadoActa> {
  const { browser, page } = await lanzarBrowser();
 
  try {
    await autenticarARCA(page, creds);
 
    // Navegar a la sección Consultas / Estado de trámite
    const consultaUrl = `${INPI_PORTAL_URL}consultas/estado-tramite`;
    await page.goto(consultaUrl, { waitUntil: 'networkidle', timeout: 20_000 });
 
    // Completar campo de número de acta
    const inputActa = page.locator('input[name*="acta"], input[placeholder*="acta"], input[id*="acta"]').first();
    await inputActa.fill(acta);
    await page.click('button[type="submit"], input[type="submit"], button:has-text("Buscar"), button:has-text("Consultar")');
    await page.waitForLoadState('networkidle', { timeout: 20_000 });
 
    // Extraer datos del resultado usando la API de locators de Playwright (sin DOM types)
    const getLocatorText = async (selectors: string[]): Promise<string> => {
      for (const sel of selectors) {
        const el = page.locator(sel).first();
        if (await el.count() > 0) {
          const txt = await el.innerText().catch(() => '');
          if (txt.trim()) return txt.trim();
        }
      }
      return '';
    };
 
    const resultado = {
      denominacion: await getLocatorText(['[class*="denominacion"]', '.marca-nombre', 'td:nth-of-type(2)']),
      estado:       await getLocatorText(['[class*="estado"]', '.tramite-estado']),
      titular:      await getLocatorText(['[class*="titular"]', '.titular-nombre']),
      claseNiza:    await getLocatorText(['[class*="clase"]']),
      tipoMarca:    await getLocatorText(['[class*="tipo"]']),
      fechaSolicitud:  await getLocatorText(['[class*="fecha-solicitud"]', '.fecha-presentacion']),
      fechaPublicacion: await getLocatorText(['[class*="fecha-publicacion"]', '.fecha-boletin']),
      observaciones: await getLocatorText(['[class*="observacion"]', '.obs']),
    };
 
    // Fallback: si no extrae bien, tomar el HTML crudo de la tabla de resultados
    if (!resultado.denominacion && !resultado.estado) {
      const tablaTexto = await page.locator('table, .resultado, .tramite-detalle').first().innerText().catch(() => '');
      logger.warn(`[INPI] Extracción parcial para acta ${acta}. HTML: ${tablaTexto.slice(0, 300)}`);
    }
 
    return {
      acta,
      denominacion: resultado.denominacion || '(no disponible)',
      claseNiza: parseInt(resultado.claseNiza) || 0,
      tipoMarca: resultado.tipoMarca || '',
      estado: resultado.estado || 'Desconocido',
      titular: resultado.titular || '',
      fechaSolicitud: resultado.fechaSolicitud || undefined,
      fechaPublicacion: resultado.fechaPublicacion || undefined,
      observaciones: resultado.observaciones || undefined,
    };
  } finally {
    await browser.close();
  }
}
 
// ── Búsqueda de marcas por denominación en INPI (para factibilidad) ──────────
/**
 * Busca marcas en el registro argentino del INPI por denominación y clase.
 * No requiere autenticación.
 *
 * Estrategia (en orden):
 *   1. TMView API — base de datos internacional que incluye INPI Argentina.
 *      Confiable, sin scraping, respuesta JSON directa.
 *   2. Playwright sobre el portal público del INPI — fallback si TMView falla.
 *   3. Si ambas fallan, devuelve [] sin tirar error (degradación elegante).
 *
 * TMView (tmdn.org) agrega datos del INPI Argentina y es la fuente más confiable
 * para consultas automatizadas sin autenticación.
 */
export interface MarcaINPI {
  acta: string;
  denominacion: string;
  claseNiza: number;
  tipoMarca: string;
  titular: string;
  titularCuit?: string;   // CUIT del titular si el INPI lo devuelve
  nroResolucion: string;
  estado: string;
  fechaSolicitud?: string;
  fechaPublicacion?: string;
  vencimiento?: string;
}
 
/**
 * Busca marcas en el INPI Argentina mediante POST directo al endpoint JSON real.
 *
 * Endpoint descubierto mediante análisis de tráfico de red del portal:
 *   POST https://portaltramites.inpi.gob.ar/MarcasConsultas/GrillaMarcasAvanzada
 *   Content-Type: application/json
 *   Requiere cookies de sesión (se obtienen con GET previo al portal)
 *
 * La respuesta es JSON con la lista de marcas.
 */
/**
 * Parámetros de búsqueda para el INPI.
 * - clase: número de clase NIZA, o 0 para todas las clases
 * - denominacion: texto a buscar (puede ser vacío si se busca por titular)
 * - titular: nombre del titular (puede ser vacío si se busca por denominación)
 */
interface ParamsBusquedaINPI {
  denominacion?: string;
  clase?: number;         // 0 = todas las clases
  titular?: string;
}
 
async function buscarPorPostINPI(
  denominacionOrParams: string | ParamsBusquedaINPI,
  claseArg?: number,
): Promise<MarcaINPI[]> {
  // Compatibilidad hacia atrás: acepta (string, number) o ({ denominacion, clase, titular })
  let denominacion = '';
  let clase = 0;
  let titular = '';
  if (typeof denominacionOrParams === 'string') {
    denominacion = denominacionOrParams;
    clase = claseArg ?? 0;
  } else {
    denominacion = denominacionOrParams.denominacion ?? '';
    clase = denominacionOrParams.clase ?? 0;
    titular = denominacionOrParams.titular ?? '';
  }
 
  const { default: axios } = await import('axios');
 
  const BASE = 'https://portaltramites.inpi.gob.ar';
  const BUSQUEDA_URL = `${BASE}/marcasconsultas/busqueda/?Cod_Funcion=NQA0ADEA`;
  const GRILLA_URL = `${BASE}/MarcasConsultas/GrillaMarcasAvanzada`;
 
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
 
  // Paso 1: GET al portal para obtener cookies de sesión (ASP.NET Session)
  let cookies = '';
  try {
    const { headers: respHeaders } = await axios.get(BUSQUEDA_URL, {
      timeout: 15_000,
      headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'es-AR,es;q=0.9' },
    });
    const setCookie = respHeaders['set-cookie'] || [];
    cookies = Array.isArray(setCookie)
      ? setCookie.map((c: string) => c.split(';')[0]).join('; ')
      : String(setCookie).split(';')[0];
    logger.info(`[INPI POST] Sesión establecida. Cookies: ${cookies.slice(0, 80)}...`);
  } catch (err: any) {
    logger.warn(`[INPI POST] Error obteniendo sesión: ${err.message}`);
  }
 
  const marcas: MarcaINPI[] = [];
 
  // Paso 2: POST JSON al endpoint real descubierto
  // clase=0 → Clase: '' → todas las clases (igual que el portal del INPI sin filtro)
  try {
    const jsonBody = {
      Tipo_Resolucion: '',
      Clase: clase > 0 ? String(clase) : '',
      TipoBusquedaDenominacion: '0',   // 0 = Contiene
      Denominacion: denominacion,
      Titular: titular,
      TipoBusquedaTitular: '0',        // 0 = Contiene
      Fecha_IngresoDesde: '',
      Fecha_IngresoHasta: '',
      Fecha_ResolucionDesde: '',
      Fecha_ResolucionHasta: '',
      vigentes: true,   // solo marcas vigentes — equivalente al checkbox "SOLO VIGENTES" del portal INPI
      limit: 50,
      offset: 0,
    };
 
    const { data } = await axios.post(GRILLA_URL, jsonBody, {
      timeout: 25_000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': UA,
        'Referer': BUSQUEDA_URL,
        'Origin': BASE,
        'Accept-Language': 'es-AR,es;q=0.9',
        ...(cookies ? { Cookie: cookies } : {}),
      },
      maxRedirects: 0,
    });
 
    logger.info(`[INPI POST] Respuesta JSON recibida: ${JSON.stringify(data).length} bytes`);
 
    // Parsear respuesta JSON
    // La respuesta puede ser: array directo, { data: [...] }, { marcas: [...] }, { rows: [...] }
    const lista: any[] = Array.isArray(data)
      ? data
      : (data?.data ?? data?.marcas ?? data?.rows ?? data?.resultado ?? []);
 
    for (const item of lista) {
      const acta = String(item.Acta ?? item.acta ?? item.NumActa ?? item.nro_acta ?? '').replace(/\D/g, '');
      const denom = String(item.Denominacion ?? item.denominacion ?? item.nombre ?? '').trim();
      if (!acta || acta.length < 3 || !denom) continue;
      marcas.push({
        acta,
        denominacion: denom,
        claseNiza: parseInt(String(item.Clase ?? item.clase ?? clase)) || clase,
        tipoMarca: String(item.TipoMarca ?? item.Tipo_Marca ?? item.tipoMarca ?? '').trim(),
        // El INPI devuelve el titular como: "20284614780 LEGUIZAMON PONDAL HONORIO MARTINIANO 100.00%"
        // Intentamos capturar el campo con distintos nombres posibles
        ...(() => {
          const raw = String(
            item.TitularesAsignados ?? item.Titulares ?? item.titularesAsignados ??
            item.Titular ?? item.titular ?? item.razon_social ?? ''
          ).trim();
          // Extraer CUIT y nombre del formato "CUIT NOMBRE 100.00%"
          const m = raw.match(/^(\d{10,11})\s+(.+?)(?:\s+\d+[\.,]\d+%.*)?$/);
          return {
            titular: m ? m[2].trim() : raw,
            titularCuit: m ? m[1] : undefined,
          };
        })(),
        nroResolucion: String(item.NroResolucion ?? item.Nro_Resolucion ?? item.NumResolucion ?? item.nroResolucion ?? '').trim(),
        estado: String(item.Estado ?? item.estado ?? item.EstadoTramite ?? '').trim(),
        fechaSolicitud: parseDotNetDate(item.FechaIngreso ?? item.Fecha_Ingreso ?? item.fechaSolicitud),
        fechaPublicacion: parseDotNetDate(item.FechaPublicacion ?? item.fechaPublicacion),
        vencimiento: parseDotNetDate(item.Vencimiento ?? item.FechaVencimiento ?? item.fechaVencimiento),
      });
    }
 
    // Si la respuesta es un string HTML en vez de JSON, intentar parsear tabla
    if (marcas.length === 0 && typeof data === 'string' && String(data).includes('<tr')) {
      const html = String(data);
      const filas = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
      for (const fila of filas) {
        const celdas = [...fila[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
          .map(c => c[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim());
        if (celdas.length < 2) continue;
        const acta = celdas[0].replace(/\D/g, '');
        if (acta.length < 4) continue;
        const denom = celdas[1] || '';
        if (!denom || denom.length < 2) continue;
        marcas.push({
          acta,
          denominacion: denom,
          claseNiza: parseInt(celdas[2]) || clase,
          titular: celdas[3] || '',
          estado: celdas[4] || '',
          fechaSolicitud: celdas[5] || undefined,
        });
      }
    }
 
  } catch (err: any) {
    logger.warn(`[INPI POST] Error en búsqueda JSON: ${err.message}`);
  }
 
  logger.info(`[INPI POST] ${marcas.length} marcas para "${denominacion}" clase ${clase}`);
  return marcas;
}
 
export async function buscarMarcasPublicoINPI(
  denominacion: string,
  clase: number,   // 0 = todas las clases
): Promise<MarcaINPI[]> {
  // 1. POST directo al formulario del INPI (fuente principal — rápida, sin browser)
  const resultadosPost = await buscarPorPostINPI({ denominacion, clase });
  if (resultadosPost.length > 0) {
    return resultadosPost;
  }
 
  // 2. Fallback: Playwright (requiere Chromium instalado en el contenedor)
  logger.info(`[INPI] POST directo sin resultados — usando Playwright para "${denominacion}" clase ${clase}`);
  return buscarMarcasPlaywright(denominacion, clase);
}
 
/**
 * Busca todas las marcas vigentes de un titular en el INPI.
 * Útil para que el usuario importe su portfolio de marcas a la app.
 */
export async function buscarPorTitularINPI(titular: string): Promise<MarcaINPI[]> {
  logger.info(`[INPI] Búsqueda por titular: "${titular}"`);
  const resultados = await buscarPorPostINPI({ titular, denominacion: '', clase: 0 });
  if (resultados.length > 0) return resultados;
 
  // Fallback Playwright si el POST directo no devolvió resultados
  logger.info(`[INPI] POST sin resultados para titular — usando Playwright`);
  return buscarMarcasPlaywright('', 0, titular);
}
 
/**
 * Busca marcas por CUIT del titular en el INPI.
 * Usa el CUIT como término de búsqueda en el campo titular (modo Contiene).
 */
export async function buscarPorCuitINPI(cuit: string): Promise<MarcaINPI[]> {
  // Normalizar CUIT: solo dígitos
  const cuitNorm = cuit.replace(/\D/g, '');
  logger.info(`[INPI] Búsqueda por CUIT: "${cuitNorm}"`);
  const resultados = await buscarPorPostINPI({ titular: cuitNorm, denominacion: '', clase: 0 });
  if (resultados.length > 0) return resultados;
 
  logger.info(`[INPI] POST sin resultados para CUIT — usando Playwright`);
  return buscarMarcasPlaywright('', 0, cuitNorm);
}
 
// URL oficial del buscador público de antecedentes del INPI
const INPI_BUSQUEDA_URL = 'https://portaltramites.inpi.gob.ar/marcasconsultas/busqueda/?Cod_Funcion=NQA0ADEA';
 
async function buscarMarcasPlaywright(denominacion: string, clase: number, titular = ''): Promise<MarcaINPI[]> {
  const { browser, context, page } = await lanzarBrowser();
  const marcas: MarcaINPI[] = [];
 
  try {
    logger.info(`[INPI Playwright] Navegando a: ${INPI_BUSQUEDA_URL}`);
    await page.goto(INPI_BUSQUEDA_URL, { waitUntil: 'networkidle', timeout: 30_000 });
 
    logger.info('[INPI Playwright] Enviando búsqueda JSON vía fetch() interno a GrillaMarcasAvanzada');
    const respuesta = await page.evaluate(async (params: { den: string; cls: string; tit: string }) => {
      try {
        const jsonBody = JSON.stringify({
          Tipo_Resolucion: '',
          Clase: params.cls,
          TipoBusquedaDenominacion: '0',
          Denominacion: params.den,
          Titular: params.tit,
          TipoBusquedaTitular: '0',
          Fecha_IngresoDesde: '',
          Fecha_IngresoHasta: '',
          Fecha_ResolucionDesde: '',
          Fecha_ResolucionHasta: '',
          vigentes: true,
          limit: 50,
          offset: 0,
        });
 
        const resp = await fetch('/MarcasConsultas/GrillaMarcasAvanzada', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: jsonBody,
          credentials: 'include',
        });
        const text = await resp.text();
        return { ok: resp.ok, status: resp.status, body: text };
      } catch (e: any) {
        return { ok: false, status: 0, body: `ERROR:${e.message}` };
      }
    }, { den: denominacion, cls: clase > 0 ? String(clase) : '', tit: titular });
 
    logger.info(`[INPI Playwright] Respuesta: status=${respuesta.status}, bytes=${respuesta.body.length}`);
 
    // Parsear JSON
    const body = respuesta.body;
    if (!body.startsWith('ERROR') && (body.startsWith('[') || body.startsWith('{'))) {
      try {
        const json = JSON.parse(body);
        const lista: any[] = Array.isArray(json)
          ? json
          : (json?.data ?? json?.marcas ?? json?.rows ?? json?.resultado ?? []);
        for (const item of lista) {
          const acta = String(item.Acta ?? item.acta ?? item.NumActa ?? '').replace(/\D/g, '');
          const denom = String(item.Denominacion ?? item.denominacion ?? '').trim();
          if (!acta || acta.length < 3 || !denom) continue;
          marcas.push({
            acta,
            denominacion: denom,
            claseNiza: parseInt(String(item.Clase ?? item.clase ?? clase)) || clase,
            tipoMarca: String(item.TipoMarca ?? item.Tipo_Marca ?? item.tipoMarca ?? '').trim(),
            titular: String(item.Titular ?? item.titular ?? '').trim(),
            nroResolucion: String(item.NroResolucion ?? item.Nro_Resolucion ?? item.nroResolucion ?? '').trim(),
            estado: String(item.Estado ?? item.estado ?? '').trim(),
            fechaSolicitud: parseDotNetDate(item.FechaIngreso ?? item.fechaSolicitud),
            fechaPublicacion: parseDotNetDate(item.FechaPublicacion ?? item.fechaPublicacion),
            vencimiento: parseDotNetDate(item.Vencimiento ?? item.FechaVencimiento ?? item.fechaVencimiento),
          });
        }
      } catch (e: any) {
        logger.warn(`[INPI Playwright] Error parseando JSON: ${e.message}. Body: ${body.slice(0, 200)}`);
      }
    }
 
    logger.info(`[INPI Playwright] ${marcas.length} marcas para "${denominacion}" clase ${clase}`);
  } catch (err: any) {
    logger.warn(`[INPI Playwright] Error: ${err.message}`);
  } finally {
    await browser.close();
  }
 
  return marcas;
}
 
// ── Consulta de acta SIN credenciales (API pública INPI) ─────────────────────
/**
 * El INPI tiene una API pública de consulta que no requiere autenticación.
 * Es más confiable y rápida para consultas de solo lectura.
 * URL: https://www.inpi.gob.ar/rest/consulta/marcas/{acta}
 */
export async function consultarEstadoActaPublico(acta: string): Promise<EstadoActa | null> {
  const { default: axios } = await import('axios');
  const baseUrls = [
    `https://www.inpi.gob.ar/rest/consulta/marcas/${acta}`,
    `https://portaltramitesline.inpi.gob.ar/api/consulta/${acta}`,
  ];
 
  for (const url of baseUrls) {
    try {
      const { data } = await axios.get(url, {
        timeout: 10_000,
        headers: { Accept: 'application/json' },
      });
      if (data) {
        logger.info(`[INPI] Consulta pública exitosa para acta ${acta} en ${url}`);
        return {
          acta,
          denominacion: data.denominacion || data.nombre || '(no disponible)',
          claseNiza: parseInt(data.claseNiza || data.clase) || 0,
          tipoMarca: data.tipoMarca || data.tipo || '',
          estado: data.estado || data.estadoTramite || 'Desconocido',
          titular: data.titular || data.titularNombre || '',
          fechaSolicitud: data.fechaSolicitud || data.fechaPresentacion,
          fechaPublicacion: data.fechaPublicacion || data.fechaBoletin,
          observaciones: data.observaciones,
          raw: data,
        };
      }
    } catch (err: any) {
      logger.debug(`[INPI] URL pública ${url} no disponible: ${err.message}`);
    }
  }
  return null;
}
 
// ── Presentación de solicitud de marca ───────────────────────────────────────
export interface DatosSolicitud {
  denominacion: string;
  claseNiza: number;
  tipoMarca: 'DENOMINATIVA' | 'FIGURATIVA' | 'MIXTA' | 'TRIDIMENSIONAL';
  descripcionProductos: string;
  titularNombre: string;
  titularCuit: string;
  titularDomicilio?: string;
  titularEmail?: string;
  // Para marcas figurativas/mixtas: imagen en base64
  imagenBase64?: string;
  imagenMimeType?: string;
}
 
export async function presentarSolicitud(
  datos: DatosSolicitud,
  creds: CredencialesARCA,
): Promise<{ pasos: PasosSolicitud[]; resultado?: ResultadoSolicitud; error?: string }> {
  const pasos: PasosSolicitud[] = [
    { paso: 1, descripcion: 'Autenticación ARCA (Clave Fiscal)', estado: 'pendiente' },
    { paso: 2, descripcion: 'Acceso al portal INPI', estado: 'pendiente' },
    { paso: 3, descripcion: 'Apertura formulario Nueva Solicitud', estado: 'pendiente' },
    { paso: 4, descripcion: 'Completar datos de la marca', estado: 'pendiente' },
    { paso: 5, descripcion: 'Completar datos del titular', estado: 'pendiente' },
    { paso: 6, descripcion: 'Confirmación y envío', estado: 'pendiente' },
    { paso: 7, descripcion: 'Obtención número de acta', estado: 'pendiente' },
  ];
 
  const marcarPaso = (n: number, estado: PasosSolicitud['estado'], detalle?: string) => {
    const p = pasos.find(p => p.paso === n);
    if (p) { p.estado = estado; p.detalle = detalle; }
  };
 
  const { browser, page } = await lanzarBrowser();
 
  try {
    // Paso 1: Autenticación
    try {
      await autenticarARCA(page, creds);
      marcarPaso(1, 'completado');
    } catch (err: any) {
      marcarPaso(1, 'error', err.message);
      return { pasos, error: `Error de autenticación: ${err.message}` };
    }
 
    // Paso 2: Acceso al portal
    try {
      marcarPaso(2, 'completado');
    } catch (err: any) {
      marcarPaso(2, 'error', err.message);
      return { pasos, error: `Error accediendo al portal INPI: ${err.message}` };
    }
 
    // Paso 3: Nueva solicitud
    try {
      await page.goto(`${INPI_PORTAL_URL}marcas/nueva-solicitud`, { waitUntil: 'networkidle', timeout: 20_000 });
      const btnNueva = page.locator('a:has-text("Nueva solicitud"), button:has-text("Nueva solicitud"), a:has-text("Presentar marca")').first();
      if (await btnNueva.count() > 0) await btnNueva.click();
      await page.waitForLoadState('networkidle', { timeout: 15_000 });
      marcarPaso(3, 'completado');
    } catch (err: any) {
      marcarPaso(3, 'error', err.message);
      return { pasos, error: `No se pudo abrir el formulario de nueva solicitud: ${err.message}` };
    }
 
    // Paso 4: Datos de la marca
    try {
      // Denominación
      const inputDenom = page.locator('input[name*="denominacion"], input[id*="denominacion"], input[placeholder*="Denominación"]').first();
      if (await inputDenom.count() > 0) await inputDenom.fill(datos.denominacion);
 
      // Tipo de marca
      const selectTipo = page.locator('select[name*="tipo"], select[id*="tipo"]').first();
      if (await selectTipo.count() > 0) {
        await selectTipo.selectOption({ label: datos.tipoMarca.charAt(0) + datos.tipoMarca.slice(1).toLowerCase() });
      }
 
      // Clase de Niza
      const selectClase = page.locator('select[name*="clase"], select[id*="clase"]').first();
      if (await selectClase.count() > 0) {
        await selectClase.selectOption({ value: String(datos.claseNiza) });
      }
 
      // Descripción de productos/servicios
      const textareaDesc = page.locator('textarea[name*="producto"], textarea[name*="servicio"], textarea[id*="descripcion"]').first();
      if (await textareaDesc.count() > 0) await textareaDesc.fill(datos.descripcionProductos);
 
      // Imagen (para marcas figurativas o mixtas)
      if (datos.imagenBase64 && (datos.tipoMarca === 'FIGURATIVA' || datos.tipoMarca === 'MIXTA')) {
        const inputFile = page.locator('input[type="file"]').first();
        if (await inputFile.count() > 0) {
          // Convertir base64 a buffer y subir como archivo temporal
          const buf = Buffer.from(datos.imagenBase64, 'base64');
          const ext = datos.imagenMimeType === 'image/png' ? 'png' : 'jpg';
          const tmpPath = `/tmp/marca_${Date.now()}.${ext}`;
          const { writeFile } = await import('fs/promises');
          await writeFile(tmpPath, buf);
          await inputFile.setInputFiles(tmpPath);
        }
      }
 
      marcarPaso(4, 'completado');
    } catch (err: any) {
      marcarPaso(4, 'error', err.message);
      return { pasos, error: `Error completando datos de la marca: ${err.message}` };
    }
 
    // Paso 5: Datos del titular
    try {
      const btnSiguiente = page.locator('button:has-text("Siguiente"), input[value="Siguiente"]').first();
      if (await btnSiguiente.count() > 0) {
        await btnSiguiente.click();
        await page.waitForLoadState('networkidle', { timeout: 15_000 });
      }
 
      const inputTitular = page.locator('input[name*="titular"], input[id*="titular"]').first();
      if (await inputTitular.count() > 0) await inputTitular.fill(datos.titularNombre);
 
      const inputCuit = page.locator('input[name*="cuit"], input[id*="cuit"]').first();
      if (await inputCuit.count() > 0) await inputCuit.fill(datos.titularCuit);
 
      if (datos.titularDomicilio) {
        const inputDom = page.locator('input[name*="domicilio"], input[id*="domicilio"]').first();
        if (await inputDom.count() > 0) await inputDom.fill(datos.titularDomicilio);
      }
 
      if (datos.titularEmail) {
        const inputEmail = page.locator('input[type="email"], input[name*="email"]').first();
        if (await inputEmail.count() > 0) await inputEmail.fill(datos.titularEmail);
      }
 
      marcarPaso(5, 'completado');
    } catch (err: any) {
      marcarPaso(5, 'error', err.message);
      return { pasos, error: `Error completando datos del titular: ${err.message}` };
    }
 
    // Paso 6: Confirmación y envío
    try {
      const btnConfirmar = page.locator('button:has-text("Confirmar"), button:has-text("Presentar"), input[value="Confirmar"], input[value="Enviar"]').first();
      if (await btnConfirmar.count() > 0) {
        await btnConfirmar.click();
        await page.waitForLoadState('networkidle', { timeout: 30_000 });
      }
      marcarPaso(6, 'completado');
    } catch (err: any) {
      marcarPaso(6, 'error', err.message);
      return { pasos, error: `Error en la confirmación: ${err.message}` };
    }
 
    // Paso 7: Obtener número de acta
    try {
      const actaTexto = await page.locator('[class*="acta"], .numero-acta, .tramite-numero, h2, h3').first().innerText().catch(() => '');
      const actaMatch = actaTexto.match(/(\d{7,})/);
      const actaAsignada = actaMatch ? actaMatch[1] : 'Pendiente';
 
      const comprobante = await page.locator('.comprobante, .constancia').first().innerText().catch(() => '');
 
      marcarPaso(7, 'completado', `Acta N° ${actaAsignada}`);
 
      return {
        pasos,
        resultado: {
          acta: actaAsignada,
          fechaPresentacion: new Date().toISOString(),
          comprobante: comprobante || undefined,
          mensaje: `Solicitud presentada exitosamente. Acta N° ${actaAsignada}`,
        },
      };
    } catch (err: any) {
      marcarPaso(7, 'error', err.message);
      return { pasos, error: `Solicitud enviada pero no se pudo obtener el número de acta: ${err.message}` };
    }
  } catch (err: any) {
    logger.error('[INPI] Error general:', err);
    return { pasos, error: err.message };
  } finally {
    await browser.close();
  }
}
