/**
 * Detalle de Oposición — MARCAS FÁCIL
 * Gestión del flujo completo según Res. INPI 297/2026
 */
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, FileText, Download, AlertTriangle, CheckCircle,
  Clock, Shield, ChevronRight, Send,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { oposicionesApi, getApiError } from '../services/api';
import { BadgeEstadoOposicion } from '../components/ui/Badge';
import { PageLoader } from '../components/ui/Spinner';
import { Modal } from '../components/ui/Modal';

// ── Step indicator ─────────────────────────────────────────────────────────────
const STEPS = [
  { id: 'FORMULADA', label: 'Oposición formulada' },
  { id: 'MANTENIDA', label: 'Mantenida' },
  { id: 'EN_TRAMITE', label: 'En trámite' },
  { id: 'FUNDADA', label: 'Resuelta' },
];

const STEP_ORDER = ['FORMULADA', 'MANTENIDA', 'EN_TRAMITE', 'FUNDADA'];

function StepIndicator({ estadoActual }: { estadoActual: string }) {
  const currentIdx = STEP_ORDER.indexOf(estadoActual);
  const resolvedIdx = ['FUNDADA', 'INFUNDADA', 'DESISTIDA', 'ABANDONADA'].includes(estadoActual)
    ? 3 : currentIdx;

  return (
    <div className="flex items-center gap-0">
      {STEPS.map((step, i) => {
        const done = i < resolvedIdx;
        const active = i === resolvedIdx;
        return (
          <div key={step.id} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                done ? 'bg-primary-600 text-white' :
                active ? 'bg-primary-100 text-primary-700 ring-2 ring-primary-400' :
                'bg-gray-100 text-gray-400'
              }`}>
                {done ? <CheckCircle className="w-4 h-4" /> : i + 1}
              </div>
              <span className={`text-[11px] mt-1 text-center leading-tight max-w-[60px] ${
                active ? 'font-medium text-primary-700' : 'text-gray-400'
              }`}>
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`h-0.5 flex-1 mb-5 ${done ? 'bg-primary-400' : 'bg-gray-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Modal: mantener oposición ──────────────────────────────────────────────────
function ModalMantener({
  isOpen, onClose, oposicionId,
}: { isOpen: boolean; onClose: () => void; oposicionId: string }) {
  const queryClient = useQueryClient();
  const [fechaNotificacion, setFechaNotificacion] = useState('');
  const [ampliar, setAmpliar] = useState('');

  const mutation = useMutation({
    mutationFn: () => oposicionesApi.mantener(oposicionId, {
      fechaNotificacion: new Date(fechaNotificacion).toISOString(),
      ampliarFundamentos: ampliar || undefined,
    }),
    onSuccess: (data) => {
      toast.success('Oposición mantenida — PDF generado');
      queryClient.invalidateQueries({ queryKey: ['oposicion', oposicionId] });
      queryClient.invalidateQueries({ queryKey: ['oposiciones'] });
      // Intentar abrir PDF
      if (data.documentoPDF) window.open(`/api/documentos/${encodeURIComponent(data.documentoPDF)}`, '_blank');
      onClose();
    },
    onError: (err) => toast.error(getApiError(err)),
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Mantener oposición" size="lg">
      <div className="space-y-4">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-800">
          <p className="font-medium">Art. 1 Res. INPI 297/2026</p>
          <p className="text-xs mt-0.5">
            El INPI notifica al oponente. Tiene <strong>15 días hábiles</strong> desde
            esa notificación para mantener la oposición y abonar el arancel correspondiente.
          </p>
        </div>

        <div>
          <label className="label">Fecha de notificación del INPI *</label>
          <input
            type="date"
            value={fechaNotificacion}
            onChange={(e) => setFechaNotificacion(e.target.value)}
            className="input"
          />
        </div>

        <div>
          <label className="label">Ampliación de fundamentos (opcional)</label>
          <textarea
            value={ampliar}
            onChange={(e) => setAmpliar(e.target.value)}
            className="input"
            rows={4}
            placeholder="Texto adicional a agregar a los fundamentos estándar de la plantilla..."
          />
          <p className="text-xs text-gray-400 mt-1">
            Los fundamentos estándar de la plantilla se incluyen siempre de forma automática
          </p>
        </div>

        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!fechaNotificacion || mutation.isPending}
            className="btn-primary"
          >
            <Download className="w-4 h-4" />
            {mutation.isPending ? 'Generando PDF...' : 'Mantener y generar PDF'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Modal: registrar resolución ────────────────────────────────────────────────
function ModalResolucion({
  isOpen, onClose, oposicionId,
}: { isOpen: boolean; onClose: () => void; oposicionId: string }) {
  const queryClient = useQueryClient();
  const [resolucion, setResolucion] = useState<'FUNDADA' | 'INFUNDADA' | 'DESISTIDA' | 'ABANDONADA'>('FUNDADA');
  const [numero, setNumero] = useState('');
  const [fundamentos, setFundamentos] = useState('');

  const mutation = useMutation({
    mutationFn: () => oposicionesApi.registrarResolucion(oposicionId, {
      resolucion,
      numeroResolucion: numero || undefined,
      fundamentosResolucion: fundamentos || undefined,
    }),
    onSuccess: (data) => {
      toast.success(data.mensaje);
      queryClient.invalidateQueries({ queryKey: ['oposicion', oposicionId] });
      queryClient.invalidateQueries({ queryKey: ['oposiciones'] });
      onClose();
    },
    onError: (err) => toast.error(getApiError(err)),
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Registrar resolución INPI" size="md">
      <div className="space-y-4">
        <div>
          <label className="label">Resultado *</label>
          <div className="grid grid-cols-2 gap-2">
            {(['FUNDADA', 'INFUNDADA', 'DESISTIDA', 'ABANDONADA'] as const).map(r => (
              <button
                key={r}
                onClick={() => setResolucion(r)}
                className={`p-3 rounded-xl border text-sm font-medium transition-colors ${
                  resolucion === r
                    ? r === 'FUNDADA' ? 'border-green-400 bg-green-50 text-green-700'
                      : 'border-primary-400 bg-primary-50 text-primary-700'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {r === 'FUNDADA' && '✓ Fundada'}
                {r === 'INFUNDADA' && '✗ Infundada'}
                {r === 'DESISTIDA' && 'Desistida'}
                {r === 'ABANDONADA' && 'Abandonada'}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="label">N° de resolución INPI</label>
          <input type="text" value={numero} onChange={e => setNumero(e.target.value)} className="input" placeholder="Ej: 1234/2026" />
        </div>
        <div>
          <label className="label">Fundamentos de la resolución</label>
          <textarea value={fundamentos} onChange={e => setFundamentos(e.target.value)} className="input" rows={3} />
        </div>
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="btn-primary">
            {mutation.isPending ? 'Guardando...' : 'Guardar resolución'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
export default function OposicionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [showMantener, setShowMantener] = useState(false);
  const [showResolucion, setShowResolucion] = useState(false);

  const { data: op, isLoading } = useQuery({
    queryKey: ['oposicion', id],
    queryFn: () => oposicionesApi.obtener(id!),
    enabled: !!id,
  });

  const pdfMutation = useMutation({
    mutationFn: () => oposicionesApi.generarPDF(id!),
    onSuccess: (data) => {
      toast.success('PDF generado');
      window.open(data.url, '_blank');
    },
    onError: (err) => toast.error(getApiError(err)),
  });

  if (isLoading) return <PageLoader />;
  if (!op) return null;

  const esActiva = !['FUNDADA', 'INFUNDADA', 'DESISTIDA', 'ABANDONADA'].includes(op.estado);
  const puedeGenPDF = op.estado === 'FORMULADA';
  const puedeMantener = op.estado === 'FORMULADA' || op.estado === 'MANTENIDA';
  const puedeResolucion = ['MANTENIDA', 'EN_TRAMITE'].includes(op.estado);

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button
          onClick={() => navigate('/oposiciones')}
          className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg mt-1"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="page-title">{op.denominacionOpuesta}</h1>
            <BadgeEstadoOposicion estado={op.estado} />
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            Acta {op.actaOpuesta} · Clase {op.claseOpuesta}
            {op.esRes297 && <span className="ml-2 text-[11px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Res. 297/2026</span>}
          </p>
        </div>
      </div>

      {/* Indicador de pasos */}
      {esActiva && (
        <div className="card p-5">
          <h3 className="text-sm font-medium text-gray-700 mb-4">Progreso del trámite</h3>
          <StepIndicator estadoActual={op.estado} />
        </div>
      )}

      {/* Próximo plazo urgente */}
      {op.proximoPlazo && (
        <div className={`flex items-start gap-3 p-4 rounded-xl border ${
          op.proximoPlazo.urgente
            ? 'border-red-200 bg-red-50'
            : 'border-orange-200 bg-orange-50'
        }`}>
          <AlertTriangle className={`w-5 h-5 flex-shrink-0 mt-0.5 ${op.proximoPlazo.urgente ? 'text-red-500' : 'text-orange-500'}`} />
          <div>
            <p className={`text-sm font-semibold ${op.proximoPlazo.urgente ? 'text-red-900' : 'text-orange-900'}`}>
              {op.proximoPlazo.tipo}
            </p>
            <p className={`text-sm ${op.proximoPlazo.urgente ? 'text-red-700' : 'text-orange-700'}`}>
              Vence el {format(parseISO(op.proximoPlazo.fecha), "d 'de' MMMM", { locale: es })} ({op.proximoPlazo.diasRestantes} días)
              {op.proximoPlazo.urgente && <strong className="ml-1">— URGENTE</strong>}
            </p>
          </div>
        </div>
      )}

      {/* Acciones */}
      {esActiva && (
        <div className="card p-4">
          <h3 className="section-title mb-3">Acciones</h3>
          <div className="flex flex-wrap gap-3">
            {puedeGenPDF && (
              <button
                onClick={() => pdfMutation.mutate()}
                disabled={pdfMutation.isPending}
                className="btn-primary"
              >
                <FileText className="w-4 h-4" />
                {pdfMutation.isPending ? 'Generando...' : 'Generar PDF oposición'}
              </button>
            )}
            {puedeMantener && (
              <button onClick={() => setShowMantener(true)} className="btn-secondary">
                <Shield className="w-4 h-4" />
                Mantener oposición
              </button>
            )}
            {puedeResolucion && (
              <button onClick={() => setShowResolucion(true)} className="btn-secondary">
                <CheckCircle className="w-4 h-4" />
                Registrar resolución
              </button>
            )}
          </div>

          {puedeGenPDF && (
            <div className="mt-3 text-xs text-gray-500 space-y-0.5">
              <p className="font-medium">Instrucciones para presentar ante INPI:</p>
              <p>1. Generá el PDF → 2. Ingresá a inpi.gob.ar con Clave Fiscal → 3. Marcas → Trámites → Oposiciones → 4. Completá el acta y adjuntá el PDF → 5. Abonás el arancel (Cód. 126000)</p>
            </div>
          )}
        </div>
      )}

      {/* Información de la oposición */}
      <div className="card p-5 space-y-2">
        <h3 className="section-title mb-3">Datos de la oposición</h3>
        {[
          ['Marca propia afectada', op.marcaOponente?.denominacion ? `${op.marcaOponente.denominacion} (Clase ${op.marcaOponente.claseNiza})` : undefined],
          ['Marca opuesta', op.denominacionOpuesta],
          ['Acta INPI', op.actaOpuesta],
          ['Clase de la marca opuesta', `Clase ${op.claseOpuesta}`],
          ['Oponente', op.oponenteNombre],
          ['CUIT oponente', op.oponenteCuit],
          ['Fecha publicación Boletín', op.fechaPublicacion ? format(parseISO(op.fechaPublicacion), "d 'de' MMMM 'de' yyyy", { locale: es }) : undefined],
          ['Plazo de oposición', op.plazoOposicion ? format(parseISO(op.plazoOposicion), "d 'de' MMMM 'de' yyyy", { locale: es }) : undefined],
          ['Plazo de mantenimiento', op.plazoMantenimiento ? format(parseISO(op.plazoMantenimiento), "d 'de' MMMM 'de' yyyy", { locale: es }) : undefined],
          ['N° de resolución INPI', op.resolucionNumero],
        ].filter(([, v]) => v).map(([label, value]) => (
          <div key={label} className="flex justify-between py-2.5 border-b border-gray-50 last:border-0">
            <span className="text-sm text-gray-500">{label}</span>
            <span className="text-sm font-medium text-gray-900 text-right max-w-[60%]">{value}</span>
          </div>
        ))}
      </div>

      {/* Fundamentos */}
      {op.fundamentosTexto && (
        <div className="card p-5">
          <h3 className="section-title mb-3">Fundamentos de la oposición</h3>
          <p className="text-sm text-gray-700 leading-relaxed">{op.fundamentosTexto}</p>
        </div>
      )}

      {/* Resolución final */}
      {op.resolucionTexto && (
        <div className="card p-5">
          <h3 className="section-title mb-3">Resolución INPI</h3>
          <p className="text-sm text-gray-700">{op.resolucionTexto}</p>
        </div>
      )}

      {/* Modales */}
      <ModalMantener
        isOpen={showMantener}
        onClose={() => setShowMantener(false)}
        oposicionId={id!}
      />
      <ModalResolucion
        isOpen={showResolucion}
        onClose={() => setShowResolucion(false)}
        oposicionId={id!}
      />
    </div>
  );
}
