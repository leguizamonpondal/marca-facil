/**
 * CUASI-IDENTIDAD — el filtro de las marcas notorias y renombradas
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Por qué existe aparte de `esConfundible()` ─────────────────────────────
 *
 * La vigilancia normal compara dentro de la clase y de las afines, donde la
 * proximidad comercial corrobora: una similitud del 75 % entre dos marcas de
 * indumentaria amerita mirarse.
 *
 * Las notorias y renombradas se vigilan en **las 45 clases**. Ahí no hay
 * proximidad que corrobore nada, y ese mismo 75 % es ruido puro: con 3.500
 * actas semanales por 45 clases, un umbral laxo sepulta los hallazgos reales
 * bajo cientos de coincidencias casuales.
 *
 * Por eso acá se exige **identidad o cuasi-identidad**, que es otra pregunta:
 * no "¿se parecen?" sino "¿esto es un intento de colgarse de aquella marca?".
 *
 * ── Las siete reglas ───────────────────────────────────────────────────────
 *
 * Aprobadas por el matriculado el 24/09/2026, sobre el ejemplo COCA COLA:
 *
 * | # | Regla | Ejemplo | |
 * |---|-------|---------|--|
 * | 1 | Identidad exacta normalizada | `Coca-Cola`, `COCACOLA` | ✅ |
 * | 2 | Equivalencia fonética española | `KOCA KOLA` | ✅ |
 * | 3 | La notoria contenida entera | `COCA COLA DEL SUR` | ✅ |
 * | 4 | Con agregado genérico | `COCA COLA PREMIUM` | ✅ |
 * | 5 | Una letra de diferencia | `COCA CALA` | ✅ |
 * | 6 | Singular / plural | `LAS COCA COLAS` | ✅ |
 * | 7 | Solo un elemento de una marca de dos palabras | `COLA` a secas | ❌ |
 *
 * La 2 es la que más pesa en la práctica: quien quiere colgarse de una notoria
 * rara vez copia la grafía exacta, y el cotejo fonético es donde se juega el
 * aprovechamiento real.
 *
 * La 3 tiene respaldo normativo directo: el art. 6 bis del Convenio de París
 * alcanza el caso en que **la parte esencial** de la marca reproduce o imita a
 * la notoria.
 *
 * La 4 no necesita lógica propia —si contiene la marca entera, ya la atrapa la
 * regla 3—, pero sí se informa aparte: un agregado genérico es un caso mucho
 * más fuerte que uno distintivo, y esa diferencia le sirve al matriculado para
 * priorizar sin abrir el expediente.
 *
 * ── La regla 5 y el largo ──────────────────────────────────────────────────
 *
 * "Una letra de diferencia" no significa lo mismo en nueve caracteres que en
 * tres. Sobre `COCACOLA` es un filtro estrecho; sobre `OMO` deja pasar `OSO`,
 * `AMO`, `OJO`, `ORO` y media lengua.
 *
 * Criterio del matriculado (opción A): **piso de largo**. Abajo de
 * `LARGO_MINIMO_REGLA_5` caracteres normalizados, la regla 5 no se aplica y
 * quedan solo identidad y fonética.
 *
 * ⚠️ A 5 caracteres exactos la regla está en su punto más flojo: `NIVEA` con
 *    una letra de diferencia incluye `NIVEL`, que es palabra común. Si en la
 *    práctica resulta ruidoso, **subir este número a 6 es todo el cambio.**
 *
 * ── Lo que esto NO decide ──────────────────────────────────────────────────
 *
 * Que una coincidencia salte no significa que corresponda oponerse. Para una
 * **notoria**, el art. 6 bis protege frente a productos iguales o similares;
 * la protección en cualquier clase es la del art. 16.3 del ADPIC, que exige
 * registro y renombre. Vigilamos más ancho de lo que la ley concede, a
 * propósito — mirar de más no cuesta nada, y la decisión de oponerse es del
 * matriculado.
 */

/** Piso de largo para la regla 5. Ver la nota de arriba antes de tocarlo. */
export const LARGO_MINIMO_REGLA_5 = 5;

