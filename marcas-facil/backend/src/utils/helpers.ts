
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
 * Normaliza texto para comparación: minúsculas, sin acentos, sin especiales
 */
export function normalizarMarca(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // quitar diacríticos (acentos, ñ→n, etc.)
    .replace(/[^a-z0-9\s]/g, '')      // solo letras, números, espacios
    .replace(/\s+/g, ' ')
    .trim();
}
 
// ─────────────────────────────────────────────────────────────────────────────
// EJE 1: SIMILITUD GRÁFICA / ORTOGRÁFICA
// Mide cuánto se parecen visualmente las marcas como texto escrito.
// Herramientas: Levenshtein + n-gramas (trigramas) de Dice.
// ─────────────────────────────────────────────────────────────────────────────
 
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
  return (2 * intersection) / (ng1.size + ng2.size); // coeficiente de Dice
}
 
function similitudGrafica(n1: string, n2: string): number {
  if (n1 === n2) return 1.0;
  const levenSim = 1 - levenshteinDistance(n1, n2) / Math.max(n1.length, n2.length, 1);
  const ngramSim = ngramSimilarity(n1, n2, 3);
  // Peso mayor a Levenshtein para capturas de variantes ortográficas breves
  return levenSim * 0.60 + ngramSim * 0.40;
}
 
// ─────────────────────────────────────────────────────────────────────────────
// EJE 2: SIMILITUD FONÉTICA
// Mide cuánto se parecen las marcas al pronunciarlas en español rioplatense.
// Reglas adaptadas a Argentina (INPI, CNCAF).
// ─────────────────────────────────────────────────────────────────────────────
 
function aplicarFoneticoEspanol(texto: string): string {
  return texto
    // Dígrafo ch → X antes de normalizar
    .replace(/ch/g, 'x')
    // ll → y (yeísmo rioplatense: ll = sh/y)
    .replace(/ll/g, 'y')
    // qu → k (que/qui)
    .replace(/qu/g, 'k')
    // gue / gui → ge / gi (u muda)
    .replace(/gu([ei])/g, 'g$1')
    // ge, gi → je, ji (sonido /x/)
    .replace(/g([ei])/g, 'j$1')
    // j → j (unificar ja/je/ji/jo/ju)
    // c ante e, i → s
    .replace(/c([ei])/g, 's$1')
    // z → s (seseo)
    .replace(/z/g, 's')
    // v → b (betacismo)
    .replace(/v/g, 'b')
    // h muda
    .replace(/h/g, '')
    // ph → f
    .replace(/ph/g, 'f')
    // ck → k
    .replace(/ck/g, 'k')
    // rr → r (simplificación)
    .replace(/rr/g, 'r')
    // ñ → ni (aproximación)
    .replace(/n/g, 'n')
    // x → ks o s según posición (simplificación: x → s)
    .replace(/x/g, 's')
    // Eliminar vocales finales duplicadas
    .replace(/([aeiou])\1+/g, '$1')
    // Eliminar espacios
    .replace(/\s+/g, '');
}
 
function similitudFonetica(n1: string, n2: string): number {
  if (n1 === n2) return 1.0;
  const f1 = aplicarFoneticoEspanol(n1);
  const f2 = aplicarFoneticoEspanol(n2);
  if (f1 === f2) return 1.0;
  const levenSim = 1 - levenshteinDistance(f1, f2) / Math.max(f1.length, f2.length, 1);
  const ngramSim = ngramSimilarity(f1, f2, 2); // bigramas para fonética
  return levenSim * 0.65 + ngramSim * 0.35;
}
 
// ─────────────────────────────────────────────────────────────────────────────
// EJE 3: SIMILITUD IDEOLÓGICA / CONCEPTUAL
// Mide si las marcas evocan el mismo concepto aunque sean palabras distintas.
// Es criterio autónomo de confundibilidad (Art. 3° b) Ley 22.362 — CNCAF).
// Ejemplos: GOLDEN/DORADO, KING/REY, LUNA/MOON, LION/LEON.
// ─────────────────────────────────────────────────────────────────────────────
 
