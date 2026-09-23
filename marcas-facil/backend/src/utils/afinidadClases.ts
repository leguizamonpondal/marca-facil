/**
 * AFINIDAD ENTRE CLASES DE NIZA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Tabla revisada y aprobada por Honorio M. Leguizamón Pondal, Agente de la
 * Propiedad Industrial N° 1974, el 23/09/2026.
 *
 * ── Cómo se construyó ──────────────────────────────────────────────────────
 *
 * 1. Un borrador de 85 pares, armado sobre criterios de afinidad comercial.
 * 2. Revisión completa del matriculado, que aportó 57 pares nuevos, descartó
 *    6 y corrigió grados.
 * 3. Consolidación a 137 pares, y una segunda pasada sobre los 32 que tenían
 *    grados discrepantes entre hojas.
 * 4. Resolución de esas discrepancias tomando **el grado más alto**, con las
 *    excepciones que el matriculado indicó expresamente.
 *
 * El punto 4 merece explicación, porque la primera consolidación había
 * resuelto toda discrepancia hacia MEDIA y eso dejó al 83 % de la tabla en
 * un solo grado. Un grado que aplica a cuatro de cada cinco pares no
 * discrimina: equivale a volver al booleano que esta tabla vino a reemplazar.
 *
 * Tomar el grado más alto es además lo coherente con el principio rector:
 * ante la duda se incluye, porque un candidato de más se descarta en dos
 * segundos y uno de menos es un plazo de oposición perdido. El grado más alto
 * hace el filtro más permisivo, que es el lado seguro del error.
 *
 * ── Los dos usos ───────────────────────────────────────────────────────────
 *
 * **Vigilancia** — decidir qué publicaciones del Boletín vale la pena
 * comparar contra cada marca vigilada, sin cotejar 3.500 actas semanales
 * contra cada una.
 *
 * **Recomendación de clases** — sugerirle al cliente qué clases le conviene
 * cubrir. Acá el grado es la señal principal: permite decir "estas dos son
 * imprescindibles y estas cuatro convienen si vas a crecer" en vez de
 * enumerar quince con el mismo peso.
 *
 * ── Qué NO hace esta tabla ─────────────────────────────────────────────────
 *
 * No determina confundibilidad. Eso lo resuelve el matriculado en los
 * términos del Art. 3° b) de la Ley 22.362, mirando los signos y los
 * productos concretos. Un par ausente no es un par no confundible: es un par
 * que este filtro no propone.
 */

// ── Tipos ────────────────────────────────────────────────────────────────────

/**
 * - `alta`  — los productos o servicios conviven en el mismo punto de venta o
 *             se dirigen al mismo consumidor en la misma ocasión de compra.
 * - `media` — hay canales, públicos o usos que se superponen parcialmente.
 * - `baja`  — hay vínculo real pero acotado; depende del producto concreto
 *             más que de la clase.
 */
export type GradoAfinidad = 'alta' | 'media' | 'baja';

export interface ParAfinidad {
  a: number;
  b: number;
  grado: GradoAfinidad;
  fundamento: string;
  /** `usuario` = aportado o confirmado por el matriculado. */
  origen: 'usuario' | 'nomenclador' | 'propuesta';
  /**
   * `true` cuando el par sirve para **vigilar** pero no para **recomendar**.
   *
   * Son los casos donde la otra clase cubre un insumo o un servicio de
   * producción: el titular no los vende, así que sugerirle que los registre no
   * tiene sentido. Pero una marca nueva en esa clase sí puede ser confundible
   * con la suya, de modo que el par tiene que seguir proponiéndose en el
   * Boletín.
   *
   * Criterio del matriculado, 23/09/2026, sobre la clase 25: la mercería, los
   * tejidos, los artículos deportivos y los servicios de confección a medida
   * salen de la recomendación y se quedan en la vigilancia.
   *
   * ⚠️ Por ahora solo están marcados los pares de la clase 25 que él revisó.
   *    El criterio seguramente alcanza a otros —los servicios de tratamiento
   *    de materiales (40) frente a cualquier producto, los hilos frente a los
   *    tejidos— pero eso lo define él, no yo.
   */
  soloVigilancia?: boolean;
}

// ── La tabla ─────────────────────────────────────────────────────────────────

/**
 * 130 pares entre clases 1–34 y 36–45. Cada uno figura una sola vez, con la
 * clase menor en `a`.
 *
 * ⚠️ **La clase 35 no está acá.** Sus afinidades están en
 *    `AFINIDAD_35_NO_VENTA`, y la parte de venta se resuelve leyendo el campo
 *    (57). Ver la sección de la clase 35 más abajo.
 */
