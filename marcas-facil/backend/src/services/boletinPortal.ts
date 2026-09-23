/**
 * PORTAL DE BOLETINES DEL INPI — cliente de descubrimiento y descarga
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Protocolo verificado el 22/09/2026 contra el portal real y contra el
 * boletín Nº 11121 (16/09/2026). Documentado en el proyecto, en
 * `claude/boletin-marcas-protocolo.md`.
 *
 * ── El endpoint ────────────────────────────────────────────────────────────
 *
 *   POST https://portaltramites.inpi.gob.ar/Boletines/Index
 *   Content-Type: multipart/form-data
 *
 * Público: sin login, sin cookies, sin token anti-CSRF. Devuelve HTML — no
 * hay variante JSON —, una tabla de seis columnas.
 *
 * ── Por qué este archivo existe separado del servicio ──────────────────────
 *
 * Acá vive todo lo que depende del formato del portal: el multipart, el
 * scraping de la tabla, la URL del PDF. Si el INPI cambia la maquetación, se
 * rompe este archivo y ningún otro. El servicio de vigilancia trabaja contra
 * `FilaBoletin`, que es una estructura nuestra.
 *
 * ── La regla que gobierna todo el archivo ──────────────────────────────────
 *
 * **Nada falla en silencio.** Cada función tira excepción o devuelve un error
 * explícito. Ninguna devuelve `[]` cuando no pudo leer: un arreglo vacío acá
 * significaría "esta semana no se publicó nada", y un producto de vigilancia
 * que confunde "no pude mirar" con "no hay nada" le hace perder al cliente el
 * plazo de 30 días corridos para oponerse sin que nadie se entere.
 */

import { logger } from '../utils/logger';

const PORTAL = 'https://portaltramites.inpi.gob.ar';
const ENDPOINT_LISTADO = `${PORTAL}/Boletines/Index`;

/** `3` = sector Marcas. Es el valor del campo `Tipo_Item` del formulario. */
const SECTOR_MARCAS = '3';

const AGENTE_HTTP =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface FilaBoletin {
  /** Número de boletín. Ej.: `11121`. */
  numero: string;
  /** `Boletines` o `Anexos`. Los anexos acompañan a las resoluciones. */
  tipoItem: string;
  /** Sector. Siempre `Marcas` si se pidió con `Tipo_Item=3`. */
  sector: string;
  /** Fecha de publicación, a medianoche. */
  fecha: Date;
  /** La fecha tal como la devuelve el portal, para los mensajes de error. */
  fechaTexto: string;
  /** URL absoluta del PDF, tomada del `href` real de la fila. */
  urlPdf: string;
  /**
   * El campo que dice de qué tipo es el boletín: `MARCAS NUEVAS`,
   * `Resolución de oposiciones`, `Caducidad y nulidades`, etc.
   */
  comentario: string;
  /** `true` si es uno de los boletines de solicitudes nuevas publicadas. */
  esMarcasNuevas: boolean;
}

export interface PdfDescargado {
  numero: string;
  urlPdf: string;
  bytes: Buffer;
  tamanoMb: number;
}

// ── Listado ──────────────────────────────────────────────────────────────────

/**
 * Pide al portal el listado de boletines del sector Marcas.
 *
 * ⚠️ **Sin filtro de fechas el portal devuelve solo los últimos 100 registros.**
 *    Con once semanas de boletines de marcas más las series paralelas de
 *    resoluciones y anexos, 100 registros son unos tres meses. Para una fecha
 *    concreta hay que mandar `desde` y `hasta`, o un boletín viejo simplemente
 *    no aparece — y no aparecer se lee igual que no existir.
 *
 * @throws si el portal responde con error, si tarda más que `timeoutMs`, o si
 *         el HTML no tiene la forma esperada.
 */
export async function listarBoletines(opciones?: {
  numero?: string;
  desde?: Date;
  hasta?: Date;
  timeoutMs?: number;
}): Promise<FilaBoletin[]> {
  const form = new FormData();
  form.append('numero', opciones?.numero || '');
  form.append('Tipo_Item', SECTOR_MARCAS);
  form.append('Tipo_Boletin', '');
  form.append('start', opciones?.desde ? aFormatoPortal(opciones.desde) : '');
  form.append('finish', opciones?.hasta ? aFormatoPortal(opciones.hasta) : '');

  const html = await pedir(ENDPOINT_LISTADO, {
    metodo: 'POST',
    cuerpo: form,
    timeoutMs: opciones?.timeoutMs ?? 45_000,
    comoTexto: true,
  });

  return parsearTabla(html as string);
}

