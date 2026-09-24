/**
 * PARSER DEL BOLETÍN DE MARCAS — códigos INID
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Convierte el PDF de un boletín en actas estructuradas.
 *
 * ── El formato ─────────────────────────────────────────────────────────────
 *
 * El boletín usa los **códigos INID de la OMPI**, un estándar internacional.
 * Es una buena noticia: no es una maquetación que cambie por capricho del
 * proveedor de turno.
 *
 *   (21) Acta 4207981 - (51) Clase 41
 *   (40) D (54) BEEFEATER
 *   (22) 10/01/2023 13:55:09.300 - (73) ALLIED DOMECQ SPIRITS & WINE LIMITED - GB *
 *   (57) SOLAMENTE … [productos y servicios]
 *   (30) // UK00003814972 - 29/07/22 - GB
 *   (74) 1029 - (44)16/09/2026
 *
 * | Código | Campo | Presencia en el boletín 11121 |
 * |--------|-------|-------------------------------|
 * | (21) | Acta — separador de registro | 772/772 |
 * | (51) | Clase de Niza | 772/772 |
 * | (40) | Tipo: D denominativa · M mixta · F figurativa · T 3D · R | 772/772 |
 * | (54) | Denominación — **vacía en mixtas y figurativas** | 772/772 |
 * | (22) | Fecha y hora de presentación | 772/772 |
 * | (73) | Titulares y país, separados por `*` | 772/772 |
 * | (57) | Productos y servicios | 772/772 |
 * | (30) | Prioridad extranjera | 145/772 |
 * | (59) | Colores reivindicados | 137/772 |
 * | (74) | Matrícula del agente, o `Part.` | 608/772 |
 * | (44) | Fecha de publicación | 772/772 |
 *
 * ── Cómo se separan los campos ─────────────────────────────────────────────
 *
 * No por líneas: varios códigos comparten renglón —(21) con (51), (40) con
 * (54), (22) con (73), (74) con (44)— y (57) se extiende por muchas líneas.
 *
 * Se localizan **todas las marcas `(NN)` del bloque** y se corta entre una y
 * la siguiente. Así el mismo código sirve para un campo de una palabra y para
 * uno de veinte renglones, sin casos especiales.
 *
 * ── Regla de la casa ───────────────────────────────────────────────────────
 *
 * **Nada falla en silencio.** Si un bloque no se puede leer, se cuenta y se
 * informa; no se descarta. Un parser que devuelve 700 actas de 772 sin decir
 * nada deja 72 marcas sin vigilar, y eso en este producto es un plazo de
 * oposición perdido.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger';

const ejecutar = promisify(execFile);

// ── Tipos ────────────────────────────────────────────────────────────────────

export type TipoMarca = 'D' | 'M' | 'F' | 'T' | 'R' | '?';

export interface Titular {
  nombre: string;
  /** Código de país de dos letras, o `''` si no vino. */
  pais: string;
}

export interface ActaBoletin {
  acta: string;
  clase: number;
  tipo: TipoMarca;
  /**
   * `null` en mixtas y figurativas: la denominación está dentro del logo, que
   * en el PDF es una imagen. Son el 57 % de las actas — hay que pedírsela al
   * Web Service del INPI por número de acta.
   */
  denominacion: string | null;
  fechaPresentacion: Date | null;
  titulares: Titular[];
  productos: string;
  prioridad: string | null;
  colores: string | null;
  /** Matrícula del agente. `null` si va por derecho propio. */
  agente: number | null;
  porDerechoPropio: boolean;
  fechaPublicacion: Date | null;
}

export interface ResultadoParseo {
  actas: ActaBoletin[];
  /** Bloques que empezaban con (21) pero no se pudieron leer. */
  fallidos: { fragmento: string; motivo: string }[];
  /** Bloques detectados en total. `actas.length + fallidos.length`. */
  bloques: number;
}

/** Los códigos INID que aparecen en el boletín de marcas nuevas. */
const CODIGOS = ['21', '22', '30', '40', '44', '51', '54', '57', '59', '73', '74'] as const;
const RE_CODIGO = new RegExp(`\\((${CODIGOS.join('|')})\\)`, 'g');

// ── Extracción del texto ─────────────────────────────────────────────────────

/**
 * Saca el texto del PDF con `pdftotext -layout`.
 *
 * El PDF lo genera iTextSharp y trae capa de texto — no es escaneado, no hace
 * falta OCR.
 *
 * ⚠️ `pdftotext` viene en el paquete **poppler-utils**, que la imagen de
 *    Playwright no incluye. Está agregado en el Dockerfile. Si falta, esto
 *    tira con un mensaje claro en lugar de devolver texto vacío y hacer creer
 *    que el boletín no tenía actas.
 */
export async function extraerTextoDelPdf(rutaPdf: string): Promise<string> {
  try {
    const { stdout } = await ejecutar('pdftotext', ['-layout', '-enc', 'UTF-8', rutaPdf, '-'], {
      maxBuffer: 64 * 1024 * 1024, // un boletín ronda los 650 KB de texto; holgura de sobra
    });
    if (!stdout || stdout.length < 1000) {
      throw new Error(
        `pdftotext devolvió ${stdout?.length ?? 0} caracteres. Un boletín ronda los 650.000. ` +
          'El PDF puede estar truncado o no ser el que esperábamos.'
      );
    }
    return stdout;
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      throw new Error(
        'No está instalado `pdftotext`. Viene en el paquete poppler-utils y tiene que ' +
          'estar en el Dockerfile: `RUN apt-get update && apt-get install -y poppler-utils`.'
      );
    }
    throw err;
  }
}

// ── Parseo ───────────────────────────────────────────────────────────────────

