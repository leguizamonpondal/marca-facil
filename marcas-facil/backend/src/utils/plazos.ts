/**
 * PLAZOS — el cálculo más delicado de toda la app
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Acá vive el vencimiento del plazo para oponerse. Vive solo, en su propio
 * archivo, por una razón: **es el único número del sistema que, si está mal,
 * le hace perder un derecho al cliente.** Todo lo demás se puede reintentar.
 *
 * ── La regla ───────────────────────────────────────────────────────────────
 *
 * Confirmada por el matriculado el 23/09/2026:
 *
 *   **30 días CORRIDOS desde el día siguiente a la publicación en el Boletín,
 *   hasta las 23:59 del último día. Caiga donde caiga, vence.**
 *
 * Sin traslado al día hábil siguiente. Si el vencimiento cae sábado, domingo o
 * feriado, vence igual ese día.
 *
 * Ejemplo dado por él, que es el caso de prueba de este archivo:
 *
 *   Boletín publicado el **23/09/2026** → vence el **23/10/2026 a las 23:59**.
 *
 * O sea: fecha del boletín **+ 30 días**. Que es lo mismo que contar el día
 * siguiente como día 1 y llegar al día 30 (24/09 = día 1 … 23/10 = día 30).
 *
 * ── El error que esto corrige ──────────────────────────────────────────────
 *
 * El código anterior hacía `addCalendarDays(fecha, 31)`, con un comentario que
 * decía "30 días corridos desde el día siguiente". El comentario era correcto;
 * la cuenta, no. Sumaba un día de más.
 *
 * Y el error iba para el lado malo: le habría dicho al cliente que tenía
 * tiempo hasta el 24/10 cuando venció el 23/10. Un cliente que se organiza
 * para presentar el último día pierde la oposición, avisado por nosotros.
 *
 * Un día de MENOS habría sido inocuo — presenta antes y no pasa nada. Por eso,
 * ante cualquier duda futura sobre este cálculo, **el redondeo va siempre
 * hacia el lado conservador**.
 *
 * ── Por qué hay que ocuparse del huso horario ──────────────────────────────
 *
 * El servidor de Railway corre en UTC. Argentina es UTC−3 todo el año (sin
 * horario de verano desde 2009). Guardar "23:59" sin más significaría 23:59
 * UTC, que en Argentina son las **20:59**: le estaríamos cerrando el plazo al
 * cliente tres horas antes de que venza de verdad.
 *
 * Por eso el vencimiento se construye como el instante UTC que corresponde a
 * las 23:59:59 argentinas.
 */

/** Argentina, UTC−3 todo el año. Sin horario de verano desde 2009. */
const OFFSET_ARGENTINA_HS = 3;

/** Días corridos del plazo de oposición. Art. 13 de la Ley 22.362. */
export const DIAS_PLAZO_OPOSICION = 30;

/**
 * Vencimiento del plazo para oponerse a una solicitud publicada.
 *
 * @param fechaBoletin  la fecha de publicación del boletín
 * @returns el instante exacto en que vence: 23:59:59 de Argentina del día 30
 *
 * @example
 *   vencimientoOposicion(new Date(2026, 8, 23))  // boletín del 23/09/2026
 *   // → 2026-10-24T02:59:59.999Z, que es el 23/10/2026 23:59:59 en Argentina
 */
export function vencimientoOposicion(fechaBoletin: Date): Date {
  // Se leen los componentes con los getters locales, que es como se construyó
  // la fecha al parsear el boletín (`new Date(a, m - 1, d)`). Así el cálculo
  // es coherente con sí mismo sin importar en qué huso corra el servidor.
  const a = fechaBoletin.getFullYear();
  const m = fechaBoletin.getMonth();
  const d = fechaBoletin.getDate();

  // `Date.UTC` normaliza solo: si el día 30 cae en el mes siguiente, o la hora
  // 26 pasa al día siguiente, lo resuelve sin que haya que tocar nada.
  return new Date(
    Date.UTC(a, m, d + DIAS_PLAZO_OPOSICION, 23 + OFFSET_ARGENTINA_HS, 59, 59, 999)
  );
}

/**
 * El vencimiento como fecha para mostrarle a una persona: `23/10/2026`.
 *
 * No se usa `toLocaleDateString('es-AR')` a secas porque el servidor está en
 * UTC y el instante del vencimiento cae de madrugada UTC del día SIGUIENTE —
 * mostrarlo sin convertir diría 24/10 cuando el plazo vence el 23.
 */
export function vencimientoLegible(vencimiento: Date): string {
  const enArgentina = new Date(vencimiento.getTime() - OFFSET_ARGENTINA_HS * 3600_000);
  const dd = String(enArgentina.getUTCDate()).padStart(2, '0');
  const mm = String(enArgentina.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${enArgentina.getUTCFullYear()}`;
}

/**
 * Cuántos días corridos faltan para el vencimiento.
 *
 *   `7`  → vence dentro de una semana
 *   `0`  → **vence hoy**
 *   `-2` → venció hace dos días
 *
 * Sirve para graduar la urgencia del aviso: no es lo mismo avisar a 28 días
 * que a 3.
 *
 * ⚠️ Se cuentan **días de calendario argentinos**, no fracciones de 24 horas.
 *    Restar milisegundos y dividir da resultados absurdos cerca del borde: a
 *    las 9 de la mañana del día del vencimiento faltan 15 horas, y redondear
 *    eso hacia arriba dice "1 día" cuando en realidad vence hoy. Un cliente
 *    que lee "te queda 1 día" el día que vence, se lo pierde.
 */
export function diasHastaVencimiento(vencimiento: Date, desde?: Date): number {
  const diaDelVencimiento = diaCalendarioArgentino(vencimiento);
  const hoy = diaCalendarioArgentino(desde || new Date());
  return Math.round((diaDelVencimiento - hoy) / 86_400_000);
}

/**
 * El día de calendario argentino de un instante, como número, para poder
 * restar dos días sin que la hora del día ensucie la cuenta.
 */
function diaCalendarioArgentino(instante: Date): number {
  const enArgentina = new Date(instante.getTime() - OFFSET_ARGENTINA_HS * 3600_000);
  return Date.UTC(
    enArgentina.getUTCFullYear(),
    enArgentina.getUTCMonth(),
    enArgentina.getUTCDate()
  );
}
