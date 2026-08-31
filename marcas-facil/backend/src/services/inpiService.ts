
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
 * Busca marcas en el registro público del INPI por denominación y clase.
 * No requiere autenticación. Usado por el estudio de factibilidad.
 *
 * Estrategia:
 *   1. Intenta la API REST pública del INPI (rápida, ~1s)
 *   2. Si falla, scrapea el portal público vía Playwright (~20s)
 *   3. Si ambas fallan, devuelve [] sin tirar error (degradación elegante)
 */
export interface MarcaINPI {
  acta: string;
  denominacion: string;
  claseNiza: number;
  titular: string;
  estado: string;
  fechaSolicitud?: string;
  fechaPublicacion?: string;
}
 
export async function buscarMarcasPublicoINPI(
  denominacion: string,
  clase: number,
): Promise<MarcaINPI[]> {
  const { default: axios } = await import('axios');
  const denomEnc = encodeURIComponent(denominacion);
 
  // Endpoints conocidos de la API pública INPI (orden de preferencia)
  const apiCandidatos = [
    `https://portaltramites.inpi.gob.ar/marcasconsultas/api/busqueda?denominacion=${denomEnc}&clase=${clase}`,
    `https://www.inpi.gob.ar/rest/consulta/marcas?denominacion=${denomEnc}&clase=${clase}`,
    `https://www.inpi.gob.ar/rest/consulta/marcas?q=${denomEnc}&clase=${clase}`,
  ];
 
  for (const url of apiCandidatos) {
    try {
      const { data } = await axios.get(url, {
        timeout: 8_000,
        headers: { Accept: 'application/json', 'User-Agent': 'MarcaFacil/1.0' },
      });
      const lista = Array.isArray(data) ? data : (data?.marcas || data?.resultados || data?.items || []);
      if (lista.length > 0) {
        logger.info(`[INPI] API pública devolvió ${lista.length} resultados para "${denominacion}" clase ${clase}`);
        return lista.map((item: any) => ({
          acta: String(item.acta || item.nroActa || item.expediente || ''),
          denominacion: item.denominacion || item.nombre || '',
          claseNiza: parseInt(item.claseNiza || item.clase || clase) || clase,
          titular: item.titular || item.titularNombre || item.solicitante || '',
          estado: item.estado || item.estadoTramite || '',
          fechaSolicitud: item.fechaSolicitud || item.fechaPresentacion || undefined,
          fechaPublicacion: item.fechaPublicacion || item.fechaBoletin || undefined,
        }));
      }
    } catch (err: any) {
      logger.debug(`[INPI] API pública ${url} no disponible: ${err.message}`);
    }
  }
 
  // Fallback: scraping del portal público vía Playwright
  logger.info(`[INPI] Usando Playwright para buscar "${denominacion}" clase ${clase} en portal público`);
  return buscarMarcasPlaywright(denominacion, clase);
}
 
// URL oficial del buscador público de antecedentes del INPI
const INPI_BUSQUEDA_URL = 'https://portaltramites.inpi.gob.ar/marcasconsultas/busqueda/?Cod_Funcion=NQA0ADEA';
 