/**
 * Grupos de equivalencia ideológica.
 * Cada grupo contiene palabras o raíces que evocan el mismo concepto.
 * La confundibilidad ideológica se da cuando marca1 y marca2 pertenecen al mismo grupo.
 */
const GRUPOS_IDEOLOGICOS: string[][] = [
  // ── Colores ──
  ['rojo', 'red', 'rouge', 'rosso', 'crimson', 'scarlet', 'carmesi'],
  ['azul', 'blue', 'bleu', 'azzurro', 'cobalt', 'cobalt', 'celeste'],
  ['verde', 'green', 'vert', 'emerald', 'esmeralda'],
  ['amarillo', 'yellow', 'jaune', 'giallo', 'oro', 'gold', 'golden', 'dorado'],
  ['blanco', 'white', 'blanc', 'bianco'],
  ['negro', 'black', 'noir', 'nero', 'ebano'],
  ['plateado', 'silver', 'argent', 'argento', 'plata'],
  ['gris', 'grey', 'gray'],
  ['violeta', 'violet', 'purple', 'morado'],
  ['naranja', 'orange'],
  ['rosa', 'pink', 'rose'],
 
  // ── Animales ──
  ['perro', 'dog', 'hound', 'canino', 'canine', 'cane'],
  ['gato', 'cat', 'feline', 'felino', 'chat'],
  ['leon', 'lion', 'leone', 'leona'],
  ['tigre', 'tiger', 'tigress'],
  ['aguila', 'eagle', 'aigle', 'aquila'],
  ['oso', 'bear', 'ours'],
  ['toro', 'bull', 'bison', 'bisonte'],
  ['caballo', 'horse', 'steed'],
  ['lobo', 'wolf', 'loup'],
  ['zorro', 'fox'],
  ['pajaro', 'bird', 'oiseau', 'ave'],
  ['puma', 'puma', 'cougar', 'panter', 'pantera'],
  ['jaguar', 'jaguar'],
  ['serpiente', 'snake', 'cobra', 'viper', 'vibora'],
  ['delfin', 'dolphin'],
  ['paloma', 'dove', 'pigeon'],
  ['halcon', 'falcon', 'hawk'],
 
  // ── Astros y naturaleza ──
  ['sol', 'sun', 'soleil', 'sole', 'solar'],
  ['luna', 'moon', 'lunar', 'lune'],
  ['estrella', 'star', 'etoile', 'stella'],
  ['mar', 'sea', 'ocean', 'oceano'],
  ['rio', 'river'],
  ['fuego', 'fire', 'flame', 'llama'],
  ['agua', 'water', 'aqua', 'eau'],
  ['tierra', 'earth', 'terra', 'land'],
  ['viento', 'wind'],
  ['nieve', 'snow'],
  ['hielo', 'ice', 'glaciar'],
  ['montana', 'mountain', 'mont'],
  ['bosque', 'forest', 'selva', 'jungle'],
 
  // ── Jerarquía / Realeza ──
  ['rey', 'king', 'rex', 'real', 'royal', 'regio'],
  ['reina', 'queen'],
  ['principe', 'prince', 'crown'],
  ['corona', 'crown', 'couronne'],
  ['imperio', 'empire', 'imperial'],
  ['maestro', 'master', 'maestre'],
  ['jefe', 'chief', 'boss'],
 
  // ── Fuerza / Velocidad ──
  ['rapido', 'fast', 'quick', 'speed', 'express', 'turbo', 'veloz', 'swift'],
  ['fuerte', 'strong', 'forte', 'power', 'poder', 'potente', 'mighty'],
  ['titan', 'titan', 'titanic', 'colossal', 'colosal'],
  ['gigante', 'giant', 'mega', 'ultra'],
  ['agil', 'agile', 'nimble'],
 
  // ── Calidad / Excelencia ──
  ['mejor', 'best', 'top', 'prime', 'primero', 'numero uno'],
  ['optimo', 'optimal', 'optimum'],
  ['elite', 'elite', 'premier', 'select', 'selecto'],
  ['premium', 'premium', 'luxury', 'lujo'],
  ['puro', 'pure', 'pura', 'natural'],
  ['nuevo', 'new', 'nuevo', 'nouveau', 'neo'],
  ['bueno', 'good', 'buen', 'bien'],
 
  // ── Escudo / Protección ──
  ['escudo', 'shield', 'proteccion'],
  ['fortaleza', 'fortress', 'castle', 'castillo'],
  ['fuerza', 'force', 'power'],
 
  // ── Luz / Brillo ──
  ['luz', 'light', 'lux', 'lumiere', 'lumen'],
  ['brillante', 'bright', 'shine', 'brilliant', 'brillo'],
  ['resplandor', 'glow', 'gleam'],
 
  // ── Números con significado marcario ──
  ['uno', 'one', 'first', 'primero', 'prime', 'uno', 'un'],
  ['dos', 'two', 'second', 'duo', 'bi'],
  ['tres', 'three', 'tri', 'triple'],
  ['cien', 'hundred', 'century'],
  ['mil', 'thousand', 'kilo', 'milli'],
 
  // ── Dirección / Movimiento ──
  ['norte', 'north', 'nord'],
  ['sur', 'south'],
  ['este', 'east'],
  ['oeste', 'west'],
 
  // ── Hogar / Familia ──
  ['casa', 'home', 'house', 'maison'],
  ['familia', 'family', 'hogar'],
 
  // ── Misticismo / Espíritu ──
  ['angel', 'angel'],
  ['dragon', 'dragon'],
  ['fenix', 'phoenix', 'fenix'],
  ['milagro', 'miracle', 'milagros'],
  ['espiritu', 'spirit', 'soul', 'alma'],
 
  // ── Alimentos / Sabores ──
  ['miel', 'honey'],
  ['dulce', 'sweet'],
  ['amargo', 'bitter'],
  ['sal', 'salt', 'salty'],
 
  // ── Tecnología ──
  ['digital', 'digital', 'tech', 'tecnologia'],
  ['global', 'global', 'mundial', 'world'],
  ['red', 'network', 'net', 'web'],
];
 
