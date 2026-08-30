// ── Tipos compartidos MARCAS FÁCIL ────────────────────────────────────────────

export type Plan = 'GRATUITO' | 'BASICO' | 'PROFESIONAL' | 'EMPRESARIAL';
export type EstadoMarca =
  | 'BORRADOR' | 'EN_TRAMITE' | 'REGISTRADA' | 'VIGENTE'
  | 'VENCIDA' | 'ABANDONADA' | 'RECHAZADA' | 'CON_OPOSICION';
export type TipoMarca = 'DENOMINATIVA' | 'FIGURATIVA' | 'MIXTA' | 'TRIDIMENSIONAL';
export type EstadoOposicion =
  | 'FORMULADA' | 'MANTENIDA' | 'EN_TRAMITE' | 'FUNDADA' | 'INFUNDADA' | 'DESISTIDA' | 'ABANDONADA';
export type TipoAlerta =
  | 'DDJJ_VENCIMIENTO' | 'RENOVACION' | 'OPOSICION_DETECTADA' | 'OPOSICION_PLAZO'
  | 'OPOSICION_TRASLADO' | 'DOMINIO_VENCIMIENTO' | 'CUSTOM';
export type DictamenFactibilidad = 'VIABLE' | 'CONDICIONADA' | 'NO_VIABLE';