/**
 * Los boletines de MARCAS NUEVAS de una fecha.
 *
 * Son cuatro o cinco por miércoles, no uno. Descargar uno solo y dar la semana
 * por vigilada deja afuera el 80 % de las publicaciones sin ningún error
 * visible: el hallazgo que obligó a rehacer este servicio.
 *
 * ── Por qué primero se consulta SIN filtro de fechas ───────────────────────
 *
 * La consulta sin filtros es la única verificada contra el portal real: son
 * los últimos 100 registros, que en la muestra del 22/09/2026 cubrían desde
 * el 08/07 hasta el 16/09 — unas diez semanas. La vigilancia semanal siempre
 * cae dentro de esa ventana, así que el camino de todos los miércoles es el
 * camino probado.
 *
 * El filtro `start`/`finish` **no está verificado**: no sé con certeza si el
 * portal espera `dd/mm/aaaa`. Si el formato fuera otro podría devolver cero
 * filas, y cero filas se lee igual que "esa semana no hubo boletines" — la
 * falla silenciosa de siempre. Por eso el filtro queda como segundo intento,
 * solo para fechas viejas que se cayeron de los 100 registros, y su resultado
 * vacío nunca se toma como respuesta final: el que decide es el llamador,
 * que tira excepción.
 */
export async function boletinesDeMarcasNuevas(fecha: Date): Promise<FilaBoletin[]> {
  const dia = aMedianoche(fecha);

  const deLaFecha = (filas: FilaBoletin[]) =>
    filas
      .filter((f) => f.esMarcasNuevas)
      .filter((f) => f.fecha.getTime() === dia.getTime())
      .sort((a, b) => Number(a.numero) - Number(b.numero));

  // Intento 1: la consulta verificada.
  const recientes = await listarBoletines();
  const encontrados = deLaFecha(recientes);
  if (encontrados.length > 0) return encontrados;

  // ¿Vacío porque la fecha se cayó de la ventana de 100 registros?
  const masVieja = recientes.reduce(
    (min, f) => (f.fecha < min ? f.fecha : min),
    recientes[0]?.fecha ?? dia
  );

  if (dia >= masVieja) {
    // Está dentro de la ventana y no aparece: es una respuesta real, no un
    // problema de alcance de la consulta.
    return [];
  }

  logger.info(
    `[Boletín] ${dia.toLocaleDateString('es-AR')} es anterior al registro más viejo ` +
      `(${masVieja.toLocaleDateString('es-AR')}); se reintenta con filtro de fechas.`
  );

  // Intento 2: ventana de ±1 día. Se manda con margen porque el portal guarda
  // la fecha con hora y no quiero depender de cómo interprete el borde.
  const filtrados = await listarBoletines({
    desde: restarDias(dia, 1),
    hasta: sumarDias(dia, 1),
  });

  return deLaFecha(filtrados);
}

// ── Descarga ─────────────────────────────────────────────────────────────────

/**
 * Baja el PDF de un boletín. Reintenta hasta tres veces con espera creciente:
 * son archivos de ~20 MB contra un portal público del Estado, y un corte de
 * conexión es más probable que un error real.
 *
 * @throws si los tres intentos fallan, o si lo que llega no es un PDF.
 */
export async function descargarPdf(fila: FilaBoletin): Promise<PdfDescargado> {
  const intentos = 3;
  let ultimoError: Error | undefined;

  for (let i = 1; i <= intentos; i++) {
    try {
      const bytes = (await pedir(fila.urlPdf, {
        metodo: 'GET',
        timeoutMs: 120_000,
        comoTexto: false,
      })) as Buffer;

      // Un portal que devuelve una página de error con status 200 es un
      // clásico. Si no empieza con la firma de PDF, no es un PDF.
      if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
        throw new Error(
          `La respuesta no es un PDF (empieza con "${bytes.subarray(0, 20).toString('latin1')}"). ` +
            'Suele significar que el portal devolvió una página de error con status 200.'
        );
      }

      const tamanoMb = Number((bytes.length / 1024 / 1024).toFixed(1));
      logger.info(`  ✅ Boletín ${fila.numero}: ${tamanoMb} MB`);
      return { numero: fila.numero, urlPdf: fila.urlPdf, bytes, tamanoMb };
    } catch (err: any) {
      ultimoError = err;
      logger.warn(`  Boletín ${fila.numero}, intento ${i}/${intentos}: ${err.message}`);
      if (i < intentos) await esperar(i * 3000);
    }
  }

  throw new Error(
    `No se pudo descargar el boletín ${fila.numero} tras ${intentos} intentos. ` +
      `Último error: ${ultimoError?.message}`
  );
}

// ── Parseo del HTML ──────────────────────────────────────────────────────────

/**
 * Convierte la tabla del portal en filas.
 *
 * El parseo es deliberadamente estricto: si el HTML no tiene la forma
 * esperada, tira. Un parser laxo contra una maquetación que cambió devuelve
 * cero filas, y cero filas es indistinguible de "no hubo boletines".
 */