/** Índice word → id de grupo (para lookup O(1)) */
const indiceIdeologico = new Map<string, number>();
for (let i = 0; i < GRUPOS_IDEOLOGICOS.length; i++) {
  for (const palabra of GRUPOS_IDEOLOGICOS[i]) {
    // Normalizar la palabra del grupo antes de indexar
    const norm = normalizarMarca(palabra);
    if (!indiceIdeologico.has(norm)) {
      indiceIdeologico.set(norm, i);
    }
  }
}
 
/**
 * Calcula similitud ideológica entre dos marcas (0-1).
 * Retorna 0.95 si comparten grupo de concepto, 0 si no.
 */
function similitudIdeologica(n1: string, n2: string): number {
  if (n1 === n2) return 1.0;
 
  const palabras1 = n1.split(/\s+/);
  const palabras2 = n2.split(/\s+/);
 
  let maxSim = 0;
 
  for (const p1 of palabras1) {
    const grupo1 = indiceIdeologico.get(p1);
    if (grupo1 === undefined) continue;
 
    for (const p2 of palabras2) {
      const grupo2 = indiceIdeologico.get(p2);
      if (grupo2 === undefined) continue;
 
      if (grupo1 === grupo2) {
        // Mismo grupo conceptual
        maxSim = Math.max(maxSim, p1 === p2 ? 1.0 : 0.92);
      }
    }
  }
 
  return maxSim;
}
 
// ─────────────────────────────────────────────────────────────────────────────
// FUNCIÓN PRINCIPAL: calcularSimilitudMarcas
// Combina los tres ejes. Sigue criterio del INPI y la CNCAF:
//   • La confundibilidad puede provenir de cualquiera de los tres ejes
//   • Basta que uno de los tres supere el umbral para declarar confundibilidad
// ─────────────────────────────────────────────────────────────────────────────
 
