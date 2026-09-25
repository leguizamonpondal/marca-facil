/**
 * MOT VEDETTE — el término sobre el que se hace el cotejo
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * En un conjunto marcario no todas las palabras pesan igual. La doctrina llama
 * **mot vedette** a la que sobresale, y es ésa la que hay que cotejar contra el
 * antecedente. Las demás —artículos, preposiciones, y las palabras de uso
 * común dentro de la clase— no fundan confundibilidad por sí solas: si
 * cualquiera de ellas alcanzara para hacer coincidir dos marcas, todas las
 * marcas de una clase serían confundibles entre sí.
 *
 * Criterio dado por el matriculado (24/09/2026):
 *
 * > «Pueden existir palabras de uso común dentro de la clase, que son aquellas
 * > en las que existen más de 10 registros con una misma palabra —por ejemplo,
 * > en clase 25 la palabra KIDS—, y hay una palabra que es la que sobresale,
 * > que la doctrina llama MOT VEDETTE; es entonces ésa la que hay que evaluar
 * > contra el antecedente.»
 *
 * ── Qué hace este módulo y qué NO ──────────────────────────────────────────
 *
 * Hace dos cosas, las dos mecánicas y verificables:
 *
 *   1. Saca los **gráficos entre paréntesis** (convención de Damlong).
 *   2. Descarta **palabras vacías** (lista cerrada) y **palabras de uso común
 *      en la clase** (consulta a un índice), y devuelve lo que queda.
 *
 * Lo que NO hace es juzgar qué término es semánticamente más llamativo entre
 * dos que sobrevivieron al filtro. Eso no es medible con reglas y no se
 * inventa: si quedan varias palabras, se devuelven todas y el cotejo se hace
 * sobre ese resto. La decisión sobre un caso dudoso sigue siendo del
 * matriculado.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1 · Gráficos entre paréntesis — convención de Damlong
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Damlong guarda la descripción del dibujo **entre paréntesis**, dentro del
 * mismo campo que la denominación. Hay dos casos y no se tratan igual:
 *
 *   `NAHANA (CASA)`        → la marca es NAHANA, mixta, con un dibujo de casa
 *   `(CARA CUADRADA OJO)`  → figurativa pura: no hay denominación
 *
 * Confundir los dos es lo que produjo el falso positivo
 * `NAHANA (CASA)` × `HOMAX HOME MATERIALS`: se cotejó la palabra CASA, que no
 * es una palabra de la marca sino la descripción de su dibujo, contra HOME.
 *
 * El dibujo NO se descarta: se devuelve aparte. La confundibilidad entre
 * gráficos existe, pero es un cotejo de imágenes y hoy no se hace.
 */
export function separarGraficos(campo: string): {
  denominacion: string;
  graficos: string[];
} {
  const graficos: string[] = [];
  for (const m of campo.matchAll(/\(([^)]*)\)/g)) {
    const g = m[1].trim();
    if (g) graficos.push(g);
  }
  const denominacion = campo.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  return { denominacion, graficos };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2 · Palabras vacías
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Artículos, preposiciones, conjunciones y pronombres. Lista **cerrada**: son
 * clases gramaticales finitas, así que se puede enumerar sin riesgo de dejar
 * afuera algo que importe.
 *
 * Están en castellano, inglés, italiano, francés y portugués porque el Boletín
 * publica marcas en todos esos idiomas.
 *
 * ⚠️ `UN`, `UNA`, `UNO` están acá **a pedido expreso** del matriculado. El
 * numeral y el artículo indefinido se escriben igual en castellano, y mientras
 * `UN` funcionó como palabra plena, cualquier marca que empezara con «UN»
 * coincidía ideológicamente con cualquier marca que contuviera «ONE».
 *
 * Eso **no** anula la confundibilidad entre `UN`, `UNA` y `UNO` como marcas:
 * cuando la palabra vacía es lo único que hay, es el mot vedette (ver
 * `extraerVedette`). El criterio del matriculado fue explícito: *«eliminá UN,
 * siempre y cuando, si llegase a existir por ejemplo una marca con UN y otra
 * con UNA o UNO, se pueda detectar confundibilidad»*.
 */
