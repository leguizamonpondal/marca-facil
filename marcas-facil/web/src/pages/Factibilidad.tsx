/**
 * Estudio de Factibilidad — MARCAS FÁCIL
 * Búsqueda de antecedentes y diagnóstico de viabilidad
 */
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Search, AlertTriangle, CheckCircle, XCircle, Clock, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import { factibilidadApi, getApiError } from '../services/api';
import { BadgeDictamen } from '../components/ui/Badge';
import { Spinner, PageLoader } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import { CLASES_NIZA } from '../types';

const TIPOS_MARCA = [
  { value: 'DENOMINATIVA', label: 'Denominativa' },
  { value: 'FIGURATIVA', label: 'Figurativa' },
  { value: 'MIXTA', label: 'Mixta' },
];

export default function Factibilidad() {
  const [denominacion, setDenominacion] = useState('');
  const [claseNiza, setClaseNiza] = useState<number>(35);
  const [tipoMarca, setTipoMarca] = useState('DENOMINATIVA');
  const [resultado, setResultado] = useState<any>(null);

  const { data: historial, isLoading: loadingHistorial } = useQuery({
    queryKey: ['factibilidad-historial'],
    queryFn: () => factibilidadApi.historial(),
  });

  const estudiarMutation = useMutation({
    mutationFn: () => factibilidadApi.estudiar({ denominacion, claseNiza, tipoMarca }),
    onSuccess: (data) => {
      setResultado(data);
    },
    onError: (err) => toast.error(getApiError(err)),
  });

  const puedeConsultar = denominacion.trim().length >= 2;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="page-title">Búsqueda de antecedentes</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Evaluación de viabilidad de registro en el INPI
        </p>
      </div>

      {/* Formulario de consulta */}
      <div className="card p-6 space-y-4">
        <h2 className="section-title">Nueva consulta</h2>

        <div>
          <label className="label">Denominación a registrar *</label>
          <input
            type="text"
            value={denominacion}
            onChange={(e) => setDenominacion(e.target.value.toUpperCase())}
            className="input"
            placeholder="Ingresá la marca tal como la registrarías..."
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Clase de Niza *</label>
            <select
              value={claseNiza}
              onChange={(e) => setClaseNiza(Number(e.target.value))}
              className="input"
            >
              {Object.entries(CLASES_NIZA).map(([n, d]) => (
                <option key={n} value={n}>Clase {n} — {d}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Tipo de marca</label>
            <select
              value={tipoMarca}
              onChange={(e) => setTipoMarca(e.target.value)}
              className="input"
            >
              {TIPOS_MARCA.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-500 space-y-1">
          <p className="font-medium text-gray-700">Metodología de análisis</p>
          <p>· Búsqueda en el Boletín de Marcas del INPI (base actualizada semanalmente)</p>
          <p>· Algoritmo de confundibilidad: similitud fonética + visual (Levenshtein + trigramas)</p>
          <p>· Análisis de clases relacionadas según jurisprudencia INPI</p>
          <p>· El estudio es orientativo — no reemplaza el análisis profesional personalizado</p>
        </div>

        <button
          onClick={() => estudiarMutation.mutate()}
          disabled={!puedeConsultar || estudiarMutation.isPending}
          className="btn-primary w-full justify-center py-3"
        >
          {estudiarMutation.isPending ? (
            <>
              <Spinner size="sm" />
              Analizando antecedentes...
            </>
          ) : (
            <>
              <Search className="w-5 h-5" />
              Buscar antecedentes
            </>
          )}
        </button>
      </div>

      {/* Resultado */}
      {resultado && (
        <ResultadoFactibilidad
          resultado={resultado}
          onNuevaBusqueda={() => setResultado(null)}
        />
      )}

      {/* Historial */}
      {!resultado && (
        <div className="card p-5">
          <h2 className="section-title mb-4">Historial de consultas</h2>
          {loadingHistorial ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : !historial || historial.length === 0 ? (
            <EmptyState
              icon={Search}
              title="Sin consultas previas"
              description="Las búsquedas de antecedentes que realices aparecerán acá"
            />
          ) : (
            <div className="space-y-2">
              {historial.map(h => (
                <div
                  key={h.id}
                  className="flex items-center gap-4 p-3 rounded-xl border border-gray-100 hover:border-gray-200 hover:bg-gray-50 cursor-pointer"
                  onClick={() => setResultado(h)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{h.denominacion}</p>
                    <p className="text-xs text-gray-500">Clase {h.claseNiza} · {h.tipoMarca}</p>
                  </div>
                  <BadgeDictamen dictamen={h.dictamen} />
                  <span className="text-xs text-gray-400 flex-shrink-0">
                    {new Date(h.createdAt).toLocaleDateString('es-AR')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Resultado del estudio ──────────────────────────────────────────────────────
function ResultadoFactibilidad({
  resultado, onNuevaBusqueda,
}: { resultado: any; onNuevaBusqueda: () => void }) {
  const { dictamen, riesgo, resumenDictamen, totalAntecedentes, antecedentesConfundibles } = resultado;

  type DictConf = { icon: React.ElementType; color: string; bg: string; title: string };
  const dictamenMap: Record<string, DictConf> = {
    VIABLE: {
      icon: CheckCircle,
      color: 'text-green-600',
      bg: 'bg-green-50 border-green-200',
      title: '✓ Marca probablemente viable',
    },
    CONDICIONADA: {
      icon: AlertTriangle,
      color: 'text-yellow-600',
      bg: 'bg-yellow-50 border-yellow-200',
      title: '⚠ Viabilidad condicionada',
    },
    NO_VIABLE: {
      icon: XCircle,
      color: 'text-red-600',
      bg: 'bg-red-50 border-red-200',
      title: '✗ Alta probabilidad de oposición',
    },
  };
  const dictamenConfig: DictConf = dictamenMap[dictamen] || { icon: Search, color: 'text-gray-600', bg: 'bg-gray-50 border-gray-200', title: dictamen };

  const Icon = dictamenConfig.icon;

  return (
    <div className="space-y-4">
      {/* Resultado principal */}
      <div className={`rounded-xl border p-5 ${dictamenConfig.bg}`}>
        <div className="flex items-start gap-4">
          <Icon className={`w-8 h-8 flex-shrink-0 mt-0.5 ${dictamenConfig.color}`} />
          <div className="flex-1">
            <h3 className={`text-lg font-bold ${dictamenConfig.color}`}>{dictamenConfig.title}</h3>
            <p className="text-sm text-gray-700 mt-2 leading-relaxed">{resumenDictamen}</p>
          </div>
        </div>
      </div>

      {/* Métricas */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{totalAntecedentes}</p>
          <p className="text-xs text-gray-500 mt-0.5">Antecedentes encontrados</p>
        </div>
        <div className="card p-4 text-center">
          <p className={`text-2xl font-bold ${antecedentesConfundibles > 0 ? 'text-red-600' : 'text-green-600'}`}>
            {antecedentesConfundibles}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">Potencialmente confundibles</p>
        </div>
        <div className="card p-4 text-center">
          <p className={`text-2xl font-bold ${
            riesgo === 'ALTO' ? 'text-red-600' :
            riesgo === 'MEDIO' ? 'text-yellow-600' : 'text-green-600'
          }`}>{riesgo}</p>
          <p className="text-xs text-gray-500 mt-0.5">Nivel de riesgo</p>
        </div>
      </div>

      {/* Aviso legal */}
      <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-600">
        <p className="font-medium mb-1">Importante</p>
        <p className="text-xs">
          Este análisis automatizado es orientativo y no reemplaza el estudio jurídico profesional.
          La existencia o ausencia de antecedentes en la base no garantiza el resultado del trámite.
          Para una evaluación completa, contactate con el servicio de asesoramiento.
        </p>
      </div>

      {/* Acciones */}
      <div className="flex gap-3">
        <button onClick={onNuevaBusqueda} className="btn-secondary flex-1 justify-center">
          <Search className="w-4 h-4" />
          Nueva búsqueda
        </button>
        {resultado.pdfUrl && (
          <button
            onClick={() => window.open(resultado.pdfUrl, '_blank')}
            className="btn-primary flex-1 justify-center"
          >
            <Download className="w-4 h-4" />
            Descargar informe
          </button>
        )}
      </div>
    </div>
  );
}
