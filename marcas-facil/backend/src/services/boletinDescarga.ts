/**
 * DESCARGA SEMANAL DE BOLETINES — con verificación de completitud
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Trae **todos** los boletines de MARCAS NUEVAS de un miércoles y deja
 * constancia de si están todos o no.
 *
 * ── Por qué la verificación es la mitad del archivo ────────────────────────
 *
 * El Boletín de Marcas no es uno por semana: son cuatro o cinco. El
 * 16/09/2026 fueron los números 11117 a 11121, y solo el 11121 ya traía 772
 * actas. El universo real ronda las 3.100–3.900 solicitudes semanales.
 *
 * Una rutina que baje uno y dé la semana por vigilada queda ciega al 80 % de
 * las publicaciones **sin ningún error visible**. Para el cliente eso es un
 * plazo de oposición de 30 días corridos que se vence sin que nadie mire.
 *
 * Por eso acá nada se da por hecho. La rutina tiene que poder afirmar
 * "bajé los 5 boletines del 16/09", y si no puede, decirlo fuerte.
 *
 * Tres controles:
 *
 *   1. **Que el portal haya listado algo.** Cero boletines un miércoles no es
 *      un resultado válido: en las once semanas verificadas no pasó nunca.
 *      Se trata como falla del portal, no como semana sin publicaciones.
 *
 *   2. **Que la numeración no tenga huecos.** Los boletines de una fecha son
 *      consecutivos (11117, 11118, 11119, 11120, 11121). Un salto significa
 *      que existe un boletín que el listado no mostró — el caso peligroso,
 *      porque todo lo demás sale bien.
 *
 *   3. **Que hayan bajado todos los listados.** Uno que falla deja la semana
 *      incompleta, y la semana incompleta tiene que quedar marcada para
 *      reintentar, no pasar como buena.
 *
 * ── Dónde quedan los PDF ───────────────────────────────────────────────────
 *
 * En un directorio temporal, y se borran después de parsear. Son ~20 MB cada
 * uno: 100 MB por semana, 5 GB por año. No se guardan porque el INPI ya los
 * aloja de forma permanente en una URL estable — si alguna vez hace falta el
 * PDF original, se vuelve a pedir. Lo que hay que persistir son las actas
 * extraídas, que van a la base.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { prisma } from '../db/client';
import { logger } from '../utils/logger';
import {
  boletinesDeMarcasNuevas,
  descargarPdf,
  ultimoMiercoles,
  aMedianoche,
  type FilaBoletin,
} from './boletinPortal';

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface BoletinEnDisco {
  numero: string;
  urlPdf: string;
  rutaPdf: string;
  tamanoMb: number;
  comentario: string;
}

export interface ResultadoDescarga {
  fecha: Date;
  /** `true` solo si se bajaron todos los boletines listados y no hay huecos. */
  completa: boolean;
  /** Números que el portal listó para esa fecha. */
  publicados: string[];
  descargados: BoletinEnDisco[];
  fallidos: { numero: string; error: string }[];
  /** Números que faltan en la secuencia. Ver control 2. */
  huecos: string[];
  /** Directorio temporal con los PDF. Hay que borrarlo al terminar. */
  directorio: string;
  /** Frases legibles para el log y para el aviso al matriculado. */
  advertencias: string[];
}

// ── La rutina ────────────────────────────────────────────────────────────────

/**
 * Descarga los boletines de MARCAS NUEVAS de una fecha.
 *
 * @param fecha  el miércoles a procesar. Por defecto, el último.
 * @param opciones.forzar  vuelve a bajar los que ya figuran descargados.
 *
 * @throws si el portal no responde o no lista ningún boletín para la fecha.
 *         Una excepción acá es correcta: significa que no se pudo mirar, y
 *         eso no se puede confundir con haber mirado y no encontrado nada.
 */