/**
 * Convierte el texto de un boletín en actas.
 *
 * Probado contra el boletín 11121 completo: 772 de 772.
 */
export function parsearActas(texto: string): ResultadoParseo {
  // Cada registro arranca en "(21) Acta". El primer fragmento es el
  // nomenclador y las portadas, que se descartan.
  const bloques = texto.split(/(?=\(21\)\s*Acta\s)/).slice(1);

  const actas: ActaBoletin[] = [];
  const fallidos: { fragmento: string; motivo: string }[] = [];

  for (const bloque of bloques) {
    try {
      const acta = parsearBloque(bloque);
      if (acta) actas.push(acta);
      else fallidos.push({ fragmento: bloque.slice(0, 120), motivo: 'sin acta o sin clase' });
    } catch (err: any) {
      fallidos.push({ fragmento: bloque.slice(0, 120), motivo: err?.message || String(err) });
    }
  }

  return { actas, fallidos, bloques: bloques.length };
}

function parsearBloque(bloque: string): ActaBoletin | null {
  const campos = trocearPorCodigos(bloque);

  // (21) "Acta 4207981 - "
  const acta = campos['21']?.match(/Acta\s*([\d.]+)/i)?.[1]?.replace(/\./g, '');
  const clase = Number(campos['51']?.match(/Clase\s*(\d{1,2})/i)?.[1]);
  if (!acta || !Number.isFinite(clase) || clase < 1 || clase > 45) return null;

  // (40) es una sola letra. (54) puede venir vacío: es lo normal en mixtas.
  const tipoBruto = (campos['40'] || '').trim().toUpperCase().charAt(0);
  const tipo: TipoMarca = 'DMFTR'.includes(tipoBruto) ? (tipoBruto as TipoMarca) : '?';

  const denomBruta = limpiar(campos['54'] || '');
  const denominacion = denomBruta.length > 0 ? denomBruta : null;

  return {
    acta,
    clase,
    tipo,
    denominacion,
    fechaPresentacion: parsearFechaHora(campos['22'] || ''),
    titulares: parsearTitulares(campos['73'] || ''),
    productos: limpiar(campos['57'] || ''),
    prioridad: limpiar(campos['30'] || '') || null,
    colores: limpiar(campos['59'] || '') || null,
    ...parsearAgente(campos['74'] || ''),
    fechaPublicacion: parsearFecha(campos['44'] || ''),
  };
}

/**
 * Corta el bloque entre marca y marca de código INID.
 *
 * Es lo que permite que (57) ocupe veinte renglones y (40) una letra sin
 * tratarlos distinto. Si un código apareciera dos veces, gana el primero: el
 * texto de los productos a veces contiene paréntesis con números.
 */
function trocearPorCodigos(bloque: string): Record<string, string> {
  const marcas: { codigo: string; desde: number; hasta: number }[] = [];

  RE_CODIGO.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_CODIGO.exec(bloque)) !== null) {
    marcas.push({ codigo: m[1], desde: m.index + m[0].length, hasta: bloque.length });
  }
  for (let i = 0; i < marcas.length - 1; i++) {
    marcas[i].hasta = marcas[i + 1].desde - 4; // 4 = largo de "(NN)"
  }

  const campos: Record<string, string> = {};
  for (const { codigo, desde, hasta } of marcas) {
    if (campos[codigo] === undefined) campos[codigo] = bloque.slice(desde, hasta);
  }
  return campos;
}

/**
 * (73) `ALLIED DOMECQ SPIRITS & WINE LIMITED - GB *`
 *      `LEONE ADRIAN JAVIER - AR * VERA FERNANDO ANDRES - AR * TOZZINI … - AR *`
 *
 * Varios titulares separados por `*`, cada uno con su país al final tras un
 * guion. El guion también aparece dentro de razones sociales, así que se toma
 * **el último**, y solo si lo que sigue son dos letras.
 */
function parsearTitulares(bruto: string): Titular[] {
  return bruto
    .split('*')
    .map((t) => limpiar(t))
    .filter((t) => t.length > 0)
    .map((t) => {
      const m = t.match(/^(.*?)\s*-\s*([A-Z]{2})$/);
      return m ? { nombre: limpiar(m[1]), pais: m[2] } : { nombre: t, pais: '' };
    })
    .filter((t) => t.nombre.length > 0);
}

/**
 * (74) `1029 - ` → agente matrícula 1029
 *      `Part. - ` → por derecho propio
 *      ausente → ni uno ni otro; se registra como derecho propio
 *
 * La matrícula sirve para saber qué publicaciones presentó cada agente. La del
 * matriculado de este sistema es la 1974.
 */
function parsearAgente(bruto: string): { agente: number | null; porDerechoPropio: boolean } {
  const texto = limpiar(bruto);
  if (/^part\.?/i.test(texto)) return { agente: null, porDerechoPropio: true };
  const n = Number(texto.match(/^(\d+)/)?.[1]);
  if (Number.isFinite(n)) return { agente: n, porDerechoPropio: false };
  return { agente: null, porDerechoPropio: true };
}

/** (22) `10/01/2023 13:55:09.300 - ` */
function parsearFechaHora(bruto: string): Date | null {
  const m = bruto.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}):(\d{2}))?/);
  if (!m) return null;
  const d = new Date(
    Number(m[3]), Number(m[2]) - 1, Number(m[1]),
    Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)
  );
  return isNaN(d.getTime()) ? null : d;
}

/** (44) `16/09/2026` */
function parsearFecha(bruto: string): Date | null {
  const m = bruto.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return isNaN(d.getTime()) ? null : d;
}

/** Junta los renglones en uno y normaliza los espacios. */
function limpiar(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/^[\s\-—]+|[\s\-—*]+$/g, '').trim();
}
