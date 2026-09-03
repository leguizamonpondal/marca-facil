/**
 * Estudio de Factibilidad — MARCA FÁCIL
 * Búsqueda de antecedentes y diagnóstico de viabilidad
 */
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Search, AlertTriangle, CheckCircle, XCircle, Download, User, Building2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { factibilidadApi, getApiError } from '../services/api';
import { BadgeDictamen } from '../components/ui/Badge';
import { Spinner } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import { CLASES_NIZA } from '../types';

// ── API helper para búsqueda por titular ─────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const API_BASE = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3001';

async function apiBuscarTitular(titular: string): Promise<any[]> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 60_000);
  try {
    const token = localStorage.getItem('mf_token');
    const res = await fetch(
      `${API_BASE}/api/factibilidad/buscar-titular?titular=${encodeURIComponent(titular)}`,
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: controller.signal,
      }
    );
    if (!res.ok) throw new Error(`Error ${res.status}`);
    const json = await res.json();
    return json.marcas ?? json ?? [];
  } finally {
    clearTimeout(tid);
  }
}

// ── Gauge de registrabilidad ──────────────────────────────────────────────────
function GaugeRegistrabilidad({ pct, recomienda }: { pct: number; recomienda: boolean }) {
  const color =
    pct > 75 ? { fg: '#15803d', bg: '#f0fdf4', border: '#bbf7d0', label: 'Muy alta' } :
    pct > 50 ? { fg: '#d97706', bg: '#fffbeb', border: '#fde68a', label: 'Moderada' } :
    pct > 25 ? { fg: '#ea580c', bg: '#fff7ed', border: '#fed7aa', label: 'Baja' } :
               { fg: '#dc2626', bg: '#fef2f2', border: '#fecaca', label: 'Muy baja' };

  return (
    <div className="card p-5">
      <h3 className="section-title mb-3">Registrabilidad estimada</h3>
      <div className="flex items-center gap-6">
        {/* Círculo indicador */}
        <div
          className="flex-shrink-0 w-24 h-24 rounded-full flex flex-col items-center justify-center border-4 font-bold"
          style={{ borderColor: color.fg, background: color.bg }}
        >
          <span className="text-3xl" style={{ color: color.fg }}>{pct}%</span>
          <span className="text-xs mt-0.5" style={{ color: color.fg }}>{color.label}</span>
        </div>

        {/* Barra de progreso + texto */}
        <div className="flex-1 space-y-2">
          <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
            <div
              className="h-3 rounded-full transition-all duration-500"
              style={{ width: `${pct}%`, background: color.fg }}
            />
          </div>

          {/* Escala referencial */}
          <div className="flex justify-between text-xs text-gray-400">
            <span>0%</span>
            <span className="text-orange-500">25%</span>
            <span className="text-yellow-500">50%</span>
            <span className="text-lime-600">75%</span>
            <span>100%</span>
          </div>

          {/* Banner de recomendación */}
          <div
            className="rounded-lg px-3 py-2 text-sm font-semibold flex items-center gap-2 border"
            style={{ background: recomienda ? '#f0fdf4' : '#fef2f2', borderColor: recomienda ? '#bbf7d0' : '#fecaca', color: recomienda ? '#15803d' : '#dc2626' }}
          >
            {recomienda
              ? <><CheckCircle className="w-4 h-4 flex-shrink-0" /> Recomendamos solicitar el registro</>
              : <><XCircle    className="w-4 h-4 flex-shrink-0" /> No recomendamos presentar sin revisar la denominación</>
            }
          </div>
        </div>
      </div>

      {/* Leyenda técnica */}
      <div className="mt-3 text-xs text-gray-500 space-y-0.5">
        <p>· <strong>&gt;75%</strong> — Muy probable que la marca se registre; riesgo de objeciones u oposiciones bajo.</p>
        <p>· <strong>50–75%</strong> — Buena probabilidad; pueden surgir obstáculos durante el proceso.</p>
        <p>· <strong>25–50%</strong> — Proceso probablemente difícil; obstáculos esperables.</p>
        <p>· <strong>&lt;25%</strong> — Probabilidades de registro bajas.</p>
        <p className="pt-1 text-gray-400">Recomendamos solicitar el registro cuando las posibilidades de éxito son superiores al 50%. Nuestras recomendaciones se basan en las búsquedas de marcas y en nuestra experiencia. Esto de ningún modo implica que no se presentarán objeciones por parte de la Oficina de Marcas o de terceros.</p>
      </div>
    </div>
  );
}

