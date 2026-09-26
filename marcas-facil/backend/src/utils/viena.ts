/**
 * CLASIFICACIÓN DE VIENA — códigos y coincidencia figurativa
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * El INPI **no usa Viena de oficio**: no aparece en el Boletín (el código INID
 * (531) no figura en ninguna de las 772 actas del 11121), no lo devuelve el Web
 * Service, y no hay búsqueda figurativa arancelada. Decisión del matriculado
 * (25/09/2026): **la aplicamos nosotros**, tanto al leer el Boletín como cuando
 * el usuario carga una marca mixta o figurativa. Así el criterio es uno solo y
 * no depende de que un tercero codifique bien.
 *
 * Este módulo es **sólo la parte determinística**: parsear códigos y comparar
 * dos marcas. No clasifica imágenes — eso lo hace `vienaClasificador.ts`, que
 * necesita un modelo de visión. La separación es deliberada: esta lógica tiene
 * que poder probarse sin llamar a ningún servicio externo.
 *
 * ── Estructura (VCL10, vigente desde el 1/1/2026) ──────────────────────────
 *
 * Jerarquía de lo general a lo particular: **categoría → división → sección**.
 *
 *   29 categorías · 145 divisiones · 841 secciones principales
 *   930 secciones auxiliares
 *
 * Un código se escribe `categoría.división.sección`. Las secciones auxiliares
 * van precedidas por la letra `A` y agrupan elementos ya cubiertos por una
 * sección principal según otro criterio, para facilitar la búsqueda.
 *
 * Ejemplo oficial — «una nena comiendo» se codifica `2.5.3, 18`:
 *
 *   2   categoría   Seres humanos
 *   5   división    Niños
 *   3   sección     Niñas
 *   18  auxiliar    Niños bebiendo o comiendo
 *
 * ⚠️ **La edición se versiona junto con el código asignado.** Las ediciones
 *    mueven secciones: un `3.1.8` de la 9.ª no significa necesariamente lo
 *    mismo que uno de la 10.ª. Criterio del matriculado: usar siempre la última
 *    edición vigente, de Viena y de Niza.
 */

import {
  CATEGORIAS,
  DIVISIONES,
  SECCIONES,
  AUXILIARES,
  CON_AUXILIARES,
  EDICION,
  VIGENTE_DESDE,
} from './vienaTabla';

export const EDICION_VIENA = EDICION;
export { CATEGORIAS, DIVISIONES, SECCIONES, AUXILIARES, CON_AUXILIARES, VIGENTE_DESDE };

/**
 * Las 29 categorías, en castellano, para mostrar en pantalla.
 *
 * La tabla oficial (`vienaTabla.ts`) está en inglés porque es el texto que
 * publica la OMPI y no se toca: es la fuente. Esto es sólo la rotulación.
 */
export const CATEGORIAS_VIENA: Record<number, string> = {
  1: 'Cuerpos celestes, fenómenos naturales, mapas geográficos',
  2: 'Seres humanos',
  3: 'Animales',
  4: 'Seres sobrenaturales, fabulosos, fantásticos o no identificables',
  5: 'Plantas',
  6: 'Paisajes',
  7: 'Construcciones, estructuras para anuncios, puertas o barreras',
  8: 'Productos alimenticios',
  9: 'Textiles, vestimenta, accesorios de costura, tocados, calzado',
  10: 'Tabaco, artículos para fumadores, fósforos, artículos de viaje, abanicos, artículos de tocador',
  11: 'Utensilios domésticos',
  12: 'Mobiliario, instalaciones sanitarias',
  13: 'Iluminación, válvulas, calefacción, cocción o refrigeración, lavarropas, secado',
  14: 'Ferretería, herramientas, escaleras',
  15: 'Maquinaria, motores',
  16: 'Telecomunicaciones, grabación o reproducción de sonido, computadoras, fotografía, cinematografía, óptica',
  17: 'Relojería, joyería, pesas y medidas',
  18: 'Transporte, equipamiento para animales',
  19: 'Recipientes y embalajes, representaciones de productos varios',
  20: 'Materiales de escritura, dibujo o pintura, artículos de oficina, papelería y librería',
  21: 'Juegos, juguetes, artículos deportivos, calesitas',
  22: 'Instrumentos musicales y sus accesorios, campanas, cuadros, esculturas',
  23: 'Armas, municiones, armaduras',
  24: 'Heráldica, monedas, emblemas, símbolos',
  25: 'Motivos ornamentales, superficies o fondos con ornamentos',
  26: 'Figuras y sólidos geométricos',
  27: 'Formas de escritura, números',
  28: 'Inscripciones en diversos caracteres',
  29: 'Colores',
};

