/**
 * Clasificador de productos y servicios según Nomenclador de Niza
 * Clasificación local por palabras clave en español
 */
import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/auth';
import { logger } from '../../utils/logger';

const router = Router();

// Descripción canónica de las 45 clases de Niza
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

// Diccionario de palabras clave → clases Niza (español argentino)
const KEYWORDS: Array<{ palabras: string[]; clases: number[]; descripcion: string }> = [
  // Clase 3 — Cosméticos y perfumería
  { palabras: ['perfume', 'perfumes', 'colonia', 'colonias', 'fragancia', 'fragancias', 'desodorante', 'desodorantes', 'cosmetico', 'cosméticos', 'cosmética', 'maquillaje', 'labial', 'labiales', 'base', 'rubor', 'sombra', 'rimmel', 'mascara', 'crema', 'cremas', 'locion', 'loción', 'shampoo', 'champú', 'acondicionador', 'gel', 'serum', 'sérum', 'protector solar', 'bronceador', 'hidratante', 'desmaquillante', 'tónico', 'tonico', 'esmalte de uñas', 'esmalte'], clases: [3], descripcion: 'Perfumería y cosméticos' },

  // Clase 5 — Farmacéuticos
  { palabras: ['medicamento', 'medicamentos', 'farmacéutico', 'farmaceutico', 'suplemento', 'suplementos', 'vitamina', 'vitaminas', 'antibiótico', 'antibiotico', 'analgésico', 'analgesico', 'antiinflamatorio', 'pastilla', 'pastillas', 'comprimido', 'comprimidos', 'jarabe', 'vacuna', 'vacunas', 'probiótico', 'probiotico', 'proteína', 'proteina', 'proteinas', 'whey', 'suero', 'dietético', 'dietetico', 'adelgazante', 'desinfectante', 'antiséptico', 'barbijo', 'barbijos', 'tapaboca'], clases: [5], descripcion: 'Productos farmacéuticos y suplementos' },

  // Clase 9 — Electrónica y software
  { palabras: ['software', 'aplicacion', 'aplicación', 'app', 'programa', 'programas', 'celular', 'celulares', 'smartphone', 'telefono', 'teléfono', 'computadora', 'computadoras', 'notebook', 'tablet', 'tablets', 'auricular', 'auriculares', 'cámara', 'camara', 'cámaras', 'camaras', 'electronico', 'electrónico', 'electronica', 'electrónica', 'televisor', 'television', 'televisión', 'monitor', 'impresora', 'router', 'modem', 'módem', 'pendrive', 'disco', 'cargador', 'cable', 'gps', 'drone', 'drones', 'reloj inteligente', 'smartwatch'], clases: [9], descripcion: 'Aparatos electrónicos y software' },

  // Clase 14 — Joyería
  { palabras: ['joya', 'joyas', 'joyería', 'joyeria', 'anillo', 'anillos', 'collar', 'collares', 'pulsera', 'pulseras', 'arete', 'aretes', 'aro', 'aros', 'pendiente', 'pendientes', 'reloj', 'relojes', 'oro', 'plata', 'plata 925', 'brillante', 'diamante', 'diamantes', 'piedra preciosa', 'accesorios de lujo', 'medalla', 'medallas', 'cadena', 'cadenas', 'prendedor'], clases: [14], descripcion: 'Joyería y relojes' },

  // Clase 16 — Papel e imprenta
  { palabras: ['libro', 'libros', 'revista', 'revistas', 'diario', 'periódico', 'periodico', 'cuaderno', 'cuadernos', 'agenda', 'agendas', 'lapicera', 'lapiceras', 'lapiz', 'lápiz', 'bolígrafo', 'boligrafo', 'papel', 'papelería', 'papeleria', 'editorial', 'publicacion', 'publicación', 'sticker', 'stickers', 'tarjeta', 'tarjetas', 'poster', 'póster', 'impresión', 'impresion', 'fotocopias', 'carpeta', 'carpetas', 'block', 'planilla', 'etiqueta', 'etiquetas'], clases: [16], descripcion: 'Papel, libros y material de oficina' },

  // Clase 18 — Bolsos y carteras
  { palabras: ['bolso', 'bolsos', 'cartera', 'carteras', 'mochila', 'mochilas', 'maleta', 'maletas', 'valija', 'valijas', 'billetera', 'billeteras', 'monedero', 'monederos', 'portadocumentos', 'riñonera', 'riñoneras', 'maletín', 'maletin', 'neceser', 'neceseres', 'cuero', 'marroquinería', 'marroquineria', 'portafolios'], clases: [18], descripcion: 'Bolsos, carteras y artículos de viaje' },

  // Clase 20 — Muebles
  { palabras: ['mueble', 'muebles', 'silla', 'sillas', 'mesa', 'mesas', 'sillón', 'sillon', 'sofa', 'sofá', 'cama', 'camas', 'placard', 'placards', 'estante', 'estantes', 'escritorio', 'escritorios', 'librería', 'libreria', 'mueblería', 'muebleria', 'decoración', 'decoracion', 'marco', 'marcos', 'espejo', 'espejos', 'perchero', 'percheros'], clases: [20], descripcion: 'Muebles y decoración' },

  // Clase 21 — Utensilios domésticos
  { palabras: ['utensilio', 'utensilios', 'cocina', 'sartén', 'sartenm', 'olla', 'ollas', 'vaso', 'vasos', 'taza', 'tazas', 'plato', 'platos', 'cubierto', 'cubiertos', 'cuchillo', 'tenedor', 'cuchara', 'licuadora', 'batidora', 'cacerola', 'cacerolas', 'tupper', 'tuppers', 'termo', 'termos', 'mate', 'mates', 'bombilla', 'jarra', 'jarras', 'fuente', 'fuentes', 'vajilla', 'cristalería', 'cristaleria', 'porcelana'], clases: [21], descripcion: 'Utensilios de cocina y hogar' },

  // Clase 25 — Ropa y calzado
  { palabras: ['ropa', 'indumentaria', 'vestimenta', 'remera', 'remeras', 'camiseta', 'camisetas', 'camisa', 'camisas', 'pantalon', 'pantalón', 'pantalones', 'jean', 'jeans', 'vestido', 'vestidos', 'falda', 'faldas', 'pollera', 'polleras', 'zapatilla', 'zapatillas', 'zapato', 'zapatos', 'bota', 'botas', 'sandalia', 'sandalias', 'calzado', 'ropa interior', 'bombacha', 'bombachas', 'calzoncillo', 'calzoncillos', 'medias', 'calcetines', 'campera', 'camperas', 'buzo', 'buzos', 'abrigo', 'abrigos', 'traje', 'trajes', 'saco', 'sacos', 'chaqueta', 'chaquetas', 'gorra', 'gorras', 'sombrero', 'sombreros', 'gorro', 'gorros', 'bufanda', 'bufandas', 'guante', 'guantes', 'cinturón', 'cinturon', 'cinturones', 'pijama', 'pijamas', 'ropa deportiva', 'legging', 'leggings', 'short', 'shorts', 'bermuda', 'bermudas', 'malla', 'traje de baño', 'bikini'], clases: [25], descripcion: 'Indumentaria y calzado' },

  // Clase 28 — Juguetes y deportes
  { palabras: ['juguete', 'juguetes', 'peluche', 'peluches', 'muñeca', 'muñecas', 'auto a escala', 'rompecabezas', 'puzzle', 'juego de mesa', 'juegos de mesa', 'deporte', 'deportes', 'pelota', 'pelotas', 'raqueta', 'raquetas', 'bicicleta', 'bicicletas', 'patines', 'skate', 'skateboard', 'artículo deportivo', 'artículos deportivos', 'gimnasio', 'pesas', 'mancuernas', 'colchoneta', 'colchonetas', 'naipe', 'naipes', 'carta', 'cartas'], clases: [28], descripcion: 'Juguetes y artículos deportivos' },

  // Clase 29 — Alimentos (cárnicos y conservas)
  { palabras: ['carne', 'carnes', 'pollo', 'pollos', 'pescado', 'pescados', 'fiambre', 'fiambres', 'embutido', 'embutidos', 'salchicha', 'salchichas', 'jamón', 'jamon', 'salame', 'salamín', 'salamin', 'queso', 'quesos', 'lácteo', 'lacteo', 'lácteos', 'lacteos', 'yogur', 'yogurt', 'leche', 'manteca', 'crema de leche', 'conserva', 'conservas', 'enlatado', 'enlatados', 'atún', 'atun', 'sardina', 'sardinas', 'aceite de oliva', 'aceite', 'aceites', 'fruto seco', 'frutos secos', 'maní', 'mani', 'almendra', 'almendras', 'nuez', 'huevo', 'huevos', 'mermelada', 'mermeladas', 'dulce', 'dulces', 'alimento para animales', 'alimentos para animales', 'pet food', 'comida para perros', 'comida para gatos', 'alimento para mascotas'], clases: [29], descripcion: 'Carnes, lácteos y alimentos conservados' },

  // Clase 30 — Panadería y café
  { palabras: ['café', 'cafe', 'te', 'té', 'cacao', 'chocolate', 'chocolates', 'galletita', 'galletitas', 'galleta', 'galletas', 'pan', 'panes', 'factura', 'facturas', 'medialuna', 'medialunas', 'torta', 'tortas', 'postre', 'postres', 'helado', 'helados', 'golosina', 'golosinas', 'caramelo', 'caramelos', 'alfajor', 'alfajores', 'turron', 'turrón', 'goma de mascar', 'chicle', 'chicles', 'yerba', 'yerba mate', 'condimento', 'condimentos', 'sal', 'azúcar', 'azucar', 'harina', 'arroz', 'fideos', 'pasta', 'pastas', 'mayonesa', 'mostaza', 'ketchup', 'salsa', 'salsas', 'vinagre', 'especias', 'cereal', 'cereales', 'granola'], clases: [30], descripcion: 'Café, té, panadería y repostería' },

  // Clase 31 — Productos agrícolas
  { palabras: ['fruta', 'frutas', 'verdura', 'verduras', 'hortaliza', 'hortalizas', 'semilla', 'semillas', 'planta', 'plantas', 'flor', 'flores', 'árbol', 'arbol', 'árboles', 'arboles', 'animal vivo', 'animales vivos', 'mascota', 'mascotas', 'perro', 'gato', 'agrícola', 'agricola', 'vivero', 'viveros', 'sustrato', 'fertilizante', 'fertilizantes'], clases: [31], descripcion: 'Productos agrícolas y animales vivos' },

  // Clase 32 — Bebidas sin alcohol
  { palabras: ['agua', 'aguas', 'gaseosa', 'gaseosas', 'jugo', 'jugos', 'refresco', 'refrescos', 'bebida sin alcohol', 'bebidas sin alcohol', 'cerveza', 'cervezas', 'soda', 'isotónico', 'isotonico', 'energizante', 'energizantes', 'limonada', 'jarabe', 'sirope', 'tónica', 'tonica'], clases: [32], descripcion: 'Cervezas y bebidas sin alcohol' },

  // Clase 33 — Bebidas alcohólicas
  { palabras: ['vino', 'vinos', 'bebida alcohólica', 'bebidas alcohólicas', 'whisky', 'vodka', 'gin', 'ron', 'fernet', 'aperitivo', 'aperitivos', 'champagne', 'champán', 'espumante', 'espumantes', 'licor', 'licores', 'destilado', 'destilados', 'tequila', 'cognac', 'coñac', 'brandy', 'grappa', 'singani'], clases: [33], descripcion: 'Bebidas alcohólicas' },

  // Clase 35 — Servicios comerciales
  { palabras: ['publicidad', 'marketing', 'comercio', 'negocio', 'tienda', 'tiendas', 'venta', 'ventas', 'retail', 'supermercado', 'supermercados', 'ecommerce', 'e-commerce', 'online', 'gestión comercial', 'administración', 'consultora', 'consultoras', 'empresa', 'empresas', 'agencia', 'agencias', 'importacion', 'importación', 'exportacion', 'exportación', 'distribución', 'distribucion', 'mayorista', 'minorista', 'franquicia', 'franquicias'], clases: [35], descripcion: 'Servicios comerciales y publicitarios' },

  // Clase 36 — Finanzas y seguros
  { palabras: ['seguro', 'seguros', 'banco', 'bancos', 'financiero', 'financiera', 'financieros', 'prestamo', 'préstamo', 'prestamos', 'préstamos', 'crédito', 'credito', 'inversión', 'inversion', 'fintech', 'inmobiliaria', 'inmobiliarias', 'alquiler', 'alquileres', 'propiedad', 'propiedades', 'ahorro', 'ahorros', 'caja', 'cooperativa', 'cooperativas', 'tarjeta de crédito', 'tarjeta de debito', 'billetera virtual', 'pagos', 'transferencia', 'bolsa', 'valores'], clases: [36], descripcion: 'Servicios financieros e inmobiliarios' },

  // Clase 38 — Telecomunicaciones
  { palabras: ['telecomunicaciones', 'internet', 'wifi', 'streaming', 'televisión por cable', 'cable', 'radio', 'comunicaciones', 'mensajería', 'red social', 'redes sociales', 'plataforma digital', 'hosting', 'servidor', 'servidores', 'nube', 'cloud', 'telefonía', 'telefonia'], clases: [38], descripcion: 'Servicios de telecomunicaciones e internet' },

  // Clase 41 — Educación y entretenimiento
  { palabras: ['educacion', 'educación', 'escuela', 'escuelas', 'colegio', 'colegios', 'instituto', 'institutos', 'universidad', 'universidades', 'curso', 'cursos', 'capacitacion', 'capacitación', 'formacion', 'formación', 'entretenimiento', 'cine', 'teatro', 'música', 'musica', 'concierto', 'conciertos', 'evento', 'eventos', 'deporte', 'gym', 'gimnasio', 'academia', 'academias', 'editorial', 'producción audiovisual', 'produccion audiovisual', 'fotografia', 'fotografía', 'diseño', 'disenio'], clases: [41], descripcion: 'Educación y entretenimiento' },

  // Clase 42 — Servicios tecnológicos
  { palabras: ['tecnología', 'tecnologia', 'desarrollo de software', 'desarrollo web', 'programación', 'programacion', 'diseño web', 'it', 'sistemas', 'inteligencia artificial', 'ia', 'ai', 'nube', 'saas', 'startup', 'innovación', 'innovacion', 'investigacion', 'investigación', 'laboratorio', 'laboratorios', 'testing', 'qa', 'ux', 'ui', 'consultoría tecnológica', 'consultoria tecnologica', 'ciberseguridad', 'blockchain', 'nft'], clases: [42], descripcion: 'Servicios tecnológicos e informáticos' },

  // Clase 43 — Restauración y hotelería
  { palabras: ['restaurante', 'restaurantes', 'restaurant', 'bar', 'bares', 'cafe', 'cafetería', 'cafeteria', 'hotel', 'hoteles', 'hostel', 'hostels', 'alojamiento', 'catering', 'gastronomía', 'gastronomia', 'panadería', 'panaderia', 'pastelería', 'pasteleria', 'heladería', 'heladeria', 'pizzería', 'pizzeria', 'hamburguesería', 'hamburgueseria', 'delivery', 'comida', 'comidas', 'menú', 'menu', 'bodega', 'bodegas', 'vinoteca', 'vinotecas'], clases: [43], descripcion: 'Restauración y alojamiento' },

  // Clase 44 — Servicios médicos y veterinarios
  { palabras: ['médico', 'medico', 'médicos', 'medicos', 'salud', 'clinica', 'clínica', 'clínicas', 'clinicas', 'hospital', 'hospitales', 'veterinaria', 'veterinario', 'veterinarios', 'farmacia', 'farmacias', 'odontología', 'odontologia', 'dentista', 'dentistas', 'psicólogo', 'psicologia', 'psicología', 'spa', 'spa y bienestar', 'peluquería', 'peluqueria', 'estética', 'estetica', 'nutricion', 'nutrición', 'dietista', 'fisioterapia', 'kinesiólogo', 'kinesiologia', 'cosmetología', 'cosmetologia'], clases: [44], descripcion: 'Servicios médicos, veterinarios y de estética' },

  // Clase 45 — Servicios legales y de seguridad
  { palabras: ['abogado', 'abogados', 'estudio juridico', 'estudio jurídico', 'juridico', 'jurídico', 'legal', 'legales', 'notaría', 'notaria', 'escribano', 'escribanos', 'seguridad', 'custodia', 'detective', 'investigación privada', 'arbitraje', 'mediacion', 'mediación', 'servicio funerario', 'sepelio', 'servicios personales'], clases: [45], descripcion: 'Servicios jurídicos y de seguridad' },

  // Clase 37 — Construcción y reparación
  { palabras: ['construccion', 'construcción', 'obra', 'obras', 'albañilería', 'albanileria', 'plomería', 'plomeria', 'electricidad', 'electricista', 'electricistas', 'pintura de casas', 'reparacion', 'reparación', 'mantenimiento', 'reformas', 'reforma', 'carpintería', 'carpinteria', 'cerrajería', 'cerrajeria', 'instalacion', 'instalación', 'inmobiliaria obra', 'sanitarios', 'gasfitería', 'gasfiteria'], clases: [37], descripcion: 'Construcción y reparación' },

  // Clase 39 — Transporte y logística
  { palabras: ['transporte', 'transportes', 'logistica', 'logística', 'flete', 'fletes', 'mudanza', 'mudanzas', 'envío', 'envios', 'envíos', 'correo', 'courier', 'turismo', 'viaje', 'viajes', 'agencia de viajes', 'taxi', 'remis', 'remises', 'delivery de paquetes', 'almacenamiento', 'depósito', 'deposito', 'warehousing'], clases: [39], descripcion: 'Transporte y logística' },
];