// ── Auth ──────────────────────────────────────────────────────────────────────
export interface User {
  id: string;
  email: string;
  nombre: string;
  cuit?: string;
  plan: Plan;
  planVencimiento?: string;
  razonSocial?: string;
  rol: 'CLIENTE' | 'RESELLER' | 'ADMIN';
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

// ── Marca ─────────────────────────────────────────────────────────────────────
export interface Marca {
  id: string;
  userId: string;
  denominacion: string;
  claseNiza: number;
  tipoMarca: TipoMarca;
  estado: EstadoMarca;
  numeroActa?: string;
  numeroCertificado?: string;
  fechaSolicitud?: string;
  fechaConcesion?: string;
  fechaVencimiento?: string;
  ddjjVencimiento?: string;
  descripcionProductos?: string;
  vigilanciaActiva: boolean;
  notas?: string;
  logoUrl?: string;
  createdAt: string;
  updatedAt: string;
  _count?: {
    oposicionesRecibidas: number;
    oposicionesFormuladas: number;
    alertas: number;
  };
}

export interface MarcaTimeline {
  tipo: string;
  descripcion: string;
  fecha: string;
  icono?: string;
}

// ── Oposición ─────────────────────────────────────────────────────────────────
export interface Oposicion {
  id: string;
  userId: string;
  marcaOponenteId: string;
  actaOpuesta: string;
  denominacionOpuesta: string;
  claseOpuesta: number;
  oponenteNombre?: string;
  oponenteCuit?: string;
  fechaPublicacion: string;
  plazoOposicion: string;
  estado: EstadoOposicion;
  plazoMantenimiento?: string;
  fechaMantenimiento?: string;
  trasladoFecha?: string;
  plazoTraslado?: string;
  argumentosFinales?: string;
  resolucionFecha?: string;
  resolucionNumero?: string;
  resolucionTexto?: string;
  fundamentosTexto?: string;
  createdAt: string;
  marcaOponente?: Pick<Marca, 'id' | 'denominacion' | 'claseNiza'>;
  proximoPlazo?: {
    tipo: string;
    fecha: string;
    diasRestantes: number;
    urgente: boolean;
  } | null;
  esRes297?: boolean;
}

// ── Alerta ────────────────────────────────────────────────────────────────────
export interface Alerta {
  id: string;
  userId: string;
  marcaId?: string;
  oposicionId?: string;
  tipo: TipoAlerta;
  titulo: string;
  descripcion?: string;
  fechaVencimiento?: string;
  fechaAlerta?: string;
  leida: boolean;
  leidaEn?: string;
  notificadaPush: boolean;
  createdAt: string;
  marca?: Pick<Marca, 'id' | 'denominacion' | 'claseNiza'>;
}

// ── Boletín ───────────────────────────────────────────────────────────────────
export interface BoletinDescarga {
  id: string;
  boletinNumero: string;
  fechaBoletin: string;
  urlDescargada: string;
  exitosa: boolean;
  entriesCount?: number;
  createdAt: string;
}

export interface BoletinEntrada {
  id: string;
  acta: string;
  denominacion: string;
  tipoMarca: TipoMarca;
  claseNiza: number;
  titularNombre: string;
  titularCuit?: string;
  productos?: string;
  boletinFecha: string;
  boletinNumero?: string;
  confundibleCon?: string[];
  createdAt: string;
}

// ── Dominio ───────────────────────────────────────────────────────────────────
export interface Dominio {
  id: string;
  userId: string;
  nombre: string;
  registrante?: string;
  fechaRegistro?: string;
  fechaVencimiento?: string;
  estado: string;
  notas?: string;
  createdAt: string;
}

// ── Estudio de factibilidad ───────────────────────────────────────────────────
export interface EstudioFactibilidad {
  id: string;
  userId: string;
  denominacion: string;
  claseNiza: number;
  tipoMarca: TipoMarca;
  dictamen: DictamenFactibilidad;
  riesgo: 'BAJO' | 'MEDIO' | 'ALTO';
  resumenDictamen: string;
  totalAntecedentes: number;
  antecedentesConfundibles: number;
  pdfUrl?: string;
  createdAt: string;
}

// ── Pagos ─────────────────────────────────────────────────────────────────────
export interface PlanInfo {
  plan: Plan;
  nombre: string;
  precio: number;
  descripcion: string;
  beneficios: string[];
  vigencia: string;
  popular?: boolean;
}

// ── API Pagination ────────────────────────────────────────────────────────────
export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

// ── Misc ──────────────────────────────────────────────────────────────────────
export const CLASES_NIZA: Record<number, string> = {
  1: 'Productos químicos', 2: 'Pinturas y barnices', 3: 'Cosméticos y limpieza',
  4: 'Aceites y grasas industriales', 5: 'Productos farmacéuticos',
  6: 'Metales comunes', 7: 'Máquinas y aparatos', 8: 'Herramientas y utensilios',
  9: 'Aparatos científicos y eléctricos', 10: 'Aparatos médicos',
  11: 'Aparatos para alumbrado y calefacción', 12: 'Vehículos',
  13: 'Armas de fuego', 14: 'Metales preciosos', 15: 'Instrumentos musicales',
  16: 'Papel y artículos de oficina', 17: 'Caucho y plástico',
  18: 'Cuero y artículos de viaje', 19: 'Materiales de construcción',
  20: 'Muebles y artículos del hogar', 21: 'Utensilios domésticos',
  22: 'Cuerdas y redes', 23: 'Hilos para uso textil', 24: 'Tejidos',
  25: 'Prendas de vestir', 26: 'Encajes y bordados', 27: 'Alfombras',
  28: 'Juegos y juguetes', 29: 'Carne, pescado y productos alimenticios',
  30: 'Café, té, cacao y especias', 31: 'Productos agrícolas',
  32: 'Cervezas y bebidas no alcohólicas', 33: 'Bebidas alcohólicas',
  34: 'Tabaco', 35: 'Publicidad y gestión empresarial',
  36: 'Seguros y servicios financieros', 37: 'Construcción y reparación',
  38: 'Telecomunicaciones', 39: 'Transporte y almacenamiento',
  40: 'Tratamiento de materiales', 41: 'Educación y entretenimiento',
  42: 'Servicios científicos y tecnológicos', 43: 'Servicios de restauración',
  44: 'Servicios médicos y veterinarios', 45: 'Servicios jurídicos y de seguridad',
};

export const ESTADO_MARCA_LABEL: Record<EstadoMarca, string> = {
  BORRADOR: 'Borrador',
  EN_TRAMITE: 'En trámite',
  REGISTRADA: 'Registrada',
  VIGENTE: 'Vigente',
  VENCIDA: 'Vencida',
  ABANDONADA: 'Abandonada',
  RECHAZADA: 'Rechazada',
  CON_OPOSICION: 'Con oposición',
};

export const ESTADO_OPOSICION_LABEL: Record<EstadoOposicion, string> = {
  FORMULADA: 'Formulada',
  MANTENIDA: 'Mantenida',
  EN_TRAMITE: 'En trámite',
  FUNDADA: 'Fundada ✓',
  INFUNDADA: 'Infundada',
  DESISTIDA: 'Desistida',
  ABANDONADA: 'Abandonada',
};