export const PALABRAS_VACIAS = new Set([
  // castellano
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'uno',
  'de', 'del', 'al', 'a', 'ante', 'bajo', 'con', 'contra', 'desde', 'durante',
  'en', 'entre', 'hacia', 'hasta', 'para', 'por', 'segun', 'sin', 'sobre',
  'tras', 'y', 'e', 'o', 'u', 'ni', 'que', 'su', 'sus', 'mi', 'mis', 'tu',
  'tus', 'lo', 'le', 'les', 'se', 'me', 'te', 'nos',
  // inglés
  'the', 'an', 'of', 'and', 'or', 'for', 'to', 'in', 'on', 'at', 'by',
  'with', 'from', 'into', 'over', 'under', 'my', 'your', 'its',
  // italiano
  'il', 'lo', 'gli', 'i', 'della', 'delle', 'dei', 'degli', 'dal', 'nel',
  'con', 'per', 'tra', 'fra', 'un', 'uno', 'una',
  // francés
  'le', 'les', 'des', 'du', 'et', 'ou', 'dans', 'sur', 'sous', 'pour',
  'avec', 'sans', 'chez', 'aux',
  // portugués
  'os', 'as', 'da', 'das', 'dos', 'no', 'na', 'nos', 'nas', 'pelo', 'pela',
]);

// ─────────────────────────────────────────────────────────────────────────────
// 3 · Palabras de uso común en la clase
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decide si una palabra es de uso común en una clase.
 *
 * Se inyecta desde afuera porque el dato verdadero está en el registro del
 * INPI, no en este proceso. Ver `SEMILLA_USO_COMUN` y la nota de abajo.
 */
export type EsUsoComun = (palabra: string, clase: number) => boolean;

/**
 * Lista sembrada a mano, mínima y provisoria. **No es el índice definitivo.**
 *
 * ⚠️ POR QUÉ NO SE PUEDE CALCULAR TODAVÍA
 *
 * El umbral del criterio es «más de 10 registros con la misma palabra en la
 * clase». Eso requiere el padrón del INPI. Los dos corpus disponibles hoy no
 * sirven, y conviene dejar escrito por qué:
 *
 * • **Un boletín semanal es muy chico.** En el 11121 (332 denominaciones
 *   legibles), la única palabra que pasa de 10 en cualquier clase es la
 *   preposición «DE». KIDS, el ejemplo del matriculado, no aparece ni una vez
 *   en clase 25.
 *
 * • **La cartera propia distorsiona.** Contando las 837 filas del estudio,
 *   `NAHANA` aparece 11 veces en clase 25 y cruzaría el umbral — pero son las
 *   11 marcas de un mismo cliente, es decir exactamente lo contrario de una
 *   palabra de uso común.
 *
 * De ahí una corrección al criterio, **confirmada por el matriculado el
 * 25/09/2026**: el conteo es **por titulares distintos**, no por registros.
 * Diez registros de un titular son una familia de marcas; diez titulares
 * distintos usando la misma palabra son uso común.
 *
 * El camino real es consultar el buscador del INPI por palabra y clase y
 * cachear el resultado con su fecha. Hasta entonces rige esta semilla, y las
 * palabras que falten se comportan como palabras plenas — que es el lado
 * conservador del error: produce falsos positivos, que el matriculado
 * descarta, en vez de silencios, que no ve.
 */
export const SEMILLA_USO_COMUN: Record<number, string[]> = {
  3: ['natural', 'organic', 'organico', 'bio', 'beauty', 'cosmetica'],
  5: ['pharma', 'farma', 'vital', 'salud', 'health', 'bio'],
  25: ['kids', 'jeans', 'denim', 'wear', 'sport', 'sports', 'style', 'moda',
       'atelier', 'basics', 'collection', 'coleccion'],
  29: ['natural', 'campo', 'granja', 'farm'],
  30: ['natural', 'artesanal', 'gourmet'],
  35: ['shop', 'store', 'market', 'mercado', 'online', 'express', 'group',
       'grupo', 'camara', 'eventos', 'exposicion', 'distribuidora'],
  41: ['academia', 'academy', 'escuela', 'school', 'club', 'eventos',
       'training', 'capacitacion'],
  43: ['resto', 'restaurant', 'restaurante', 'bar', 'cafe', 'grill', 'cocina'],
  44: ['salud', 'health', 'clinica', 'clinic', 'centro', 'medico', 'estetica'],
};