export type ReglaCuasiIdentidad =
  | 'identica'
  | 'fonetica'
  | 'contiene-generico'
  | 'contiene-distintivo'
  | 'una-letra'
  | 'plural';

export interface Coincidencia {
  hay: boolean;
  regla?: ReglaCuasiIdentidad;
  /** Frase lista para la alerta, en castellano. */
  explicacion?: string;
}

/**
 * Palabras que no aportan distintividad. Sirven para separar
 * `COCA COLA PREMIUM` —agregado genérico, caso fuerte— de
 * `COCA COLA DEL SUR`, donde el agregado sí distingue algo.
 *
 * No pretende ser exhaustiva: es una heurística para priorizar, no para
 * decidir. Un agregado no listado se informa como distintivo, que es el lado
 * prudente — obliga a mirar.
 */
const GENERICAS = new Set([
  'PREMIUM', 'ORIGINAL', 'CLASSIC', 'CLASICO', 'CLASICA', 'LIGHT', 'ZERO', 'CERO',
  'PLUS', 'MAX', 'MAXI', 'MINI', 'DELUXE', 'GOLD', 'ORO', 'SUPER', 'EXTRA', 'ULTRA',
  'NUEVO', 'NUEVA', 'NEW', 'THE', 'LA', 'EL', 'LOS', 'LAS', 'DE', 'DEL', 'Y',
  'SA', 'SRL', 'SAS', 'CIA', 'COMPANY', 'GROUP', 'GRUPO', 'INTERNACIONAL',
  'INTERNATIONAL', 'ARGENTINA', 'ARG', 'NACIONAL', 'ORIGINAL', 'AUTENTICO',
]);

// ── La función ───────────────────────────────────────────────────────────────

/**
 * ¿La denominación publicada es idéntica o cuasi-idéntica a la notoria?
 *
 * @param notoria    la marca vigilada
 * @param publicada  la denominación de la solicitud del Boletín
 */
export function esCuasiIdentica(notoria: string, publicada: string): Coincidencia {
  const a = normalizar(notoria);
  const b = normalizar(publicada);

  if (!a || !b) return { hay: false };

  // ── Regla 1 ──
  if (a === b) {
    return { hay: true, regla: 'identica', explicacion: 'Denominación idéntica.' };
  }

  // ── Regla 6 ── antes que las demás, porque un plural también difiere en una
  // letra y conviene que el motivo informado sea el correcto.
  if (sonMismoNumero(a, b)) {
    return {
      hay: true,
      regla: 'plural',
      explicacion: 'Misma denominación en singular o plural.',
    };
  }

  // ── Regla 2 ──
  if (clavefonetica(a) === clavefonetica(b)) {
    return {
      hay: true,
      regla: 'fonetica',
      explicacion: `Se pronuncia igual: "${publicada}" suena como "${notoria}".`,
    };
  }

  // ── Reglas 3 y 4 ──
  // Solo en ese sentido: la notoria dentro de la publicada. Al revés sería la
  // regla 7, que el matriculado descartó — que la publicada sea un pedazo de
  // la notoria no alcanza.
  if (b.includes(a)) {
    const agregado = palabrasAgregadas(notoria, publicada);
    const todasGenericas = agregado.length > 0 && agregado.every((p) => GENERICAS.has(p));
    return todasGenericas
      ? {
          hay: true,
          regla: 'contiene-generico',
          explicacion: `Reproduce la marca entera y le suma "${agregado.join(' ')}", que no aporta distintividad.`,
        }
      : {
          hay: true,
          regla: 'contiene-distintivo',
          explicacion: `Reproduce la marca entera dentro de una denominación más larga.`,
        };
  }

  // ── Regla 5 ──
  if (a.length >= LARGO_MINIMO_REGLA_5 && b.length >= LARGO_MINIMO_REGLA_5) {
    if (distancia(a, b, 1) <= 1) {
      return {
        hay: true,
        regla: 'una-letra',
        explicacion: `Difiere en una sola letra de "${notoria}".`,
      };
    }
  }

  return { hay: false };
}

// ── Normalización ────────────────────────────────────────────────────────────

