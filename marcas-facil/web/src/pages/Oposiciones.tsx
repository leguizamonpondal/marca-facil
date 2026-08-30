/**
 * Oposiciones — MARCAS FÁCIL
 * Gestión completa del flujo Res. INPI 297/2026
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Shield, Plus, AlertTriangle, Clock, ChevronRight,
  CheckCircle, XCircle, FileText, Filter,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { oposicionesApi, marcasApi, getApiError } from '../services/api';
import { BadgeEstadoOposicion } from '../components/ui/Badge';
import { PageLoader } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal } from '../components/ui/Modal';
import { CLASES_NIZA } from '../types';
import type { Oposicion } from '../types';

const ESTADOS_FILTRO = [
  { value: '', label: 'Todas' },
  { value: 'FORMULADA', label: 'Formuladas' },
  { value: 'MANTENIDA', label: 'Mantenidas' },
  { value: 'EN_TRAMITE', label: 'En trámite' },
  { value: 'FUNDADA', label: 'Fundadas' },
  { value: 'INFUNDADA', label: 'Infundadas' },
];

// ── Modal: crear oposición ─────────────────────────────────────────────────────
function ModalNuevaOposicion({
  isOpen, onClose,
}: { isOpen: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: marcasData } = useQuery({
    queryKey: ['marcas-selector'],
    queryFn: () => marcasApi.listar({ limit: 100 }),
    enabled: isOpen,
  });

  const [form, setForm] = useState({
    marcaOponenteId: '',
    actaOpuesta: '',
    denominacionOpuesta: '',
    claseOpuesta: 35,
    oponenteNombre: '',
    oponenteCuit: '',
    fechaPublicacion: '',
  });

  const mutation = useMutation({
    mutationFn: () => oposicionesApi.crear({
      ...form,
      claseOpuesta: Number(form.claseOpuesta),
      fechaPublicacion: new Date(form.fechaPublicacion).toISOString(),
    }),
    onSuccess: () => {
      toast.success('Oposición creada');
      queryClient.invalidateQueries({ queryKey: ['oposiciones'] });
      onClose();
    },
    onError: (err) => toast.error(getApiError(err)),
  });

  const set = (f: string, v: any) => setForm(p => ({ ...p, [f]: v }));
  const marcas = marcasData?.data || [];
  const valid = form.marcaOponenteId && form.actaOpuesta && form.denominacionOpuesta && form.fechaPublicacion;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Registrar oposición" size="lg">
      <div className="space-y-4">
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 text-sm text-orange-800">
          <p className="font-medium">Plazo: 30 días corridos desde la publicación en el Boletín de Marcas</p>
          <p className="text-xs mt-0.5">Res. INPI 297/2026 — Acción por confusabilidad directa</p>
        </div>

        <div>
          <label className="label">Marca propia que se ve afectada *</label>
          <select
            value={form.marcaOponenteId}
            onChange={(e) => set('marcaOponenteId', e.target.value)}
            className="input"
          >
            <option value="">Seleccioná tu marca...</option>
            {marcas.map(m => (
              <option key={m.id} value={m.id}>
                {m.denominacion} — Clase {m.claseNiza}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Acta opuesta (INPI) *</label>
            <input
              type="text"
              value={form.actaOpuesta}
              onChange={(e) => set('actaOpuesta', e.target.value)}
              className="input"
              placeholder="Ej: 4.567.890"
            />
          </div>
          <div>
            <label className="label">Clase de la marca opuesta *</label>
            <select
              value={form.claseOpuesta}
              onChange={(e) => set('claseOpuesta', Number(e.target.value))}
              className="input"
            >
              {Object.entries(CLASES_NIZA).map(([n, d]) => (
                <option key={n} value={n}>Clase {n}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label">Denominación de la marca opuesta *</label>
          <input
            type="text"
            value={form.denominacionOpuesta}
            onChange={(e) => set('denominacionOpuesta', e.target.value.toUpperCase())}
            className="input"
            placeholder="Como figura en el Boletín"
          />
        </div>

        <div>
          <label className="label">Fecha de publicación en el Boletín *</label>
          <input
            type="date"
            value={form.fechaPublicacion}
            onChange={(e) => set('fechaPublicacion', e.target.value)}
            className="input"
          />
          <p className="text-xs text-gray-400 mt-1">
            El plazo de 30 días corre desde el día siguiente a la publicación
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Nombre del oponente</label>
            <input
              type="text"
              value={form.oponenteNombre}
              onChange={(e) => set('oponenteNombre', e.target.value)}
              className="input"
              placeholder="Razón social o nombre"
            />
          </div>
          <div>
            <label className="label">CUIT del oponente</label>
            <input
              type="text"
              value={form.oponenteCuit}
              onChange={(e) => set('oponenteCuit', e.target.value)}
              className="input"
              placeholder="20-12345678-1"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!valid || mutation.isPending}
            className="btn-primary"
          >
            {mutation.isPending ? 'Registrando...' : 'Registrar oposición'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Tarjeta de oposición ──────────────────────────────────────────────────────
function OposicionCard({
  op, onClick,
}: { op: Oposicion; onClick: () => void }) {
  const esUrgente = op.proximoPlazo?.urgente;
  const diasRestantes = op.proximoPlazo?.diasRestantes;

  return (
    <div
      onClick={onClick}
      className={`card p-4 cursor-pointer hover:shadow-md transition-all ${
        esUrgente ? 'border-red-200' : ''
      }`}
    >
      <div className="flex items-start gap-4">
        {/* Ícono estado */}
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
          op.estado === 'FUNDADA' ? 'bg-green-100' :
          op.estado === 'INFUNDADA' ? 'bg-red-100' :
          esUrgente ? 'bg-red-100' : 'bg-orange-100'
        }`}>
          {op.estado === 'FUNDADA'
            ? <CheckCircle className="w-5 h-5 text-green-600" />
            : op.estado === 'INFUNDADA'
            ? <XCircle className="w-5 h-5 text-red-600" />
            : <Shield className={`w-5 h-5 ${esUrgente ? 'text-red-500' : 'text-orange-500'}`} />
          }
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-semibold text-gray-900">{op.denominacionOpuesta}</h3>
              <p className="text-sm text-gray-500 mt-0.5">
                Acta {op.actaOpuesta} · Clase {op.claseOpuesta}
                {op.oponenteNombre && ` · ${op.oponenteNombre}`}
              </p>
            </div>
            <BadgeEstadoOposicion estado={op.estado} />
          </div>

          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
            <span>Marca propia: {op.marcaOponente?.denominacion}</span>
            <span>
              Publicado: {format(parseISO(op.fechaPublicacion), 'd MMM yyyy', { locale: es })}
            </span>
            <span>
              Plazo oposición: {format(parseISO(op.plazoOposicion), 'd MMM yyyy', { locale: es })}
            </span>
          </div>

          {/* Próximo plazo urgente */}
          {op.proximoPlazo && (
            <div className={`mt-2 inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${
              op.proximoPlazo.urgente
                ? 'bg-red-100 text-red-700'
                : 'bg-orange-100 text-orange-700'
            }`}>
              <Clock className="w-3 h-3" />
              {op.proximoPlazo.tipo}: {op.proximoPlazo.diasRestantes} día{op.proximoPlazo.diasRestantes !== 1 ? 's' : ''}
              {op.proximoPlazo.urgente && ' — URGENTE'}
            </div>
          )}

          {/* Resolución */}
          {op.resolucionNumero && (
            <p className="mt-1.5 text-xs text-gray-500">Resolución INPI N° {op.resolucionNumero}</p>
          )}
        </div>

        <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0 mt-1" />
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
export default function Oposiciones() {
  const navigate = useNavigate();
  const [filtroEstado, setFiltroEstado] = useState('');
  const [page, setPage] = useState(1);
  const [showNueva, setShowNueva] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['oposiciones', filtroEstado, page],
    queryFn: () => oposicionesApi.listar({
      estado: filtroEstado || undefined,
      page, limit: 20,
    }),
  });

  const oposiciones = data?.data || [];
  const activas = oposiciones.filter(o =>
    !['FUNDADA', 'INFUNDADA', 'DESISTIDA', 'ABANDONADA'].includes(o.estado)
  );

  if (isLoading && !data) return <PageLoader />;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Oposiciones</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {data?.meta.total || 0} total · {activas.length} activa{activas.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button onClick={() => setShowNueva(true)} className="btn-primary">
          <Plus className="w-4 h-4" />
          Nueva oposición
        </button>
      </div>

      {/* Info Res. 297/2026 */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
        <p className="font-semibold mb-1">Plazos según Res. INPI 297/2026 (vigente desde 01/03/2026)</p>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
          <span>Oposición: 30 días corridos desde publicación</span>
          <span>Mantenimiento: 15 días hábiles (Art. 1)</span>
          <span>Traslado: 15 días hábiles (Art. 2)</span>
          <span>Argumentos finales: 10 días hábiles (Art. 6)</span>
        </div>
      </div>

      {/* Filtro */}
      <div className="card p-3 flex items-center gap-3">
        <Filter className="w-4 h-4 text-gray-400" />
        <div className="flex gap-2 flex-wrap">
          {ESTADOS_FILTRO.map(e => (
            <button
              key={e.value}
              onClick={() => { setFiltroEstado(e.value); setPage(1); }}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                filtroEstado === e.value
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {e.label}
            </button>
          ))}
        </div>
      </div>

      {/* Lista */}
      {oposiciones.length === 0 ? (
        <EmptyState
          icon={Shield}
          title="Sin oposiciones"
          description={filtroEstado
            ? 'No hay oposiciones con este estado'
            : 'Las oposiciones detectadas automáticamente o cargadas manualmente aparecerán acá'
          }
          action={!filtroEstado ? {
            label: 'Registrar oposición',
            onClick: () => setShowNueva(true),
          } : undefined}
        />
      ) : (
        <div className="space-y-3">
          {oposiciones.map((op) => (
            <OposicionCard
              key={op.id}
              op={op}
              onClick={() => navigate(`/oposiciones/${op.id}`)}
            />
          ))}
        </div>
      )}

      {/* Paginación */}
      {data && data.meta.pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="btn-secondary py-1.5 px-3 text-sm"
          >
            ← Anterior
          </button>
          <span className="text-sm text-gray-600">Página {page} de {data.meta.pages}</span>
          <button
            onClick={() => setPage(p => Math.min(data.meta.pages, p + 1))}
            disabled={page === data.meta.pages}
            className="btn-secondary py-1.5 px-3 text-sm"
          >
            Siguiente →
          </button>
        </div>
      )}

      {/* Modal nueva oposición */}
      <ModalNuevaOposicion
        isOpen={showNueva}
        onClose={() => setShowNueva(false)}
      />
    </div>
  );
}
