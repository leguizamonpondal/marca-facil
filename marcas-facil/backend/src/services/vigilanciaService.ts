/**
 * EL CRUCE — actas del Boletín contra marcas vigiladas
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Es el punto donde todo lo construido empieza a decir algo. Hasta acá el
 * sistema descarga, parsea y guarda; esto es lo que convierte 4.000 actas
 * semanales en un puñado de avisos que valen la pena mirar.
 *
 * ── Dos filtros distintos, no uno con dos umbrales ─────────────────────────
 *
 * **Vigilancia normal** — clase idéntica y clases afines. Acá la proximidad
 * comercial corrobora, así que se usa `esConfundible()` con el umbral graduado
 * por el grado de afinidad: cuanto más lejana la clase, más exigente.
 *
 * **Vigilancia ampliada** (notorias y renombradas, módulo pago) — las 45
 * clases. En una clase sin ninguna relación no hay nada que corrobore, y el
 * umbral de la vigilancia normal sería ruido puro: con 4.000 actas por 45
 * clases, los hallazgos reales quedarían sepultados. Por eso ahí se exige
 * **identidad o cuasi-identidad** (`cuasiIdentidad.ts`).
 *
 * Una marca con vigilancia ampliada recibe los dos tratamientos: el normal en
 * sus clases afines, el estricto en las demás.
 *
 * ── Lo que este servicio NO decide ─────────────────────────────────────────
 *
 * Que una coincidencia salte no significa que corresponda oponerse. El aviso
 * es una convocatoria a mirar el expediente, no un dictamen. Por eso el texto
 * de la alerta cambia según el caso, y el de clase no afín dice expresamente
 * que requiere análisis.
 *
 * Es el mismo principio que ya rige la tabla de afinidad con el campo
 * `soloVigilancia`: **vigilar y oponer son cosas distintas.**
 *
 * ⚠️ Los umbrales de `esConfundible()` están puestos a ojo y **nadie los
 *    validó todavía**. Calibrarlos contra los dictámenes del INPI —fundadas e
 *    infundadas— es el paso siguiente, y necesita criterio del matriculado,
 *    no código. Hasta entonces, la lista que este servicio produce hay que
 *    leerla como un borrador.
 */

import { prisma } from '../db/client';
import { logger } from '../utils/logger';
import { calcularSimilitudMarcas } from '../utils/helpers';
import { vencimientoOposicion, vencimientoLegible, diasHastaVencimiento } from '../utils/plazos';
import {
  afinidadEntreClases,
  clasesAfinesA,
  UMBRAL_POR_AFINIDAD,
  type GradoAfinidad,
} from '../utils/afinidadClases';
import { esCuasiIdentica, type ReglaCuasiIdentidad } from '../utils/cuasiIdentidad';
import {
  extraerVedette,
  explicarVedette,
  usoComunSembrado,
  type EsUsoComun,
} from '../utils/motVedette';

// ── Tipos ────────────────────────────────────────────────────────────────────

export type MotivoCoincidencia = 'afinidad' | 'cuasi-identidad';

export interface Coincidencia {
  /** La marca del cliente. */
  marcaId: string;
  marcaDenominacion: string;
  marcaClase: number;

  /** La solicitud publicada en el Boletín. */
  entradaId: string;
  acta: string;
  actaDenominacion: string;
  actaClase: number;
  actaTitular: string;

  motivo: MotivoCoincidencia;
  /** `identica` · `alta` · `media` · `baja` — solo para el motivo afinidad. */
  gradoAfinidad?: GradoAfinidad | 'identica';
  /** Qué regla disparó — solo para cuasi-identidad. */
  regla?: ReglaCuasiIdentidad;
  similitud: number;
  /**
   * Qué eje hizo entrar la coincidencia, con su valor y el umbral que superó.
   *
   * La decisión se toma **por eje** —basta que uno supere, que es el criterio
   * del INPI y de la CNCAF— pero antes se informaba `similitudTotal`, el
   * promedio ponderado. Eso hacía que el listado dijera «similitud 65 %» en
   * una coincidencia que había entrado por ideológica 92 con umbral 72: quien
   * lo leía concluía, con razón, que el motor estaba roto.
   */
  ejeQueDisparo?: 'gráfico' | 'fonético' | 'ideológico';
  valorDelEje?: number;
  umbral?: number;
  /** Sobre qué términos se hizo el cotejo conceptual (mot vedette). */
  cotejoSobre?: string;
  explicacion: string;
  /** Qué tiene que hacer el matriculado con esto. */
  accion: string;
}