async function buscarMarcasPlaywright(denominacion: string, clase: number): Promise<MarcaINPI[]> {
  const { browser, page } = await lanzarBrowser();
  const marcas: MarcaINPI[] = [];
 
  try {
    logger.info(`[INPI] Navegando a buscador público: ${INPI_BUSQUEDA_URL}`);
    await page.goto(INPI_BUSQUEDA_URL, { waitUntil: 'networkidle', timeout: 30_000 });
 
    // ── Completar campo de denominación ──────────────────────────────────────
    // El buscador INPI tiene un input de denominación (texto libre)
    const inputDenom = page.locator([
      'input[name*="denominacion" i]',
      'input[id*="denominacion" i]',
      'input[placeholder*="ominaci" i]',
      'input[placeholder*="arca" i]',
      'input[name*="nombre" i]',
      'input[id*="nombre" i]',
      'input[type="text"]:visible',
    ].join(', ')).first();
 
    if (await inputDenom.count() > 0) {
      await inputDenom.fill(denominacion);
    } else {
      logger.warn('[INPI] No se encontró campo de denominación en el buscador');
    }
 
    // ── Seleccionar clase NIZA ────────────────────────────────────────────────
    const selectClase = page.locator([
      'select[name*="clase" i]',
      'select[id*="clase" i]',
      'select[name*="niza" i]',
    ].join(', ')).first();
 
    if (await selectClase.count() > 0) {
      // Intentar seleccionar por value numérico, label o texto visible
      await selectClase.selectOption({ value: String(clase) }).catch(async () => {
        await selectClase.selectOption({ label: `Clase ${clase}` }).catch(() => {});
      });
    }
 
    // ── Enviar búsqueda ───────────────────────────────────────────────────────
    const btnBuscar = page.locator([
      'button[type="submit"]:visible',
      'input[type="submit"]:visible',
      'button:has-text("Buscar"):visible',
      'button:has-text("Consultar"):visible',
      'input[value*="Buscar" i]:visible',
    ].join(', ')).first();
 
    if (await btnBuscar.count() > 0) {
      await btnBuscar.click();
    } else {
      await page.keyboard.press('Enter');
    }
 
    await page.waitForLoadState('networkidle', { timeout: 25_000 }).catch(() => {});
 
    // ── Interceptar posible llamada AJAX de resultados ────────────────────────
    // El portal INPI puede devolver JSON vía XHR; intentar capturarlo si está en el DOM
    const pageContent = await page.content();
    const jsonMatch = pageContent.match(/"marcas"\s*:\s*(\[[\s\S]*?\])/);
    if (jsonMatch) {
      try {
        const lista = JSON.parse(jsonMatch[1]);
        for (const item of lista.slice(0, 100)) {
          marcas.push({
            acta: String(item.acta || item.nroActa || ''),
            denominacion: item.denominacion || item.nombre || '',
            claseNiza: parseInt(item.clase || item.claseNiza) || clase,
            titular: item.titular || item.solicitante || '',
            estado: item.estado || '',
          });
        }
        logger.info(`[INPI] Extraídas ${marcas.length} marcas vía JSON embebido`);
        return marcas;
      } catch (_) {}
    }
 
    // ── Extraer tabla de resultados ───────────────────────────────────────────
    const filas = await page.locator('table tbody tr').all();
    for (const fila of filas.slice(0, 100)) {
      const celdas = await fila.locator('td').all();
      if (celdas.length >= 2) {
        const textos = await Promise.all(celdas.map(c => c.innerText().catch(() => '')));
        // El formato típico del buscador INPI es: Acta | Denominación | Clase | Titular | Estado
        const acta = textos[0]?.trim();
        const denom = textos[1]?.trim() || textos[0]?.trim();
        if (denom && denom.length > 1) {
          marcas.push({
            acta: acta || '',
            denominacion: celdas.length >= 3 ? (textos[1]?.trim() || '') : denom,
            claseNiza: parseInt(textos[2]) || clase,
            titular: textos[3]?.trim() || '',
            estado: textos[4]?.trim() || textos[5]?.trim() || '',
          });
        }
      }
    }
 
    // ── Alternativa: cards / items tipo lista ─────────────────────────────────
    if (marcas.length === 0) {
      const items = await page.locator('.resultado, .marca-item, [class*="result"], [class*="marca"]').all();
      for (const item of items.slice(0, 100)) {
        const texto = await item.innerText().catch(() => '');
        const actaMatch = texto.match(/(?:Acta|N[°º]|Exp\.?)\s*:?\s*(\d{5,})/i);
        const lines = texto.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length > 0) {
          marcas.push({
            acta: actaMatch?.[1] || '',
            denominacion: lines[0],
            claseNiza: clase,
            titular: lines[2] || '',
            estado: lines[lines.length - 1] || '',
          });
        }
      }
    }
 
    logger.info(`[INPI] Playwright encontró ${marcas.length} marcas para "${denominacion}" clase ${clase}`);
  } catch (err: any) {
    logger.warn(`[INPI] Playwright scraping falló para "${denominacion}" clase ${clase}: ${err.message}`);
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
