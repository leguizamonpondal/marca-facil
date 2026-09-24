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
import { extraerTextoDelPdf, parsearActas, type ActaBoletin } from './boletinParser';

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface BoletinEnDisco {
  numero: string;
  urlPdf: string;
  rutaPdf: string;
  tamanoMb: number;
  comentario: string;
  /** Actas que el parser pudo leer del PDF. */
  actasLeidas: number;
  /** Las que entraron a la base en esta corrida. */
  actasNuevas: number;
  /** Las que ya estaban — se vuelve a correr la misma fecha, por ejemplo. */
  actasRepetidas: number;
  /** Bloques ilegibles más actas que no se pudieron guardar. */
  actasFallidas: number;
  /** Mixtas y figurativas: hay que pedirle la denominación al Web Service. */
  sinDenominacion: number;
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
  opciones?: { forzar?: boolean; soloNumero?: string }
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

  // Procesar de a uno. Existe para las pruebas manuales: los cuatro boletines
  // de una fecha son ~150 MB y varios minutos de trabajo, y el proxy de
  // Railway corta la respuesta HTTP antes de que termine. La rutina semanal
  // corre en un worker, sin nadie esperando del otro lado, así que ahí no hace
  // falta — pero para verificar a mano sí.
  //
  // ⚠️ Con esto la fecha NO queda completa: se procesa un boletín de cuatro.
  //    Por eso `completa` se fuerza a false más abajo.
  const aProcesar = opciones?.soloNumero
    ? filas.filter((f) => f.numero === opciones.soloNumero)
    : filas;

  if (opciones?.soloNumero && aProcesar.length === 0) {
    throw new Error(
      `El boletín ${opciones.soloNumero} no figura entre los del ${diaTexto}. ` +
        `Publicados: ${publicados.join(', ')}.`
    );
  }

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

  // ── Control 2 bis ──────────────────────────────────────────────────────────
  const saltados = await verificarContinuidad(publicados[0], dia);
  huecos.push(...saltados);
  if (saltados.length > 0) {
    advertencias.push(
      `Entre la última descarga y esta quedaron sin bajar: ${saltados.join(', ')}. ` +
        'Son boletines que existieron y no se vigilaron — hay que recuperarlos por número. ' +
        'El plazo de oposición de esas publicaciones ya está corriendo.'
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

  for (const fila of aProcesar) {
    if (!opciones?.forzar && (await yaSeDescargo(fila.numero))) {
      logger.info(`  ⏭️  Boletín ${fila.numero}: ya descargado, se omite`);
      continue;
    }

    try {
      const pdf = await descargarPdf(fila);
      const rutaPdf = path.join(directorio, `${fila.numero}.pdf`);
      fs.writeFileSync(rutaPdf, pdf.bytes);

      // ── Parsear y guardar ────────────────────────────────────────────────
      const texto = await extraerTextoDelPdf(rutaPdf);
      const parseo = parsearActas(texto);
      const guardadas = await guardarActas(parseo.actas, dia, fila.numero);

      if (parseo.fallidos.length > 0) {
        advertencias.push(
          `Boletín ${fila.numero}: ${parseo.fallidos.length} de ${parseo.bloques} bloques ` +
            'no se pudieron leer. Son actas publicadas que no quedaron vigiladas.'
        );
      }
      if (guardadas.fallidas > 0) {
        advertencias.push(
          `Boletín ${fila.numero}: ${guardadas.fallidas} actas se leyeron pero no se ` +
            'pudieron guardar en la base.'
        );
      }

      descargados.push({
        numero: fila.numero,
        urlPdf: fila.urlPdf,
        rutaPdf,
        tamanoMb: pdf.tamanoMb,
        comentario: fila.comentario,
        actasLeidas: parseo.actas.length,
        actasNuevas: guardadas.nuevas,
        actasRepetidas: guardadas.repetidas,
        actasFallidas: guardadas.fallidas + parseo.fallidos.length,
        sinDenominacion: parseo.actas.filter((a) => !a.denominacion).length,
      });

      logger.info(
        `  📖 Boletín ${fila.numero}: ${parseo.actas.length} actas leídas, ` +
          `${guardadas.nuevas} nuevas, ${guardadas.repetidas} ya estaban`
      );

      await registrar(dia, fila, { exitosa: true, totalActas: guardadas.nuevas });
    } catch (err: any) {
      const error = err?.message || String(err);
      logger.error(`  ❌ Boletín ${fila.numero}: ${error}`);
      fallidos.push({ numero: fila.numero, error });
      await registrar(dia, fila, { exitosa: false, error });
    }
  }

  // ── Control 3 ──────────────────────────────────────────────────────────────
  //
  // Procesar uno solo nunca deja la fecha completa, aunque ese uno salga bien:
  // quedan los otros tres sin mirar. Decirlo explícito evita que una prueba
  // manual exitosa se confunda con una semana vigilada.
  const completa =
    !opciones?.soloNumero && fallidos.length === 0 && huecos.length === 0;

  if (opciones?.soloNumero) {
    advertencias.push(
      `Se procesó solo el boletín ${opciones.soloNumero} de ${filas.length}. ` +
        'La fecha NO está vigilada: faltan los demás.'
    );
  }

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

// ── Guardado de actas ────────────────────────────────────────────────────────

/**
 * Actas por lote de inserción.
 *
 * Chico a propósito: si un lote falla, se pierden 200 actas y el log dice
 * entre qué números estaban. Con lotes de 2.000 se perdería medio boletín y no
 * se sabría por dónde buscar.
 */
const TAMANO_LOTE = 200;

/**
 * Guarda las actas leídas de un boletín.
 *
 * ── Por qué en lotes, y no una consulta por acta ───────────────────────────
 *
 * ⚠️ La primera versión hacía `findUnique` + `create` por cada acta. Con ~4.000
 *    actas son 8.000 viajes de Railway a Supabase, y cada viaje son decenas de
 *    milisegundos: **minutos enteros solo de latencia de red**. El proxy de
 *    Railway cortaba la respuesta con `upstream error` antes de que terminara.
 *
 *    Al escribir aquella versión justifiqué el costo diciendo "son segundos".
 *    No conté la latencia de red, que es la que manda cuando la base está del
 *    otro lado de Internet. El error fue mío y está acá anotado para no
 *    repetirlo: **en este sistema, el costo de una operación sobre la base se
 *    mide en viajes, no en registros.**
 *
 * Ahora son 1 consulta para saber cuáles ya estaban, más un puñado de
 * `createMany` por lotes. De 8.000 viajes a menos de 20.
 *
 * ── Los tres contadores se conservan ───────────────────────────────────────
 *
 * El motivo por el que la primera versión iba una por una era poder distinguir:
 *
 *   - **nuevas** — actas que no estaban
 *   - **repetidas** — ya estaban; se reprocesa una fecha, por ejemplo
 *   - **fallidas** — no se guardaron
 *
 * Esa distinción no se pierde: las repetidas salen de la consulta previa, y
 * `createMany` devuelve cuántas entraron de verdad, así que un faltante dentro
 * del lote se detecta igual. Lo único que se resigna es saber *cuál* acta del
 * lote falló; por eso el lote es chico y el log dice entre qué números estaba.
 *
 * Una acta fallida es una marca que no se va a vigilar, y tiene que contarse
 * aparte de una repetida, que es inofensiva. La diferencia entre "0 alertas
 * porque no había nada" y "0 alertas porque no se guardó nada" es el producto
 * entero.
 */
async function guardarActas(
  actas: ActaBoletin[],
  fechaBoletin: Date,
  boletinNumero: string
): Promise<{ nuevas: number; repetidas: number; fallidas: number }> {
  if (actas.length === 0) return { nuevas: 0, repetidas: 0, fallidas: 0 };

  // ── 1. Cuáles ya están, en UNA consulta ──────────────────────────────────
  const numeros = actas.map((a) => a.acta);
  const yaEstaban = new Set<string>();
  try {
    const previas = await prisma.boletinEntrada.findMany({
      where: { acta: { in: numeros } },
      select: { acta: true },
    });
    for (const p of previas) yaEstaban.add(p.acta);
  } catch (err: any) {
    // Sin este dato se insertaría a ciegas y los duplicados harían fallar el
    // lote entero. Mejor abortar el boletín y que quede contado como fallido.
    throw new Error(`No se pudo consultar qué actas ya estaban: ${err.message}`);
  }

  const aInsertar = actas.filter((a) => !yaEstaban.has(a.acta));

  // ── 2. Insertar en lotes ─────────────────────────────────────────────────
  let nuevas = 0;
  let fallidas = 0;

  for (let i = 0; i < aInsertar.length; i += TAMANO_LOTE) {
    const lote = aInsertar.slice(i, i + TAMANO_LOTE);
    try {
      const r = await prisma.boletinEntrada.createMany({
        data: lote.map((a) => filaDeActa(a, fechaBoletin, boletinNumero)),
        skipDuplicates: true,
      });
      nuevas += r.count;
      // `createMany` devuelve cuántas entraron. Si entraron menos que las del
      // lote, la diferencia son actas que no quedaron guardadas — o sea,
      // marcas que no se van a vigilar. No se puede pasar por alto.
      if (r.count < lote.length) fallidas += lote.length - r.count;
    } catch (err: any) {
      fallidas += lote.length;
      logger.error(
        `[Boletín ${boletinNumero}] Falló un lote de ${lote.length} actas ` +
          `(${lote[0].acta} a ${lote[lote.length - 1].acta}): ${err.message}`
      );
    }
  }

  return { nuevas, repetidas: yaEstaban.size, fallidas };
}

/** Una acta parseada, con la forma que espera la base. */
function filaDeActa(a: ActaBoletin, fechaBoletin: Date, boletinNumero: string) {
  return {
    fechaBoletin,
    boletinNumero,
    acta: a.acta,
    claseNiza: a.clase,
    denominacion: a.denominacion, // null en mixtas y figurativas
    tipoInid: a.tipo,
    tipoMarca: nombreDelTipo(a.tipo),
    titularNombre: a.titulares.map((t) => t.nombre).join(' * ') || 'No informado',
    productos: a.productos || null,
    productosTruncados: /PUEDE SER CONSULTADA EN EL SIGUIENTE ENLACE/i.test(a.productos),
    fechaPresentacion: a.fechaPresentacion,
    agenteNumero: a.agente,
    porDerechoPropio: a.porDerechoPropio,
    colores: a.colores,
    prioridad: a.prioridad,
  };
}

/** El código INID (40) en palabras, para las pantallas. */
function nombreDelTipo(inid: string): string {
  return (
    {
      D: 'DENOMINATIVA',
      M: 'MIXTA',
      F: 'FIGURATIVA',
      T: 'TRIDIMENSIONAL',
      R: 'OTRA',
    }[inid] || 'DENOMINATIVA'
  );
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
  estado: { exitosa: boolean; error?: string; totalActas?: number }
): Promise<void> {
  try {
    await prisma.boletinDescarga.create({
      data: {
        fechaBoletin: fecha,
        boletinNumero: fila.numero,
        urlDescargada: fila.urlPdf,
        exitosa: estado.exitosa,
        totalActas: estado.totalActas ?? 0,
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
 * Control de continuidad ENTRE semanas.
 *
 * ── Por qué hace falta, además del control de huecos ───────────────────────
 *
 * `buscarHuecos()` mira la numeración dentro de una misma fecha. Eso deja
 * pasar el caso peligroso: que el INPI publique un boletín más tarde, o que el
 * listado no lo muestre, y la tanda del día se vea perfectamente consecutiva.
 *
 *   Semana pasada: 11122 … 11125
 *   Esta semana:   11127 … 11130   ← el 11126 existió y nadie lo miró
 *
 * Dentro de cada fecha no hay ningún hueco. Todo sale bien. Y hay un boletín
 * entero sin vigilar, con su plazo de 30 días corriendo.
 *
 * ── Por qué el control es válido ───────────────────────────────────────────
 *
 * La serie de MARCAS NUEVAS es estrictamente consecutiva: verificada del 11073
 * al 11125, doce semanas seguidas sin un solo salto. Los otros tipos de
 * boletín (resoluciones, caducidades, anexos) van en una numeración paralela
 * —la serie `60xx`— así que no se intercalan.
 *
 * @returns los números que quedaron sin descargar, o `[]` si no hay ninguno
 *          o si es la primera corrida.
 */
async function verificarContinuidad(primeroDeHoy: string, fecha: Date): Promise<string[]> {
  const inicio = Number(primeroDeHoy);
  if (!Number.isFinite(inicio)) return [];

  let ultimo: number;
  try {
    // ⚠️ `boletinNumero` es String en el schema, así que este `desc` ordena
    //    alfabéticamente, no numéricamente. Hoy da igual porque todos los
    //    números tienen cinco dígitos (11xxx) y ahí las dos ordenaciones
    //    coinciden. Dejaría de coincidir si la serie llegara a seis dígitos
    //    —faltan unas 1.700 semanas— o si alguien cargara a mano un número de
    //    largo distinto.
    const previo = await prisma.boletinDescarga.findFirst({
      where: { exitosa: true, fechaBoletin: { lt: fecha } },
      orderBy: { boletinNumero: 'desc' },
      select: { boletinNumero: true },
    });
    if (!previo?.boletinNumero) return []; // primera corrida: no hay con qué comparar
    ultimo = Number(previo.boletinNumero);
    if (!Number.isFinite(ultimo)) return [];
  } catch (err: any) {
    // Sin el dato previo no se puede afirmar continuidad. Se avisa en el log y
    // no se inventa un resultado tranquilizador.
    logger.warn(`[Boletín] No se pudo verificar la continuidad entre semanas: ${err.message}`);
    return [];
  }

  if (inicio <= ultimo + 1) return []; // consecutivo, o repetido

  const faltantes: string[] = [];
  for (let n = ultimo + 1; n < inicio; n++) faltantes.push(String(n));

  // Un salto enorme no es un hueco real: es una base recién creada, una
  // importación, o un cambio de serie del INPI. Avisar de 400 boletines
  // faltantes sería ruido que tapa el caso verdadero, que es de uno o dos.
  if (faltantes.length > 12) {
    logger.warn(
      `[Boletín] Salto de ${faltantes.length} números entre ${ultimo} y ${inicio}. ` +
        'Es demasiado para un hueco real; probablemente la base no tenga el historial ' +
        'completo. No se reporta como faltante.'
    );
    return [];
  }

  return faltantes;
}

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
