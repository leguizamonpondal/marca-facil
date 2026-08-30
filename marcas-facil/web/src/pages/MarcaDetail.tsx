/**
 * Detalle de Marca — MARCAS FÁCIL
 */
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Edit, Shield, Bell, FileText, Clock,
  CheckCircle, AlertTriangle, Download, ToggleLeft, ToggleRight,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { marcasApi, documentosApi, getApiError } from '../services/api';
import { BadgeEstadoMarca } from '../components/ui/Badge';
import { PageLoader } from '../components/ui/Spinner';
import { CLASES_NIZA } from '../types';
import type { EstadoMarca } from '../types';

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex justify-between py-2.5 border-b border-gray-50 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900">{value}</span>
    </div>
  );
}

export default function MarcaDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'info' | 'timeline' | 'docs'>('info');

  const { data: marca, isLoading } = useQuery({
    queryKey: ['marca', id],
    queryFn: () => marcasApi.obtener(id!),
    enabled: !!id,
  });

  const { data: timeline } = useQuery({
    queryKey: ['marca-timeline', id],
    queryFn: () => marcasApi.timeline(id!),
    enabled: !!id && activeTab === 'timeline',
  });

  const vigilanciaMutation = useMutation({
    mutationFn: () => marcasApi.activarVigilancia(id!),
    onSuccess: () => {
      toast.success('Vigilancia actualizada');
      queryClient.invalidateQueries({ queryKey: ['marca', id] });
    },
    onError: (err) => toast.error(getApiError(err)),
  });

  const ddjjMutation = useMutation({
    mutationFn: (tipo: 'medio-termino' | 'renovacion') =>
      tipo === 'medio-termino'
        ? documentosApi.ddjjMedioTermino(id!)
        : documentosApi.ddjjRenovacion(id!),
    onSuccess: (data) => {
      toast.success('DDJJ generada — descargando...');
      window.open(data.url, '_blank');
    },
    onError: (err) => toast.error(getApiError(err)),
  });

  if (isLoading) return <PageLoader />;
  if (!marca) return null;

  const tabs = [
    { id: 'info', label: 'Información' },
    { id: 'timeline', label: 'Historial' },
    { id: 'docs', label: 'Documentos' },
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button
          onClick={() => navigate('/marcas')}
          className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg mt-1"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="page-title">{marca.denominacion}</h1>
            <BadgeEstadoMarca estado={marca.estado as EstadoMarca} />
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            Clase {marca.claseNiza} — {CLASES_NIZA[marca.claseNiza]}
          </p>
        </div>
        <button
          onClick={() => navigate(`/marcas/${id}/editar`)}
          className="btn-secondary"
        >
          <Edit className="w-4 h-4" />
          Editar
        </button>
      </div>

      {/* Acciones rápidas */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Vigilancia */}
        <button
          onClick={() => vigilanciaMutation.mutate()}
          className={`card p-3.5 flex flex-col items-center gap-2 transition-all hover:shadow-md ${
            marca.vigilanciaActiva ? 'border-green-200 bg-green-50' : ''
          }`}
        >
          {marca.vigilanciaActiva
            ? <ToggleRight className="w-5 h-5 text-green-600" />
            : <ToggleLeft className="w-5 h-5 text-gray-400" />
          }
          <span className="text-xs font-medium text-center text-gray-700">
            {marca.vigilanciaActiva ? 'Vigilancia activa' : 'Activar vigilancia'}
          </span>
        </button>

        {/* DDJJ Medio Término */}
        <button
          onClick={() => ddjjMutation.mutate('medio-termino')}
          className="card p-3.5 flex flex-col items-center gap-2 hover:shadow-md transition-all"
        >
          <FileText className="w-5 h-5 text-blue-600" />
          <span className="text-xs font-medium text-center text-gray-700">DDJJ Medio Término</span>
        </button>

        {/* DDJJ Renovación */}
        <button
          onClick={() => ddjjMutation.mutate('renovacion')}
          className="card p-3.5 flex flex-col items-center gap-2 hover:shadow-md transition-all"
        >
          <Download className="w-5 h-5 text-purple-600" />
          <span className="text-xs font-medium text-center text-gray-700">DDJJ Renovación</span>
        </button>

        {/* Alertas */}
        <button
          onClick={() => navigate('/alertas')}
          className="card p-3.5 flex flex-col items-center gap-2 hover:shadow-md transition-all"
        >
          <Bell className="w-5 h-5 text-orange-500" />
          <span className="text-xs font-medium text-center text-gray-700">
            {marca._count?.alertas || 0} alerta{(marca._count?.alertas || 0) !== 1 ? 's' : ''}
          </span>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab: Información */}
      {activeTab === 'info' && (
        <div className="space-y-4">
          {/* Datos generales */}
          <div className="card p-5">
            <h3 className="section-title mb-4">Datos generales</h3>
            <InfoRow label="Denominación" value={marca.denominacion} />
            <InfoRow label="Clase de Niza" value={`${marca.claseNiza} — ${CLASES_NIZA[marca.claseNiza]}`} />
            <InfoRow label="Tipo de marca" value={marca.tipoMarca} />
            <InfoRow label="Estado" value={marca.estado} />
            <InfoRow label="Descripción" value={marca.descripcionProductos} />
          </div>

          {/* Trámite INPI */}
          <div className="card p-5">
            <h3 className="section-title mb-4">Trámite INPI</h3>
            <InfoRow label="Número de acta" value={marca.numeroActa} />
            <InfoRow label="Número de certificado" value={marca.numeroCertificado} />
            <InfoRow
              label="Fecha de solicitud"
              value={marca.fechaSolicitud
                ? format(parseISO(marca.fechaSolicitud), "d 'de' MMMM 'de' yyyy", { locale: es })
                : undefined}
            />
            <InfoRow
              label="Fecha de concesión"
              value={marca.fechaConcesion
                ? format(parseISO(marca.fechaConcesion), "d 'de' MMMM 'de' yyyy", { locale: es })
                : undefined}
            />
            <InfoRow
              label="Vencimiento del registro"
              value={marca.fechaVencimiento
                ? format(parseISO(marca.fechaVencimiento), "d 'de' MMMM 'de' yyyy", { locale: es })
                : undefined}
            />
            <InfoRow
              label="Vencimiento DDJJ (Art. 26)"
              value={marca.ddjjVencimiento
                ? format(parseISO(marca.ddjjVencimiento), "d 'de' MMMM 'de' yyyy", { locale: es })
                : undefined}
            />
          </div>

          {/* Notas */}
          {marca.notas && (
            <div className="card p-5">
              <h3 className="section-title mb-3">Notas</h3>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{marca.notas}</p>
            </div>
          )}

          {/* Estadísticas */}
          <div className="card p-5">
            <h3 className="section-title mb-4">Actividad</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center">
                <p className="text-2xl font-bold text-gray-900">{marca._count?.alertas || 0}</p>
                <p className="text-xs text-gray-500 mt-0.5">Alertas</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-gray-900">{marca._count?.oposicionesFormuladas || 0}</p>
                <p className="text-xs text-gray-500 mt-0.5">Oposiciones formuladas</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-gray-900">{marca._count?.oposicionesRecibidas || 0}</p>
                <p className="text-xs text-gray-500 mt-0.5">Oposiciones recibidas</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Timeline */}
      {activeTab === 'timeline' && (
        <div className="card p-5">
          <h3 className="section-title mb-4">Historial del trámite</h3>
          {(!timeline || timeline.length === 0) ? (
            <div className="text-center py-8 text-gray-500">
              <Clock className="w-10 h-10 mx-auto mb-2 text-gray-300" />
              <p className="text-sm">Sin eventos registrados</p>
            </div>
          ) : (
            <div className="space-y-0">
              {timeline.map((event, i) => (
                <div key={i} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className="w-2 h-2 rounded-full bg-primary-500 mt-2 flex-shrink-0" />
                    {i < timeline.length - 1 && (
                      <div className="w-px flex-1 bg-gray-200 my-1" />
                    )}
                  </div>
                  <div className="pb-5">
                    <p className="text-sm font-medium text-gray-900">{event.descripcion}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {format(parseISO(event.fecha), "d MMM yyyy, HH:mm", { locale: es })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Documentos */}
      {activeTab === 'docs' && (
        <div className="card p-5 space-y-4">
          <h3 className="section-title">Documentos disponibles</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 border border-gray-200 rounded-xl">
              <div>
                <p className="text-sm font-medium">DDJJ de Uso — Medio Término (Art. 26)</p>
                <p className="text-xs text-gray-500">Obligatoria en el año 6 desde la concesión</p>
              </div>
              <button
                onClick={() => ddjjMutation.mutate('medio-termino')}
                className="btn-secondary py-1.5 px-3 text-xs"
              >
                <Download className="w-3.5 h-3.5" />
                Generar
              </button>
            </div>
            <div className="flex items-center justify-between p-3 border border-gray-200 rounded-xl">
              <div>
                <p className="text-sm font-medium">DDJJ de Uso — Renovación</p>
                <p className="text-xs text-gray-500">Para acompañar la solicitud de renovación</p>
              </div>
              <button
                onClick={() => ddjjMutation.mutate('renovacion')}
                className="btn-secondary py-1.5 px-3 text-xs"
              >
                <Download className="w-3.5 h-3.5" />
                Generar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