function parsearTabla(html: string): FilaBoletin[] {
  if (!/<t(able|body|r)/i.test(html)) {
    throw new Error(
      `La respuesta del portal no contiene una tabla (${html.length} caracteres). ` +
        'Puede ser una página de mantenimiento o un cambio en el endpoint.'
    );
  }

  const filas: FilaBoletin[] = [];
  const malformadas: string[] = [];

  const bloques = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];

  for (const bloque of bloques) {
    const celdas = bloque.match(/<td[\s\S]*?<\/td>/gi);
    if (!celdas || celdas.length < 6) continue; // encabezado o fila decorativa

    const texto = celdas.map(limpiar);
    const numero = texto[0];

    // El encabezado también llega como <tr>; se descarta por no tener número.
    if (!/^\d+$/.test(numero)) continue;

    const href = celdas[4].match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    const fecha = parsearFecha(texto[3]);

    if (!href || !fecha) {
      malformadas.push(numero);
      continue;
    }

    const comentario = texto[5];

    filas.push({
      numero,
      tipoItem: texto[1],
      sector: texto[2],
      fecha,
      fechaTexto: texto[3],
      urlPdf: href.startsWith('http') ? href : `${PORTAL}${href.startsWith('/') ? '' : '/'}${href}`,
      comentario,
      // El portal escribe el comentario en mayúsculas o capitalizado según el
      // tipo, así que se compara sin acentos ni caja.
      esMarcasNuevas: normalizar(comentario).includes('MARCAS NUEVAS') && texto[1] !== 'Anexos',
    });
  }

  if (filas.length === 0) {
    throw new Error(
      `El portal respondió pero no se pudo leer ninguna fila de la tabla ` +
        `(${bloques.length} <tr> encontrados, ${html.length} caracteres). ` +
        'Probablemente cambió la maquetación: hay que revisar parsearTabla().'
    );
  }

  if (malformadas.length > 0) {
    // No se tira: las filas buenas sirven. Pero queda en el log, porque una
    // fila que no se pudo leer es un boletín que no se va a vigilar.
    logger.warn(
      `[Boletín] ${malformadas.length} filas sin enlace o sin fecha legible: ${malformadas.join(', ')}`
    );
  }

  return filas;
}

/** `16/09/2026 12:00:00 a.m.` → Date a medianoche local. */
function parsearFecha(texto: string): Date | null {
  const m = texto.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return isNaN(d.getTime()) ? null : d;
}

/** Quita etiquetas, decodifica entidades y normaliza los espacios. */
function limpiar(celda: string): string {
  return celda
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Mayúsculas sin acentos, para comparar comentarios. */
function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

/**
 * Una sola función de red para todo el archivo, con `AbortController` en lugar
 * de `AbortSignal.timeout` para no depender de qué tipos trae el entorno.
 */
async function pedir(
  url: string,
  opciones: {
    metodo: 'GET' | 'POST';
    cuerpo?: FormData;
    timeoutMs: number;
    comoTexto: boolean;
  }
): Promise<string | Buffer> {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), opciones.timeoutMs);

  try {
    const r = await fetch(url, {
      method: opciones.metodo,
      body: opciones.cuerpo,
      signal: control.signal,
      headers: {
        'User-Agent': AGENTE_HTTP,
        Accept: opciones.comoTexto ? 'text/html,application/xhtml+xml' : 'application/pdf,*/*',
      },
    });

    if (!r.ok) {
      throw new Error(`El portal respondió ${r.status} ${r.statusText} en ${url}`);
    }

    return opciones.comoTexto
      ? await r.text()
      : Buffer.from(new Uint8Array(await r.arrayBuffer()));
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`Se agotaron los ${opciones.timeoutMs / 1000} s de espera en ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(reloj);
  }
}

// ── Fechas ───────────────────────────────────────────────────────────────────

/** El portal espera `dd/mm/aaaa` en `start` y `finish`. */
function aFormatoPortal(f: Date): string {
  const dd = String(f.getDate()).padStart(2, '0');
  const mm = String(f.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${f.getFullYear()}`;
}

export function aMedianoche(f: Date): Date {
  const d = new Date(f);
  d.setHours(0, 0, 0, 0);
  return d;
}

function sumarDias(f: Date, n: number): Date {
  const d = new Date(f);
  d.setDate(d.getDate() + n);
  return d;
}

function restarDias(f: Date, n: number): Date {
  return sumarDias(f, -n);
}

function esperar(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * El último miércoles, que es el día en que se publica el Boletín de Marcas.
 * Si hoy es miércoles, devuelve hoy.
 */
export function ultimoMiercoles(desde?: Date): Date {
  const hoy = aMedianoche(desde || new Date());
  const dia = hoy.getDay(); // 0 = domingo, 3 = miércoles
  const atras = dia >= 3 ? dia - 3 : dia + 4;
  return restarDias(hoy, atras);
}