export const PARES_AFINIDAD: ParAfinidad[] = [

  // ═══ QUÍMICA, PINTURAS Y PLÁSTICOS ═══
  { a: 1, b: 2, grado: 'media', origen: 'propuesta',
    fundamento: 'Productos químicos con pinturas y materias tintóreas. Los productos químicos industriales son insumos de pinturas, tintas y colorantes; comparten canal industrial y usuarios profesionales.' },
  { a: 1, b: 4, grado: 'media', origen: 'propuesta',
    fundamento: 'Aceites y grasas industriales con productos químicos. Productos químicos y aditivos industriales frente a aceites, lubricantes y combustibles: mismo canal industrial y usuarios técnicos.' },
  { a: 1, b: 5, grado: 'media', origen: 'propuesta',
    fundamento: 'Productos químicos con farmacéuticos y veterinarios. Se cruzan en agroquímicos y principios activos. Fertilizantes y agroquímicos (1) se comercializan junto con pesticidas, fungicidas y herbicidas (5) en el canal agropecuario; también productos químicos frente a desinfectantes.' },
  { a: 1, b: 17, grado: 'media', origen: 'nomenclador',
    fundamento: 'Materias plásticas en bruto con plásticos semielaborados. Distinto grado de elaboración de lo mismo. Resinas artificiales y materias plásticas en bruto (1) frente a las mismas materias en estado semielaborado (17): cadena productiva común.' },
  { a: 1, b: 31, grado: 'media', origen: 'propuesta',
    fundamento: 'Abonos y químicos agrícolas con semillas y productos del agro. Mismo cliente rural. Abonos y fertilizantes (1) son complementarios de semillas, plantas y productos agrícolas (31); mismo canal y mismo destinatario (productor agropecuario).' },
  { a: 1, b: 40, grado: 'baja', origen: 'propuesta',
    fundamento: 'Tratamiento de materiales con productos químicos. Vínculo de servicio a insumo.' },
  { a: 1, b: 42, grado: 'media', origen: 'usuario',
    fundamento: 'Productos químicos frente a servicios de análisis, investigación y control de calidad químicos.' },
  { a: 1, b: 44, grado: 'media', origen: 'usuario',
    fundamento: 'Fertilizantes frente a servicios agrícolas y hortícolas (44), que los utilizan y a veces los proveen.' },
  { a: 2, b: 16, grado: 'media', origen: 'usuario',
    fundamento: 'Pinturas y tintas (2) frente a material de artistas, pinceles y papelería (16): mismo canal (librerías artísticas, papeleras) y uso complementario.' },
  { a: 2, b: 19, grado: 'media', origen: 'propuesta',
    fundamento: 'Pinturas y barnices con materiales de construcción. Misma pinturería y corralón. Pinturas, barnices y revestimientos frente a materiales de construcción no metálicos: mismo canal (pinturerías, corralones) y destinatario.' },
  { a: 2, b: 37, grado: 'alta', origen: 'usuario',
    fundamento: 'Pinturas y barnices frente a servicios de pintura, revestimiento y reparación de edificios (37): complementariedad directa.' },
  { a: 4, b: 40, grado: 'media', origen: 'usuario',
    fundamento: 'Combustibles frente a servicios de generación de energía (40).' },
  { a: 6, b: 40, grado: 'media', origen: 'usuario',
    fundamento: 'Metales frente a servicios de tratamiento de metales (40).' },
  { a: 16, b: 17, grado: 'media', origen: 'usuario',
    fundamento: 'Bolsas y películas plásticas para embalaje (16) frente a materias plásticas semielaboradas (17).' },
  { a: 16, b: 40, grado: 'media', origen: 'usuario',
    fundamento: 'Impresos frente a servicios de impresión (40).' },
  { a: 17, b: 19, grado: 'media', origen: 'propuesta',
    fundamento: 'Materias plásticas semielaboradas y aislantes con materiales de construcción. Materiales aislantes (17) frente a materiales de construcción (19): obra común.' },
  { a: 17, b: 37, grado: 'media', origen: 'usuario',
    fundamento: 'Materiales aislantes frente a servicios de aislamiento de edificios (37).' },
  { a: 24, b: 40, grado: 'baja', origen: 'propuesta',
    fundamento: 'Tratamiento de materiales con textiles. Teñido y acabado de telas.' },
  { a: 25, b: 40, grado: 'media', origen: 'usuario',
    fundamento: 'Prendas de vestir frente a servicios de confección a medida y sastrería (40).',
    soloVigilancia: true },
  { a: 29, b: 40, grado: 'media', origen: 'usuario',
    fundamento: 'Alimentos frente a servicios de conservación y procesamiento de alimentos por encargo (40).' },

  // ═══ ALIMENTOS, BEBIDAS Y RESTAURACIÓN ═══
  { a: 5, b: 31, grado: 'media', origen: 'usuario',
    fundamento: 'Productos veterinarios y pesticidas (5) frente a alimentos para animales, animales vivos y plantas (31): canal agroveterinario común.' },
  { a: 5, b: 32, grado: 'media', origen: 'propuesta',
    fundamento: 'Bebidas dietéticas y suplementos líquidos con bebidas sin alcohol. Bebidas dietéticas para uso médico y suplementos (5) frente a bebidas isotónicas, energizantes y sin alcohol (32).' },
  { a: 26, b: 31, grado: 'media', origen: 'usuario',
    fundamento: 'Flores artificiales (26) frente a flores y plantas naturales (31).' },
  { a: 29, b: 30, grado: 'alta', origen: 'usuario',
    fundamento: 'La división entre ambas es de nomenclatura, no comercial: un mismo fabricante de alimentos cubre las dos, y conviven en la misma góndola. Alimentos procesados de ambas clases: mismo canal (supermercados), mismos consumidores.' },
  { a: 29, b: 31, grado: 'alta', origen: 'nomenclador',
    fundamento: 'Alimentos procesados con productos agrícolas frescos. El mismo producto cambia de clase según esté fresco o elaborado. Frutas, verduras, carnes y pescados procesados (29) frente a sus equivalentes frescos o vivos (31).' },
  { a: 29, b: 32, grado: 'media', origen: 'propuesta',
    fundamento: 'Alimentos con jugos de fruta y bebidas sin alcohol. Comparten fabricantes y góndola. Bebidas lácteas (29) frente a bebidas sin alcohol y jugos (32).' },
  { a: 29, b: 43, grado: 'alta', origen: 'propuesta',
    fundamento: 'Restauración con alimentos elaborados. Ídem: el local vende bajo su marca lo que la 29 protege como producto.' },
  { a: 30, b: 31, grado: 'alta', origen: 'nomenclador',
    fundamento: 'Harinas, cereales y confituras con granos y productos agrícolas sin procesar. Misma cadena, distinto grado de elaboración. Harinas y preparaciones de cereales (30) frente a granos sin procesar (31).' },
  { a: 30, b: 32, grado: 'media', origen: 'propuesta',
    fundamento: 'Café, té e infusiones con bebidas sin alcohol. La frontera entre un té listo para beber y una infusión es de presentación. Bebidas a base de café, té y cacao (30) frente a bebidas sin alcohol (32): p. ej., tés helados listos para beber frente a gaseosas.' },
  { a: 30, b: 43, grado: 'alta', origen: 'propuesta',
    fundamento: 'Servicios de restauración con los alimentos que sirven. Una marca de cafetería y una de café son confundibles de frente. Café, pastelería y helados frente a cafeterías, heladerías y restaurantes (43).' },
  { a: 31, b: 32, grado: 'media', origen: 'usuario',
    fundamento: 'Malta (31) frente a cervezas (32).' },
  { a: 31, b: 44, grado: 'media', origen: 'propuesta',
    fundamento: 'Animales vivos, semillas y plantas con servicios veterinarios y de jardinería. Productos agrícolas, plantas y animales vivos frente a servicios agrícolas, hortícolas, de jardinería y veterinarios (44).' },
  { a: 32, b: 33, grado: 'alta', origen: 'nomenclador',
    fundamento: 'La 32 cubre la cerveza y las bebidas sin alcohol; la 33 el resto de las alcohólicas. Misma góndola, mismo consumidor, cervecerías que producen ambas. Cervezas y bebidas sin alcohol (32) frente a otras bebidas alcohólicas (33): mismo canal (vinotecas, supermercados, bares) y consumo conjunto.' },
  { a: 32, b: 43, grado: 'alta', origen: 'propuesta',
    fundamento: 'Restauración con bebidas sin alcohol. Bebidas frente a bares y servicios de restauración (43).' },
  { a: 33, b: 34, grado: 'media', origen: 'usuario',
    fundamento: 'Bebidas alcohólicas frente a tabaco: canal de kioscos, bares y tiendas libres de impuestos.' },
  { a: 33, b: 43, grado: 'alta', origen: 'propuesta',
    fundamento: 'Restauración con bebidas alcohólicas. Bares y vinotecas que etiquetan producto propio. Bebidas alcohólicas frente a bares, vinotecas con servicio y restaurantes (43).' },
  { a: 36, b: 43, grado: 'media', origen: 'usuario',
    fundamento: 'Alquiler de inmuebles (36) frente a hospedaje temporal (43): la línea divisoria depende de la duración y modalidad del alojamiento.' },
  { a: 39, b: 43, grado: 'alta', origen: 'propuesta',
    fundamento: 'Organización de viajes con servicios de hospedaje. Agencias y cadenas hoteleras bajo la misma marca. Organización de viajes y transporte (39) frente a hospedaje temporal (43): servicios turísticos complementarios.' },
  { a: 41, b: 43, grado: 'media', origen: 'propuesta',
    fundamento: 'Esparcimiento con restauración y hospedaje. Salones de eventos, resorts. Organización de fiestas y eventos (41) frente a banquetes y catering (43).' },
  { a: 43, b: 44, grado: 'baja', origen: 'propuesta',
    fundamento: 'Servicios de salud con hospedaje. Spas, clínicas con internación.' },

  // ═══ SALUD, HIGIENE Y BELLEZA ═══
  { a: 3, b: 4, grado: 'media', origen: 'propuesta',
    fundamento: 'Cosmética con velas y ceras. Se cruzan en aromatización del hogar y velas perfumadas. Perfumería, incienso y aromatizantes (3) frente a velas perfumadas (4): productos de ambientación comercializados juntos.' },
  { a: 3, b: 5, grado: 'alta', origen: 'propuesta',
    fundamento: 'Cosmética con productos farmacéuticos e higiénicos. Frontera difusa en dermocosmética; conviven en farmacia. Cosméticos frente a productos farmacéuticos, dermocosméticos e higiénicos: mismo canal (farmacias, perfumerías), mismo consumidor; aceites esenciales repartidos entre 3 y 5 según destino (NCL 13-2026).' },
  { a: 3, b: 8, grado: 'media', origen: 'usuario',
    fundamento: 'Maquinillas de afeitar, pinzas, alicates y limas de uñas (8) son complementarios de productos de afeitado y manicura (3).' },
  { a: 3, b: 21, grado: 'media', origen: 'propuesta',
    fundamento: 'Cosmética y jabones con utensilios de tocador, esponjas y cepillos. Misma góndola de higiene personal. Cepillos, peines, esponjas y cepillos de dientes (21) son complementarios de cosméticos y dentífricos (3); mismo canal. Desde NCL 13-2026 los raspadores de lengua se ubican en la clase 21.' },
  { a: 3, b: 25, grado: 'alta', origen: 'usuario',
    fundamento: 'Indumentaria con perfumería y cosmética. Las casas de moda extienden su marca a fragancias de forma sistemática; el consumidor atribuye el mismo origen.' },
  { a: 3, b: 44, grado: 'alta', origen: 'propuesta',
    fundamento: 'Cosmética con servicios de belleza. El salón vende producto con su marca y el fabricante presta el servicio.' },
  { a: 5, b: 10, grado: 'alta', origen: 'propuesta',
    fundamento: 'Farmacéuticos con aparatos e instrumental médico. Mismo canal, mismo prescriptor. Productos farmacéuticos y dispositivos médicos: mismo canal (farmacias, ortopedias, droguerías), mismo prescriptor y usuario sanitario.' },
  { a: 5, b: 44, grado: 'alta', origen: 'propuesta',
    fundamento: 'Farmacéuticos con servicios médicos y veterinarios. Productos farmacéuticos y veterinarios frente a servicios médicos, veterinarios y de farmacia: complementariedad directa.' },
  { a: 9, b: 10, grado: 'alta', origen: 'usuario',
    fundamento: 'Desde NCL 13-2026 los anteojos y lentes pasaron a la clase 10, pero las gafas inteligentes e instrumentos ópticos siguen en la 9; además, aparatos de medición frente a aparatos médicos de diagnóstico.' },
  { a: 10, b: 14, grado: 'media', origen: 'usuario',
    fundamento: 'Anteojos de sol (10 desde NCL 13-2026) como accesorios de moda frente a joyería y relojería (14).' },
  { a: 10, b: 25, grado: 'media', origen: 'usuario',
    fundamento: 'Calzado y prendas ortopédicas o de compresión (10) frente a calzado y prendas (25); anteojos de sol como accesorio de moda.' },
  { a: 10, b: 28, grado: 'alta', origen: 'usuario',
    fundamento: 'Aparatos de rehabilitación y fisioterapia (10) frente a aparatos de gimnasia (28).' },
  { a: 10, b: 44, grado: 'alta', origen: 'propuesta',
    fundamento: 'Instrumental médico con servicios médicos.' },
  { a: 41, b: 44, grado: 'media', origen: 'propuesta',
    fundamento: 'Actividades deportivas y formación con servicios de salud y bienestar. Gimnasios, centros de rehabilitación. Gimnasios y entrenamiento físico (41) frente a spa, sauna y tratamientos de bienestar (44).' },
  { a: 42, b: 44, grado: 'media', origen: 'usuario',
    fundamento: 'Investigación médica y científica (42) frente a servicios médicos y análisis clínicos (44).' },

  // ═══ INDUMENTARIA, TEXTILES Y ACCESORIOS ═══
  { a: 6, b: 22, grado: 'media', origen: 'usuario',
    fundamento: 'Cables e hilos metálicos no eléctricos (6) frente a cuerdas y cordeles (22): finalidad similar, material distinto. Cables e hilos metálicos no eléctricos (6) frente a cuerdas y cordeles (22): finalidad similar, material distinto' },
  { a: 9, b: 14, grado: 'media', origen: 'propuesta',
    fundamento: 'Dispositivos vestibles con relojería. El reloj inteligente ocupa la clase 9 y el reloj clase 14. Relojes inteligentes (9) frente a relojes tradicionales (14): misma finalidad, mismo canal y marcas relojeras con ambas líneas.' },
  { a: 9, b: 18, grado: 'media', origen: 'usuario',
    fundamento: 'Fundas y bolsos para computadoras portátiles (9) frente a bolsos y equipaje (18).' },
  { a: 9, b: 25, grado: 'media', origen: 'usuario',
    fundamento: 'Ropa y calzado de protección contra accidentes (9) frente a prendas y calzado comunes (25)' },
  { a: 12, b: 22, grado: 'media', origen: 'usuario',
    fundamento: 'Velas de navegación (22) frente a embarcaciones (12).' },
  { a: 14, b: 18, grado: 'media', origen: 'propuesta',
    fundamento: 'Marroquinería con joyería y relojería. Accesorios personales de gama comparable en el mismo comercio.' },
  { a: 14, b: 25, grado: 'media', origen: 'propuesta',
    fundamento: 'Indumentaria con joyería, bijouterie y relojería. Accesorios de uso personal, misma lógica de extensión de marca de moda.' },
  { a: 14, b: 26, grado: 'media', origen: 'usuario',
    fundamento: 'Bisutería (14) frente a adornos para el cabello, broches y artículos de mercería decorativa (26): mismo canal y consumidor.' },
  { a: 16, b: 24, grado: 'media', origen: 'usuario',
    fundamento: 'Manteles y servilletas de papel (16) frente a mantelería textil (24).' },
  { a: 18, b: 25, grado: 'alta', origen: 'usuario',
    fundamento: 'Indumentaria y calzado con marroquinería, bolsos y carteras. Misma vidriera, mismo consumidor, marcas que habitualmente cubren ambos rubros. Bolsos, carteras y marroquinería frente a prendas y calzado: mismo canal, mismos fabricantes y marcas de moda; relación muy frecuente.' },
  { a: 18, b: 28, grado: 'media', origen: 'usuario',
    fundamento: 'Bolsos y equipaje (18) frente a bolsas adaptadas para equipamiento deportivo (28).' },
  { a: 19, b: 27, grado: 'media', origen: 'propuesta',
    fundamento: 'Revestimientos de construcción con pisos y alfombras.' },
  { a: 20, b: 24, grado: 'media', origen: 'propuesta',
    fundamento: 'Mobiliario con textiles del hogar. Colchones y almohadas (20) frente a ropa de cama y mantas (24): complementarios, mismo canal (blanquerías, casas de colchones).' },
  { a: 21, b: 24, grado: 'media', origen: 'propuesta',
    fundamento: 'Menaje con textiles del hogar. Mantelería y bazar en el mismo comercio. Vajilla frente a mantelería y ropa de mesa (24): artículos de mesa vendidos juntos.' },
  { a: 22, b: 23, grado: 'media', origen: 'nomenclador',
    fundamento: 'Cuerdas y fibras textiles con hilos. Frontera de nomenclatura dentro de la misma industria. Fibras textiles en bruto (22) frente a hilos (23): cadena productiva textil.' },
  { a: 22, b: 28, grado: 'media', origen: 'usuario',
    fundamento: 'Tiendas de campaña (22) frente a artículos de camping y deporte (28).' },
  { a: 23, b: 24, grado: 'alta', origen: 'nomenclador',
    fundamento: 'Hilos con tejidos. La 23 es el insumo directo de la 24.' },
  { a: 23, b: 26, grado: 'media', origen: 'nomenclador',
    fundamento: 'Hilos con mercería. Comparten góndola y consumidor. Hilos (23) frente a mercería: encajes, cintas, agujas y alfileres (26): mismo canal (mercerías).' },
  { a: 24, b: 25, grado: 'media', origen: 'propuesta',
    fundamento: 'Indumentaria con tejidos y textiles. Insumo y producto terminado; fabricantes textiles que comercializan prendas con la misma marca.',
    soloVigilancia: true },
  { a: 24, b: 26, grado: 'media', origen: 'propuesta',
    fundamento: 'Tejidos con mercería. Insumos textiles del mismo circuito.' },
  { a: 24, b: 27, grado: 'media', origen: 'propuesta',
    fundamento: 'Ropa de cama y tejidos con alfombras y revestimientos. Textiles para el hogar en el mismo punto de venta. Tapices murales textiles (24) frente a tapices murales no textiles (27).' },
  { a: 25, b: 26, grado: 'alta', origen: 'propuesta',
    fundamento: 'Indumentaria con mercería, botones, cintas y encajes. Insumos del mismo producto terminado, vendidos con frecuencia bajo la misma marca.',
    soloVigilancia: true },
  { a: 25, b: 28, grado: 'media', origen: 'propuesta',
    fundamento: 'Artículos deportivos con indumentaria deportiva. Las marcas del rubro cubren las dos como regla.',
    soloVigilancia: true },

  // ═══ CONSTRUCCIÓN, HOGAR Y MOBILIARIO ═══
  { a: 6, b: 8, grado: 'alta', origen: 'usuario',
    fundamento: 'Pequeños artículos de ferretería metálicos (6) y herramientas de mano (8): mismo canal (ferreterías), mismo usuario. Pequeños artículos de ferretería metálicos (6) y herramientas de mano (8): mismo canal (ferreterías), mismo usuario' },
  { a: 6, b: 19, grado: 'alta', origen: 'nomenclador',
    fundamento: 'Materiales de construcción metálicos y no metálicos. Misma función, distinta materia; corralón común. Materiales de construcción metálicos frente a no metálicos: la división es solo por material; misma finalidad, canal y usuario.' },
  { a: 6, b: 20, grado: 'alta', origen: 'usuario',
    fundamento: 'Contenedores metálicos (6) frente a no metálicos (20); ciertos herrajes y cerraduras se reparten entre ambas clases según el material; los muebles metálicos están en la 20.' },
  { a: 6, b: 37, grado: 'media', origen: 'propuesta',
    fundamento: 'Materiales metálicos con servicios de construcción. Materiales de construcción metálicos frente a servicios de construcción e instalación.' },
  { a: 7, b: 11, grado: 'alta', origen: 'usuario',
    fundamento: 'Electrodomésticos: lavarropas y lavavajillas (7) frente a heladeras, cocinas, hornos y aire acondicionado (11); mismos fabricantes y canal.' },
  { a: 7, b: 21, grado: 'media', origen: 'usuario',
    fundamento: 'Aparatos eléctricos de cocina como batidoras y procesadoras (7) frente a utensilios manuales de cocina (21): finalidad idéntica.' },
  { a: 7, b: 37, grado: 'alta', origen: 'propuesta',
    fundamento: 'Maquinaria con servicios de reparación y mantenimiento. Máquinas frente a servicios de instalación, mantenimiento y reparación de maquinaria (37).' },
  { a: 8, b: 11, grado: 'alta', origen: 'usuario',
    fundamento: 'Planchas y rizadores eléctricos para el cabello (8) frente a secadores de cabello (11): mismos fabricantes, canal y consumidor.' },
  { a: 8, b: 21, grado: 'media', origen: 'usuario',
    fundamento: 'Cubiertos (8) frente a vajilla y utensilios de cocina (21): productos complementarios vendidos juntos en bazares.' },
  { a: 9, b: 11, grado: 'alta', origen: 'usuario',
    fundamento: 'Aparatos eléctricos de control y domótica (9) frente a aparatos de iluminación y climatización (11).' },
  { a: 9, b: 37, grado: 'media', origen: 'usuario',
    fundamento: 'Equipos electrónicos e informáticos frente a su instalación y reparación (37).' },
  { a: 11, b: 12, grado: 'media', origen: 'usuario',
    fundamento: 'Luces y faros para vehículos (11) frente a vehículos (12).' },
  { a: 11, b: 19, grado: 'media', origen: 'usuario',
    fundamento: 'Instalaciones sanitarias (11) frente a revestimientos y materiales de construcción (19): proyectos de baño y cocina.' },
  { a: 11, b: 20, grado: 'media', origen: 'propuesta',
    fundamento: 'Artefactos de iluminación y sanitarios con mobiliario. Mismo comercio de equipamiento del hogar.' },
  { a: 11, b: 21, grado: 'media', origen: 'propuesta',
    fundamento: 'Aparatos de cocción con utensilios de cocina. Aparatos eléctricos de cocción (pavas y cafeteras eléctricas, 11) frente a utensilios y recipientes de cocina (21).' },
  { a: 11, b: 37, grado: 'alta', origen: 'propuesta',
    fundamento: 'Aparatos de calefacción, sanitarios y climatización con servicios de instalación y reparación. Aparatos de calefacción, climatización y sanitarios frente a su instalación y reparación (37).' },
  { a: 12, b: 37, grado: 'alta', origen: 'propuesta',
    fundamento: 'Vehículos con servicios de reparación y mantenimiento. Concesionaria y taller bajo una misma marca. Vehículos frente a servicios de mantenimiento y reparación de vehículos (37).' },
  { a: 15, b: 37, grado: 'media', origen: 'usuario',
    fundamento: 'Instrumentos musicales frente a servicios de afinación y reparación (37).' },
  { a: 19, b: 21, grado: 'media', origen: 'usuario',
    fundamento: 'Vidrio de construcción (19) frente a vidrio en bruto o semielaborado para otros usos (21).' },
  { a: 19, b: 37, grado: 'alta', origen: 'propuesta',
    fundamento: 'Materiales de construcción con servicios de construcción e instalación. La constructora que vende su material con la misma marca. Materiales de construcción frente a servicios de construcción (37).' },
  { a: 20, b: 21, grado: 'alta', origen: 'propuesta',
    fundamento: 'Muebles con menaje y bazar. Misma tienda de decoración, misma marca. Contenedores y artículos de hogar no metálicos (20) frente a recipientes domésticos (21): canal de bazar y hogar.' },
  { a: 20, b: 45, grado: 'media', origen: 'usuario',
    fundamento: 'Ataúdes (20) frente a servicios funerarios (45).' },
  { a: 36, b: 37, grado: 'media', origen: 'propuesta',
    fundamento: 'Servicios inmobiliarios con construcción. La desarrolladora que construye y comercializa. Negocios inmobiliarios (36) frente a servicios de construcción (37): desarrollos inmobiliarios.' },
  { a: 37, b: 42, grado: 'media', origen: 'usuario',
    fundamento: 'Servicios de construcción (37) frente a arquitectura, ingeniería y diseño (42): complementarios en toda obra.' },

  // ═══ MÁQUINAS, VEHÍCULOS Y TRANSPORTE ═══
  { a: 4, b: 7, grado: 'media', origen: 'usuario',
    fundamento: 'Lubricantes y aceites industriales frente a máquinas y motores que los requieren: complementariedad.' },
  { a: 4, b: 12, grado: 'media', origen: 'propuesta',
    fundamento: 'Vehículos con lubricantes y combustibles.' },
  { a: 4, b: 34, grado: 'baja', origen: 'propuesta',
    fundamento: 'Artículos para fumadores con encendedores y combustibles.' },
  { a: 7, b: 8, grado: 'alta', origen: 'nomenclador',
    fundamento: 'Máquinas y herramientas mecánicas con herramientas de accionamiento manual. La misma herramienta cambia de clase según sea eléctrica o manual. Herramientas mecánicas y eléctricas (7) frente a herramientas manuales (8): competidoras, mismo canal (ferreterías) y mismo usuario.' },
  { a: 7, b: 9, grado: 'media', origen: 'usuario',
    fundamento: 'Máquinas y robots industriales (7) frente a aparatos de control, regulación y software (9) que los gobiernan.' },
  { a: 7, b: 12, grado: 'media', origen: 'propuesta',
    fundamento: 'Máquinas y motores con vehículos. Motores, piezas y órganos de transmisión (7) frente a vehículos y sus motores (12): mismo sector (autopartes).' },
  { a: 8, b: 13, grado: 'media', origen: 'usuario',
    fundamento: 'Armas blancas (8) frente a armas de fuego (13): canal de armerías y artículos de caza.' },
  { a: 9, b: 12, grado: 'alta', origen: 'usuario',
    fundamento: 'Sistemas de navegación, electrónica y baterías (9) frente a vehículos (12); desde NCL 13-2026 los vehículos de rescate pasaron de la 9 a la 12.' },
  { a: 12, b: 28, grado: 'media', origen: 'usuario',
    fundamento: 'Bicicletas (12) frente a artículos deportivos (28): mismo canal y consumidor deportivo; también vehículos de juguete.' },
  { a: 12, b: 39, grado: 'media', origen: 'propuesta',
    fundamento: 'Vehículos con servicios de transporte y alquiler de vehículos. Vehículos frente a transporte y alquiler de vehículos (39).' },
  { a: 39, b: 41, grado: 'media', origen: 'propuesta',
    fundamento: 'Organización de viajes con esparcimiento y turismo.' },

  // ═══ TECNOLOGÍA Y COMUNICACIONES ═══
  { a: 9, b: 15, grado: 'media', origen: 'propuesta',
    fundamento: 'Instrumentos musicales con equipos de audio y grabación. Amplificadores, auriculares y software musical (9) frente a instrumentos musicales, incluidos los electrónicos (15).' },
  { a: 9, b: 16, grado: 'media', origen: 'propuesta',
    fundamento: 'Publicaciones impresas con publicaciones electrónicas. El mismo contenido en distinto soporte. Publicaciones electrónicas descargables (9) frente a publicaciones impresas (16): mismo contenido en distinto soporte.' },
  { a: 9, b: 28, grado: 'media', origen: 'propuesta',
    fundamento: 'Aparatos y programas de videojuego con juegos y juguetes. Los aparatos de videojuego están en la 28; en la 9 queda el software Software de videojuegos (9) frente a aparatos de videojuegos y juguetes (28): complementariedad directa.' },
  { a: 9, b: 38, grado: 'alta', origen: 'propuesta',
    fundamento: 'Aparatos de comunicación con servicios de telecomunicaciones.' },
  { a: 9, b: 41, grado: 'media', origen: 'propuesta',
    fundamento: 'Publicaciones y soportes electrónicos con servicios de educación y entretenimiento.' },
  { a: 9, b: 42, grado: 'alta', origen: 'propuesta',
    fundamento: 'Software como producto con servicios informáticos y de desarrollo. Hoy la misma empresa vende el programa y el servicio; para el consumidor es indistinto. Software descargable (9) frente a diseño y desarrollo de software y software como servicio (SaaS) (42): es una de las relaciones más frecuentes en la práctica.' },
  { a: 9, b: 45, grado: 'media', origen: 'propuesta',
    fundamento: 'Servicios de seguridad con aparatos de vigilancia y alarmas. Aparatos de alarma y seguridad (9) frente a servicios de seguridad y vigilancia (45).' },
  { a: 36, b: 45, grado: 'media', origen: 'propuesta',
    fundamento: 'Servicios financieros, de seguros e inmobiliarios con servicios jurídicos. Se cruzan en asesoramiento patrimonial y gestión inmobiliaria.' },
  { a: 38, b: 41, grado: 'media', origen: 'propuesta',
    fundamento: 'Telecomunicaciones con entretenimiento. Plataformas de streaming que transmiten y producen contenido. Transmisión y streaming (38) frente a provisión de contenidos de entretenimiento (41).' },
  { a: 38, b: 42, grado: 'alta', origen: 'propuesta',
    fundamento: 'Telecomunicaciones con servicios tecnológicos. Proveedores que prestan ambos bajo una sola marca.' },

  // ═══ CULTURA, EDUCACIÓN Y ESPARCIMIENTO ═══
  { a: 13, b: 28, grado: 'baja', origen: 'propuesta',
    fundamento: 'Armas con artículos deportivos. Tiro deportivo, caza.' },
  { a: 13, b: 41, grado: 'media', origen: 'usuario',
    fundamento: 'Armas y municiones frente a servicios de instalaciones deportivas de tiro y formación (41).' },
  { a: 15, b: 28, grado: 'media', origen: 'usuario',
    fundamento: 'Instrumentos musicales (15) frente a juguetes musicales (28).' },
  { a: 15, b: 41, grado: 'media', origen: 'propuesta',
    fundamento: 'Instrumentos musicales con servicios de enseñanza musical y espectáculos.' },
  { a: 16, b: 28, grado: 'media', origen: 'propuesta',
    fundamento: 'Papelería y material impreso con juegos y juguetes. Juegos de mesa, figuritas y artículos de librería infantil.' },
  { a: 16, b: 41, grado: 'alta', origen: 'propuesta',
    fundamento: 'Material impreso y publicaciones con servicios de educación y entretenimiento. La editorial que también organiza cursos; el instituto que edita su material.' },
  { a: 28, b: 41, grado: 'alta', origen: 'propuesta',
    fundamento: 'Juegos, juguetes y artículos deportivos con servicios de esparcimiento y actividades deportivas.' },

  // ═══ SERVICIOS Y OTROS ═══
];


