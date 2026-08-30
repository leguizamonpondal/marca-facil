/**
 * Formulario Nueva Marca / Editar — MARCAS FÁCIL
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { marcasApi, getApiError } from '../services/api';
import { PageLoader } from '../components/ui/Spinner';
import { CLASES_NIZA } from '../types';

const TIPOS_MARCA = [
  { value: 'DENOMINATIVA', label: 'Denominativa — solo texto' },
  { value: 'FIGURATIVA', label: 'Figurativa — solo imagen o logo' },
  { value: 'MIXTA', label: 'Mixta — texto + imagen' },
  { value: 'TRIDIMENSIONAL', label: 'Tridimensional — forma del producto/envase' },
];

const ESTADOS_DISPONIBLES = [
  { value: 'BORRADOR', label: 'Borrador — aún no presentada' },
  { value: 'EN_TRAMITE', label: 'En trámite — presentada ante INPI' },
  { value: 'REGISTRADA', label: 'Registrada — concedida por INPI' },
  { value: 'VIGENTE', label: 'Vigente' },
  { value: 'CON_OPOSICION', label: 'Con oposición' },
  { value: 'VENCIDA', label: 'Vencida' },
  { value: 'ABANDONADA', label: 'Abandonada' },
  { value: 'RECHAZADA', label: 'Rechazada' },
];

export default function MarcaForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEdit = !!id;

  const { data: marcaExistente, isLoading } = useQuery({
    queryKey: ['marca', id],
    queryFn: () => marcasApi.obtener(id!),
    enabled: isEdit,
  });

  const [form, setForm] = useState({
    denominacion: marcaExistente?.denominacion || '',
    claseNiza: marcaExistente?.claseNiza || 35,
    tipoMarca: marcaExistente?.tipoMarca || 'DENOMINATIVA',
    estado: marcaExistente?.estado || 'BORRADOR',
    numeroActa: marcaExistente?.numeroActa || '',
    numeroCertificado: marcaExistente?.numeroCertificado || '',
    fechaSolicitud: marcaExistente?.fechaSolicitud?.slice(0, 10) || '',
    fechaConcesion: marcaExistente?.fechaConcesion?.slice(0, 10) || '',
    descripcionProductos: marcaExistente?.descripcionProductos || '',
    notas: marcaExistente?.notas || '',
  });

  // Sincronizar con datos cargados
  const [initialized, setInitialized] = useState(false);
  if (marcaExistente && !initialized) {
    setInitialized(true);
    setForm({
      denominacion: marcaExistente.denominacion,
      claseNiza: marcaExistente.claseNiza,
      tipoMarca: marcaExistente.tipoMarca,
      estado: marcaExistente.estado,
      numeroActa: marcaExistente.numeroActa || '',
      numeroCertificado: marcaExistente.numeroCertificado || '',
      fechaSolicitud: marcaExistente.fechaSolicitud?.slice(0, 10) || '',
      fechaConcesion: marcaExistente.fechaConcesion?.slice(0, 10) || '',
      descripcionProductos: marcaExistente.descripcionProductos || '',
      notas: marcaExistente.notas || '',
    });
  }

  const mutation = useMutation({
    mutationFn: () => isEdit
      ? marcasApi.actualizar(id!, form)
      : marcasApi.crear(form),
    onSuccess: (data) => {
      toast.success(isEdit ? 'Marca actualizada' : 'Marca registrada');
      queryClient.invalidateQueries({ queryKey: ['marcas'] });
      navigate(`/marcas/${data.id}`);
    },
    onError: (err) => toast.error(getApiError(err)),
  });

  if (isLoading) return <PageLoader />;

  const set = (field: string, value: any) =>
    setForm(prev => ({ ...prev, [field]: value }));

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="page-title">
          {isEdit ? 'Editar marca' : 'Registrar marca'}
        </h1>
      </div>

      {/* Info legal */}
      <div className="flex gap-3 bg-blue-50 rounded-xl p-4">
        <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-blue-800">
          <p className="font-medium mb-1">¿Necesitás ayuda con el trámite?</p>
          <p>
            El registro se realiza ante el INPI. Te recomendamos hacer primero una
            <button
              onClick={() => navigate('/factibilidad')}
              className="underline font-medium mx-1"
            >
              búsqueda de antecedentes
            </button>
            para evaluar la viabilidad del registro.
          </p>
        </div>
      </div>

      {/* Formulario */}
      <div className="card p-6 space-y-5">
        <h2 className="section-title">Datos de la marca</h2>

        <div>
          <label className="label">Denominación *</label>
          <input
            type="text"
            value={form.denominacion}
            onChange={(e) => set('denominacion', e.target.value.toUpperCase())}
            className="input"
            placeholder="Ej: MARCA EJEMPLO"
            required
          />
          <p className="text-xs text-gray-400 mt-1">
            Exactamente como aparecerá en el certificado de registro
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Clase de Niza *</label>
            <select
              value={form.claseNiza}
              onChange={(e) => set('claseNiza', Number(e.target.value))}
              className="input"
            >
              {Object.entries(CLASES_NIZA).map(([num, desc]) => (
                <option key={num} value={num}>
                  Clase {num} — {desc}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Tipo de marca *</label>
            <select
              value={form.tipoMarca}
              onChange={(e) => set('tipoMarca', e.target.value)}
              className="input"
            >
              {TIPOS_MARCA.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label">Estado actual</label>
          <select
            value={form.estado}
            onChange={(e) => set('estado', e.target.value)}
            className="input"
          >
            {ESTADOS_DISPONIBLES.map(e => (
              <option key={e.value} value={e.value}>{e.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Descripción de productos/servicios</label>
          <textarea
            value={form.descripcionProductos}
            onChange={(e) => set('descripcionProductos', e.target.value)}
            className="input"
            rows={3}
            placeholder="Descripción de los productos o servicios que ampara la marca..."
          />
        </div>
      </div>

      {/* Datos del trámite INPI */}
      <div className="card p-6 space-y-5">
        <h2 className="section-title">Datos del trámite INPI</h2>
        <p className="text-sm text-gray-500 -mt-2">
          Opcional — completá estos datos si ya iniciaste el trámite
        </p>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Número de acta</label>
            <input
              type="text"
              value={form.numeroActa}
              onChange={(e) => set('numeroActa', e.target.value)}
              className="input"
              placeholder="Ej: 4.123.456"
            />
          </div>
          <div>
            <label className="label">Número de certificado</label>
            <input
              type="text"
              value={form.numeroCertificado}
              onChange={(e) => set('numeroCertificado', e.target.value)}
              className="input"
              placeholder="Ej: 2.345.678"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Fecha de solicitud</label>
            <input
              type="date"
              value={form.fechaSolicitud}
              onChange={(e) => set('fechaSolicitud', e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="label">Fecha de concesión</label>
            <input
              type="date"
              value={form.fechaConcesion}
              onChange={(e) => set('fechaConcesion', e.target.value)}
              className="input"
            />
            <p className="text-xs text-gray-400 mt-1">
              El sistema calculará automáticamente DDJJ y renovación
            </p>
          </div>
        </div>
      </div>

      {/* Notas */}
      <div className="card p-6">
        <label className="label">Notas internas</label>
        <textarea
          value={form.notas}
          onChange={(e) => set('notas', e.target.value)}
          className="input"
          rows={3}
          placeholder="Notas, observaciones, historial de gestión..."
        />
      </div>

      {/* Acciones */}
      <div className="flex items-center justify-between pt-2 pb-6">
        <button onClick={() => navigate(-1)} className="btn-secondary">
          Cancelar
        </button>
        <button
          onClick={() => mutation.mutate()}
          disabled={!form.denominacion || !form.claseNiza || mutation.isPending}
          className="btn-primary"
        >
          <Save className="w-4 h-4" />
          {mutation.isPending
            ? 'Guardando...'
            : isEdit ? 'Guardar cambios' : 'Registrar marca'
          }
        </button>
      </div>
    </div>
  );
}