export interface ResultadoSimilitud {
  similitudTotal: number;       // 0-100 — puntuación combinada
  similitudGrafica: number;     // 0-100
  similitudFonetica: number;    // 0-100
  similitudIdeologica: number;  // 0-100
  ejesDominantes: string[];     // cuáles ejes superan umbral
}
 
/**
 * Calcula la similitud entre dos denominaciones marcarias.
 * @returns objeto con puntuación por eje y total
 */
export function calcularSimilitudMarcas(
  marca1: string,
  marca2: string,
): ResultadoSimilitud {
  const n1 = normalizarMarca(marca1);
  const n2 = normalizarMarca(marca2);
 
  const sg = similitudGrafica(n1, n2);
  const sf = similitudFonetica(n1, n2);
  const si = similitudIdeologica(n1, n2);
 
  // Puntuación combinada: el mayor de los tres ejes tiene peso dominante
  // (criterio: basta que uno supere para confundir)
  const maxEje = Math.max(sg, sf, si);
 
  // Promedio ponderado dando más peso al eje más fuerte
  const total = maxEje * 0.50 + (sg + sf + si) / 3 * 0.50;
 
  const ejesDominantes: string[] = [];
  if (sg >= 0.70) ejesDominantes.push('gráfico');
  if (sf >= 0.70) ejesDominantes.push('fonético');
  if (si >= 0.85) ejesDominantes.push('ideológico');
 
  return {
    similitudTotal: Math.round(total * 100),
    similitudGrafica: Math.round(sg * 100),
    similitudFonetica: Math.round(sf * 100),
    similitudIdeologica: Math.round(si * 100),
    ejesDominantes,
  };
}
 
// ─────────────────────────────────────────────────────────────────────────────
// FUNCIÓN PRINCIPAL: esConfundible
// Determina si existe riesgo de confusión según criterio jurisprudencial INPI.
// Retorna confundible=true si cualquier eje supera el umbral aplicable.
// ─────────────────────────────────────────────────────────────────────────────
 
export function esConfundible(
  marca1: string,
  marca2: string,
  clase1: number,
  clase2: number,
): { confundible: boolean; similitud: number; razon: string; detalle?: ResultadoSimilitud } {
  const resultado = calcularSimilitudMarcas(marca1, marca2);
  const mismaClase = clase1 === clase2;
 
  // Umbrales por eje (misma clase vs clases relacionadas)
  // Los umbrales en misma clase son más bajos (INPI aplica criterio más estricto)
  const umbralGrafico   = mismaClase ? 0.72 : 0.85;
  const umbralFonetico  = mismaClase ? 0.72 : 0.85;
  const umbralIdeologico = mismaClase ? 0.85 : 0.92; // ideológico siempre requiere más certeza
 
  const { similitudGrafica: sg, similitudFonetica: sf, similitudIdeologica: si } = resultado;
 
  const confGrafico   = sg / 100 >= umbralGrafico;
  const confFonetico  = sf / 100 >= umbralFonetico;
  const confIdeologico = si / 100 >= umbralIdeologico;
 
  const confundible = confGrafico || confFonetico || confIdeologico;
 
  // Construir razón explicativa
  let razon = '';
  if (confundible) {
    const ejes: string[] = [];
    if (confGrafico)   ejes.push(`gráfico (${sg}%)`);
    if (confFonetico)  ejes.push(`fonético (${sf}%)`);
    if (confIdeologico) ejes.push(`ideológico (${si}%)`);
 
    const similGlobal = resultado.similitudTotal;
    if (similGlobal >= 90) {
      razon = `Marcas prácticamente idénticas — ejes: ${ejes.join(', ')}`;
    } else if (similGlobal >= 75) {
      razon = `Alta confundibilidad — ejes: ${ejes.join(', ')}`;
    } else {
      razon = `Confundibilidad por eje ${ejes.join(' y ')} (Art. 3° b) Ley 22.362)`;
    }
  }
 
  return {
    confundible,
    similitud: resultado.similitudTotal,
    razon,
    detalle: resultado,
  };
}
 