/**
 * Afinidades de la clase 35 en su parte que **no es venta**.
 *
 * ── Por qué existe esta lista ──────────────────────────────────────────────
 *
 * El mecanismo del campo (57) resuelve la clase 35 cuando protege servicios de
 * venta: se lee qué comercializa y se cruza con las clases de ese rubro. Pero
 * la clase 35 es mucho más que venta. Su título es "Publicidad; gestión,
 * organización y administración de negocios comerciales; trabajos de oficina",
 * y la nota explicativa de Niza incluye la publicidad y el marketing, las
 * relaciones públicas, la organización de ferias, la consultoría empresarial,
 * la teneduría de libros y las auditorías.
 *
 * Contra el boletín 11121, **47 de las 156 actas de clase 35 no eran de
 * venta**. Con el mecanismo del (57) solo, esas 47 quedaban sin cruzarse con
 * nada: el sistema no tenía forma de relacionarlas.
 *
 * Estos tres pares, aportados por el matriculado el 23/09/2026, cubren ese
 * hueco. No son afinidades "de la clase 35" en abstracto: cada uno vincula una
 * porción concreta del título de la clase con otra clase de servicios.
 */
export const AFINIDAD_35_NO_VENTA: ParAfinidad[] = [
  { a: 35, b: 36, grado: 'media', origen: 'usuario',
    fundamento: 'Gestión y administración de negocios, contabilidad (35) frente a servicios financieros (36).' },
  { a: 35, b: 41, grado: 'media', origen: 'usuario',
    fundamento: 'Organización de ferias con fines comerciales (35) frente a organización de eventos con fines culturales o educativos (41).' },
  { a: 35, b: 42, grado: 'media', origen: 'usuario',
    fundamento: 'Consultoría empresarial (35) frente a consultoría tecnológica e informática (42).' },
];