export interface ResultadoVigilancia {
  fecha: Date;
  entradasRevisadas: number;
  marcasVigiladas: number;
  comparaciones: number;
  coincidencias: Coincidencia[];
  vencimiento: string;
  diasRestantes: number;
  milisegundos: number;
  advertencias: string[];
}

// ── El cruce de UNA marca ────────────────────────────────────────────────────

/** Lo mínimo que hace falta saber de una marca para cruzarla. */
export interface MarcaACruzar {
  id: string;
  denominacion: string;
  claseNiza: number;
  vigilanciaAmpliada: boolean;
  tipoNotoriedad: 'NOTORIA' | 'RENOMBRADA' | null;
}

type ActaIndexada = {
  id: string;
  acta: string;
  denominacion: string | null;
  claseNiza: number;
  titularNombre: string;
};

/**
 * Cruza una marca contra las actas ya indexadas por clase.
 *
 * Está separada de `cruzarBoletin` para poder probar una denominación
 * cualquiera sin cargarla en la base. Durante la calibración eso importa: se
 * van a probar decenas de marcas contra los mismos datos, y crear una marca de
 * prueba por cada intento ensuciaría la base de producción con registros que
 * después hay que acordarse de borrar.
 */
export function cruzarUnaMarca(
  marca: MarcaACruzar,
  porClase: Map<number, ActaIndexada[]>,
  /**
   * Cómo se decide qué palabras son de uso común en cada clase. Se inyecta
   * porque el dato verdadero está en el padrón del INPI, no acá: hoy el
   * predicado por defecto sólo conoce una lista sembrada a mano, y cuando
   * exista el índice consultado al INPI se pasa ése sin tocar esta función.
   */
  esUsoComun: EsUsoComun = usoComunSembrado
): { coincidencias: Coincidencia[]; comparaciones: number } {
  const coincidencias: Coincidencia[] = [];
  let comparaciones = 0;

  // Qué clases mira esta marca, y con qué criterio cada una.
  const criterioPorClase = new Map<number, GradoAfinidad | 'identica'>();
  criterioPorClase.set(marca.claseNiza, 'identica');
  for (const af of clasesAfinesA(marca.claseNiza)) {
    if (!criterioPorClase.has(af.clase)) criterioPorClase.set(af.clase, af.grado);
  }

  // 1 · Clase idéntica y afines — confundibilidad con umbral graduado
  for (const [clase, grado] of criterioPorClase) {
    for (const e of porClase.get(clase) || []) {
      comparaciones++;

      // El mot vedette de cada lado, cada uno con SU clase: una palabra puede
      // ser de uso común en la clase de la marca y plena en la del acta.
      const vMarca = extraerVedette(marca.denominacion, marca.claseNiza, esUsoComun);
      const vActa = extraerVedette(e.denominacion!, e.claseNiza, esUsoComun);

      const sim = calcularSimilitudMarcas(marca.denominacion, e.denominacion!, {
        vedette1: vMarca.vedette,
        vedette2: vActa.vedette,
      });
      const umbral = UMBRAL_POR_AFINIDAD[grado] * 100;

      // Se informa el eje que disparó, no el promedio. Orden de preferencia:
      // gráfico, fonético, ideológico — del más objetivo al más discutible.
      let ejeQueDisparo: 'gráfico' | 'fonético' | 'ideológico' | null = null;
      let valorDelEje = 0;
      if (sim.similitudGrafica >= umbral) {
        ejeQueDisparo = 'gráfico'; valorDelEje = sim.similitudGrafica;
      } else if (sim.similitudFonetica >= umbral) {
        ejeQueDisparo = 'fonético'; valorDelEje = sim.similitudFonetica;
      } else if (sim.similitudIdeologica >= umbral) {
        ejeQueDisparo = 'ideológico'; valorDelEje = sim.similitudIdeologica;
      }
      if (!ejeQueDisparo) continue;

      coincidencias.push({
        marcaId: marca.id,
        marcaDenominacion: marca.denominacion,
        marcaClase: marca.claseNiza,
        entradaId: e.id,
        acta: e.acta,
        actaDenominacion: e.denominacion!,
        actaClase: e.claseNiza,
        actaTitular: e.titularNombre,
        motivo: 'afinidad',
        gradoAfinidad: grado,
        similitud: sim.similitudTotal,
        ejeQueDisparo,
        valorDelEje,
        umbral,
        cotejoSobre: sim.ideologicaSobre,
        explicacion:
          (grado === 'identica'
            ? `Misma clase (${clase}). `
            : `Clase ${e.claseNiza} frente a ${marca.claseNiza}, afinidad ${grado}. ` +
              `${afinidadEntreClases(marca.claseNiza, e.claseNiza).fundamento} `) +
          `Entró por el eje ${ejeQueDisparo} con ${valorDelEje} % ` +
          `(umbral ${Math.round(umbral)} %). ` +
          `Ejes: gráfica ${sim.similitudGrafica}, fonética ${sim.similitudFonetica}, ` +
          `ideológica ${sim.similitudIdeologica} sobre ${sim.ideologicaSobre}. ` +
          (vMarca.descartadas.length || vMarca.graficos.length
            ? explicarVedette(vMarca) + ' '
            : ''),
        accion: 'Cotejar el expediente y resolver si corresponde oponerse.',
      });
    }
  }

  // 2 · Clases NO afines — solo con vigilancia ampliada, exigiendo identidad
  //     o cuasi-identidad.
  if (!marca.vigilanciaAmpliada) return { coincidencias, comparaciones };

  for (const [clase, lista] of porClase) {
    if (criterioPorClase.has(clase)) continue; // ya se miró arriba
    for (const e of lista) {
      comparaciones++;
      const r = esCuasiIdentica(marca.denominacion, e.denominacion!);
      if (!r.hay) continue;

      coincidencias.push({
        marcaId: marca.id,
        marcaDenominacion: marca.denominacion,
        marcaClase: marca.claseNiza,
        entradaId: e.id,
        acta: e.acta,
        actaDenominacion: e.denominacion!,
        actaClase: e.claseNiza,
        actaTitular: e.titularNombre,
        motivo: 'cuasi-identidad',
        regla: r.regla,
        similitud: calcularSimilitudMarcas(marca.denominacion, e.denominacion!).similitudTotal,
        explicacion:
          `Coincidencia en clase NO afín (${e.claseNiza} frente a ${marca.claseNiza}). ` +
          r.explicacion,
        // El encuadre es otro: no es el art. 3° b), es notoriedad. Y para una
        // notoria —a diferencia de una renombrada— el art. 16.3 del ADPIC
        // puede no estar disponible. La decisión es del matriculado.
        accion:
          marca.tipoNotoriedad === 'RENOMBRADA'
            ? 'Puede corresponder oposición por renombre (ADPIC 16.3): la marca alcanza ' +
              'cualquier clase. Requiere análisis.'
            : 'Puede corresponder oposición por notoriedad, PERO el art. 6 bis protege ' +
              'frente a productos iguales o similares; la protección en cualquier clase ' +
              'es la del ADPIC 16.3, que exige renombre y registro. Requiere análisis.',
      });
    }
  }

  return { coincidencias, comparaciones };
}