/**
 * Mayúsculas, sin acentos, sin puntuación ni espacios.
 *
 * ⚠️ También repara la **ligadura tipográfica "fi"**, que `pdftotext` pierde:
 *    en el boletín "artificiales" sale "artif ciales" y "oficina" como
 *    "of cina". En las denominaciones, que van en mayúsculas, no se observó el
 *    problema, pero la reparación no cuesta nada y evita que una marca con
 *    "fi" nunca coincida.
 */
export function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/F\s+(?=[AEIOU])/g, 'FI')   // "OF CINA" → "OFICINA"
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Clave fonética para el castellano rioplatense.
 *
 * Dos denominaciones con la misma clave se pronuncian igual. Son las
 * equivalencias del cotejo fonético: B/V, C/K/Q, S/Z/C suave, G/J, LL/Y, H
 * muda, I/Y, X→KS, y las dobles que no suenan doble.
 *
 * El orden importa: las reglas de dos letras van antes que las de una.
 */
export function clavefonetica(normalizada: string): string {
  return normalizada
    .replace(/PH/g, 'F')
    .replace(/QU([EI])/g, 'K$1')
    .replace(/C([EI])/g, 'S$1')   // CE/CI suenan S
    .replace(/G([EI])/g, 'J$1')   // GE/GI suenan J
    .replace(/GU([EI])/g, 'G$1')  // GUE/GUI: la U no suena
    .replace(/LL/g, 'Y')
    .replace(/CH/g, '1')          // dígrafo propio; el 1 es un marcador interno
    .replace(/X/g, 'KS')
    .replace(/H/g, '')            // muda
    .replace(/[CQK]/g, 'K')
    .replace(/[BV]/g, 'B')
    .replace(/[ZS]/g, 'S')
    .replace(/W/g, 'B')
    .replace(/Y/g, 'I')           // tras LL→Y, unifica I/Y
    .replace(/(.)\1+/g, '$1');    // dobles: RR→R, NN→N, SS→S…
}

/** `LAS COCA COLAS` frente a `COCA COLA`: misma marca, distinto número. */
function sonMismoNumero(a: string, b: string): boolean {
  const sinPlural = (s: string) => s.replace(/(ES|S)$/, '');
  return sinPlural(a) === sinPlural(b) || a === sinPlural(b) || sinPlural(a) === b;
}

/**
 * Las palabras que la publicada agrega respecto de la notoria.
 *
 * La comparación es **en singular**: en `LAS COCA COLAS` la palabra `COLAS` no
 * es un agregado, es `COLA` en plural. Sin esto, el único agregado real —el
 * artículo `LAS`, que es genérico— quedaba acompañado de un falso agregado
 * distintivo, y el caso se informaba como más débil de lo que es.
 */
function palabrasAgregadas(notoria: string, publicada: string): string[] {
  const deLaNotoria = new Set<string>();
  for (const p of notoria.split(/\s+/).map(normalizar).filter(Boolean)) {
    deLaNotoria.add(p);
    deLaNotoria.add(singular(p));
  }
  return publicada
    .split(/\s+/)
    .map((p) => normalizar(p))
    .filter((p) => p.length > 0 && !deLaNotoria.has(p) && !deLaNotoria.has(singular(p)));
}

function singular(p: string): string {
  return p.replace(/(ES|S)$/, '');
}

/**
 * Distancia de edición, cortada apenas supera `tope`.
 *
 * El corte importa: esto corre contra ~3.500 actas por semana por cada marca
 * vigilada, y calcular la distancia completa entre dos cadenas que ya se sabe
 * que difieren mucho es trabajo tirado.
 */
export function distancia(a: string, b: string, tope: number): number {
  if (Math.abs(a.length - b.length) > tope) return tope + 1;
  if (a === b) return 0;

  let previa = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const actual = [i];
    let mejorDeLaFila = i;

    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(actual[j - 1] + 1, previa[j] + 1, previa[j - 1] + costo);
      actual.push(v);
      if (v < mejorDeLaFila) mejorDeLaFila = v;
    }

    if (mejorDeLaFila > tope) return tope + 1; // ninguna fila posterior puede bajar
    previa = actual;
  }

  return previa[b.length];
}