/**
 * El par 25-35 también fue confirmado por el matriculado —"las marcas de
 * indumentaria protegen habitualmente ambas"— pero lo resuelve el mecanismo
 * del (57): una publicación de clase 35 que venda ropa devuelve la clase 25
 * por `alcanceDeLaVenta()`. Se deja anotado acá para que la revisión futura
 * de la tabla no lo interprete como una omisión.
 */

// ── La clase 35 ──────────────────────────────────────────────────────────────


/**
 * Criterio del matriculado (23/09/2026), sobre la venta genérica:
 *
 *   "Una marca así se cruza con todas las clases de productos, ya que podría
 *    ser cualquier producto. También la clase 35 puede ser que se cruce con
 *    alguna clase de servicios, ya que sirve para comercializar un servicio."
 *
 * La nota explicativa de Niza para la clase 35 lo respalda: comprende "el
 * agrupamiento, por cuenta de terceros, de una amplia gama de productos,
 * excepto su transporte, para que los consumidores puedan verlos y adquirirlos
 * con comodidad", prestado por comercios minoristas o mayoristas, catálogos o
 * medios electrónicos. Y aclara que "a fines de clasificación, la venta de
 * productos no se considera un servicio" — por eso quien comercializa protege
 * en la 35 y no en la clase del producto.
 *
 * De ahí las tres salidas posibles al leer el campo (57) de una publicación:
 *
 *   1. No es un servicio de venta (publicidad, gestión, trabajos de oficina)
 *      → no se cruza con nada por esta vía.
 *   2. Es venta de un rubro identificable → se cruza con las clases de ese
 *      rubro.
 *   3. Es venta genérica, sin rubro acotado → **se cruza con todas las clases
 *      vigiladas**, por el criterio de arriba.
 */