// ── Indexado de las actas ────────────────────────────────────────────────────

/**
 * Trae las actas de una fecha y las agrupa por clase.
 *
 * El índice por clase es lo que hace viable el cruce: sin él habría que
 * recorrer las ~4.000 actas por cada marca vigilada; con él, solo las de las
 * clases que a esa marca le interesan — entre una y quince, según la afinidad.
 */
export async function indexarActas(fechaBoletin: Date): Promise<{
  total: number;
  sinDenominacion: number;
  porClase: Map<number, ActaIndexada[]>;
  advertencias: string[];
}> {
  const entradas = await prisma.boletinEntrada.findMany({
    where: { fechaBoletin },
    select: { id: true, acta: true, denominacion: true, claseNiza: true, titularNombre: true },
  });

  if (entradas.length === 0) {
    throw new Error(
      `No hay actas guardadas para el ${fechaBoletin.toLocaleDateString('es-AR')}. ` +
        'Hay que correr la descarga de esa fecha antes de cruzar.'
    );
  }

  const advertencias: string[] = [];
  const sinDenominacion = entradas.filter((e) => !e.denominacion).length;

  if (sinDenominacion > 0) {
    // No es un detalle: es la mitad del universo. Decirlo en cada corrida evita
    // que un "3 coincidencias" se lea como si se hubiera mirado todo.
    advertencias.push(
      `${sinDenominacion} de ${entradas.length} actas no tienen denominación y ` +
        'quedaron fuera del cotejo. Son mixtas y figurativas: la denominación está ' +
        'dentro del logo y hay que pedírsela al Web Service del INPI por número de acta. ' +
        'Hasta que eso esté, la vigilancia mira algo menos de la mitad de lo publicado.'
    );
  }

  const porClase = new Map<number, ActaIndexada[]>();
  for (const e of entradas) {
    if (!e.denominacion) continue;
    const lista = porClase.get(e.claseNiza) || [];
    lista.push(e);
    porClase.set(e.claseNiza, lista);
  }

  return { total: entradas.length, sinDenominacion, porClase, advertencias };
}

