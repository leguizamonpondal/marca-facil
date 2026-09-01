/**
 * Cliente API centralizado — MARCAS FÁCIL
 */
import axios, { AxiosError } from 'axios';
import type {
  AuthResponse, User, Marca, Oposicion, Alerta,
  BoletinDescarga, BoletinEntrada, Dominio, EstudioFactibilidad,
  PaginatedResponse, PlanInfo, MarcaTimeline,
} from '../types';

// En desarrollo: proxy de Vite reenvía /api → backend local
// En producción: VITE_API_URL apunta al backend de Railway
const API_BASE =
  (import.meta as any).env?.VITE_API_URL?.replace(/\/$/, '') + '/api' ||
  '/api';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 60000,
  headers: { 'Content-Type': 'application/json' },
});

// ── Interceptor: adjuntar JWT ─────────────────────────────────────────────────
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('mf_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ── Interceptor: manejar 401 ──────────────────────────────────────────────────
api.interceptors.response.use(
  (res) => res,
  (err: AxiosError) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('mf_token');
      localStorage.removeItem('mf_user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

// ── Helper para errores ───────────────────────────────────────────────────────
export function getApiError(err: unknown): string {
  if (err instanceof AxiosError) {
    const data = err.response?.data as any;
    return data?.message || data?.error || err.message || 'Error desconocido';
  }
  if (err instanceof Error) return err.message;
  return 'Error desconocido';
}

// ═════════════════════════════════════════════════════════════════════════════
// AUTH
// ═════════════════════════════════════════════════════════════════════════════
export const authApi = {
  login: async (email: string, password: string): Promise<AuthResponse> => {
    const { data } = await api.post('/auth/login', { email, password });
    return data;
  },
  register: async (payload: {
    email: string; password: string; nombre: string;
    cuit?: string; razonSocial?: string; codigoReseller?: string;
  }): Promise<AuthResponse> => {
    const { data } = await api.post('/auth/register', payload);
    return data;
  },
  me: async (): Promise<User> => {
    const { data } = await api.get('/auth/me');
    return data;
  },
  updateProfile: async (payload: Partial<User>): Promise<User> => {
    const { data } = await api.put('/auth/profile', payload);
    return data;
  },
};

// ═════════════════════════════════════════════════════════════════════════════
// MARCAS
// ═════════════════════════════════════════════════════════════════════════════
export const marcasApi = {
  listar: async (params?: {
    estado?: string; clase?: number; vigilancia?: boolean;
    page?: number; limit?: number;
  }): Promise<PaginatedResponse<Marca>> => {
    const { data } = await api.get('/marcas', { params });
    return data;
  },
  obtener: async (id: string): Promise<Marca & { timeline?: MarcaTimeline[] }> => {
    const { data } = await api.get(`/marcas/${id}`);
    return data;
  },
  crear: async (payload: {
    denominacion: string; claseNiza: number; tipoMarca: string;
    numeroActa?: string; fechaSolicitud?: string;
    descripcionProductos?: string; notas?: string;
  }): Promise<Marca> => {
    const { data } = await api.post('/marcas', payload);
    return data;
  },
  actualizar: async (id: string, payload: Partial<Marca>): Promise<Marca> => {
    const { data } = await api.put(`/marcas/${id}`, payload);
    return data;
  },
  eliminar: async (id: string): Promise<void> => {
    await api.delete(`/marcas/${id}`);
  },
  activarVigilancia: async (id: string): Promise<{ vigilanciaActiva: boolean }> => {
    const { data } = await api.post(`/marcas/${id}/vigilancia`);
    return data;
  },
  timeline: async (id: string): Promise<MarcaTimeline[]> => {
    const { data } = await api.get(`/marcas/${id}/timeline`);
    return data;
  },
};

// ═════════════════════════════════════════════════════════════════════════════
// OPOSICIONES
// ═════════════════════════════════════════════════════════════════════════════
export const oposicionesApi = {
  listar: async (params?: {
    estado?: string; page?: number; limit?: number;
  }): Promise<PaginatedResponse<Oposicion>> => {
    const { data } = await api.get('/oposiciones', { params });
    return data;
  },
  obtener: async (id: string): Promise<Oposicion> => {
    const { data } = await api.get(`/oposiciones/${id}`);
    return data;
  },
  crear: async (payload: {
    marcaOponenteId: string; actaOpuesta: string;
    denominacionOpuesta: string; claseOpuesta: number;
    oponenteNombre?: string; oponenteCuit?: string;
    fechaPublicacion: string;
  }): Promise<Oposicion> => {
    const { data } = await api.post('/oposiciones', payload);
    return data;
  },
  mantener: async (id: string, payload: {
    fechaNotificacion: string; ampliarFundamentos?: string;
  }): Promise<{ mensaje: string; plazoMantenimiento: string; documentoPDF: string }> => {
    const { data } = await api.post(`/oposiciones/${id}/mantener`, payload);
    return data;
  },
  registrarArgumentos: async (id: string, payload: {
    fechaTraslado: string; argumentos: string;
  }): Promise<{ mensaje: string; plazoArgumentos: string }> => {
    const { data } = await api.post(`/oposiciones/${id}/argumentos`, payload);
    return data;
  },
  registrarResolucion: async (id: string, payload: {
    resolucion: string; numeroResolucion?: string; fundamentosResolucion?: string;
  }): Promise<{ mensaje: string; resultado: string }> => {
    const { data } = await api.post(`/oposiciones/${id}/resolucion`, payload);
    return data;
  },
  generarPDF: async (id: string): Promise<{ mensaje: string; url: string; instrucciones: string[] }> => {
    const { data } = await api.post(`/oposiciones/${id}/pdf`);
    return data;
  },
};

// ═════════════════════════════════════════════════════════════════════════════
// ALERTAS
// ═════════════════════════════════════════════════════════════════════════════
export const alertasApi = {
  listar: async (params?: {
    urgentes?: boolean; tipo?: string; leida?: boolean;
    page?: number; limit?: number;
  }): Promise<PaginatedResponse<Alerta>> => {
    const { data } = await api.get('/alertas', { params });
    return data;
  },
  proximas: async (): Promise<Alerta[]> => {
    const { data } = await api.get('/alertas/proximas');
    return data;
  },
  calendario: async (): Promise<Record<string, Alerta[]>> => {
    const { data } = await api.get('/alertas/calendario');
    return data;
  },
  marcarLeida: async (id: string): Promise<void> => {
    await api.patch(`/alertas/${id}/leer`);
  },
  marcarTodasLeidas: async (): Promise<void> => {
    await api.post('/alertas/leer-todas');
  },
  crear: async (payload: {
    tipo: string; titulo: string; descripcion?: string;
    marcaId?: string; fechaVencimiento?: string; fechaAlerta?: string;
  }): Promise<Alerta> => {
    const { data } = await api.post('/alertas', payload);
    return data;
  },
};

// ═════════════════════════════════════════════════════════════════════════════
// BOLETÍN
// ═════════════════════════════════════════════════════════════════════════════
export const boletinApi = {
  listarDescargas: async (): Promise<BoletinDescarga[]> => {
    const { data } = await api.get('/boletin');
    return data;
  },
  descargar: async (): Promise<{ mensaje: string; resultado: any }> => {
    const { data } = await api.post('/boletin/descargar');
    return data;
  },
  buscarEntradas: async (params: {
    q?: string; clase?: number; page?: number; limit?: number;
  }): Promise<PaginatedResponse<BoletinEntrada>> => {
    const { data } = await api.get('/boletin/entradas', { params });
    return data;
  },
  stats: async (): Promise<{
    totalEntradas: number; boletinesDescargados: number;
    ultimaBoletin?: string; marcasVigiladas: number;
  }> => {
    const { data } = await api.get('/boletin/stats');
    return data;
  },
};

// ═════════════════════════════════════════════════════════════════════════════
// FACTIBILIDAD
// ═════════════════════════════════════════════════════════════════════════════
export const factibilidadApi = {
  estudiar: async (payload: {
    denominacion: string; claseNiza: number; tipoMarca?: string;
  }): Promise<EstudioFactibilidad> => {
    const { data } = await api.post('/factibilidad', payload);
    return data;
  },
  historial: async (): Promise<EstudioFactibilidad[]> => {
    const { data } = await api.get('/factibilidad');
    return data;
  },
};

// ═════════════════════════════════════════════════════════════════════════════
// DOMINIOS
// ═════════════════════════════════════════════════════════════════════════════
export const dominiosApi = {
  listar: async (): Promise<Dominio[]> => {
    const { data } = await api.get('/dominios');
    return data;
  },
  crear: async (payload: {
    nombre: string; registrante?: string;
    fechaRegistro?: string; fechaVencimiento?: string; notas?: string;
  }): Promise<Dominio> => {
    const { data } = await api.post('/dominios', payload);
    return data;
  },
  actualizar: async (id: string, payload: Partial<Dominio>): Promise<Dominio> => {
    const { data } = await api.put(`/dominios/${id}`, payload);
    return data;
  },
  eliminar: async (id: string): Promise<void> => {
    await api.delete(`/dominios/${id}`);
  },
};

// ═════════════════════════════════════════════════════════════════════════════
// PAGOS / PLANES
// ═════════════════════════════════════════════════════════════════════════════
export const pagosApi = {
  planes: async (): Promise<PlanInfo[]> => {
    const { data } = await api.get('/pagos/planes');
    return data;
  },
  suscribir: async (plan: string): Promise<{ initPoint: string; preferenceId: string }> => {
    const { data } = await api.post('/pagos/suscripcion', { plan });
    return data;
  },
  estado: async (): Promise<{
    plan: string; vencimiento?: string; activo: boolean;
  }> => {
    const { data } = await api.get('/pagos/estado');
    return data;
  },
};

// ═════════════════════════════════════════════════════════════════════════════
// DOCUMENTOS
// ═════════════════════════════════════════════════════════════════════════════
export const documentosApi = {
  listar: async (): Promise<any[]> => {
    const { data } = await api.get('/documentos');
    return data;
  },
  ddjjMedioTermino: async (marcaId: string): Promise<{ mensaje: string; url: string }> => {
    const { data } = await api.post('/documentos/ddjj-medio-termino', { marcaId });
    return data;
  },
  ddjjRenovacion: async (marcaId: string): Promise<{ mensaje: string; url: string }> => {
    const { data } = await api.post('/documentos/ddjj-renovacion', { marcaId });
    return data;
  },
};

// ═════════════════════════════════════════════════════════════════════════════
// INPI — Integración portal Trámites en Línea (Clave ARCA)
// ═════════════════════════════════════════════════════════════════════════════
export const inpiApi = {
  estado: async (): Promise<{ servicio: string; estado: string; modos: string[] }> => {
    const { data } = await api.get('/inpi/estado');
    return data;
  },
  consultarActa: async (payload: {
    acta: string;
    cuit?: string;
    claveFiscal?: string;
  }): Promise<{
    fuente: 'api-publica' | 'portal-arca';
    datos: {
      acta: string;
      denominacion: string;
      claseNiza: number;
      tipoMarca: string;
      estado: string;
      titular: string;
      fechaSolicitud?: string;
      fechaPublicacion?: string;
      observaciones?: string;
    };
  }> => {
    const { data } = await api.post('/inpi/consultar-acta', payload);
    return data;
  },
  presentarSolicitud: async (payload: {
    cuit: string;
    claveFiscal: string;
    denominacion: string;
    claseNiza: number;
    tipoMarca: string;
    descripcionProductos: string;
    titularNombre: string;
    titularCuit: string;
    titularDomicilio?: string;
    titularEmail?: string;
    imagenBase64?: string;
    imagenMimeType?: string;
  }): Promise<{
    pasos: Array<{ paso: number; descripcion: string; estado: string; detalle?: string }>;
    resultado?: { acta: string; fechaPresentacion: string; comprobante?: string; mensaje: string };
    error?: string;
  }> => {
    const { data } = await api.post('/inpi/presentar-solicitud', payload, { timeout: 120_000 });
    return data;
  },
};

export default api;