/**
 * Términos que, en el campo (57) de una publicación de clase 35, delatan qué
 * comercializa el servicio de venta.
 *
 * Incluye rubros de servicios además de productos, por el criterio del
 * matriculado: un servicio de clase 35 puede comercializar otro servicio.
 */
export const VENTA_A_CLASES: Array<{ terminos: string[]; clases: number[] }> = [
  // Productos
  { terminos: ['indumentaria', 'ropa', 'prendas de vestir', 'vestimenta', 'calzado', 'zapatos', 'sombrerer'], clases: [25] },
  { terminos: ['bolsos', 'carteras', 'marroquiner', 'maletas', 'valijas', 'mochilas'], clases: [18] },
  { terminos: ['joyer', 'bijouterie', 'bisuter', 'reloj'], clases: [14] },
  { terminos: ['cosmetic', 'cosmétic', 'perfum', 'maquillaje', 'tocador'], clases: [3] },
  { terminos: ['farmac', 'medicament', 'productos medicinales'], clases: [5] },
  { terminos: ['alimento', 'comestibles', 'almacén', 'almacen', 'supermercado', 'fiambres', 'lácteos', 'lacteos', 'carnes'], clases: [29, 30, 31] },
  { terminos: ['bebidas', 'vinos', 'bodega', 'cerveza', 'licores'], clases: [32, 33] },
  { terminos: ['mueble', 'decoración', 'decoracion', 'bazar', 'menaje'], clases: [20, 21] },
  { terminos: ['electrónic', 'electronic', 'informátic', 'informatic', 'computación', 'computacion', 'celulares'], clases: [9] },
  // ⚠️ Los electrodomésticos se reparten entre la 7 (con motor: licuadoras,
  //    lavarropas) y la 11 (de cocción o climatización: hornos, estufas).
  //    Mapearlos también a la 9 era un error: infló la clase 7 a 48
  //    publicaciones en el boletín 11121.
  { terminos: ['electrodomést', 'electrodomest'], clases: [7, 11] },
  { terminos: ['juguete', 'juegos'], clases: [28] },
  { terminos: ['papelería', 'papeleria', 'librería', 'libreria', 'libros'], clases: [16] },
  { terminos: ['ferreter', 'materiales de construcción', 'materiales de construccion', 'corralón', 'corralon', 'sanitarios'], clases: [6, 19, 11, 8] },
  { terminos: ['vehículo', 'vehiculo', 'automotor', 'autopartes', 'repuestos'], clases: [12] },
  { terminos: ['deportiv', 'artículos de deporte', 'articulos de deporte'], clases: [28, 25] },
  { terminos: ['mascota', 'veterinari', 'animales'], clases: [31, 5] },
  { terminos: ['textil', 'telas', 'tejidos', 'blanquer', 'ropa de cama'], clases: [24, 23] },
  { terminos: ['herramienta', 'maquinaria'], clases: [7, 8] },
  { terminos: ['instrumentos musicales'], clases: [15] },
  { terminos: ['tabaco', 'cigarrill'], clases: [34] },
  { terminos: ['pinturas', 'pinturer'], clases: [2] },
  // Servicios — por el criterio del matriculado
  { terminos: ['seguros', 'servicios financieros', 'inmobiliari'], clases: [36] },
  { terminos: ['servicios de transporte', 'viajes', 'turismo'], clases: [39] },
  { terminos: ['servicios educativos', 'cursos', 'capacitación', 'capacitacion'], clases: [41] },
  { terminos: ['servicios gastronómicos', 'servicios gastronomicos', 'hoteler', 'restauración', 'restauracion'], clases: [43] },
  { terminos: ['servicios médicos', 'servicios medicos', 'estétic', 'estetic', 'peluquer'], clases: [44] },
  { terminos: ['servicios jurídicos', 'servicios juridicos', 'seguridad privada'], clases: [45] },
];