// ── El cruce ─────────────────────────────────────────────────────────────────

/**
 * Cruza las actas de una fecha contra todas las marcas vigiladas.
 *
 * **No escribe nada.** Devuelve las coincidencias para que el llamador decida
 * qué hacer: crear oposiciones y alertas, o solo mostrarlas. Separar el cálculo
 * de la escritura es lo que permite correrlo cien veces mientras se calibran
 * los umbrales sin ensuciar la base con oposiciones de prueba.
 */
export async function cruzarBoletin(fechaBoletin: Date): Promise<ResultadoVigilancia> {
  const t0 = Date.now();
  const advertencias: string[] = [];

  const { total, porClase, advertencias: avisosDeActas } = await indexarActas(fechaBoletin);
  advertencias.push(...avisosDeActas);

  // ── Las marcas vigiladas ─────────────────────────────────────────────────
  const marcas = await prisma.marca.findMany({
    where: {
      vigilanciaActiva: true,
      estado: { in: ['EN_TRAMITE', 'PUBLICADA', 'OPOSICION', 'EXAMEN_FONDO', 'CONCEDIDA'] },
    },
    select: {
      id: true,
      denominacion: true,
      claseNiza: true,
      vigilanciaAmpliada: true,
      tipoNotoriedad: true,
    },
  });

  if (marcas.length === 0) {
    advertencias.push(
      '⚠️ No hay ninguna marca con vigilancia activa. El cruce no comparó nada, ' +
        'y por eso encontró cero coincidencias — que no es lo mismo que no haberlas.'
    );
  }

  // ── El cruce propiamente dicho ───────────────────────────────────────────
  const coincidencias: Coincidencia[] = [];
  let comparaciones = 0;

  for (const marca of marcas) {
    const r = cruzarUnaMarca(marca, porClase);
    coincidencias.push(...r.coincidencias);
    comparaciones += r.comparaciones;
  }

  // Lo más parecido primero: es el orden en que conviene revisarlas.
  coincidencias.sort((a, b) => b.similitud - a.similitud);

  const vence = vencimientoOposicion(fechaBoletin);

  logger.info(
    `🔍 [Vigilancia] ${fechaBoletin.toLocaleDateString('es-AR')}: ` +
      `${total} actas × ${marcas.length} marcas = ${comparaciones} comparaciones, ` +
      `${coincidencias.length} coincidencias en ${Date.now() - t0} ms`
  );

  return {
    fecha: fechaBoletin,
    entradasRevisadas: total,
    marcasVigiladas: marcas.length,
    comparaciones,
    coincidencias,
    vencimiento: vencimientoLegible(vence),
    diasRestantes: diasHastaVencimiento(vence),
    milisegundos: Date.now() - t0,
    advertencias,
  };
}
