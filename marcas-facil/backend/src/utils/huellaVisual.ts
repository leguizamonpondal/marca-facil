/**
 * HUELLA VISUAL — detectar la copia servil de un logo, sin modelo de visión
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Calcula una huella de cada imagen que sobrevive a los cambios con los que se
 * suele disimular una copia: otro tamaño, otra compresión, otros colores, un
 * recuadro alrededor. Dos huellas parecidas significan dos imágenes parecidas.
 *
 * ── Qué resuelve y qué NO ──────────────────────────────────────────────────
 *
 * **Sí:** el que te tomó el logo y lo redibujó apenas, lo recoloreó, lo estiró
 * o lo volvió a comprimir. Es el peor caso y el de oposición más clara.
 *
 * **No:** dos dibujos distintos del mismo concepto — un león de frente y un
 * león de perfil. Eso es confundibilidad ideológica y la resuelve la
 * Clasificación de Viena ([[viena.ts]]), no una huella.
 *
 * Los dos se complementan y ninguno reemplaza al otro.
 *
 * ── Por qué vale la pena aunque sea parcial ────────────────────────────────
 *
 * Corre en el servidor, en milisegundos, **sin llamar a ningún proveedor y sin
 * costo por imagen**. Sobre las 401 imágenes de un boletín son unos pocos
 * segundos. Mientras la clasificación de Viena por visión no esté, esto es lo
 * único que mira los logos; y cuando esté, sigue siendo la señal más barata y
 * más dura que tenemos.
 *
 * ── Cómo funciona: dHash ───────────────────────────────────────────────────
 *
 * Se lleva la imagen a 9×8 en grises y se compara cada píxel con el de su
 * derecha: más claro → 1, más oscuro → 0. Quedan 64 bits.
 *
 * Se eligió dHash y no un hash criptográfico porque acá **queremos** que un
 * cambio chico produzca una huella parecida — al revés de lo que busca un
 * MD5. Y no se eligió pHash (con DCT) porque para logos, que son formas
 * planas con bordes marcados, dHash anda igual de bien y no arrastra una
 * dependencia más.
 *
 * Lo que mide es el **gradiente**, o sea dónde están los bordes. Por eso
 * cambiar los colores conservando el dibujo casi no mueve la huella, y ése es
 * justamente el disimulo más común.
 */

import sharp from 'sharp';

/** Ancho y alto del muestreo. 9×8 da 8×8 = 64 comparaciones horizontales. */
const ANCHO = 9;
const ALTO = 8;

export interface HuellaVisual {
  /** 64 bits en hexadecimal — 16 caracteres. */
  hash: string;
  /**
   * La huella de la MISMA imagen con los colores invertidos.
   *
   * Invertir es el disimulo que dHash no ve: la distancia salta cerca de 64 en
   * vez de acercarse a 0. Complementar los bits del hash tampoco sirve —
   * medido sobre un logo real dio 45 y no 64, porque la compresión y los
   * bordes ensucian— y aflojar el umbral para atraparlo metería un 8 % de los
   * pares como falsos positivos, porque la distribución es simétrica.
   *
   * La solución es no estimar: se calcula la huella del negativo de verdad.
   * Comparar `hash` contra `hashNegativo` del otro es entonces una comparación
   * normal entre dos imágenes reales, con el mismo umbral y el mismo ruido.
   */
  hashNegativo: string;
  /** Proporción ancho/alto del original, redondeada. Ver `distancia`. */
  proporcion: number;
}

/**
 * Calcula la huella de una imagen.
 *
 * `flatten` sobre blanco antes de pasar a grises: un PNG con transparencia da
 * negro en los píxeles vacíos si no se aplana, y entonces el mismo logo sobre
 * fondo transparente y sobre fondo blanco producen huellas distintas. Es un
 * caso corriente —el Boletín trae JPG, pero el cliente sube PNG— y produciría
 * silencio justo en el caso que más importa.
 */
export async function calcularHuella(imagen: Buffer): Promise<HuellaVisual> {
  const meta = await sharp(imagen).metadata();
  const proporcion = Math.round(((meta.width || 1) / (meta.height || 1)) * 100) / 100;

  const muestrear = async (negativo: boolean) => {
    let t = sharp(imagen).flatten({ background: '#ffffff' });
    if (negativo) t = t.negate();
    const datos = await t.greyscale().resize(ANCHO, ALTO, { fit: 'fill' }).raw().toBuffer();

    let bits = '';
    for (let f = 0; f < ALTO; f++) {
      for (let c = 0; c < ANCHO - 1; c++) {
        bits += datos[f * ANCHO + c] > datos[f * ANCHO + c + 1] ? '1' : '0';
      }
    }
    let hash = '';
    for (let i = 0; i < 64; i += 4) hash += parseInt(bits.slice(i, i + 4), 2).toString(16);
    return hash;
  };

  const [hash, hashNegativo] = await Promise.all([muestrear(false), muestrear(true)]);
  return { hash, hashNegativo, proporcion };
}