// ─────────────────────────────────────────────────────────────────────────────
// Códigos
// ─────────────────────────────────────────────────────────────────────────────

export interface CodigoViena {
  categoria: number;
  division: number;
  seccion: number;
  /** `true` si es una sección auxiliar (las que la OMPI prefija con `A`). */
  auxiliar: boolean;
  /** Tal como vino escrito, para poder mostrarlo igual que se cargó. */
  crudo: string;
}

/**
 * Parsea `3.1.8`, `A3.1.8`, `2.5.3` o `26.1.3`.
 *
 * Devuelve `null` si no es un código válido, en vez de adivinar. Un código mal
 * parseado no produce un error: produce una coincidencia contra la categoría
 * equivocada, que es peor.
 */
export function parsearCodigoViena(texto: string): CodigoViena | null {
  const limpio = texto.trim().toUpperCase();
  const m = limpio.match(/^(A?)(\d{1,2})\.(\d{1,2})\.(\d{1,2})$/);
  if (!m) return null;

  const categoria = Number(m[2]);
  const division = Number(m[3]);
  const seccion = Number(m[4]);
  const auxiliar = m[1] === 'A';

  // No alcanza con que tenga forma de código: **tiene que existir en VCL10**.
  // Un código inventado no da error, da una coincidencia contra una sección
  // que no es — y eso es peor que no tener el dato.
  const clave = `${categoria}.${division}.${seccion}`;
  if (!(auxiliar ? AUXILIARES : SECCIONES)[clave]) return null;

  return { categoria, division, seccion, auxiliar, crudo: texto.trim() };
}

/** Parsea una lista y **reporta** lo que no pudo leer, en vez de descartarlo callado. */
export function parsearCodigos(textos: string[]): {
  codigos: CodigoViena[];
  invalidos: string[];
} {
  const codigos: CodigoViena[] = [];
  const invalidos: string[] = [];
  for (const t of textos) {
    const c = parsearCodigoViena(t);
    if (c) codigos.push(c);
    else if (t.trim()) invalidos.push(t.trim());
  }
  return { codigos, invalidos };
}