/** Expresiones que indican que la publicación protege un servicio de venta. */
const SENALES_DE_VENTA = [
  'venta al por menor', 'venta al por mayor', 'venta minorista', 'venta mayorista',
  'comercializacion', 'servicios de venta', 'e-commerce', 'teletienda',
  'agrupamiento, por cuenta de terceros', 'reagrupamiento de mercaderia',
];

/**
 * Fórmulas canónicas de Niza para la venta genérica, sin rubro acotado.
 *
 * Según el criterio del matriculado, estas se cruzan contra **todas** las
 * clases vigiladas: el servicio puede alcanzar cualquier producto.
 */
const VENTA_GENERICA = [
  'mercaderia de diversa procedencia',
  'amplia gama de productos',
  'diversos productos',
];

/** Quita tildes y pasa a minúsculas, para comparar sin sorpresas. */
function normalizar(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** ¿La publicación de clase 35 protege un servicio de venta? */
export function esServicioDeVenta(productosYServicios: string): boolean {
  const t = normalizar(productosYServicios);
  return SENALES_DE_VENTA.some((s) => t.includes(normalizar(s)));
}

/**
 * ¿Es venta genérica, sin rubro acotado? Se cruza contra todas las clases.
 */
export function esVentaGenerica(productosYServicios: string): boolean {
  const t = normalizar(productosYServicios);
  return VENTA_GENERICA.some((s) => t.includes(normalizar(s)));
}

export interface AlcanceVenta {
  /** `no-venta` · `generica` (todas las clases) · `rubros` · `sin-mapear`. */
  tipo: 'no-venta' | 'generica' | 'rubros' | 'sin-mapear';
  clases: number[];
}

/**
 * Qué alcanza el servicio de venta de una publicación de clase 35.
 *
 * ⚠️ Los cuatro resultados son distintos entre sí y **hay que tratarlos
 *    distinto**. En particular, `sin-mapear` no es lo mismo que `no-venta`:
 *    es un punto ciego que hay que registrar y revisar, no un negativo.
 */
export function alcanceDeLaVenta(productosYServicios: string): AlcanceVenta {
  if (!esServicioDeVenta(productosYServicios)) {
    return { tipo: 'no-venta', clases: [] };
  }

  const t = normalizar(productosYServicios);
  const clases = new Set<number>();
  for (const { terminos, clases: cs } of VENTA_A_CLASES) {
    if (terminos.some((term) => t.includes(normalizar(term)))) {
      cs.forEach((c) => clases.add(c));
    }
  }

  if (clases.size > 0) {
    return { tipo: 'rubros', clases: [...clases].sort((x, y) => x - y) };
  }
  if (esVentaGenerica(productosYServicios)) {
    return { tipo: 'generica', clases: [] };
  }
  return { tipo: 'sin-mapear', clases: [] };
}

// ── Consulta ─────────────────────────────────────────────────────────────────

const INDICE = (() => {
  const m = new Map<string, ParAfinidad>();
  for (const p of PARES_AFINIDAD) m.set(`${p.a}-${p.b}`, p);
  return m;
})();

export interface ResultadoAfinidad {
  afines: boolean;
  grado: GradoAfinidad | 'identica' | 'ninguna';
  fundamento: string;
}

/**
 * ⚠️ **No sirve para la clase 35.** Devuelve `ninguna` con un fundamento que
 *    lo explica, antes que un `false` mudo que se confunda con "no son afines".
 */
export function afinidadEntreClases(a: number, b: number): ResultadoAfinidad {
  if (a === b) return { afines: true, grado: 'identica', fundamento: 'Misma clase.' };

  // La clase 35 tiene dos caras. La de venta se resuelve leyendo el campo
  // (57); la de gestión, publicidad y consultoría tiene sus propios pares.
  if (a === 35 || b === 35) {
    const otra = a === 35 ? b : a;
    const par = AFINIDAD_35_NO_VENTA.find((p) => p.b === otra || p.a === otra);
    if (par) return { afines: true, grado: par.grado, fundamento: par.fundamento };
    return {
      afines: false,
      grado: 'ninguna',
      fundamento:
        'Sin afinidad registrada por fuera de la venta. Si la publicación de ' +
        'clase 35 protege un servicio de venta, usar alcanceDeLaVenta() sobre ' +
        'el campo (57): ese es el camino que resuelve la mayoría de los casos.',
    };
  }

  const par = INDICE.get(`${Math.min(a, b)}-${Math.max(a, b)}`);
  if (!par) return { afines: false, grado: 'ninguna', fundamento: '' };
  return { afines: true, grado: par.grado, fundamento: par.fundamento };
}

/**
 * Todas las afinidades de una clase, incluidas las que solo sirven para
 * vigilar. **Esta es la que usa el motor de vigilancia.**
 */
export function clasesAfinesA(
  clase: number
): Array<{ clase: number; grado: GradoAfinidad; fundamento: string; soloVigilancia: boolean }> {
  const r: Array<{ clase: number; grado: GradoAfinidad; fundamento: string; soloVigilancia: boolean }> = [];
  for (const p of PARES_AFINIDAD) {
    const otra = p.a === clase ? p.b : p.b === clase ? p.a : null;
    if (otra === null) continue;
    r.push({ clase: otra, grado: p.grado, fundamento: p.fundamento, soloVigilancia: p.soloVigilancia === true });
  }
  const peso = { alta: 0, media: 1, baja: 2 };
  return r.sort((x, y) => peso[x.grado] - peso[y.grado] || x.clase - y.clase);
}

export interface Sugerencia {
  /** La clase del producto o servicio que el cliente efectivamente ofrece. */
  imprescindible: number;
  /** Afinidad alta: conviene cubrirlas de entrada. */
  convenientes: number[];
  /** Afinidad media: ampliación razonable si va a crecer. */
  ampliacion: number[];
  /** Afinidad baja: solo si su actividad concreta lo justifica. */
  siCorresponde: number[];
}

/**
 * Clases sugeridas para proteger una marca, ordenadas por prioridad.
 *
 * Es el segundo uso de la tabla, pedido por el matriculado: recomendarle al
 * cliente qué cubrir.
 *
 * ── Por qué no devuelve lo mismo que `clasesAfinesA()` ─────────────────────
 *
 * Vigilar y recomendar necesitan criterios distintos, y confundirlos arruina
 * los dos.
 *
 * Para **vigilar** importa toda clase donde pueda aparecer un signo
 * confundible, incluidos los insumos: una marca nueva de mercería con
 * denominación parecida a la de un cliente de indumentaria es un candidato
 * legítimo a oposición.
 *
 * Para **recomendar** importa solo lo que el cliente va a vender. Sugerirle a
 * una marca de ropa que registre mercería, tejidos o servicios de confección a
 * medida es hacerle pagar tasas por clases que no usa — y encima diluye la
 * recomendación, porque una lista de nueve clases no orienta a nadie.
 *
 * De ahí el campo `soloVigilancia`, que esta función respeta y el motor de
 * vigilancia ignora.
 *
 * ── La clase 35 ────────────────────────────────────────────────────────────
 *
 * Se agrega a `convenientes` siempre que la marca proteja productos (clases 1
 * a 34). El titular que además los comercializa necesita esa protección, y es
 * una de las omisiones más frecuentes: se registra la clase del producto y se
 * deja afuera la de la venta, que es la que después usa todos los días.
 */
export function clasesSugeridas(claseBase: number): Sugerencia {
  const afines = clasesAfinesA(claseBase).filter((x) => !x.soloVigilancia);
  const convenientes = afines.filter((x) => x.grado === 'alta').map((x) => x.clase);

  // Quien protege un producto casi siempre lo comercializa.
  if (claseBase >= 1 && claseBase <= 34) convenientes.push(35);

  return {
    imprescindible: claseBase,
    convenientes: convenientes.sort((x, y) => x - y),
    ampliacion: afines.filter((x) => x.grado === 'media').map((x) => x.clase),
    siCorresponde: afines.filter((x) => x.grado === 'baja').map((x) => x.clase),
  };
}

/**
 * Cuánto se relaja el umbral de confundibilidad según la afinidad.
 *
 * ⚠️ Punto de partida, no resultado medido. Se calibra contra los dictámenes
 *    del INPI cargados en el proyecto.
 */
export const UMBRAL_POR_AFINIDAD: Record<GradoAfinidad | 'identica', number> = {
  identica: 0.72,
  alta: 0.78,
  media: 0.85,
  baja: 0.90,
};
