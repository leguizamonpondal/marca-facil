/**
 * Clasificador de productos y servicios según Nomenclador de Niza
 * Clasificación local por palabras clave en español argentino
 */
import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/auth';
import { logger } from '../../utils/logger';
 
const router = Router();
 
// ── Descripción canónica de las 45 clases de Niza ────────────────────────────
const CLASES_NIZA: Record<number, { titulo: string; que_protege: string }> = {
  1:  { titulo: 'Productos químicos industriales',             que_protege: 'Químicos para industria, ciencia, agricultura y fotografía' },
  2:  { titulo: 'Pinturas y barnices',                        que_protege: 'Pinturas, barnices, lacas, tintes, preservativos anticorrosión' },
  3:  { titulo: 'Cosméticos y perfumería',                    que_protege: 'Perfumes, cosméticos, productos de higiene y limpieza personal' },
  4:  { titulo: 'Combustibles y lubricantes',                 que_protege: 'Aceites, grasas, combustibles, velas, aditivos' },
  5:  { titulo: 'Productos farmacéuticos',                    que_protege: 'Medicamentos, suplementos, productos veterinarios e higiénicos' },
  6:  { titulo: 'Metales y herrería',                         que_protege: 'Metales comunes, construcciones metálicas, ferretería' },
  7:  { titulo: 'Maquinaria',                                 que_protege: 'Máquinas, herramientas mecánicas, motores (no vehículos)' },
  8:  { titulo: 'Herramientas manuales',                      que_protege: 'Herramientas e instrumentos de mano, cubiertos, armas blancas' },
  9:  { titulo: 'Electrónica y software',                     que_protege: 'Aparatos eléctricos, electrónicos, ópticos, informáticos y software' },
  10: { titulo: 'Instrumental médico',                        que_protege: 'Aparatos e instrumentos médicos, quirúrgicos y dentales' },
  11: { titulo: 'Electrodomésticos e iluminación',            que_protege: 'Aparatos de alumbrado, cocción, refrigeración, calefacción' },
  12: { titulo: 'Vehículos',                                  que_protege: 'Vehículos y medios de transporte terrestres, aéreos y acuáticos' },
  13: { titulo: 'Armas y explosivos',                         que_protege: 'Armas de fuego, municiones, explosivos, fuegos artificiales' },
  14: { titulo: 'Joyería y relojería',                        que_protege: 'Metales preciosos, joyería, bisutería, relojes' },
  15: { titulo: 'Instrumentos musicales',                     que_protege: 'Instrumentos musicales y sus accesorios' },
  16: { titulo: 'Papel, imprenta y papelería',                que_protege: 'Papel, cartón, libros, revistas, material de escritura y oficina, embalajes de papel' },
  17: { titulo: 'Caucho y materiales aislantes',              que_protege: 'Caucho, plástico en bruto, materiales aislantes, mangueras' },
  18: { titulo: 'Marroquinería y equipaje',                   que_protege: 'Cuero, carteras, bolsos, mochilas, valijas, paraguas' },
  19: { titulo: 'Materiales de construcción',                 que_protege: 'Materiales de construcción no metálicos, vidrio, cerámicos, asfalto' },
  20: { titulo: 'Muebles y decoración',                       que_protege: 'Muebles, espejos, marcos, artículos de madera, corcho o plástico' },
  21: { titulo: 'Utensilios de hogar',                        que_protege: 'Utensilios de cocina y hogar, cristalería, porcelana, escobas' },
  22: { titulo: 'Cuerdas y fibras textiles',                  que_protege: 'Cuerdas, sogas, redes, lonas, sacos, fibras textiles en bruto' },
  23: { titulo: 'Hilos textiles',                             que_protege: 'Hilos e hilados para uso textil' },
  24: { titulo: 'Tejidos y ropa de hogar',                    que_protege: 'Telas, tejidos, ropa de cama, mantelería, tapicería' },
  25: { titulo: 'Indumentaria y calzado',                     que_protege: 'Ropa, calzado, sombreros y accesorios de vestimenta' },
  26: { titulo: 'Mercería',                                   que_protege: 'Encajes, bordados, botones, agujas, cierres, adornos para ropa' },
  27: { titulo: 'Alfombras y revestimientos',                 que_protege: 'Alfombras, tapetes, felpudos, revestimientos para pisos y paredes' },
  28: { titulo: 'Juguetes y artículos deportivos',            que_protege: 'Juguetes, juegos, artículos de deporte y gimnasia' },
  29: { titulo: 'Alimentos cárnicos y conservas',             que_protege: 'Carnes, pescados, lácteos, conservas, aceites comestibles, huevos' },
  30: { titulo: 'Alimentos de panadería y condimentos',       que_protege: 'Café, té, harinas, pan, pastelería, arroz, pastas, condimentos, golosinas' },
  31: { titulo: 'Productos agrícolas y animales',             que_protege: 'Frutas, verduras, granos, plantas, flores, animales vivos, alimentos para animales' },
  32: { titulo: 'Bebidas sin alcohol',                        que_protege: 'Aguas, jugos, gaseosas, cervezas, bebidas isotónicas y energizantes' },
  33: { titulo: 'Bebidas alcohólicas',                        que_protege: 'Vinos, licores, espirituosas y bebidas alcohólicas en general (excluye cervezas)' },
  34: { titulo: 'Tabaco',                                     que_protege: 'Tabaco, cigarrillos, cigarros, artículos para fumadores, vaporizadores' },
  35: { titulo: 'Publicidad y servicios comerciales',         que_protege: 'Publicidad, marketing, gestión de negocios, comercio al por mayor y menor' },
  36: { titulo: 'Servicios financieros e inmobiliarios',      que_protege: 'Banca, seguros, inversiones, operaciones inmobiliarias, alquiler de propiedades' },
  37: { titulo: 'Construcción y reparación',                  que_protege: 'Servicios de construcción, reparación, instalación y mantenimiento' },
  38: { titulo: 'Telecomunicaciones',                         que_protege: 'Servicios de telecomunicaciones, internet, transmisión de datos, radio y TV' },
  39: { titulo: 'Transporte y logística',                     que_protege: 'Transporte de personas y mercaderías, logística, almacenamiento, turismo' },
  40: { titulo: 'Tratamiento de materiales',                  que_protege: 'Servicios de tratamiento, procesamiento y transformación de materiales' },
  41: { titulo: 'Educación y entretenimiento',                que_protege: 'Servicios de educación, capacitación, entretenimiento, deportes y cultura' },
  42: { titulo: 'Servicios tecnológicos y científicos',       que_protege: 'Desarrollo de software, diseño web, investigación científica, consultaría IT' },
  43: { titulo: 'Gastronomía y alojamiento',                  que_protege: 'Restaurantes, bares, hoteles, servicios de comida y bebida para consumo inmediato' },
  44: { titulo: 'Servicios médicos y de belleza',             que_protege: 'Medicina humana y veterinaria, servicios de higiene y belleza personal' },
  45: { titulo: 'Servicios jurídicos y de seguridad',         que_protege: 'Servicios legales, notariales, seguridad privada, servicios personales y sociales' },
};
 