interface TerminoClasificado {
  termino: string;
  clase: number;
  descripcionClase: string;
  termDescription: string;
}

/**
 * Clasifica un término por coincidencia de palabras clave en español.
 */
function clasificarTermino(termino: string): TerminoClasificado[] {
  const t = termino.toLowerCase().trim();
  const resultados: TerminoClasificado[] = [];
  const clasesEncontradas = new Set<number>();

  for (const entry of KEYWORDS) {
    const coincide = entry.palabras.some(p => {
      const pal = p.toLowerCase();
      return t === pal || t.includes(pal) || pal.includes(t);
    });

    if (coincide) {
      for (const clase of entry.clases) {
        if (!clasesEncontradas.has(clase)) {
          clasesEncontradas.add(clase);
          resultados.push({
            termino,
            clase,
            descripcionClase: CLASES_NIZA[clase] || `Clase ${clase}`,
            termDescription: entry.descripcion,
          });
        }
      }
    }
  }

  return resultados;
}

/**
 * GET /api/clasificador/buscar?terminos=ropa,perfumes,calzado
 */
router.get('/buscar', authenticate, async (req: Request, res: Response) => {
  const terminosRaw = String(req.query.terminos || '').trim();
  if (!terminosRaw) {
    return res.status(400).json({ error: 'Parámetro "terminos" requerido' });
  }

  const terminos = terminosRaw
    .split(/[,;]+/)
    .map(t => t.trim())
    .filter(t => t.length > 0)
    .slice(0, 10);

  logger.info(`[Clasificador] Clasificando: ${terminos.join(', ')}`);

  const resultadosPorClase: Record<number, {
    clase: number;
    descripcionClase: string;
    terminos: { termino: string; descripcion: string }[];
  }> = {};

  for (const termino of terminos) {
    const resultados = clasificarTermino(termino);

    if (resultados.length === 0) {
      logger.warn(`[Clasificador] Sin coincidencia para: "${termino}"`);
    }

    for (const r of resultados) {
      if (!resultadosPorClase[r.clase]) {
        resultadosPorClase[r.clase] = {
          clase: r.clase,
          descripcionClase: r.descripcionClase,
          terminos: [],
        };
      }
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

  const clases = Object.values(resultadosPorClase).sort((a, b) => a.clase - b.clase);
  logger.info(`[Clasificador] Resultado: ${clases.length} clases para [${terminos.join(', ')}]`);

  return res.json({ terminos, clases, totalClases: clases.length });
});

/**
 * GET /api/clasificador/clases
 */
router.get('/clases', authenticate, (_req: Request, res: Response) => {
  const clases = Object.entries(CLASES_NIZA).map(([num, desc]) => ({
    clase: parseInt(num),
    descripcion: desc,
  }));
  return res.json({ clases });
});

export default router;
