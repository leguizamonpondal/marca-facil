/**
 * Clasificador de productos y servicios según Nomenclador de Niza
 * Proxy hacia la API pública de TMclass (EUIPO)
 * Idioma fijo: español (es)
 */
import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/auth';
import { logger } from '../../utils/logger';
 
const router = Router();
 
// TMclass ofrece su API REST pública sin autenticación
const TMCLASS_BASE = 'https://tmclass.tmdn.org/ec2';
 
// Descripción canónica de las 45 clases de Niza (para fallback y enriquecimiento)
const CLASES_NIZA: Record<number, string> = {
  1: 'Productos químicos para industria, ciencia y fotografía',
  2: 'Pinturas, barnices, lacas, preservativos contra la herrumbre',
  3: 'Cosméticos, perfumería, preparaciones para limpiar y pulir',
  4: 'Aceites y grasas industriales; combustibles; velas',
  5: 'Productos farmacéuticos, veterinarios e higiénicos',
  6: 'Metales comunes y sus aleaciones; herrería y ferretería',
  7: 'Máquinas, herramientas mecánicas; motores',
  8: 'Herramientas e instrumentos de mano',
  9: 'Aparatos científicos, náuticos, de cómputo y electrónicos',
  10: 'Aparatos e instrumentos quirúrgicos, médicos y dentales',
  11: 'Aparatos de alumbrado, calefacción, cocción y refrigeración',
  12: 'Vehículos; aparatos de locomoción terrestre, aérea o acuática',
  13: 'Armas de fuego; municiones; explosivos; fuegos artificiales',
  14: 'Metales preciosos; joyería; relojes',
  15: 'Instrumentos musicales',
  16: 'Papel, cartón; productos de imprenta; material de oficina',
  17: 'Caucho, gutapercha, goma; productos aislantes',
  18: 'Cuero e imitaciones; artículos de viaje; bolsos y carteras',
  19: 'Materiales de construcción no metálicos',
  20: 'Muebles, espejos, marcos; artículos de madera o plástico',
  21: 'Utensilios domésticos; cristalería; porcelana',
  22: 'Cuerdas, redes, tiendas, lonas, velas; fibras textiles',
  23: 'Hilos para uso textil',
  24: 'Tejidos y sus sustitutos; ropa de cama y de mesa',
  25: 'Vestimenta, calzado y artículos de sombrerería',
  26: 'Encajes y bordados; cintas y lazos; botones; agujas',
  27: 'Alfombras, felpudos, esteras; tapicería',
  28: 'Juegos, juguetes; artículos de deporte',
  29: 'Carne, pescado, aves; alimentos conservados; lácteos',
  30: 'Café, té, cacao; pan, pastelería; condimentos',
  31: 'Productos agrícolas, acuícolas y hortícolas; animales vivos',
  32: 'Cervezas; aguas minerales; bebidas de frutas; jarabes',
  33: 'Bebidas alcohólicas (excepto cervezas)',
  34: 'Tabaco; artículos para fumadores; fósforos',
  35: 'Publicidad; gestión comercial; administración de negocios',
  36: 'Seguros; operaciones financieras e inmobiliarias',
  37: 'Construcción; reparación; servicios de instalación',
  38: 'Telecomunicaciones',
  39: 'Transporte; embalaje y almacenamiento; viajes',
  40: 'Tratamiento de materiales',
  41: 'Educación; formación; entretenimiento; actividades deportivas',
  42: 'Servicios científicos y tecnológicos; investigación y diseño',
  43: 'Servicios de restauración y alojamiento temporal',
  44: 'Servicios médicos, veterinarios y de higiene personal',
  45: 'Servicios jurídicos; seguridad; servicios personales y sociales',
};
 
interface TerminoClasificado {
  termino: string;
  clase: number;
  descripcionClase: string;
  termDescription: string;
}
 
/**
 * Llama a la API de TMclass para un término en español.
 * Intenta varios endpoints conocidos y devuelve la lista de resultados.
 */
async function buscarEnTMclass(termino: string): Promise<TerminoClasificado[]> {
  const { default: axios } = await import('axios');
  const UA = 'Mozilla/5.0 (compatible; MarcaFacil/1.0)';
 
  // Endpoints a intentar (de más específico a más general)
  const endpoints = [
    `${TMCLASS_BASE}/api/search?lang=es&term=${encodeURIComponent(termino)}&limit=10`,
    `${TMCLASS_BASE}/api/niceclass/suggestions?lang=es&prefix=${encodeURIComponent(termino)}&limit=10`,
    `${TMCLASS_BASE}/search?lang=es&term=${encodeURIComponent(termino)}&limit=10`,
  ];
 
  for (const url of endpoints) {
    try {
      const { data } = await axios.get(url, {
        timeout: 8_000,
        headers: { 'User-Agent': UA, Accept: 'application/json' },
      });
 
      logger.info(`[TMclass] ${termino} → ${url} → ${JSON.stringify(data).slice(0, 200)}`);
 
      // Normalizar respuesta según distintos formatos posibles
      const resultados = normalizarRespuestaTMclass(data, termino);
      if (resultados.length > 0) return resultados;
    } catch (err: any) {
      logger.warn(`[TMclass] Endpoint ${url} falló: ${err.message}`);
    }
  }
 
  return [];
}
 