// ── Diccionario de palabras clave → clases Niza ───────────────────────────────
// Reglas:
//   - Usar términos específicos; evitar palabras ambiguas sueltas
//   - Frases de 2+ palabras son más seguras que palabras únicas muy cortas
//   - El algoritmo hace matching por palabra completa (≥4 letras) o frase exacta
const KEYWORDS: Array<{ palabras: string[]; clases: number[]; descripcion: string }> = [
 
  // ── CLASE 1 — Químicos industriales ─────────────────────────────────────────
  {
    palabras: [
      'producto quimico', 'productos quimicos', 'reactivo', 'reactivos',
      'fertilizante quimico', 'agroquimico', 'agroquimicos', 'pesticida', 'pesticidas',
      'herbicida', 'herbicidas', 'fungicida', 'fungicidas', 'insecticida agricola',
      'resina industrial', 'resinas industriales', 'adhesivo industrial',
      'pegamento industrial', 'solvente', 'solventes', 'quimica industrial',
    ],
    clases: [1],
    descripcion: 'Productos químicos para industria y agricultura',
  },
 
  // ── CLASE 2 — Pinturas y barnices ───────────────────────────────────────────
  {
    palabras: [
      'pintura', 'pinturas', 'barniz', 'barnices', 'laca', 'lacas',
      'esmalte sintetico', 'esmaltes sinteticos', 'pintura latex', 'anticorrosivo',
      'antioxidante', 'tinte para madera', 'tintes para madera', 'imprimacion',
      'sellador', 'selladores', 'pintura para paredes', 'pintura para exterior',
      'colorante industrial', 'colorantes industriales',
    ],
    clases: [2],
    descripcion: 'Pinturas, barnices y recubrimientos',
  },
 
  // ── CLASE 3 — Cosméticos y perfumería ───────────────────────────────────────
  {
    palabras: [
      'perfume', 'perfumes', 'colonia', 'colonias', 'fragancia', 'fragancias',
      'eau de toilette', 'eau de parfum',
      'desodorante', 'desodorantes', 'antitranspirante', 'antitranspirantes',
      'cosmetico', 'cosmeticos', 'cosmetica', 'maquillaje',
      'base de maquillaje', 'rubor', 'sombra de ojos', 'delineador',
      'labial', 'labiales', 'lipstick', 'gloss', 'brillo labial',
      'rimmel', 'mascara de pestanas', 'rimel',
      'crema facial', 'crema corporal', 'crema hidratante', 'crema de noche',
      'crema antiarrugas', 'serum facial', 'serum capilar',
      'locion corporal', 'locion facial', 'toner',
      'shampoo', 'champu', 'acondicionador', 'balsamo capilar',
      'mascarilla capilar', 'mascarilla facial', 'exfoliante',
      'gel de ducha', 'jabon liquido', 'jabon de tocador',
      'protector solar', 'bloqueador solar', 'bronceador',
      'desmaquillante', 'agua micelar', 'tonico facial',
      'esmalte de unas', 'quitaesmalte', 'tratamiento de unas',
      'depilatorio', 'crema depilatoria',
      'producto capilar', 'productos capilares', 'cuidado del cabello',
      'cuidado de la piel', 'higiene personal',
    ],
    clases: [3],
    descripcion: 'Perfumería, cosméticos e higiene personal',
  },
 
  // ── CLASE 4 — Combustibles y lubricantes ────────────────────────────────────
  {
    palabras: [
      'aceite lubricante', 'aceites lubricantes', 'lubricante', 'lubricantes',
      'combustible', 'combustibles', 'gasoil', 'nafta', 'kerosene',
      'aceite de motor', 'aceite para motor', 'grasa lubricante', 'grasa industrial',
      'vela', 'velas', 'cirio', 'cirios', 'parafina',
    ],
    clases: [4],
    descripcion: 'Combustibles, lubricantes y velas',
  },
 
  // ── CLASE 5 — Farmacéuticos ──────────────────────────────────────────────────
  {
    palabras: [
      'medicamento', 'medicamentos', 'farmaceutico', 'farmaceuticos',
      'remedio', 'remedios', 'droga', 'drogas', 'preparado farmaceutico',
      'antibiotico', 'antibioticos', 'analgesico', 'analgesicos',
      'antiinflamatorio', 'antiinflamatorios', 'antifebril', 'antipiretico',
      'antiacido', 'antihistaminico', 'antihistaminicos',
      'pastilla', 'pastillas', 'comprimido', 'comprimidos',
      'capsula', 'capsulas', 'jarabe medicinal', 'ampolla medicinal',
      'supositorio', 'supositorios', 'pomada medicinal', 'crema medicinal',
      'vacuna', 'vacunas', 'suero medicinal', 'solucion inyectable',
      'vitamina', 'vitaminas', 'mineral dietario', 'suplemento dietario',
      'suplemento nutricional', 'suplementos nutricionales',
      'probiotico', 'probioticos', 'prebiotico',
      'proteina en polvo', 'whey protein', 'creatina',
      'medicamento veterinario', 'medicamentos veterinarios',
      'producto veterinario', 'productos veterinarios',
      'antiparasitario', 'antipulgas', 'desparasitante',
      'desinfectante', 'desinfectantes', 'antiseptico', 'antisepticos',
      'vendaje', 'vendajes', 'apósito', 'apositos', 'barbijo', 'barbijos', 'tapaboca',
      'preservativo', 'preservativos', 'metodo anticonceptivo',
      'adelgazante', 'suplemento para adelgazar',
    ],
    clases: [5],
    descripcion: 'Productos farmacéuticos y suplementos',
  },
 
  // ── CLASE 6 — Metales ────────────────────────────────────────────────────────
  {
    palabras: [
      'metal', 'metales', 'hierro', 'acero', 'aluminio',
      'estructura metalica', 'estructuras metalicas',
      'reja', 'rejas', 'portón metalico', 'portones metalicos',
      'herrería', 'herreria', 'ferreteria metalica',
      'tornillo', 'tornillos', 'tuerca', 'tuercas', 'clavo', 'clavos',
      'caño metalico', 'caños metalicos', 'chapa metalica', 'chapas metalicas',
      'contenedor metalico', 'recipiente metalico',
      'candado', 'candados', 'cerradura metalica', 'bisagra', 'bisagras',
    ],
    clases: [6],
    descripcion: 'Productos metálicos y herrería',
  },
 
  // ── CLASE 7 — Maquinaria ─────────────────────────────────────────────────────
  {
    palabras: [
      'maquina industrial', 'maquinas industriales', 'maquinaria', 'maquinarias',
      'motor industrial', 'motores industriales',
      'compresor', 'compresores', 'bomba hidraulica', 'bombas hidraulicas',
      'generador electrico', 'generadores electricos',
      'torno industrial', 'fresadora', 'soldadora industrial',
      'maquina de coser industrial', 'maquina de coser',
      'maquina agricola', 'maquinas agricolas', 'tractor',
      'robot industrial', 'brazo robotico',
    ],
    clases: [7],
    descripcion: 'Maquinaria e industria',
  },
 
  // ── CLASE 8 — Herramientas manuales ─────────────────────────────────────────
  {
    palabras: [
      'herramienta manual', 'herramientas manuales',
      'martillo', 'destornillador', 'llave inglesa', 'pinza', 'pinzas',
      'serrucho', 'hacha', 'formón', 'espatula', 'espatulas',
      'cuchillo de cocina', 'cuchillos de cocina', 'navaja', 'tijera', 'tijeras',
      'maquina de afeitar', 'afeitadora manual',
    ],
    clases: [8],
    descripcion: 'Herramientas e instrumentos manuales',
  },
 
  // ── CLASE 9 — Electrónica y software ────────────────────────────────────────
  {
    palabras: [
      'software', 'programa informático', 'programas informaticos',
      'aplicacion movil', 'aplicaciones moviles', 'app movil',
      'videojuego', 'videojuegos', 'juego de computadora',
      'sistema informatico', 'sistemas informaticos',
      'celular', 'celulares', 'smartphone', 'telefono celular',
      'computadora', 'computadoras', 'notebook', 'laptop', 'computadora portatil',
      'tablet', 'tablets', 'ipad',
      'television', 'televisor', 'televisores', 'smart tv',
      'monitor de computadora', 'pantalla',
      'impresora', 'impresoras', 'escaner', 'fotocopiadora',
      'router', 'modem', 'switch de red',
      'auricular', 'auriculares', 'audifonos', 'auriculares inalambricos',
      'parlante', 'parlantes', 'altavoz', 'altavoces', 'sonido',
      'camara fotografica', 'camara de fotos', 'camara de video',
      'camara de seguridad', 'camaras de seguridad',
      'pendrive', 'disco rigido', 'disco solido', 'memoria usb',
      'cargador de celular', 'cargador inalambrico', 'powerbank',
      'cable hdmi', 'cable de datos',
      'gps', 'sistema de navegacion',
      'drone', 'drones', 'cuadricoptero',
      'reloj inteligente', 'smartwatch', 'pulsera fitness',
      'lector de codigos de barra', 'escaner de codigo',
      'electronico', 'electronicos', 'electronica', 'equipo electronico',
      'instrumento de medicion', 'instrumentos de medicion',
    ],
    clases: [9],
    descripcion: 'Aparatos electrónicos, informáticos y software',
  },
 
  // ── CLASE 10 — Instrumental médico ──────────────────────────────────────────
  {
    palabras: [
      'instrumental medico', 'instrumento medico', 'instrumentos medicos',
      'instrumento quirurgico', 'instrumentos quirurgicos',
      'bisturi', 'estetoscopio', 'tensiómetro', 'glucometro',
      'termometro medico', 'oximetro',
      'silla de ruedas', 'muleta', 'muletas', 'andador ortopedico',
      'protesis', 'protesis ortopedica', 'ortesis',
      'aparato dental', 'aparatos dentales', 'instrumental dental',
      'preservativo', 'preservativos medicos', 'condón',
      'electromedicina', 'equipo medico',
    ],
    clases: [10],
    descripcion: 'Instrumental médico y quirúrgico',
  },
 
  // ── CLASE 11 — Electrodomésticos e iluminación ───────────────────────────────
  {
    palabras: [
      'heladera', 'heladeras', 'refrigerador', 'refrigeradores', 'freezer',
      'lavarropas', 'lavadora', 'lavadoras', 'secarropas',
      'lavavajillas', 'lava vajilla',
      'microondas', 'horno electrico', 'hornos electricos', 'horno a gas',
      'cocina a gas', 'cocinas a gas', 'anafe',
      'aire acondicionado', 'aire acondicionados', 'climatizador', 'ventilador',
      'calefactor', 'calefactores', 'estufa', 'estufas', 'radiador',
      'lampara', 'lamparas', 'luminaria', 'luminarias', 'luz led',
      'lampara led', 'lamparas led', 'tira led', 'foco',
      'electrodomestico', 'electrodomesticos',
      'termotanque', 'calefon', 'calentador de agua',
      'extractor de cocina', 'campana de cocina',
      'plancha de ropa', 'aspiradora', 'purificador de agua', 'filtro de agua',
    ],
    clases: [11],
    descripcion: 'Electrodomésticos, iluminación y climatización',
  },
 
  // ── CLASE 12 — Vehículos ─────────────────────────────────────────────────────
  {
    palabras: [
      'auto', 'autos', 'automovil', 'automoviles', 'vehiculo', 'vehiculos',
      'camioneta', 'camionetas', 'camion', 'camiones',
      'moto', 'motos', 'motocicleta', 'motocicletas',
      'bicicleta electrica', 'bicicletas electricas', 'scooter electrico',
      'autobus', 'micro', 'minibus',
      'barco', 'lancha', 'embarcacion', 'embarcaciones',
      'avion', 'aeronave', 'drone de carga',
      'accesorio para autos', 'accesorios para autos',
      'repuesto automotor', 'repuestos automotores',
      'llanta', 'llantas', 'cubierta de auto', 'cubiertas de auto',
      'carroceria', 'autoparte', 'autopartes',
    ],
    clases: [12],
    descripcion: 'Vehículos y medios de transporte',
  },
 
  // ── CLASE 14 — Joyería ───────────────────────────────────────────────────────
  {
    palabras: [
      'joya', 'joyas', 'joyeria', 'bisuteria',
      'anillo', 'anillos', 'alianza', 'alianzas', 'sello',
      'collar de oro', 'collar de plata', 'collares de joyeria',
      'pulsera de oro', 'pulsera de plata', 'brazalete',
      'aro de oro', 'aro de plata', 'aros de joyeria',
      'pendiente', 'pendientes', 'arete', 'aretes',
      'colgante', 'colgantes', 'medalla de oro', 'medalla de plata',
      'dije', 'dijes', 'prendedor', 'broche de joyeria',
      'reloj de pulsera', 'relojes de pulsera', 'reloj de lujo',
      'joyeria de oro', 'joyeria de plata', 'joyeria de diamantes',
      'piedra preciosa', 'piedras preciosas', 'diamante', 'diamantes',
      'esmeralda', 'rubi', 'zafiro', 'perla', 'perlas',
    ],
    clases: [14],
    descripcion: 'Joyería, bisutería y relojería',
  },
 
  // ── CLASE 15 — Instrumentos musicales ───────────────────────────────────────
  {
    palabras: [
      'instrumento musical', 'instrumentos musicales',
      'guitarra', 'bajo electrico', 'piano', 'teclado musical',
      'bateria musical', 'violín', 'violin', 'viola', 'cello',
      'trompeta', 'saxofon', 'flauta', 'clarinete', 'oboe',
      'acordeon', 'bandoneón', 'bandoneon', 'arpa',
      'ukelele', 'mandolina', 'charango',
      'cuerdas para guitarra', 'baqueta', 'baquetas',
    ],
    clases: [15],
    descripcion: 'Instrumentos musicales',
  },
 
  // ── CLASE 16 — Papel, imprenta y embalajes ──────────────────────────────────
  {
    palabras: [
      'papel', 'papeles', 'carton', 'cartones',
      'libro', 'libros', 'revista', 'revistas', 'diario', 'periodico',
      'cuaderno', 'cuadernos', 'libreta', 'libretas', 'agenda de papel',
      'lapicera', 'lapiceras', 'birome', 'boligrafo', 'boligrafos',
      'lapiz', 'lapices', 'marcador', 'marcadores', 'fibron',
      'resma de papel', 'hoja de papel', 'papel de impresora',
      'material de oficina', 'articulo de papeleria',
      'papeleria', 'libreria de papeleria',
      'sticker', 'stickers', 'calcomanía', 'calcomania',
      'tarjeta de presentacion', 'tarjetas de presentacion',
      'folleto', 'folletos', 'catalogo', 'brochure',
      'poster', 'afiche', 'afiches', 'banner de papel',
      'impresion grafica', 'impresiones graficas', 'material impreso',
      'embalaje de papel', 'embalajes de papel', 'embalaje de carton',
      'caja de carton', 'cajas de carton',
      'bolsa de papel', 'bolsas de papel',
      'bolsa de plastico', 'bolsas de plastico',
      'sobre', 'sobres', 'sobre de papel', 'bolsita de regalo',
      'packaging de carton', 'packaging de papel',
      'etiqueta adhesiva', 'etiquetas adhesivas', 'etiqueta de papel',
      'carpeta', 'carpetas', 'archivador', 'archivadores',
    ],
    clases: [16],
    descripcion: 'Papel, publicaciones, papelería y embalajes de papel/cartón',
  },
 
  // ── CLASE 17 — Caucho y plásticos en bruto ──────────────────────────────────
  {
    palabras: [
      'caucho', 'goma en bruto', 'latex industrial',
      'plastico en bruto', 'polietileno', 'polipropileno', 'pvc industrial',
      'material aislante', 'materiales aislantes', 'aislante termico', 'aislante acustico',
      'manguera industrial', 'mangueras industriales',
      'sellador de goma', 'junta de goma', 'juntas de goma',
      'espuma de poliuretano', 'goma eva', 'silicona industrial',
    ],
    clases: [17],
    descripcion: 'Caucho, plásticos en bruto y materiales aislantes',
  },
 
  // ── CLASE 18 — Marroquinería y equipaje ─────────────────────────────────────
  {
    palabras: [
      'cartera de cuero', 'carteras de cuero', 'cartera de mujer', 'carteras de mujer',
      'bolso de cuero', 'bolsos de cuero', 'bolso de mano', 'bolso de hombro',
      'mochila de cuero', 'mochila de tela', 'mochila escolar',
      'maleta', 'maletas', 'valija', 'valijas', 'trolley', 'equipaje',
      'billetera de cuero', 'billetera', 'billeteras', 'portadocumentos',
      'monedero', 'monederos', 'riñonera', 'riñoneras',
      'maletin ejecutivo', 'maletin', 'porta laptop',
      'neceser de viaje', 'neceser', 'cosmetiquera',
      'marroquineria', 'articulo de marroquineria', 'articulos de marroquineria',
      'paraguas', 'sombrilla', 'sombrillas',
      'correa para bolso', 'correa de cuero',
    ],
    clases: [18],
    descripcion: 'Bolsos, carteras, marroquinería y equipaje',
  },
 
  // ── CLASE 19 — Materiales de construcción ───────────────────────────────────
  {
    palabras: [
      'material de construccion', 'materiales de construccion',
      'ladrillo', 'ladrillos', 'bloque de cemento', 'bloque de hormigon',
      'cemento', 'hormigon', 'mortero',
      'ceramica', 'ceramicas', 'porcelanato', 'porcelanatos', 'azulejo', 'azulejos',
      'vidrio de construccion', 'ventana de aluminio', 'ventanas de aluminio',
      'puerta de madera', 'puertas de madera',
      'madera para construccion', 'tablones de madera', 'viga de madera',
      'asfalto', 'baldosa', 'baldosas', 'piso ceramico', 'pisos ceramicos',
      'pintura de construccion', 'impermeabilizante',
      'piedra natural', 'marmol', 'granito',
    ],
    clases: [19],
    descripcion: 'Materiales de construcción no metálicos',
  },
 
  // ── CLASE 20 — Muebles y decoración ─────────────────────────────────────────
  {
    palabras: [
      'mueble', 'muebles', 'muebleria',
      'silla', 'sillas', 'sillon', 'sillones', 'sofa', 'sofas',
      'mesa de madera', 'mesas de madera', 'mesa de comedor', 'mesa de trabajo',
      'escritorio de madera', 'escritorio de oficina',
      'cama de madera', 'cama de plaza', 'sommier', 'colchon',
      'placard', 'placards', 'ropero', 'roperos',
      'estante de madera', 'estantes de madera', 'biblioteca de madera',
      'mesa de luz', 'mesas de luz', 'cocina de madera', 'mueble de cocina',
      'espejo decorativo', 'espejos decorativos', 'marco para cuadro',
      'marcos para cuadros', 'portarretrato', 'portarretratos',
      'perchero de madera', 'perchero de pie', 'perchero de pared',
      'decoracion', 'objeto decorativo', 'objetos decorativos', 'cuadro decorativo',
      'mueble de plastico', 'silla de plastico', 'mesa de plastico',
      'mueble de jardin', 'muebles de jardin',
    ],
    clases: [20],
    descripcion: 'Muebles, espejos y artículos de decoración',
  },
 
  // ── CLASE 21 — Utensilios de hogar ──────────────────────────────────────────
  {
    palabras: [
      'utensilio de cocina', 'utensilios de cocina', 'articulo de cocina',
      'sarten', 'sartenes', 'olla', 'ollas', 'cacerola', 'cacerolas',
      'vaso de vidrio', 'vasos de vidrio', 'taza de ceramica', 'tazas de ceramica',
      'plato de ceramica', 'platos de ceramica', 'plato hondo', 'plato playero',
      'cubierto', 'cubiertos', 'cuchillo de mesa', 'tenedor', 'cuchara de mesa',
      'licuadora', 'batidora de mano', 'procesadora', 'minipimer',
      'termo de cocina', 'termo stanley',
      'mate', 'bombilla para mate',
      'jarra de vidrio', 'jarra para agua',
      'fuente para horno', 'fuente de vidrio',
      'tabla de cortar', 'colador', 'rallador',
      'tupper', 'envase hermetico', 'frasco de vidrio',
      'vajilla', 'vajillas', 'juego de vajilla',
      'cristaleria', 'copa', 'copas',
      'porcelana de mesa', 'loza',
      'escoba', 'escobillon', 'pala de basura', 'lampaza', 'mopa',
      'cepillo de dientes', 'cepillos de dientes',
      'articulo de limpieza del hogar',
    ],
    clases: [21],
    descripcion: 'Utensilios de cocina, hogar y artículos de limpieza',
  },
 
  // ── CLASE 22 — Sogas y fibras ────────────────────────────────────────────────
  {
    palabras: [
      'soga', 'sogas', 'cuerda', 'cuerdas', 'hilo resistente', 'cable de acero',
      'red de pesca', 'redes de pesca', 'lona', 'lonas', 'lona de camion',
      'bolsa de arpillera', 'bolsa de yute', 'saco de yute',
      'fibra textil en bruto', 'fibra de algodon en bruto',
      'cordon', 'cordones', 'correa textil', 'cinta de carga',
    ],
    clases: [22],
    descripcion: 'Sogas, cuerdas, redes y fibras textiles en bruto',
  },
 
  // ── CLASE 23 — Hilos textiles ────────────────────────────────────────────────
  {
    palabras: [
      'hilo textil', 'hilos textiles', 'hilo de coser', 'hilos de coser',
      'hilo de tejer', 'lana para tejer', 'ovillo de lana', 'ovillos de lana',
      'hilo de algodon', 'hilo de seda', 'hilo de poliester',
      'hebra', 'hebras', 'hilado', 'hilados',
    ],
    clases: [23],
    descripcion: 'Hilos e hilados para uso textil',
  },
 
  // ── CLASE 24 — Tejidos y ropa de hogar ──────────────────────────────────────
  {
    palabras: [
      'tela', 'telas', 'tejido', 'tejidos', 'genero textil', 'generos textiles',
      'tela de algodon', 'tela de poliester', 'tela de seda', 'tela de lino',
      'ropa de cama', 'sabana', 'sabanas', 'funda de almohada',
      'almohada', 'almohadas', 'cobertor', 'colcha', 'edredon',
      'mantel', 'manteles', 'servilleta de tela', 'repasador',
      'toalla', 'toallas', 'accesorio de bano textil',
      'cortina de tela', 'cortinas de tela', 'visillo',
      'tapizado', 'tapizados', 'tela para tapizar',
    ],
    clases: [24],
    descripcion: 'Tejidos, ropa de cama y mantelería',
  },
 
  // ── CLASE 25 — Indumentaria y calzado ───────────────────────────────────────
  {
    palabras: [
      'ropa', 'indumentaria', 'vestimenta', 'prendas de vestir',
      'remera', 'remeras', 'camiseta', 'camisetas', 'polo', 'polera',
      'camisa', 'camisas', 'camisa de vestir',
      'pantalon', 'pantalones', 'jean', 'jeans', 'pantalon de jean',
      'bermuda', 'bermudas', 'short', 'shorts', 'short deportivo',
      'vestido', 'vestidos', 'vestido de noche', 'vestido de fiesta',
      'falda', 'faldas', 'pollera', 'polleras', 'minifalda',
      'zapatilla', 'zapatillas', 'zapatillas deportivas', 'zapatillas de cuero',
      'zapato', 'zapatos', 'zapato de taco', 'zapato de vestir',
      'bota', 'botas', 'botines', 'botineta', 'botas de cuero',
      'sandalia', 'sandalias', 'ojota', 'ojotas',
      'calzado', 'calzados', 'calzado deportivo', 'calzado de cuero',
      'ropa interior', 'lenceria', 'bombacha', 'bombachas',
      'calzoncillo', 'calzoncillos', 'boxers', 'boxer',
      'corpiño', 'corpino', 'sujetador', 'bralette',
      'media', 'medias', 'calcetines', 'medias de nylon',
      'campera', 'camperas', 'campera de cuero', 'campera de pluma',
      'buzo', 'buzos', 'hoodie', 'sudadera',
      'abrigo', 'abrigos', 'sobretodo', 'piloto', 'impermeable',
      'traje de hombre', 'trajes de hombre', 'traje sastre', 'blazer',
      'saco de vestir', 'sacos de vestir', 'chaqueta', 'chaquetas',
      'gorra', 'gorras', 'sombrero de tela', 'sombrero de paja',
      'gorro de lana', 'gorros de lana', 'boina', 'bincha',
      'bufanda', 'bufandas', 'pañuelo de cuello', 'pashmina',
      'guante', 'guantes', 'guantes de cuero',
      'cinturon', 'cinturones', 'cinturon de cuero',
      'pijama', 'pijamas', 'camisón', 'bata de casa',
      'ropa deportiva', 'ropa de gimnasio', 'conjunto deportivo',
      'legging', 'leggings', 'calza deportiva',
      'malla de bano', 'traje de bano', 'bikini', 'trikini', 'ropa de bano',
      'disfraz', 'disfraces',
      'ropa para bebe', 'ropa para niños', 'ropa infantil',
      'indumentaria de trabajo', 'ropa de trabajo', 'uniforme de trabajo',
      'delantal', 'mameluco', 'overol',
    ],
    clases: [25],
    descripcion: 'Indumentaria, calzado y accesorios de vestimenta',
  },
 
  // ── CLASE 26 — Mercería ──────────────────────────────────────────────────────
  {
    palabras: [
      'boton', 'botones', 'cierre', 'cierres', 'cremallera', 'velcro',
      'aguja de coser', 'agujas de coser', 'dedal', 'dedales',
      'encaje', 'encajes', 'puntilla', 'broderie', 'tul',
      'elastico', 'elasticos', 'goma elastica',
      'randa', 'cinta de tela', 'cintas de tela', 'vincha de tela',
      'aplique bordado', 'apliques bordados', 'lentejuela', 'lentejuelas',
      'accesorio para ropa', 'accesorios para costura', 'merceria',
      'clip para cabello', 'pinche', 'pinches',
    ],
    clases: [26],
    descripcion: 'Mercería: botones, cierres, encajes y accesorios de costura',
  },
 
  // ── CLASE 27 — Alfombras y revestimientos ────────────────────────────────────
  {
    palabras: [
      'alfombra', 'alfombras', 'tapete', 'tapetes', 'felpudo', 'felpudos',
      'carpet', 'carpets', 'alfombra de bano',
      'revestimiento de piso', 'revestimientos de piso',
      'piso de vinilo', 'pisos de vinilo', 'vinilo adhesivo',
      'papel tapiz', 'papel mural', 'revestimiento de pared',
      'estera', 'esteras', 'colchoneta de yoga',
    ],
    clases: [27],
    descripcion: 'Alfombras, tapetes y revestimientos de pisos y paredes',
  },
 
  // ── CLASE 28 — Juguetes y artículos deportivos ───────────────────────────────
  {
    palabras: [
      'juguete', 'juguetes', 'jugueteria',
      'muñeca', 'muñecas', 'muñeco de peluche', 'peluche', 'peluches',
      'auto de juguete', 'autos de juguete', 'auto a escala',
      'rompecabezas', 'puzzle', 'puzzles',
      'juego de mesa', 'juegos de mesa', 'ajedrez', 'dama', 'ludo',
      'naipes', 'cartas de juego', 'mazo de cartas',
      'juguete educativo', 'juguetes educativos',
      'pelota de futbol', 'pelota de basket', 'pelota de tenis',
      'pelota de juguete', 'pelota de goma',
      'raqueta de tenis', 'raqueta de padel', 'paleta de padel',
      'equipo deportivo', 'equipamiento deportivo',
      'bicicleta de gimnasio', 'cinta para correr', 'eliptica',
      'pesa', 'pesas', 'mancuerna', 'mancuernas', 'barra de pesas',
      'colchoneta de gimnasio', 'colchoneta de pilates',
      'guante de boxeo', 'guantes de boxeo', 'saco de boxeo',
      'patines en linea', 'patineta', 'skate', 'skateboard',
      'artículo de pesca', 'caña de pescar', 'anzuelo',
      'artículo de camping', 'carpa de camping',
      'juguete de playa', 'paleta de playa',
      'arco de futbol', 'red de voley',
      'articulos de deporte', 'deporte en general',
    ],
    clases: [28],
    descripcion: 'Juguetes, juegos y artículos deportivos',
  },
 
  // ── CLASE 29 — Alimentos cárnicos, lácteos y conservas ──────────────────────
  {
    palabras: [
      'carne', 'carnes', 'carne vacuna', 'carne de cerdo', 'carne de pollo',
      'pollo', 'pollos', 'pechuga de pollo', 'muslo de pollo',
      'pescado', 'pescados', 'mariscos', 'langostinos', 'camaron',
      'fiambre', 'fiambres', 'fiambreria',
      'jamon', 'jamon cocido', 'jamon crudo', 'jamón serrano',
      'salame', 'salami', 'mortadela', 'chorizo',
      'embutido', 'embutidos',
      'queso', 'quesos', 'queso cremoso', 'queso de bola', 'queso en hebras',
      'lacteo', 'lacteos', 'producto lacteo', 'productos lacteos',
      'leche', 'leche entera', 'leche descremada', 'leche chocolatada',
      'yogur', 'yogurt', 'yogur griego',
      'manteca', 'margarina', 'crema de leche', 'creme fraiche',
      'dulce de leche',
      'huevo', 'huevos', 'huevo de gallina',
      'conserva alimenticia', 'conservas alimenticias',
      'atun en lata', 'sardinas en lata', 'caballa en lata',
      'aceite de oliva', 'aceite de girasol', 'aceite vegetal',
      'fruto seco', 'frutos secos', 'mani pelado', 'almendra', 'nuez', 'castana',
      'mermelada', 'mermeladas', 'dulce de fruta',
      'alimento para perros', 'alimento para gatos', 'alimento para mascotas',
      'comida para perros', 'comida para gatos', 'pellet para mascotas',
      'alimento balanceado', 'comida balanceada',
    ],
    clases: [29],
    descripcion: 'Carnes, lácteos, conservas y alimentos para mascotas',
  },
 
  // ── CLASE 30 — Café, harinas, pastelería y condimentos ──────────────────────
  {
    palabras: [
      'cafe', 'cafe molido', 'cafe en grano', 'cafe instantaneo', 'cafe de capsulas',
      'te', 'te en saquito', 'te negro', 'te verde', 'te de hierbas', 'infusion',
      'cacao en polvo', 'cacao puro',
      'chocolate', 'chocolates', 'barra de chocolate', 'bombones', 'chocolate amargo',
      'galletita', 'galletitas', 'galleta', 'galletas', 'galletas de avena',
      'pan', 'panes', 'pan lactal', 'pan de molde', 'pan artesanal', 'baguette',
      'facturas de panaderia', 'medialuna', 'medialunas', 'croissant',
      'torta', 'tortas', 'bizcocho', 'bizcochuelo',
      'pasteleria', 'reposteria', 'producto de pasteleria',
      'alfajor', 'alfajores', 'barra de cereal', 'granola',
      'golosinas', 'caramelo', 'caramelos', 'chupetines', 'gomitas',
      'turron', 'tableta de chocolate',
      'chicle', 'chicles', 'goma de mascar',
      'helado', 'helados', 'paleta helada', 'helado artesanal',
      'yerba mate', 'yerba', 'mate cocido',
      'condimento', 'condimentos', 'sal de mesa', 'sal fina',
      'pimienta', 'oregano', 'paprika', 'especias', 'mezcla de especias',
      'azucar', 'azucar refinada', 'azucar mascabo', 'edulcorante',
      'harina', 'harinas', 'harina de trigo', 'harina integral',
      'arroz', 'arroz largo fino', 'arroz integral',
      'fideo', 'fideos', 'pasta', 'pastas', 'spaghetti', 'tallarines',
      'polenta', 'avena',
      'mayonesa', 'mostaza', 'ketchup', 'salsa de tomate', 'salsas',
      'vinagre', 'aceto', 'aderezo',
      'levadura', 'polvo de hornear',
      'cereal de desayuno', 'cereales de desayuno',
    ],
    clases: [30],
    descripcion: 'Café, té, harinas, pastelería, pastas, condimentos y golosinas',
  },
 
  // ── CLASE 31 — Productos agrícolas y animales ─────────────────────────────────
  {
    palabras: [
      'fruta', 'frutas', 'fruta fresca', 'manzana', 'naranja', 'banana', 'uva',
      'verdura', 'verduras', 'verdura fresca', 'hortaliza', 'hortalizas',
      'lechuga', 'tomate', 'zapallo', 'papa', 'cebolla', 'zanahoria',
      'planta de interior', 'plantas de interior', 'planta ornamental',
      'planta de jardin', 'plantas de jardin', 'planta en maceta',
      'flor cortada', 'flores cortadas', 'ramo de flores',
      'semilla', 'semillas', 'semilla de girasol', 'semilla de maíz',
      'fertilizante organico', 'compost', 'tierra fertil',
      'animal vivo', 'animales de granja',
      'alimento para aves de corral', 'alimento para ganado',
      'grano', 'granos', 'trigo en grano', 'maiz en grano', 'soja en grano',
    ],
    clases: [31],
    descripcion: 'Frutas, verduras, plantas, flores, semillas y animales vivos',
  },
 
  // ── CLASE 32 — Bebidas sin alcohol ──────────────────────────────────────────
  {
    palabras: [
      'agua mineral', 'agua con gas', 'agua sin gas', 'agua saborizada',
      'agua envasada',
      'gaseosa', 'gaseosas', 'cola', 'bebida gaseosa',
      'jugo de fruta', 'jugos de fruta', 'jugo natural', 'zumo',
      'jugo de naranja', 'jugo de manzana',
      'refresco', 'refrescos', 'bebida refrescante',
      'bebida isotonica', 'bebidas isotonicas', 'bebida deportiva',
      'bebida energizante', 'bebidas energizantes', 'energy drink',
      'limonada', 'limonadas', 'limonada natural',
      'te helado', 'infusion fria',
      'cerveza sin alcohol', 'cerveza artesanal', 'cerveza',
      'sidra', 'sidra sin alcohol',
      'soda', 'sifon',
      'jarabe para bebida', 'sirope', 'concentrado de fruta',
      'bebida de soja', 'leche de avena', 'leche vegetal',
    ],
    clases: [32],
    descripcion: 'Aguas, jugos, gaseosas, cervezas y bebidas sin alcohol',
  },
 
  // ── CLASE 33 — Bebidas alcohólicas ──────────────────────────────────────────
  {
    palabras: [
      'vino', 'vinos', 'vino tinto', 'vino blanco', 'vino rose', 'vino espumante',
      'espumante', 'champagne', 'cava', 'prosecco',
      'whisky', 'whiskey', 'scotch', 'bourbon',
      'vodka', 'gin', 'tequila', 'mezcal', 'ron', 'rhum',
      'fernet', 'campari', 'aperol',
      'aperitivo alcoholico', 'aperitivos alcoholicos',
      'licor', 'licores', 'licor de frutas',
      'cognac', 'coñac', 'brandy', 'grappa', 'marc',
      'pisco', 'singani',
      'cerveza alcoholica', 'cerveza con alcohol',
      'sidra alcoholica',
      'bebida alcoholica', 'bebidas alcoholicas', 'alcohol bebible',
      'destilado', 'destilados',
      'vermouth', 'amaro',
    ],
    clases: [33],
    descripcion: 'Bebidas alcohólicas (vinos, licores, espirituosas)',
  },
 
  // ── CLASE 34 — Tabaco ────────────────────────────────────────────────────────
  {
    palabras: [
      'tabaco', 'cigarrillo', 'cigarrillos', 'cigarro', 'cigarros', 'puro',
      'tabaco de pipa', 'pipa de fumar', 'encendedor', 'encendedores',
      'cenicero', 'papel de armar', 'filtro de cigarrillo',
      'vaporizador', 'cigarrillo electronico', 'vapeo', 'vape', 'pod de vapeo',
      'nicotina', 'parche de nicotina', 'liquido para vape',
      'producto para fumadores',
    ],
    clases: [34],
    descripcion: 'Tabaco, cigarrillos y artículos para fumadores',
  },
 
  // ── CLASE 35 — Publicidad y servicios comerciales ────────────────────────────
  {
    palabras: [
      'publicidad', 'agencia de publicidad', 'publicidad online',
      'marketing', 'marketing digital', 'estrategia de marketing',
      'redes sociales profesionales', 'community manager',
      'gestion comercial', 'administracion de empresas',
      'consultoria empresarial', 'consultoria de negocios',
      'tienda de ropa', 'tienda de calzado', 'tienda de electronica',
      'comercio minorista', 'comercio mayorista', 'venta al por menor', 'venta al por mayor',
      'supermercado', 'hipermercado', 'minimarket', 'almacen',
      'ferreteria', 'materiales de construccion venta',
      'importacion de productos', 'exportacion de productos',
      'distribucion de productos', 'distribuidor',
      'franquicia de negocios',
      'ecommerce', 'tienda online', 'comercio electronico',
      'marketplace', 'plataforma de ventas',
      'outlet', 'venta por catalogo', 'venta directa',
      'recursos humanos', 'seleccion de personal', 'headhunting',
      'contabilidad', 'servicios contables', 'estudio contable',
      'servicio de atencion al cliente',
      'representacion comercial',
    ],
    clases: [35],
    descripcion: 'Publicidad, marketing y servicios comerciales',
  },
 
  // ── CLASE 36 — Servicios financieros e inmobiliarios ─────────────────────────
  {
    palabras: [
      'banco', 'banco comercial', 'banco digital', 'banca online',
      'seguro de vida', 'seguro de auto', 'seguro de hogar', 'seguro medico',
      'aseguradora', 'compania de seguros',
      'prestamo personal', 'prestamo hipotecario', 'credito personal', 'microcredito',
      'tarjeta de credito', 'tarjeta de debito',
      'billetera virtual', 'billetera digital', 'fintech', 'neobank',
      'inversion financiera', 'fondo de inversion', 'broker financiero',
      'cambio de divisas', 'casa de cambio', 'cambio de moneda',
      'transferencia de dinero', 'giro de dinero', 'remesas',
      'inmobiliaria', 'inmobiliarias', 'agencia inmobiliaria',
      'alquiler de inmuebles', 'alquiler de departamentos', 'alquiler de oficinas',
      'venta de inmuebles', 'venta de propiedades',
      'administracion de consorcios', 'administracion de propiedades',
      'tasacion de propiedades', 'valuacion inmobiliaria',
      'ahorro y prestamo', 'cooperativa de credito',
      'bolsa de valores', 'mercado de capitales', 'acciones y bonos',
      'crowdfunding', 'financiamiento colectivo',
      'leasing', 'fideicomiso',
      'cobros y pagos digitales', 'procesador de pagos',
    ],
    clases: [36],
    descripcion: 'Servicios financieros, bancarios y de seguros e inmobiliarios',
  },
 
  // ── CLASE 37 — Construcción y reparación ─────────────────────────────────────
  {
    palabras: [
      'empresa constructora', 'construccion de casas', 'construccion de edificios',
      'obra civil', 'obras civiles',
      'reparacion del hogar', 'reformas del hogar', 'refaccion',
      'albanileria', 'albanil', 'plomeria', 'plomero',
      'electricista', 'instalacion electrica', 'instalaciones electricas',
      'gasfiteria', 'gasista', 'instalacion de gas',
      'pintor de casas', 'pintura de interiores', 'pintura de exteriores',
      'carpinteria de obra', 'carpintero', 'instalacion de pisos',
      'colocacion de pisos', 'colocacion de ceramicas',
      'cerrajeria', 'cerrajero', 'instalacion de cerraduras',
      'instalacion de alarmas', 'instalacion de camaras de seguridad',
      'servicio tecnico de electrodomesticos', 'reparacion de electrodomesticos',
      'reparacion de celulares', 'reparacion de computadoras',
      'servicio tecnico', 'mantenimiento de edificios',
      'instalacion de aires acondicionados', 'service de aires acondicionados',
    ],
    clases: [37],
    descripcion: 'Construcción, reparación e instalación',
  },
 
  // ── CLASE 38 — Telecomunicaciones ───────────────────────────────────────────
  {
    palabras: [
      'servicio de internet', 'proveedor de internet', 'isp',
      'telefonia movil', 'telefonia fija', 'operadora de telefonia',
      'servicio de streaming', 'plataforma de streaming', 'video streaming',
      'television por cable', 'television satelital', 'television por internet',
      'servicio de radio', 'radio online', 'podcast',
      'servicio de mensajeria', 'mensajeria instantanea', 'chat',
      'red social', 'plataforma de red social',
      'hosting web', 'servidor de datos', 'centro de datos',
      'servicio de videoconferencia', 'videollamadas',
      'telecomunicaciones', 'servicio de telecomunicaciones',
      'transmision de datos', 'transmision de voz',
    ],
    clases: [38],
    descripcion: 'Servicios de telecomunicaciones e internet',
  },
 
  // ── CLASE 39 — Transporte y logística ───────────────────────────────────────
  {
    palabras: [
      'transporte de cargas', 'transporte de mercaderias', 'logistica',
      'flete', 'fletes', 'empresa de fletes',
      'mudanza', 'mudanzas', 'empresa de mudanzas',
      'correo postal', 'servicio de correo', 'mensajeria postal',
      'courier', 'servicio de courier', 'envio de paquetes',
      'delivery', 'servicio de delivery', 'reparto a domicilio',
      'turismo', 'agencia de turismo', 'agencia de viajes',
      'excursiones', 'tour operador',
      'transporte de pasajeros', 'servicio de traslados',
      'taxi', 'remis', 'remises', 'servicio de remis',
      'rent a car', 'alquiler de autos', 'alquiler de vehiculos',
      'deposito y almacenaje', 'logistica de almacenamiento',
      'transporte aereo', 'carga aerea',
    ],
    clases: [39],
    descripcion: 'Transporte, logística, correo y turismo',
  },
 
  // ── CLASE 40 — Tratamiento de materiales ────────────────────────────────────
  {
    palabras: [
      'tratamiento de materiales', 'procesamiento de materiales',
      'impresion en tela', 'bordado industrial', 'estampado de ropa',
      'serigrafia', 'sublimacion de tela',
      'reciclaje de materiales', 'reciclado',
      'tratamiento de madera', 'aserradero',
      'curtiembre', 'tratamiento de cuero',
      'molienda', 'molineria',
      'tratamiento de residuos',
    ],
    clases: [40],
    descripcion: 'Servicios de tratamiento y procesamiento de materiales',
  },
 
  // ── CLASE 41 — Educación y entretenimiento ───────────────────────────────────
  {
    palabras: [
      'educacion', 'ensenanza', 'instituto educativo', 'escuela privada',
      'colegio privado', 'jardin de infantes', 'guarderia',
      'academia de idiomas', 'clases de ingles', 'clases de idiomas',
      'instituto de idiomas', 'escuela de idiomas',
      'capacitacion profesional', 'curso de capacitacion', 'cursos online',
      'formacion profesional', 'talleres de formacion',
      'universidad privada', 'posgrado', 'maestria', 'especializacion',
      'clases particulares', 'tutoria', 'tutoria online',
      'cine', 'sala de cine', 'produccion cinematografica',
      'teatro', 'sala de teatro', 'produccion teatral',
      'musica en vivo', 'show musical', 'recital', 'concierto',
      'evento artistico', 'evento cultural',
      'radio', 'programa de radio', 'produccion radial',
      'television', 'programa de television', 'produccion televisiva',
      'produccion audiovisual', 'produccion de video', 'realizacion audiovisual',
      'fotografia profesional', 'servicio fotografico',
      'gimnasio deportivo', 'club deportivo', 'academia deportiva',
      'clases de futbol', 'clases de natacion', 'clases de tenis',
      'clases de yoga', 'clases de pilates', 'clases de baile',
      'escuela de arte', 'escuela de disenio', 'escuela de musica',
      'clases de arte', 'clases de pintura', 'taller de arte',
      'entretenimiento', 'parque de diversiones', 'escape room',
      'editorial de libros', 'publicacion de libros',
    ],
    clases: [41],
    descripcion: 'Educación, capacitación, entretenimiento y deporte',
  },
 
  // ── CLASE 42 — Servicios tecnológicos ───────────────────────────────────────
  {
    palabras: [
      'desarrollo de software', 'desarrollo de aplicaciones', 'desarrollo de apps',
      'programacion de software', 'programacion web',
      'diseno web', 'desarrollo web', 'diseno de pagina web',
      'consultoria en informatica', 'consultoria tecnologica', 'consultoria en sistemas',
      'servicio de informatica', 'soporte informatico', 'soporte tecnico it',
      'inteligencia artificial', 'machine learning', 'automatizacion',
      'cloud computing', 'computacion en la nube', 'servicios en la nube',
      'saas', 'software como servicio', 'plataforma digital',
      'ciberseguridad', 'seguridad informatica', 'seguridad digital',
      'blockchain', 'nft', 'criptomonedas tecnologia',
      'diseno ux', 'diseno ui', 'experiencia de usuario',
      'investigacion cientifica', 'laboratorio de investigacion',
      'investigacion y desarrollo', 'i+d',
      'control de calidad', 'testing de software', 'qa testing',
      'analisis de datos', 'big data', 'data science',
      'startup tecnologica', 'incubadora tecnologica',
    ],
    clases: [42],
    descripcion: 'Desarrollo de software, servicios tecnológicos e informáticos',
  },
 
  // ── CLASE 43 — Restauración y alojamiento ───────────────────────────────────
  {
    palabras: [
      'restaurante', 'restaurant', 'restaurantes',
      'bar', 'pub', 'cantina', 'bodegon',
      'cafeteria', 'cafe bar', 'confiteria',
      'panaderia', 'panaderia y pasteleria', 'casa de pastas',
      'pizzeria', 'hamburgueseria', 'sandwicheria',
      'comida rapida', 'fast food', 'burgers',
      'servicio de catering', 'catering para eventos',
      'delivery de comida', 'comida para llevar', 'take away',
      'heladeria', 'yogureria', 'gelateria',
      'vinoteca con servicio de copas', 'bar de vinos', 'wine bar',
      'hotel', 'hoteleria', 'hostel', 'posada', 'boutique hotel',
      'apart hotel', 'alquiler de habitaciones', 'alquiler temporario',
      'cabana', 'cabanas', 'alquiler de cabanas',
      'casa de huespedes', 'bed and breakfast',
    ],
    clases: [43],
    descripcion: 'Restaurantes, bares, cafés y servicios de alojamiento',
  },
 
  // ── CLASE 44 — Servicios médicos y de belleza ────────────────────────────────
  {
    palabras: [
      'medico clinico', 'clinica medica', 'consultorio medico',
      'hospital privado', 'sanatorio', 'servicio medico',
      'odontologia', 'odontologo', 'clinica dental', 'dentista',
      'psicologia', 'psicologo', 'psicologa', 'psicoterapia',
      'psiquiatria', 'psiquiatra',
      'kinesiologia', 'kinesiologo', 'fisioterapia', 'rehabilitacion fisica',
      'fonoaudiologia', 'fonoaudiologo',
      'nutricionista', 'nutricion clinica',
      'cardiologia', 'dermatologo', 'dermatologia', 'oftalmologo',
      'ortopedia', 'traumatologia',
      'veterinaria', 'veterinario', 'clinica veterinaria',
      'grooming canino', 'peluqueria canina', 'estetica canina',
      'peluqueria', 'peluquero', 'salon de peluqueria',
      'barberia', 'barbero', 'salon de barberia',
      'spa', 'spa y wellness', 'centro de spa',
      'estetica', 'esteticista', 'salon de estetica', 'centro estetico',
      'masajes', 'masajista', 'terapia de masajes',
      'manicuria', 'pedicuria', 'nail art',
      'depilacion laser', 'depilacion definitiva',
      'medicina estetica', 'cirugia estetica',
      'acupuntura', 'medicina alternativa',
    ],
    clases: [44],
    descripcion: 'Servicios médicos, veterinarios y de higiene y belleza personal',
  },
 
  // ── CLASE 45 — Servicios jurídicos y de seguridad ────────────────────────────
  {
    palabras: [
      'estudio de abogados', 'abogado', 'abogados', 'buffet de abogados',
      'estudio juridico', 'asesoramiento juridico', 'consultoria juridica',
      'abogado laboral', 'abogado de familia', 'abogado penal',
      'escribania', 'escribano', 'notaria', 'notario',
      'registro de marcas', 'propiedad intelectual',
      'patentes y marcas',
      'mediacion', 'arbitraje juridico', 'conciliacion',
      'seguridad privada', 'empresa de seguridad', 'guardia de seguridad',
      'custodia de valores', 'escolta personal',
      'detective privado', 'investigacion privada',
      'servicio de vigilancia', 'vigilancia de propiedades',
      'agencia matrimonial', 'servicio de acompanante',
      'servicio funerario', 'funeraria', 'sepelio',
      'cementerio privado',
    ],
    clases: [45],
    descripcion: 'Servicios jurídicos, notariales y de seguridad',
  },
];
 
