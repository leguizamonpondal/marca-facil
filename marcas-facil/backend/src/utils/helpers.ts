import { createHash } from 'crypto';

/**
 * Genera un código de referido único a partir del CUIT
 */
export function generateReferralCode(cuit: string): string {
  const hash = createHash('md5').update(cuit + Date.now()).digest('hex');
  return hash.substring(0, 8).toUpperCase();
}

/**
 * Calcula días hábiles desde una fecha
 * (excluye sábados y domingos; no maneja feriados argentinos por simplicidad)
 */
export function addBusinessDays(startDate: Date, days: number): Date {
  const result = new Date(startDate);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) added++; // 0=domingo, 6=sábado
  }
  return result;
}

/**
 * Calcula días corridos desde una fecha
 */
export function addCalendarDays(startDate: Date, days: number): Date {
  const result = new Date(startDate);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Formatea CUIT con guiones: 20-12345678-9
 */
export function formatCuit(cuit: string): string {
  const digits = cuit.replace(/\D/g, '');
  if (digits.length !== 11) return cuit;
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits[10]}`;
}

/**
 * Normaliza texto para comparación fonética básica
 */
export function normalizarMarca(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // quitar acentos
    .replace(/[^a-z0-9\s]/g, '')       // quitar caracteres especiales
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calcula la similitud entre dos marcas (0-1)
 * Combina similitud de cadena con análisis fonético básico
 */
export function calcularSimilitudMarcas(marca1: string, marca2: string): number {
  const n1 = normalizarMarca(marca1);
  const n2 = normalizarMarca(marca2);

  if (n1 === n2) return 1.0;

  // Similitud de Levenshtein aproximada
  const levenSim = 1 - (levenshteinDistance(n1, n2) / Math.max(n1.length, n2.length));

  // Análisis fonético: reemplazos comunes en español
  const fonetico1 = aplicarFoneticoEspanol(n1);
  const fonetico2 = aplicarFoneticoEspanol(n2);
  const foneticoSim = 1 - (levenshteinDistance(fonetico1, fonetico2) / Math.max(fonetico1.length, fonetico2.length));

  // Similitud de n-gramas (trigramas)
  const ngramSim = ngramSimilarity(n1, n2, 3);

  // Promedio ponderado
  return (levenSim * 0.35 + foneticoSim * 0.40 + ngramSim * 0.25);
}

/**
 * Threshold de confundibilidad según jurisprudencia INPI
 * El INPI usa criterio amplio: basta riesgo POSIBLE de confusión
 */
export function esConfundible(
  marca1: string,
  marca2: string,
  clase1: number,
  clase2: number
): { confundible: boolean; similitud: number; razon: string } {
  const similitud = calcularSimilitudMarcas(marca1, marca2);
  const mismaClase = clase1 === clase2;

  // Umbrales ajustados a criterio jurisprudencial argentino
  let umbral = 0.70; // En misma clase, umbral más bajo
  if (!mismaClase) {
    umbral = 0.85; // Clases relacionadas requieren mayor similitud
  }

  const confundible = similitud >= umbral;
  let razon = '';
  if (confundible) {
    if (similitud >= 0.90) razon = 'Marcas prácticamente idénticas';
    else if (similitud >= 0.80) razon = 'Alta similitud gráfica y fonética';
    else razon = 'Similitud confusionista con riesgo de confusión en el público';
  }

  return { confundible, similitud: Math.round(similitud * 100), razon };
}

// ── Helpers internos ──────────────────────────────────────────────────────────

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] = b[i - 1] === a[j - 1]
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }
  return matrix[b.length][a.length];
}

function aplicarFoneticoEspanol(texto: string): string {
  return texto
    .replace(/qu/g, 'k')
    .replace(/ch/g, 'x')
    .replace(/ll/g, 'y')
    .replace(/[cz]/g, 's')     // c/z → s ante e,i (simplificado)
    .replace(/v/g, 'b')         // b/v suenan igual
    .replace(/h/g, '')          // h muda
    .replace(/gu([ei])/g, 'g')  // gue/gui → ge/gi
    .replace(/gi/g, 'ji')       // gi = ji sonido
    .replace(/ge/g, 'je')       // ge = je sonido
    .replace(/ph/g, 'f')        // ph → f
    .replace(/ñ/g, 'ni');       // ñ → ni aproximado
}

function ngramSimilarity(a: string, b: string, n: number): number {
  const getNgrams = (s: string, size: number): Set<string> => {
    const ngrams = new Set<string>();
    for (let i = 0; i <= s.length - size; i++) ngrams.add(s.slice(i, i + size));
    return ngrams;
  };
  const ng1 = getNgrams(a, n);
  const ng2 = getNgrams(b, n);
  if (ng1.size === 0 && ng2.size === 0) return 1;
  if (ng1.size === 0 || ng2.size === 0) return 0;
  let intersection = 0;
  ng1.forEach(g => { if (ng2.has(g)) intersection++; });
  return (2 * intersection) / (ng1.size + ng2.size); // Dice coefficient
}
