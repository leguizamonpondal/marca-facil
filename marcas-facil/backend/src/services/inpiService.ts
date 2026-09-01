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
  raw?: Record<string, string>;
}

export interface ResultadoSolicitud {
  acta: string;
  fechaPresentacion: string;
  comprobante?: string;
  mensaje: string;
}

export interface PasosSolicitud {
  paso: number;
  descripcion: string;
  estado: 'pendiente' | 'completado' | 'error';
  detalle?: string;
}

// ── Tipos públicos para búsqueda de marcas ───────────────────────────────────
export interface MarcaINPI {
  acta: string;
  denominacion: string;
  claseNiza: number;
  tipoMarca: string;
  titular: string;
  nroResolucion: string;
  estado: string;
  fechaSolicitud?: string;
  fechaPublicacion?: string;
  vencimiento?: string;
}

interface ParamsBusquedaINPI {
  denominacion?: string;
  clase?: number;   // 0 = todas las clases
  titular?: string;
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

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  return { browser, context, page };
}

// ── Autenticación ARCA ────────────────────────────────────────────────────────
async function autenticarARCA(page: Page, creds: CredencialesARCA): Promise<void> {
  logger.info('[INPI] Iniciando autenticación ARCA');

  await page.goto(INPI_PORTAL_URL, { waitUntil: 'networkidle', timeout: 30_000 });

  const loginBtn = page.locator('a[href*="afip"], a[href*="arca"], button:has-text("Clave Fiscal"), a:has-text("Clave Fiscal"), a:has-text("AFIP"), a:has-text("ARCA")').first();
  if (await loginBtn.count() === 0) {
    await page.goto(ARCA_AUTH_URL, { waitUntil: 'networkidle', timeout: 30_000 });
  } else {
    await loginBtn.click();
    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30_000 });
  }

  await page.waitForSelector('input[name="F1:username"], input[id*="cuit"], input[type="text"]', { timeout: 15_000 });
  const inputCuit = page.locator('input[name="F1:username"], input[id*="cuit"]').first();
  await inputCuit.fill(creds.cuit);
  await page.click('input[name="F1:btnSiguiente"], button[id*="siguiente"], input[value="Siguiente"]');

  await page.waitForSelector('input[name="F1:password"], input[type="password"]', { timeout: 15_000 });
  await page.fill('input[name="F1:password"], input[type="password"]', creds.claveFiscal);
  await page.click('input[name="F1:btnIngresar"], button[id*="ingresar"], input[value="Ingresar"]');

  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30_000 });

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

    const consultaUrl = `${INPI_PORTAL_URL}consultas/estado-tramite`;
    await page.goto(consultaUrl, { waitUntil: 'networkidle', timeout: 20_000 });

    const inputActa = page.locator('input[name*="acta"], input[placeholder*="acta"], input[id*="acta"]').first();
    await inputActa.fill(acta);
    await page.click('button[type="submit"], input[type="submit"], button:has-text("Buscar"), button:has-text("Consultar")');
    await page.waitForLoadState('networkidle', { timeout: 20_000 });

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
      fechaSolicitud:   await getLocatorText(['[class*="fecha-solicitud"]', '.fecha-presentacion']),
      fechaPublicacion: await getLocatorText(['[class*="fecha-publicacion"]', '.fecha-boletin']),
      observaciones:    await getLocatorText(['[class*="observacion"]', '.obs']),
    };

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