/** Predicado por defecto: sólo consulta la semilla. */
export const usoComunSembrado: EsUsoComun = (palabra, clase) =>
  (SEMILLA_USO_COMUN[clase] || []).includes(palabra);

// ─────────────────────────────────────────────────────────────────────────────
// 4 · Extracción
// ─────────────────────────────────────────────────────────────────────────────

export interface Vedette {
  /** Los términos sobre los que se coteja, separados por espacio. */
  vedette: string;
  /** La denominación sin los gráficos, normalizada. */
  denominacion: string;
  /** Descripciones de dibujo que venían entre paréntesis. */
  graficos: string[];
  /** Qué se descartó y por qué — para poder explicar el resultado. */
  descartadas: { palabra: string; motivo: 'vacia' | 'uso-comun' }[];
  /**
   * `true` cuando NO quedó ninguna palabra plena y se cayó a la denominación
   * entera. Es el caso de una marca que es sólo una palabra vacía (`UN`) o
   * sólo palabras de uso común (`KIDS WEAR`): ahí el conjunto ES el vedette.
   */
  todoDescartado: boolean;
}

/** Normaliza igual que `helpers.normalizarMarca`, sin importarlo para no acoplar. */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Devuelve el mot vedette de un campo de denominación.
 *
 * @param campo  tal como viene del Boletín o de Damlong, con paréntesis y todo
 * @param clase  clase de Niza — decide qué palabras son de uso común
 */
export function extraerVedette(
  campo: string,
  clase: number,
  esUsoComun: EsUsoComun = usoComunSembrado
): Vedette {
  const { denominacion: cruda, graficos } = separarGraficos(campo);
  const denominacion = normalizar(cruda);

  const palabras = denominacion ? denominacion.split(' ') : [];
  const plenas: string[] = [];
  const descartadas: Vedette['descartadas'] = [];

  for (const p of palabras) {
    if (PALABRAS_VACIAS.has(p)) {
      descartadas.push({ palabra: p, motivo: 'vacia' });
    } else if (esUsoComun(p, clase)) {
      descartadas.push({ palabra: p, motivo: 'uso-comun' });
    } else {
      plenas.push(p);
    }
  }

  // Si no sobrevivió nada, el conjunto entero es el vedette. Una marca que es
  // sólo `UN` tiene que poder cotejarse contra `UNA` y contra `UNO`.
  const todoDescartado = plenas.length === 0 && denominacion.length > 0;

  return {
    vedette: todoDescartado ? denominacion : plenas.join(' '),
    denominacion,
    graficos,
    descartadas,
    todoDescartado,
  };
}

/** Texto corto para explicar en el informe por qué se coteja lo que se coteja. */
export function explicarVedette(v: Vedette): string {
  if (!v.vedette) return 'Sin denominación cotejable (marca figurativa).';

  const partes: string[] = [];
  if (v.graficos.length) {
    partes.push(`gráfico ${v.graficos.map((g) => `«${g}»`).join(', ')} (no se coteja como texto)`);
  }
  const vacias = v.descartadas.filter((d) => d.motivo === 'vacia').map((d) => d.palabra);
  const comunes = v.descartadas.filter((d) => d.motivo === 'uso-comun').map((d) => d.palabra);
  if (vacias.length) partes.push(`palabras vacías: ${vacias.join(', ')}`);
  if (comunes.length) partes.push(`de uso común en la clase: ${comunes.join(', ')}`);

  if (v.todoDescartado) {
    return `Cotejo sobre el conjunto «${v.vedette}»: no quedó ningún término pleno` +
      (partes.length ? ` — ${partes.join('; ')}` : '') + '.';
  }
  return `Cotejo sobre «${v.vedette}»` + (partes.length ? ` — se apartó: ${partes.join('; ')}` : '') + '.';
}