// ── Helpers ───────────────────────────────────────────────────────────────────
 
function quitarTildes(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '');
}
 
function tokenizar(texto: string): string[] {
  return quitarTildes(texto)
    .toLowerCase()
    .split(/[\s\-_,;]+/)
    .filter(w => w.length >= 2);
}
 
function clasificarTermino(termino: string): Array<{
  termino: string; clase: number; descripcionClase: string; queProtege: string; termDescription: string;
}> {
  const tNorm = quitarTildes(termino).toLowerCase().trim();
  const tTokens = tokenizar(termino);
  const resultados: Array<{ termino: string; clase: number; descripcionClase: string; queProtege: string; termDescription: string }> = [];
  const clasesEncontradas = new Set<number>();
 
  for (const entry of KEYWORDS) {
    const coincide = entry.palabras.some(p => {
      const pNorm = quitarTildes(p).toLowerCase().trim();
      const pTokens = tokenizar(p);
 
      // 1. Coincidencia exacta de frase completa
      if (tNorm === pNorm) return true;
 
      // 2. El término contiene la frase clave (mínimo 2 palabras en la clave)
      if (pTokens.length >= 2 && tNorm.includes(pNorm)) return true;
 
      // 3. La frase clave contiene el término (mínimo 2 palabras en el término)
      if (tTokens.length >= 2 && pNorm.includes(tNorm)) return true;
 
      // 4. Coincidencia por palabra individual (solo palabras de 5+ letras para evitar ruido)
      return tTokens.some(wt =>
        wt.length >= 5 && pTokens.some(wp => wp === wt)
      );
    });
 
    if (coincide) {
      for (const clase of entry.clases) {
        if (!clasesEncontradas.has(clase)) {
          clasesEncontradas.add(clase);
          resultados.push({
            termino,
            clase,
            descripcionClase: CLASES_NIZA[clase]?.titulo || `Clase ${clase}`,
            queProtege: CLASES_NIZA[clase]?.que_protege || '',
            termDescription: entry.descripcion,
          });
        }
      }
    }
  }
 
  return resultados;
}
 
// ── Rutas ─────────────────────────────────────────────────────────────────────
 
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
    queProtege: string;
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
          queProtege: r.queProtege,
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
 
router.get('/clases', authenticate, (_req: Request, res: Response) => {
  const clases = Object.entries(CLASES_NIZA).map(([num, info]) => ({
    clase: parseInt(num),
    titulo: info.titulo,
    que_protege: info.que_protege,
  }));
  return res.json({ clases });
});
 
export default router;