export async function descargarBoletinesDeLaFecha(
  fecha?: Date,
  opciones?: { forzar?: boolean }
): Promise<ResultadoDescarga> {
  const dia = aMedianoche(fecha || ultimoMiercoles());
  const diaTexto = dia.toLocaleDateString('es-AR');

  logger.info(`📰 [Boletín] Buscando boletines de MARCAS NUEVAS del ${diaTexto}`);

  const filas = await boletinesDeMarcasNuevas(dia);

  // ── Control 1 ──────────────────────────────────────────────────────────────
  if (filas.length === 0) {
    throw new Error(
      `El portal del INPI no listó ningún boletín de MARCAS NUEVAS para el ${diaTexto}. ` +
        'En las once semanas verificadas siempre hubo entre cuatro y cinco, así que ' +
        'esto se trata como falla de la consulta y no como semana sin publicaciones. ' +
        'Hay que reintentar y, si persiste, revisar el portal a mano.'
    );
  }

  const publicados = filas.map((f) => f.numero);
  const advertencias: string[] = [];

  logger.info(`  ${filas.length} boletines publicados: ${publicados.join(', ')}`);

  // ── Control 2 ──────────────────────────────────────────────────────────────
  const huecos = buscarHuecos(publicados);
  if (huecos.length > 0) {
    advertencias.push(
      `La numeración tiene huecos: falta ${huecos.join(', ')} entre ${publicados[0]} y ` +
        `${publicados[publicados.length - 1]}. Puede ser un boletín de otro tipo ` +
        '(resoluciones, caducidades) intercalado en la serie, o uno de marcas nuevas ' +
        'que el listado no mostró. Conviene verificarlo a mano antes de dar la semana por cerrada.'
    );
  }

  if (filas.length < 4) {
    advertencias.push(
      `Solo ${filas.length} boletines para el ${diaTexto}. Lo habitual son cuatro o cinco: ` +
        'revisar que el portal los haya publicado todos.'
    );
  }

  // ── Descarga ───────────────────────────────────────────────────────────────
  const directorio = fs.mkdtempSync(path.join(os.tmpdir(), 'boletines-'));
  const descargados: BoletinEnDisco[] = [];
  const fallidos: { numero: string; error: string }[] = [];

  for (const fila of filas) {
    if (!opciones?.forzar && (await yaSeDescargo(fila.numero))) {
      logger.info(`  ⏭️  Boletín ${fila.numero}: ya descargado, se omite`);
      continue;
    }

    try {
      const pdf = await descargarPdf(fila);
      const rutaPdf = path.join(directorio, `${fila.numero}.pdf`);
      fs.writeFileSync(rutaPdf, pdf.bytes);

      descargados.push({
        numero: fila.numero,
        urlPdf: fila.urlPdf,
        rutaPdf,
        tamanoMb: pdf.tamanoMb,
        comentario: fila.comentario,
      });

      await registrar(dia, fila, { exitosa: true });
    } catch (err: any) {
      const error = err?.message || String(err);
      logger.error(`  ❌ Boletín ${fila.numero}: ${error}`);
      fallidos.push({ numero: fila.numero, error });
      await registrar(dia, fila, { exitosa: false, error });
    }
  }

  // ── Control 3 ──────────────────────────────────────────────────────────────
  const completa = fallidos.length === 0 && huecos.length === 0;

  if (fallidos.length > 0) {
    advertencias.push(
      `No se pudieron descargar ${fallidos.length} de ${filas.length} boletines ` +
        `(${fallidos.map((f) => f.numero).join(', ')}). La vigilancia de esta fecha está ` +
        'INCOMPLETA: hay que reintentar antes de notificar a los clientes.'
    );
  }

  const resumen =
    `${descargados.length} descargados` +
    (fallidos.length ? `, ${fallidos.length} fallidos` : '') +
    `, de ${filas.length} publicados`;

  if (completa) {
    logger.info(`✅ [Boletín] ${diaTexto}: ${resumen}`);
  } else {
    logger.error(`⚠️  [Boletín] ${diaTexto} INCOMPLETO: ${resumen}`);
  }
  advertencias.forEach((a) => logger.warn(`  ⚠️  ${a}`));

  return {
    fecha: dia,
    completa,
    publicados,
    descargados,
    fallidos,
    huecos,
    directorio,
    advertencias,
  };
}

/**
 * Borra el directorio temporal. Se llama después de parsear, y también en el
 * `finally` de quien orqueste, para que un error no deje 100 MB colgados.
 */
export function limpiar(resultado: ResultadoDescarga): void {
  try {
    fs.rmSync(resultado.directorio, { recursive: true, force: true });
  } catch (err: any) {
    logger.warn(`[Boletín] No se pudo borrar ${resultado.directorio}: ${err.message}`);
  }
}

// ── Persistencia ─────────────────────────────────────────────────────────────

/**
 * Un registro por boletín, no por fecha.
 *
 * ⚠️ Los nombres de campo son los de `schema.prisma`: `fechaBoletin`,
 *    `urlDescargada`. El cliente de Prisma de este repo está sin generar y
 *    tipa `prisma` como `any`, así que TypeScript no verifica nada de esto:
 *    un nombre mal escrito compila y explota recién en producción.
 */
async function registrar(
  fecha: Date,
  fila: FilaBoletin,
  estado: { exitosa: boolean; error?: string }
): Promise<void> {
  try {
    await prisma.boletinDescarga.create({
      data: {
        fechaBoletin: fecha,
        boletinNumero: fila.numero,
        urlDescargada: fila.urlPdf,
        exitosa: estado.exitosa,
        totalActas: 0, // lo completa el parser
        error: estado.error || null,
      },
    });
  } catch (err: any) {
    // Que falle el registro no puede tumbar la descarga, pero tiene que verse.
    logger.error(`[Boletín] No se pudo registrar la descarga de ${fila.numero}: ${err.message}`);
  }
}

async function yaSeDescargo(numero: string): Promise<boolean> {
  try {
    const previo = await prisma.boletinDescarga.findFirst({
      where: { boletinNumero: numero, exitosa: true },
    });
    return Boolean(previo);
  } catch {
    // Ante la duda, bajar de nuevo: repetir una descarga es barato, saltearla
    // por error de consulta es quedarse sin el boletín.
    return false;
  }
}

// ── Control de numeración ────────────────────────────────────────────────────

/**
 * Devuelve los números que faltan entre el primero y el último.
 * `['11117','11118','11120']` → `['11119']`
 */
function buscarHuecos(numeros: string[]): string[] {
  const enteros = numeros.map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (enteros.length < 2) return [];

  const faltantes: string[] = [];
  for (let n = enteros[0] + 1; n < enteros[enteros.length - 1]; n++) {
    if (!enteros.includes(n)) faltantes.push(String(n));
  }
  return faltantes;
}