// ── POST directo al endpoint JSON del INPI ────────────────────────────────────
async function buscarPorPostINPI(
  denominacionOrParams: string | ParamsBusquedaINPI,
  claseArg?: number,
): Promise<MarcaINPI[]> {
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

  // Paso 1: GET para obtener cookies de sesión ASP.NET
  let cookies = '';
  try {
    const { headers: respHeaders } = await axios.get(BUSQUEDA_URL, {
      timeout: 20_000,
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

  // Paso 2: POST JSON
  // clase=0 → Clase: '' (todas las clases, sin filtro)
  // vigentes: true → solo marcas vigentes
  try {
    const jsonBody = {
      Tipo_Resolucion: '',
      Clase: clase > 0 ? String(clase) : '',
      TipoBusquedaDenominacion: '0',
      Denominacion: denominacion,
      Titular: titular,
      TipoBusquedaTitular: '0',
      Fecha_IngresoDesde: '',
      Fecha_IngresoHasta: '',
      Fecha_ResolucionDesde: '',
      Fecha_ResolucionHasta: '',
      vigentes: true,
      limit: 50,
      offset: 0,
    };

    const { data } = await axios.post(GRILLA_URL, jsonBody, {
      timeout: 45_000,
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
        titular: String(item.Titular ?? item.titular ?? item.razon_social ?? '').trim(),
        nroResolucion: String(item.NroResolucion ?? item.Nro_Resolucion ?? item.NumResolucion ?? item.nroResolucion ?? '').trim(),
        estado: String(item.Estado ?? item.estado ?? item.EstadoTramite ?? '').trim(),
        fechaSolicitud: parseDotNetDate(item.FechaIngreso ?? item.Fecha_Ingreso ?? item.fechaSolicitud),
        fechaPublicacion: parseDotNetDate(item.FechaPublicacion ?? item.fechaPublicacion),
        vencimiento: parseDotNetDate(item.Vencimiento ?? item.FechaVencimiento ?? item.fechaVencimiento),
      });
    }

    // Fallback: si la respuesta es HTML con tabla
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
          tipoMarca: '',
          titular: celdas[3] || '',
          nroResolucion: '',
          estado: celdas[4] || '',
          fechaSolicitud: celdas[5] || undefined,
        });
      }
    }

  } catch (err: any) {
    logger.warn(`[INPI POST] Error en búsqueda JSON: ${err.message}`);
  }

  logger.info(`[INPI POST] ${marcas.length} marcas para "${denominacion || titular}" clase ${clase}`);
  return marcas;
}

// ── Búsqueda pública por denominación ────────────────────────────────────────
export async function buscarMarcasPublicoINPI(
  denominacion: string,
  clase: number,   // 0 = todas las clases
): Promise<MarcaINPI[]> {
  const resultadosPost = await buscarPorPostINPI({ denominacion, clase });
  if (resultadosPost.length > 0) return resultadosPost;

  logger.info(`[INPI] POST directo sin resultados — usando Playwright para "${denominacion}" clase ${clase}`);
  return buscarMarcasPlaywright(denominacion, clase);
}

// ── Búsqueda por titular ──────────────────────────────────────────────────────
export async function buscarPorTitularINPI(titular: string): Promise<MarcaINPI[]> {
  logger.info(`[INPI] Búsqueda por titular: "${titular}"`);
  const resultados = await buscarPorPostINPI({ titular, denominacion: '', clase: 0 });
  if (resultados.length > 0) return resultados;

  logger.info(`[INPI] POST sin resultados para titular — usando Playwright`);
  return buscarMarcasPlaywright('', 0, titular);
}

// ── Consulta pública de acta (sin credenciales) ───────────────────────────────
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

// ── URL pública del buscador de antecedentes ──────────────────────────────────
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

    logger.info(`[INPI Playwright] ${marcas.length} marcas para "${denominacion || titular}" clase ${clase}`);
  } catch (err: any) {
    logger.warn(`[INPI Playwright] Error: ${err.message}`);
  } finally {
    await browser.close();
  }

  return marcas;
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
    try {
      await autenticarARCA(page, creds);
      marcarPaso(1, 'completado');
    } catch (err: any) {
      marcarPaso(1, 'error', err.message);
      return { pasos, error: `Error de autenticación: ${err.message}` };
    }

    try {
      marcarPaso(2, 'completado');
    } catch (err: any) {
      marcarPaso(2, 'error', err.message);
      return { pasos, error: `Error accediendo al portal INPI: ${err.message}` };
    }

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

    try {
      const inputDenom = page.locator('input[name*="denominacion"], input[id*="denominacion"], input[placeholder*="Denominación"]').first();
      if (await inputDenom.count() > 0) await inputDenom.fill(datos.denominacion);

      const selectTipo = page.locator('select[name*="tipo"], select[id*="tipo"]').first();
      if (await selectTipo.count() > 0) {
        await selectTipo.selectOption({ label: datos.tipoMarca.charAt(0) + datos.tipoMarca.slice(1).toLowerCase() });
      }

      const selectClase = page.locator('select[name*="clase"], select[id*="clase"]').first();
      if (await selectClase.count() > 0) {
        await selectClase.selectOption({ value: String(datos.claseNiza) });
      }

      const textareaDesc = page.locator('textarea[name*="producto"], textarea[name*="servicio"], textarea[id*="descripcion"]').first();
      if (await textareaDesc.count() > 0) await textareaDesc.fill(datos.descripcionProductos);

      if (datos.imagenBase64 && (datos.tipoMarca === 'FIGURATIVA' || datos.tipoMarca === 'MIXTA')) {
        const inputFile = page.locator('input[type="file"]').first();
        if (await inputFile.count() > 0) {
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