export default function Factibilidad() {
  const [modo, setModo] = useState<'denominacion' | 'titular'>('denominacion');

  // Modo denominación
  const [denominacion, setDenominacion] = useState('');
  const [claseNiza, setClaseNiza]       = useState<number>(35);
  const [resultado, setResultado]       = useState<any>(null);

  // Modo titular
  const [titular, setTitular]                   = useState('');
  const [resultadoTitular, setResultadoTitular] = useState<any[] | null>(null);

  const { data: historial, isLoading: loadingHistorial } = useQuery({
    queryKey: ['factibilidad-historial'],
    queryFn: () => factibilidadApi.historial(),
  });

  const estudiarMutation = useMutation({
    mutationFn: () => factibilidadApi.estudiar({ denominacion, claseNiza, tipoMarca: 'DENOMINATIVA' }),
    onSuccess: (data) => setResultado(data),
    onError: (err) => toast.error(getApiError(err)),
  });

  const titularMutation = useMutation({
    mutationFn: () => apiBuscarTitular(titular),
    onSuccess: (data) => setResultadoTitular(data),
    onError: () => toast.error('Error al buscar por titular. Verificá la conexión con el servidor.'),
  });

  const puedeConsultarDenom = denominacion.trim().length >= 2;
  const puedeConsultarTitular = titular.trim().length >= 2;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="page-title">Búsqueda de antecedentes</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Evaluación de viabilidad de registro en el INPI
        </p>
      </div>

      {/* Tabs de modo */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        <button
          onClick={() => { setModo('denominacion'); setResultadoTitular(null); }}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 ${
            modo === 'denominacion' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Search className="w-4 h-4" />
          Por denominación
        </button>
        <button
          onClick={() => { setModo('titular'); setResultado(null); }}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 ${
            modo === 'titular' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Building2 className="w-4 h-4" />
          Por titular
        </button>
      </div>

      {/* ── FORMULARIO: Búsqueda por denominación ── */}
      {modo === 'denominacion' && (
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

          <div>
            <label className="label">Clase de Niza *</label>
            <select
              value={claseNiza}
              onChange={(e) => setClaseNiza(Number(e.target.value))}
              className="input"
            >
              <option value={0}>Todas las clases (búsqueda amplia)</option>
              {Object.entries(CLASES_NIZA).map(([n, d]) => (
                <option key={n} value={n}>Clase {n} — {d}</option>
              ))}
            </select>
            {claseNiza === 0 && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-2">
                La búsqueda en todas las clases puede tomar más tiempo y devuelve más resultados. Recomendada para hacer un relevamiento completo del nombre antes de elegir clases.
              </p>
            )}
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-800 space-y-1">
            <p className="font-semibold text-blue-900">Búsqueda por componente denominativo</p>
            <p>La búsqueda se realiza sobre la <strong>denominación</strong> ingresada — igual para marcas denominativas y para el componente textual de marcas mixtas. El portal público del INPI no permite búsquedas por elementos figurativos.</p>
          </div>

          <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-500 space-y-1">
            <p className="font-medium text-gray-700">Metodología</p>
            <p>· Consulta en tiempo real al registro público del INPI</p>
            <p>· Análisis de confundibilidad fonética, gráfica e ideológica (Art. 3° b, Ley 22.362)</p>
            <p>· Evaluación de clases relacionadas según jurisprudencia INPI/CNCAF</p>
            <p>· Estudio orientativo — no reemplaza el análisis profesional personalizado</p>
          </div>

          <button
            onClick={() => estudiarMutation.mutate()}
            disabled={!puedeConsultarDenom || estudiarMutation.isPending}
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
      )}

      {/* ── FORMULARIO: Búsqueda por titular ── */}
      {modo === 'titular' && (
        <div className="card p-6 space-y-4">
          <h2 className="section-title">Buscar marcas por titular</h2>
          <p className="text-sm text-gray-500">
            Ingresá el nombre del titular tal como figura en el INPI (empresa o persona física) para ver todas sus marcas registradas. Útil para importar tus marcas existentes a la app.
          </p>

          <div>
            <label className="label">Nombre del titular *</label>
            <input
              type="text"
              value={titular}
              onChange={(e) => setTitular(e.target.value.toUpperCase())}
              className="input"
              placeholder="Ej: ADIDAS AG · EMPRESA S.A. · APELLIDO, NOMBRE"
            />
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-800">
            <p className="font-semibold text-blue-900 mb-1">Búsqueda en el registro público del INPI</p>
            <p>Se busca en todas las clases y estados (vigentes). El nombre debe coincidir con el registrado en el INPI. Si no encontrás resultados, probá con el nombre abreviado o sin forma jurídica (S.A., S.R.L., etc.).</p>
          </div>

          <button
            onClick={() => titularMutation.mutate()}
            disabled={!puedeConsultarTitular || titularMutation.isPending}
            className="btn-primary w-full justify-center py-3"
          >
            {titularMutation.isPending ? (
              <>
                <Spinner size="sm" />
                Buscando marcas...
              </>
            ) : (
              <>
                <User className="w-5 h-5" />
                Buscar marcas del titular
              </>
            )}
          </button>
        </div>
      )}

      {/* ── RESULTADO: Denominación ── */}
      {modo === 'denominacion' && resultado && (
        <ResultadoFactibilidad
          resultado={resultado}
          denominacion={denominacion}
          claseNiza={claseNiza}
          onNuevaBusqueda={() => setResultado(null)}
        />
      )}

      {/* ── RESULTADO: Titular ── */}
      {modo === 'titular' && resultadoTitular !== null && (
        <ResultadoTitular
          marcas={resultadoTitular}
          titular={titular}
          onNuevaBusqueda={() => setResultadoTitular(null)}
        />
      )}

      {/* Historial */}
      {modo === 'denominacion' && !resultado && (
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
              {historial.map((h: any) => (
                <div
                  key={h.id}
                  className="flex items-center gap-4 p-3 rounded-xl border border-gray-100 hover:border-gray-200 hover:bg-gray-50 cursor-pointer"
                  onClick={() => setResultado(h)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{h.denominacion}</p>
                    <p className="text-xs text-gray-500">Clase {h.claseNiza === 0 ? 'Todas' : h.claseNiza}</p>
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

// ── Resultado por titular ─────────────────────────────────────────────────────
function ResultadoTitular({ marcas, titular, onNuevaBusqueda }: {
  marcas: any[];
  titular: string;
  onNuevaBusqueda: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="card p-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900">
            Titular: <span className="text-blue-700">{titular}</span>
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {marcas.length === 0 ? 'Sin marcas encontradas' : `${marcas.length} marca${marcas.length !== 1 ? 's' : ''} encontrada${marcas.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button onClick={onNuevaBusqueda} className="btn-secondary text-sm">
          Nueva búsqueda
        </button>
      </div>

      {marcas.length === 0 ? (
        <div className="card p-8">
          <EmptyState
            icon={Building2}
            title="Sin resultados"
            description={`No se encontraron marcas vigentes para el titular "${titular}" en el registro del INPI.`}
          />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="section-title mb-0">Marcas registradas</h3>
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-semibold">
              {marcas.length} resultado{marcas.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-3 py-3 text-left">Acta</th>
                  <th className="px-3 py-3 text-left">Denominación</th>
                  <th className="px-3 py-3 text-center">Cl.</th>
                  <th className="px-3 py-3 text-left">Tipo</th>
                  <th className="px-3 py-3 text-left">Estado</th>
                  <th className="px-3 py-3 text-left">F. Ingreso</th>
                  <th className="px-3 py-3 text-left">Venc.</th>
                  <th className="px-3 py-3 text-left">Nro. Res.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {marcas.map((m: any, i: number) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-xs text-gray-500">{m.acta || '—'}</td>
                    <td className="px-3 py-2 text-sm font-semibold text-gray-900">{m.denominacion}</td>
                    <td className="px-3 py-2 text-xs text-center text-gray-600">{m.claseNiza ?? m.clase ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{m.tipoMarca || '—'}</td>
                    <td className="px-3 py-2 text-xs font-medium text-gray-700">{m.estado || '—'}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{m.fechaSolicitud || '—'}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{m.vencimiento || '—'}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{m.nroResolucion || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-blue-50 rounded-xl p-4 text-xs text-blue-700">
        Para agregar estas marcas a tu portafolio, ingresá a <strong>Mis marcas</strong> y usá la opción "Importar desde INPI".
      </div>
    </div>
  );
}

// ── Panel de análisis final por ejes ─────────────────────────────────────────
function AnalisisEjes({ antecedentes, dictamen }: { antecedentes: any[]; dictamen: string }) {
  if (antecedentes.length === 0) return null;

  const maxFonetico   = Math.max(0, ...antecedentes.map((a: any) => a.similitudFonetica  ?? 0));
  const maxGrafico    = Math.max(0, ...antecedentes.map((a: any) => a.similitudGrafica   ?? 0));
  const maxIdeologico = Math.max(0, ...antecedentes.map((a: any) => a.similitudIdeologica ?? 0));

  const confFonetico   = maxFonetico   >= 72;
  const confGrafico    = maxGrafico    >= 72;
  const confIdeologico = maxIdeologico >= 72;

  const ejesConf = [
    confFonetico   && 'fonético',
    confGrafico    && 'gráfico',
    confIdeologico && 'ideológico',
  ].filter(Boolean) as string[];

  const conclusion = ejesConf.length > 0
    ? `Confundibilidad detectada en eje ${ejesConf.join(' y ')} — la marca tal como está NO es aconsejable presentar.`
    : dictamen === 'CONDICIONADA'
    ? 'Similitud media en algún eje. La presentación es posible pero puede generar oposiciones.'
    : 'Sin confundibilidad significativa en ninguno de los tres ejes.';

  const ejes = [
    { label: 'Fonético', desc: 'Cómo suena al pronunciarse', valor: maxFonetico,   confundible: confFonetico },
    { label: 'Gráfico',  desc: 'Cómo se ve escrita',         valor: maxGrafico,    confundible: confGrafico },
    { label: 'Ideológico', desc: 'Concepto que evoca',       valor: maxIdeologico, confundible: confIdeologico },
  ];

  return (
    <div className="card p-5 space-y-4">
      <h3 className="section-title mb-0">Análisis por ejes de confundibilidad</h3>
      <p className="text-xs text-gray-500">
        Peor caso detectado entre todos los antecedentes. Si cualquier eje supera el 72%, existe riesgo de oposición (Art. 3° b) Ley 22.362).
      </p>

      <div className="grid grid-cols-3 gap-3">
        {ejes.map(eje => {
          const colorBg  = eje.confundible ? 'bg-red-50 border-red-200' : eje.valor >= 50 ? 'bg-yellow-50 border-yellow-200' : 'bg-green-50 border-green-200';
          const colorNum = eje.confundible ? 'text-red-600' : eje.valor >= 50 ? 'text-yellow-600' : 'text-green-600';
          const emoji    = eje.confundible ? '🔴' : eje.valor >= 50 ? '🟡' : '🟢';
          return (
            <div key={eje.label} className={`rounded-xl border p-4 text-center ${colorBg}`}>
              <div className="text-lg mb-1">{emoji}</div>
              <div className={`text-2xl font-bold ${colorNum}`}>{eje.valor}%</div>
              <div className="text-sm font-semibold text-gray-800 mt-1">{eje.label}</div>
              <div className="text-xs text-gray-500 mt-0.5">{eje.desc}</div>
            </div>
          );
        })}
      </div>

      <div className={`rounded-xl p-3 text-sm font-medium ${
        ejesConf.length > 0
          ? 'bg-red-50 text-red-800 border border-red-200'
          : dictamen === 'CONDICIONADA'
          ? 'bg-yellow-50 text-yellow-800 border border-yellow-200'
          : 'bg-green-50 text-green-800 border border-green-200'
      }`}>
        {conclusion}
      </div>
    </div>
  );
}

// ── Badge semáforo por eje de confundibilidad ────────────────────────────────
function EjeBadge({ valor }: { valor?: number }) {
  if (valor === undefined || valor === null) return <td className="px-3 py-2 text-center text-xs text-gray-300">—</td>;
  const color = valor >= 72
    ? 'bg-red-100 text-red-700'
    : valor >= 50
    ? 'bg-yellow-100 text-yellow-700'
    : 'bg-green-100 text-green-700';
  return (
    <td className="px-3 py-2 text-center">
      <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-semibold ${color}`}>{valor}%</span>
    </td>
  );
}

// ── Resultado ─────────────────────────────────────────────────────────────────
function ResultadoFactibilidad({
  resultado, denominacion, claseNiza, onNuevaBusqueda,
}: {
  resultado: any;
  denominacion: string;
  claseNiza: number;
  onNuevaBusqueda: () => void;
}) {
  const { dictamen, riesgo, resumenDictamen, antecedentes = [] } = resultado;
  const totalAntecedentes = resultado.totalAntecedentes ?? antecedentes.length;
  const antecedentesConfundibles = resultado.antecedentesConfundibles
    ?? antecedentes.filter((a: any) => a.confundible).length;
  const registrabilidad: number | null = resultado.registrabilidad ?? null;
  const recomienda: boolean = resultado.recomienda ?? false;

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
  const cfg: DictConf = dictamenMap[dictamen] || {
    icon: Search, color: 'text-gray-600', bg: 'bg-gray-50 border-gray-200', title: dictamen,
  };
  const Icon = cfg.icon;

  const descargarInforme = () => {
    const fecha = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const colorDictamen = dictamen === 'VIABLE' ? '#15803d' : dictamen === 'NO_VIABLE' ? '#dc2626' : '#d97706';
    const bgDictamen = dictamen === 'VIABLE' ? '#f0fdf4' : dictamen === 'NO_VIABLE' ? '#fef2f2' : '#fffbeb';
    const labelDictamen = dictamen === 'VIABLE' ? 'VIABLE' : dictamen === 'NO_VIABLE' ? 'NO VIABLE' : 'CONDICIONADA';

    const claseLabel = claseNiza === 0 ? 'Todas las clases' : `${claseNiza}`;
    const registrabilidadColor = registrabilidad !== null
      ? registrabilidad > 75 ? '#15803d' : registrabilidad > 50 ? '#d97706' : registrabilidad > 25 ? '#ea580c' : '#dc2626'
      : '#6b7280';

    const ejeBadgePDF = (val?: number) => {
      if (!val && val !== 0) return '<span style="color:#d1d5db">—</span>';
      const bg = val >= 72 ? '#fee2e2' : val >= 50 ? '#fef9c3' : '#dcfce7';
      const color = val >= 72 ? '#dc2626' : val >= 50 ? '#854d0e' : '#15803d';
      return `<span style="background:${bg};color:${color};padding:1px 6px;border-radius:4px;font-size:10px;font-weight:700">${val}%</span>`;
    };
    const filasAntecedentes = antecedentes.length === 0
      ? '<tr><td colspan="12" style="text-align:center;color:#6b7280;padding:16px">Sin antecedentes encontrados en el período analizado</td></tr>'
      : antecedentes.map((a: any) => `
          <tr style="border-bottom:1px solid #e5e7eb;background:${a.confundible ? '#fff5f5' : '#fff'}">
            <td style="padding:6px 4px;font-size:10px;color:#6b7280">${a.acta || '—'}</td>
            <td style="padding:6px 4px;font-size:11px;font-weight:600">${a.titular || '—'}</td>
            <td style="padding:6px 4px;font-size:10px;color:#374151">${a.fechaSolicitud || '—'}</td>
            <td style="padding:6px 4px;font-size:11px;text-align:center">${a.claseNiza ?? a.clase ?? '—'}</td>
            <td style="padding:6px 4px;font-size:12px;font-weight:700">${a.denominacion}</td>
            <td style="padding:6px 4px;font-size:10px;color:#374151">${a.tipoMarca || '—'}</td>
            <td style="padding:6px 4px;font-size:10px;color:#6b7280">${a.nroResolucion || '—'}</td>
            <td style="padding:6px 4px;font-size:10px;color:#374151">${a.estado || '—'}</td>
            <td style="padding:6px 4px;font-size:10px;color:#374151">${a.vencimiento || '—'}</td>
            <td style="padding:6px 4px;text-align:center">${ejeBadgePDF(a.similitudFonetica)}</td>
            <td style="padding:6px 4px;text-align:center">${ejeBadgePDF(a.similitudGrafica)}</td>
            <td style="padding:6px 4px;text-align:center">${ejeBadgePDF(a.similitudIdeologica)}</td>
          </tr>
        `).join('');

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Estudio de Factibilidad — ${denominacion}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; color: #111; background: #fff; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .no-print { display: none; }
    }
    .header { background: #1e3a6e; color: #fff; padding: 24px 40px; }
    .header h1 { font-size: 22px; font-weight: 700; }
    .header p { font-size: 12px; color: #93c5fd; margin-top: 4px; }
    .header .agente { font-size: 11px; color: #60a5fa; margin-top: 2px; }
    .body { padding: 32px 40px; }
    .dictamen-box {
      border: 2px solid ${colorDictamen};
      background: ${bgDictamen};
      border-radius: 8px;
      padding: 16px 20px;
      margin-bottom: 16px;
      display: flex;
      align-items: flex-start;
      gap: 16px;
    }
    .dictamen-label { font-size: 18px; font-weight: 700; color: ${colorDictamen}; }
    .dictamen-resumen { font-size: 13px; color: #374151; margin-top: 6px; line-height: 1.5; }
    .registrabilidad-box {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 14px 20px;
      margin-bottom: 24px;
      display: flex;
      align-items: center;
      gap: 20px;
    }
    .reg-circle {
      width: 72px; height: 72px;
      border-radius: 50%;
      border: 4px solid ${registrabilidadColor};
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .reg-pct { font-size: 22px; font-weight: 700; color: ${registrabilidadColor}; }
    .reg-lbl { font-size: 9px; color: ${registrabilidadColor}; margin-top: 2px; }
    .reg-bar-bg { height: 8px; background: #f1f5f9; border-radius: 4px; margin: 8px 0; }
    .reg-bar-fill { height: 8px; border-radius: 4px; background: ${registrabilidadColor}; width: ${registrabilidad ?? 0}%; }
    .metricas { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px; }
    .metrica { border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; text-align: center; }
    .metrica-num { font-size: 28px; font-weight: 700; }
    .metrica-label { font-size: 11px; color: #6b7280; margin-top: 4px; }
    .section-title { font-size: 13px; font-weight: 700; color: #1e3a6e; text-transform: uppercase;
      letter-spacing: .05em; border-bottom: 2px solid #dbeafe; padding-bottom: 6px; margin-bottom: 14px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    thead tr { background: #f1f5f9; }
    thead th { padding: 9px 6px; text-align: left; font-size: 11px; font-weight: 700;
      color: #374151; text-transform: uppercase; letter-spacing: .04em; }
    .datos-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 24px; }
    .dato { font-size: 12px; }
    .dato span { font-weight: 700; }
    .nota { background: #f9fafb; border-left: 3px solid #d1d5db; padding: 10px 14px;
      font-size: 11px; color: #6b7280; line-height: 1.6; margin-top: 24px; border-radius: 0 6px 6px 0; }
    .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e5e7eb;
      font-size: 10px; color: #9ca3af; display: flex; justify-content: space-between; }
    .print-btn {
      position: fixed; bottom: 24px; right: 24px;
      background: #1e3a6e; color: #fff; border: none; border-radius: 8px;
      padding: 12px 24px; font-size: 14px; font-weight: 600; cursor: pointer;
    }
    .rec-banner {
      padding: 10px 16px; border-radius: 6px; font-size: 12px; font-weight: 700;
      margin-top: 8px;
      background: ${recomienda ? '#f0fdf4' : '#fef2f2'};
      color: ${recomienda ? '#15803d' : '#dc2626'};
      border: 1px solid ${recomienda ? '#bbf7d0' : '#fecaca'};
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>MARCA FÁCIL — Estudio de Factibilidad Marcaria</h1>
    <p>Registro Argentino de Marcas — INPI</p>
    <p class="agente">Agente de la Propiedad Industrial Mat. N° 1974 — Honorio M. Leguizamón Pondal</p>
  </div>

  <div class="body">
    <div class="datos-grid">
      <div class="dato"><span>Denominación analizada:</span> ${denominacion}</div>
      <div class="dato"><span>Clase NIZA:</span> ${claseLabel}</div>
      <div class="dato"><span>Fecha del estudio:</span> ${fecha}</div>
      <div class="dato"><span>Fuente:</span> Registro público INPI</div>
    </div>

    <div class="dictamen-box">
      <div>
        <div class="dictamen-label">DICTAMEN: ${labelDictamen}</div>
        <div class="dictamen-resumen">${resumenDictamen}</div>
      </div>
    </div>

    ${registrabilidad !== null ? `
    <div class="registrabilidad-box">
      <div class="reg-circle">
        <span class="reg-pct">${registrabilidad}%</span>
        <span class="reg-lbl">Registr.</span>
      </div>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:700;color:#1e3a6e">Registrabilidad estimada</div>
        <div class="reg-bar-bg"><div class="reg-bar-fill"></div></div>
        <div class="rec-banner">${recomienda ? '✓ Recomendamos solicitar el registro' : '✗ No recomendamos presentar sin revisar la denominación'}</div>
        <div style="font-size:10px;color:#9ca3af;margin-top:6px">Recomendamos solicitar el registro cuando las posibilidades de éxito son superiores al 50%. Esto de ningún modo implica que no se presentarán objeciones por parte de la Oficina de Marcas o de terceros.</div>
      </div>
    </div>
    ` : ''}

    <div class="metricas">
      <div class="metrica">
        <div class="metrica-num">${totalAntecedentes}</div>
        <div class="metrica-label">Antecedentes encontrados</div>
      </div>
      <div class="metrica">
        <div class="metrica-num" style="color:${antecedentesConfundibles > 0 ? '#dc2626' : '#15803d'}">${antecedentesConfundibles}</div>
        <div class="metrica-label">Potencialmente confundibles</div>
      </div>
      <div class="metrica">
        <div class="metrica-num" style="color:${riesgo === 'ALTO' ? '#dc2626' : riesgo === 'MEDIO' ? '#d97706' : '#15803d'}">${riesgo}</div>
        <div class="metrica-label">Nivel de riesgo</div>
      </div>
    </div>

    <div class="section-title">Antecedentes encontrados</div>
    <table>
      <thead>
        <tr>
          <th>Nro. Acta</th>
          <th>Titulares</th>
          <th>F. Ingreso</th>
          <th style="text-align:center">Cl.</th>
          <th>Denominación</th>
          <th>Tipo</th>
          <th>Nro. Res.</th>
          <th>Estado</th>
          <th>Venc.</th>
          <th style="text-align:center">Fonét.</th>
          <th style="text-align:center">Gráf.</th>
          <th style="text-align:center">Ideol.</th>
        </tr>
      </thead>
      <tbody>
        ${filasAntecedentes}
      </tbody>
    </table>

    <div class="nota">
      <strong>Nota legal:</strong> Este estudio de factibilidad tiene carácter informativo y no constituye asesoramiento jurídico vinculante.
      La factibilidad final del registro marcario depende de la evaluación del INPI y de las oposiciones que pudieren formularse
      durante el período de publicación en el Boletín de Marcas (30 días corridos — Ley 22.362 y Res. INPI 297/2026).
      Se recomienda confirmar la vigencia de los antecedentes directamente en el portal del INPI (portaltramites.inpi.gob.ar).
    </div>

    <div class="footer">
      <span>MARCA FÁCIL — Sistema de Gestión Marcaria · marcafacil.com.ar</span>
      <span>Generado el ${fecha}</span>
    </div>
  </div>

  <button class="print-btn no-print" onclick="window.print()">⬇ Guardar / Imprimir PDF</button>
</body>
</html>`;

    const ventana = window.open('', '_blank');
    if (!ventana) {
      toast.error('El navegador bloqueó la ventana emergente. Habilitala para descargar el informe.');
      return;
    }
    ventana.document.write(html);
    ventana.document.close();
  };

  return (
    <div className="space-y-4">
      {/* Resultado principal */}
      <div className={`rounded-xl border p-5 ${cfg.bg}`}>
        <div className="flex items-start gap-4">
          <Icon className={`w-8 h-8 flex-shrink-0 mt-0.5 ${cfg.color}`} />
          <div className="flex-1">
            <h3 className={`text-lg font-bold ${cfg.color}`}>{cfg.title}</h3>
            <p className="text-sm text-gray-700 mt-2 leading-relaxed">{resumenDictamen}</p>
          </div>
        </div>
      </div>

      {/* Registrabilidad gauge */}
      {registrabilidad !== null && (
        <GaugeRegistrabilidad pct={registrabilidad} recomienda={recomienda} />
      )}

      {/* Métricas */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{totalAntecedentes}</p>
          <p className="text-xs text-gray-500 mt-0.5">Antecedentes</p>
        </div>
        <div className="card p-4 text-center">
          <p className={`text-2xl font-bold ${antecedentesConfundibles > 0 ? 'text-red-600' : 'text-green-600'}`}>
            {antecedentesConfundibles}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">Confundibles</p>
        </div>
        <div className="card p-4 text-center">
          <p className={`text-2xl font-bold ${
            riesgo === 'ALTO' ? 'text-red-600' : riesgo === 'MEDIO' ? 'text-yellow-600' : 'text-green-600'
          }`}>{riesgo}</p>
          <p className="text-xs text-gray-500 mt-0.5">Riesgo</p>
        </div>
      </div>

      {/* Tabla de antecedentes */}
      {antecedentes.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h3 className="section-title mb-0">Antecedentes encontrados</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-3 py-3 text-left">Acta</th>
                  <th className="px-3 py-3 text-left">Titular</th>
                  <th className="px-3 py-3 text-left">F. Ingreso</th>
                  <th className="px-3 py-3 text-center">Cl.</th>
                  <th className="px-3 py-3 text-left">Denominación</th>
                  <th className="px-3 py-3 text-left">Tipo</th>
                  <th className="px-3 py-3 text-left">Nro. Res.</th>
                  <th className="px-3 py-3 text-left">Estado</th>
                  <th className="px-3 py-3 text-left">Venc.</th>
                  <th className="px-3 py-3 text-center">Fonét.</th>
                  <th className="px-3 py-3 text-center">Gráf.</th>
                  <th className="px-3 py-3 text-center">Ideol.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {antecedentes.map((a: any, i: number) => (
                  <tr key={i} className={`hover:bg-gray-50 ${a.confundible ? 'bg-red-50/40' : ''}`}>
                    <td className="px-3 py-2 text-xs text-gray-500">{a.acta || '—'}</td>
                    <td className="px-3 py-2 text-xs text-gray-700 max-w-[120px] truncate">{a.titular || '—'}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{a.fechaSolicitud || '—'}</td>
                    <td className="px-3 py-2 text-xs text-center text-gray-600">{a.claseNiza ?? a.clase ?? '—'}</td>
                    <td className="px-3 py-2 text-sm font-semibold text-gray-900">{a.denominacion}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{a.tipoMarca || '—'}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{a.nroResolucion || '—'}</td>
                    <td className="px-3 py-2 text-xs font-medium text-gray-700">{a.estado || '—'}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{a.vencimiento || '—'}</td>
                    <EjeBadge valor={a.similitudFonetica} />
                    <EjeBadge valor={a.similitudGrafica} />
                    <EjeBadge valor={a.similitudIdeologica} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Análisis final por ejes */}
      <AnalisisEjes antecedentes={antecedentes} dictamen={dictamen} />

      {/* Aviso legal */}
      <div className="bg-gray-50 rounded-xl p-4 text-xs text-gray-500 leading-relaxed">
        <p className="font-medium text-gray-700 mb-1">Importante</p>
        Este análisis automatizado es orientativo y no reemplaza el estudio jurídico profesional.
        La existencia o ausencia de antecedentes no garantiza el resultado del trámite ante el INPI.
      </div>

      {/* Acciones */}
      <div className="flex gap-3">
        <button onClick={onNuevaBusqueda} className="btn-secondary flex-1 justify-center">
          <Search className="w-4 h-4" />
          Nueva búsqueda
        </button>
        {antecedentes.length > 0 && (
          <button onClick={descargarInforme} className="btn-primary flex-1 justify-center">
            <Download className="w-4 h-4" />
            Descargar informe
          </button>
        )}
      </div>
    </div>
  );
}