function normalizarRespuestaTMclass(data: any, terminoOriginal: string): TerminoClasificado[] {
  const resultados: TerminoClasificado[] = [];
  if (!data) return resultados;
 
  // Formato: array directo de términos
  const lista: any[] = Array.isArray(data)
    ? data
    : (data.results ?? data.data ?? data.terms ?? data.niceClasses ?? data.items ?? []);
 
  for (const item of lista) {
    // Intentar extraer número de clase
    const claseNum = parseInt(
      String(item.niceClassNumber ?? item.niceNumber ?? item.classNumber ??
             item.classId ?? item.clase ?? item.class ?? '')
        .replace(/\D/g, '')
    );
 
    if (!claseNum || claseNum < 1 || claseNum > 45) continue;
 
    const descripcionTerm = String(
      item.termDescription ?? item.description ?? item.name ?? item.term ??
      item.label ?? terminoOriginal
    ).trim();
 
    resultados.push({
      termino: terminoOriginal,
      clase: claseNum,
      descripcionClase: CLASES_NIZA[claseNum] || `Clase ${claseNum}`,
      termDescription: descripcionTerm,
    });
  }
 
  // Si el formato anida por clase (niceClasses: [{niceNumber, termList:[]}])
  if (resultados.length === 0 && Array.isArray(data.niceClasses)) {
    for (const nc of data.niceClasses) {
      const claseNum = parseInt(String(nc.niceNumber ?? nc.classNumber ?? ''));
      if (!claseNum) continue;
      const termList = Array.isArray(nc.termList) ? nc.termList : [nc];
      for (const t of termList) {
        resultados.push({
          termino: terminoOriginal,
          clase: claseNum,
          descripcionClase: CLASES_NIZA[claseNum] || `Clase ${claseNum}`,
          termDescription: String(t.termDescription ?? t.description ?? terminoOriginal).trim(),
        });
      }
    }
  }
 
  return resultados;
}
 
/**
 * GET /api/clasificador/buscar?terminos=ropa,perfumes,calzado
 * Devuelve clasificación por clase Niza para cada término
 */
router.get('/buscar', authenticateJWT, async (req: Request, res: Response) => {
  const terminosRaw = String(req.query.terminos || '').trim();
  if (!terminosRaw) {
    return res.status(400).json({ error: 'Parámetro "terminos" requerido' });
  }
 
  // Separar por coma, limpiar espacios, eliminar vacíos
  const terminos = terminosRaw
    .split(/[,;]+/)
    .map(t => t.trim())
    .filter(t => t.length > 0)
    .slice(0, 10); // máximo 10 términos por llamada
 
  logger.info(`[Clasificador] Clasificando: ${terminos.join(', ')}`);
 
  const resultadosPorClase: Record<number, {
    clase: number;
    descripcionClase: string;
    terminos: { termino: string; descripcion: string }[];
  }> = {};
 
  // Llamar TMclass para cada término (en paralelo, máx 5 simultáneas)
  const chunks: string[][] = [];
  for (let i = 0; i < terminos.length; i += 5) chunks.push(terminos.slice(i, i + 5));
 
  for (const chunk of chunks) {
    const resultados = await Promise.all(chunk.map(t => buscarEnTMclass(t)));
    for (const lista of resultados) {
      for (const r of lista) {
        if (!resultadosPorClase[r.clase]) {
          resultadosPorClase[r.clase] = {
            clase: r.clase,
            descripcionClase: r.descripcionClase,
            terminos: [],
          };
        }
        // Evitar duplicados
        const yaExiste = resultadosPorClase[r.clase].terminos
          .some(t => t.termino.toLowerCase() === r.termino.toLowerCase());
        if (!yaExiste) {
          resultadosPorClase[r.clase].terminos.push({
            termino: r.termino,
            descripcion: r.termDescription,
          });
        }
      }
    }
  }
 
  const clases = Object.values(resultadosPorClase).sort((a, b) => a.clase - b.clase);
 
  logger.info(`[Clasificador] Resultado: ${clases.length} clases para [${terminos.join(', ')}]`);
  return res.json({ terminos, clases, totalClases: clases.length });
});
 
/**
 * GET /api/clasificador/clases
 * Devuelve el listado completo de las 45 clases Niza con descripción
 */
router.get('/clases', authenticateJWT, (_req: Request, res: Response) => {
  const clases = Object.entries(CLASES_NIZA).map(([num, desc]) => ({
    clase: parseInt(num),
    descripcion: desc,
  }));
  return res.json({ clases });
});
 
export default router;