export function describirCodigo(c: CodigoViena): string {
  const cat = CATEGORIAS_VIENA[c.categoria] || '(categoría desconocida)';
  return `${c.crudo} — ${cat}${c.auxiliar ? ' (sección auxiliar)' : ''}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Coincidencia
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Nivel de coincidencia entre dos elementos figurativos. Mismo diseño graduado
 * que `UMBRAL_POR_AFINIDAD` para las clases de Niza: no es sí o no, es cuánto.
 */
export type GradoViena = 'seccion' | 'division' | 'categoria';

export const PESO_VIENA: Record<GradoViena, number> = {
  seccion: 1.0,    // el mismo elemento figurativo — un león y un león
  division: 0.6,   // el mismo grupo — un león y un tigre (3.1, felinos)
  categoria: 0.25, // familia lejana — un león y un pájaro (3, animales)
};

export interface CoincidenciaViena {
  grado: GradoViena;
  /** El código de la marca vigilada y el de la publicada que coinciden. */
  codigoMarca: CodigoViena;
  codigoActa: CodigoViena;
  peso: number;
  explicacion: string;
}

/**
 * Compara los dos conjuntos de códigos de dos marcas.
 *
 * Un logo lleva **varios** códigos: el de DEN DEN CITY tiene figura humana,
 * flor, abanico y círculo de fondo. Por eso la comparación es de conjunto
 * contra conjunto, y lo que importa no es sólo el mejor par sino **cuántos
 * elementos comparten**: dos logos que coinciden en tres secciones se parecen
 * mucho más que dos que coinciden en una.
 *
 * Las secciones auxiliares **no cuentan por sí solas**. Agrupan elementos ya
 * cubiertos por una sección principal según otro criterio, así que contarlas
 * aparte sería contar dos veces el mismo dibujo.
 */
export function compararViena(
  codigosMarca: CodigoViena[],
  codigosActa: CodigoViena[]
): {
  coincidencias: CoincidenciaViena[];
  /** El mejor nivel alcanzado, o `null` si no comparten ni la categoría. */
  mejorGrado: GradoViena | null;
  /** Suma de pesos: distingue «coinciden en una sección» de «en tres». */
  puntaje: number;
  /** Cuántos elementos coinciden en cada nivel. */
  porGrado: Record<GradoViena, number>;
} {
  const principalesMarca = codigosMarca.filter((c) => !c.auxiliar);
  const principalesActa = codigosActa.filter((c) => !c.auxiliar);

  const coincidencias: CoincidenciaViena[] = [];
  const porGrado: Record<GradoViena, number> = { seccion: 0, division: 0, categoria: 0 };

  // Un código de la marca se cuenta UNA sola vez, en su mejor nivel: si coincide
  // en sección con un código del acta, no se vuelve a sumar por categoría.
  for (const cm of principalesMarca) {
    let mejor: CoincidenciaViena | null = null;

    for (const ca of principalesActa) {
      if (cm.categoria !== ca.categoria) continue;

      let grado: GradoViena = 'categoria';
      if (cm.division === ca.division) {
        grado = cm.seccion === ca.seccion ? 'seccion' : 'division';
      }
      if (mejor && PESO_VIENA[mejor.grado] >= PESO_VIENA[grado]) continue;

      const cat = CATEGORIAS_VIENA[cm.categoria];
      mejor = {
        grado,
        codigoMarca: cm,
        codigoActa: ca,
        peso: PESO_VIENA[grado],
        explicacion:
          grado === 'seccion'
            ? `Mismo elemento figurativo (${cm.crudo}): ${cat}.`
            : grado === 'division'
              ? `Elementos del mismo grupo (${cm.crudo} y ${ca.crudo}): ${cat}.`
              : `Misma categoría figurativa (${cm.categoria}): ${cat}.`,
      };
    }

    if (mejor) {
      coincidencias.push(mejor);
      porGrado[mejor.grado]++;
    }
  }

  const puntaje = coincidencias.reduce((s, c) => s + c.peso, 0);
  const mejorGrado = coincidencias.length
    ? coincidencias.reduce((a, b) => (PESO_VIENA[a.grado] >= PESO_VIENA[b.grado] ? a : b)).grado
    : null;

  coincidencias.sort((a, b) => b.peso - a.peso);
  return { coincidencias, mejorGrado, puntaje, porGrado };
}

// ─────────────────────────────────────────────────────────────────────────────
// Trazabilidad
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lo que hay que guardar junto a cada código, porque la clasificación es
 * **nuestra** y no del INPI.
 *
 * Tres reglas acordadas con el matriculado el 25/09/2026:
 *
 * 1. **Versionar.** Mejorar el clasificador no puede reescribir en silencio lo
 *    que ya se vigiló: una oposición se funda en lo que el sistema vio *ese
 *    día*. Por eso van `clasificador`, `edicion` y `fecha`.
 * 2. **La corrección manual gana siempre** y sobrevive a toda reclasificación
 *    posterior — `origen: 'manual'` no se toca nunca.
 * 3. **Guardar la imagen**, no sólo el código. Sin la imagen no se puede
 *    revisar una clasificación discutida ni reclasificar más adelante.
 */
export interface ClasificacionFigurativa {
  codigos: CodigoViena[];
  /** Descripción en palabras de lo que se ve. Es lo que se revisa y se audita. */
  descripcion: string;
  /** 0–1. Los códigos de baja confianza no disparan alerta por sí solos. */
  confianza: number;
  origen: 'automatico' | 'manual';
  /** Identificador del clasificador que la produjo, p. ej. `viena-v1`. */
  clasificador: string;
  edicion: typeof EDICION_VIENA;
  fecha: Date;
  /** Dónde quedó guardada la imagen que se clasificó. */
  imagenRef: string;
}

/**
 * Funde la clasificación automática con la manual. La manual **siempre** gana:
 * no se mezclan códigos ni se promedian confianzas.
 */
export function clasificacionVigente(
  automatica: ClasificacionFigurativa | null,
  manual: ClasificacionFigurativa | null
): ClasificacionFigurativa | null {
  return manual ?? automatica;
}