/**
 * Distancia de Hamming entre dos huellas: cuántos de los 64 bits difieren.
 *
 *    0        idénticas
 *    1 – 6    casi con certeza la misma imagen, retocada
 *    7 – 12   muy parecidas — hay que mirarlas
 *   13 – 20   parecido genérico, normalmente no significa nada
 *    > 20     sin relación
 */
export function distancia(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

export type GradoCopia = 'identica' | 'retocada' | 'muy-parecida' | 'invertida';

export interface CoincidenciaVisual {
  grado: GradoCopia;
  distancia: number;
  explicacion: string;
}

/**
 * Umbral por encima del cual no se informa nada.
 *
 * Medido sobre los 401 logos del boletín 11125, 80.200 pares:
 *
 *   distancia  % de los pares
 *      0–6         0,26 %
 *      0–10        0,38 %   <- acá está el codo
 *      0–12        0,58 %
 *      0–16        1,97 %
 *      0–20        7,99 %
 *
 * La curva es plana hasta 10 y se dispara después. Por debajo de 10 las
 * coincidencias son estructurales; de 12 para arriba se entra en el fondo
 * estadístico, donde dos dibujos cualesquiera empiezan a parecerse por azar.
 *
 * ⚠️ Ese 0,38 % NO se puede proyectar al volumen de la vigilancia. Dentro de
 *    un mismo boletín la mayoría de las coincidencias exactas son un mismo
 *    solicitante presentando el mismo logo en varias clases —se ven como
 *    imágenes consecutivas— y eso no ocurre entre la cartera y un tercero. El
 *    volumen real hay que medirlo con los logos de la cartera cargados.
 */
export const UMBRAL_VISUAL = 10;

/**
 * Compara dos huellas y devuelve el grado, o `null` si no hay parecido.
 *
 * La proporción se informa pero **no descarta**: un logo estirado sigue siendo
 * el mismo logo, y descartar por proporción produciría silencio. Se usa sólo
 * para matizar la explicación.
 */
export function compararHuellas(
  a: HuellaVisual,
  b: HuellaVisual
): CoincidenciaVisual | null {
  const d = distancia(a.hash, b.hash);

  // El negativo: se compara contra la huella del negativo de verdad, no
  // contra el complemento estimado de los bits. Ver `HuellaVisual`.
  const dInv = Math.min(distancia(a.hash, b.hashNegativo), distancia(a.hashNegativo, b.hash));
  if (dInv <= UMBRAL_VISUAL && dInv < d) {
    return {
      grado: 'invertida',
      distancia: dInv,
      explicacion:
        `Es la misma imagen con los colores invertidos (${dInv} de 64 bits ` +
        'respecto de su negativo). La estructura del dibujo se conserva entera.',
    };
  }

  if (d > UMBRAL_VISUAL) return null;

  const estirada =
    Math.abs(a.proporcion - b.proporcion) > 0.25
      ? ' La proporción difiere: el dibujo fue estirado o recortado.'
      : '';

  if (d === 0) {
    return { grado: 'identica', distancia: d,
      explicacion: `Huella visual idéntica: es la misma imagen.${estirada}` };
  }
  if (d <= 6) {
    return { grado: 'retocada', distancia: d,
      explicacion: `Huella visual casi idéntica (${d} de 64 bits). Es la misma imagen con retoques — color, compresión o tamaño.${estirada}` };
  }
  return { grado: 'muy-parecida', distancia: d,
    explicacion: `Huellas visuales muy próximas (${d} de 64 bits). Los dibujos comparten la estructura.${estirada}` };
}

/**
 * Cruza una huella contra un conjunto y devuelve lo que se le parece, de más
 * a menos.
 *
 * Es una comparación lineal: con 400 actas por boletín y unos miles de marcas
 * en cartera son algunos millones de operaciones de 64 bits, que en la
 * práctica son milisegundos. Si alguna vez deja de alcanzar, el paso siguiente
 * es indexar por prefijo del hash, no cambiar de técnica.
 */
export function buscarParecidos<T extends { huella: HuellaVisual }>(
  huella: HuellaVisual,
  candidatos: T[]
): (T & { coincidencia: CoincidenciaVisual })[] {
  const r: (T & { coincidencia: CoincidenciaVisual })[] = [];
  for (const c of candidatos) {
    const m = compararHuellas(huella, c.huella);
    if (m) r.push({ ...c, coincidencia: m });
  }
  return r.sort((x, y) => x.coincidencia.distancia - y.coincidencia.distancia);
}
