/**
 * Estudio de Factibilidad — MARCA FÁCIL
 * Búsqueda de antecedentes y diagnóstico de viabilidad
 */
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Search, AlertTriangle, CheckCircle, XCircle, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import { factibilidadApi, getApiError } from '../services/api';
import { BadgeDictamen } from '../components/ui/Badge';
import { Spinner } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import { CLASES_NIZA } from '../types';

export default function Factibilidad() {
  const [denominacion, setDenominacion] = useState('');
  const [claseNiza, setClaseNiza] = useState<number>(35);
  const [resultado, setResultado] = useState<any>(null);

  const { data: historial, isLoading: loadingHistorial } = useQuery({
    queryKey: ['factibilidad-historial'],
    queryFn: () => factibilidadApi.historial(),
  });

  const estudiarMutation = useMutation({
    mutationFn: () => factibilidadApi.estudiar({ denominacion, claseNiza, tipoMarca: 'DENOMINATIVA' }),
    onSuccess: (data) => setResultado(data),
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

      {/* Formulario */}
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
            {Object.entries(CLASES_NIZA).map(([n, d]) => (
              <option key={n} value={n}>Clase {n} — {d}</option>
            ))}
          </select>
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
          denominacion={denominacion}
          claseNiza={claseNiza}
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
              {historial.map((h: any) => (
                <div
                  key={h.id}
                  className="flex items-center gap-4 p-3 rounded-xl border border-gray-100 hover:border-gray-200 hover:bg-gray-50 cursor-pointer"
                  onClick={() => setResultado(h)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{h.denominacion}</p>
                    <p className="text-xs text-gray-500">Clase {h.claseNiza}</p>
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

    const filasAntecedentes = antecedentes.length === 0
      ? '<tr><td colspan="9" style="text-align:center;color:#6b7280;padding:16px">Sin antecedentes encontrados en el período analizado</td></tr>'
      : antecedentes.map((a: any) => `
          <tr style="border-bottom:1px solid #e5e7eb">
            <td style="padding:8px 6px;font-size:11px;color:#6b7280">${a.acta || '—'}</td>
            <td style="padding:8px 6px;font-size:12px;font-weight:600">${a.titular || '—'}</td>
            <td style="padding:8px 6px;font-size:11px;color:#374151">${a.fechaSolicitud || '—'}</td>
            <td style="padding:8px 6px;font-size:12px;text-align:center">${a.claseNiza ?? a.clase ?? '—'}</td>
            <td style="padding:8px 6px;font-size:12px;font-weight:700">${a.denominacion}</td>
            <td style="padding:8px 6px;font-size:11px;color:#374151">${a.tipoMarca || '—'}</td>
            <td style="padding:8px 6px;font-size:11px;color:#6b7280">${a.nroResolucion || '—'}</td>
            <td style="padding:8px 6px;font-size:11px;color:#374151">${a.estado || '—'}</td>
            <td style="padding:8px 6px;font-size:11px;color:#374151">${a.vencimiento || '—'}</td>
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
      margin-bottom: 24px;
      display: flex;
      align-items: flex-start;
      gap: 16px;
    }
    .dictamen-label { font-size: 18px; font-weight: 700; color: ${colorDictamen}; }
    .dictamen-resumen { font-size: 13px; color: #374151; margin-top: 6px; line-height: 1.5; }
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
      <div class="dato"><span>Clase NIZA:</span> ${claseNiza}</div>
      <div class="dato"><span>Fecha del estudio:</span> ${fecha}</div>
      <div class="dato"><span>Fuente:</span> Registro público INPI</div>
    </div>

    <div class="dictamen-box">
      <div>
        <div class="dictamen-label">DICTAMEN: ${labelDictamen}</div>
        <div class="dictamen-resumen">${resumenDictamen}</div>
      </div>
    </div>

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
          <th style="text-align:center">Clase</th>
          <th>Denominación</th>
          <th>Tipo</th>
          <th>Nro. Res.</th>
          <th>Estado</th>
          <th>Vencimiento</th>
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
                  <th className="px-3 py-3 text-center">Clase</th>
                  <th className="px-3 py-3 text-left">Denominación</th>
                  <th className="px-3 py-3 text-left">Tipo</th>
                  <th className="px-3 py-3 text-left">Nro. Res.</th>
                  <th className="px-3 py-3 text-left">Estado</th>
                  <th className="px-3 py-3 text-left">Vencimiento</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {antecedentes.map((a: any, i: number) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-xs text-gray-500">{a.acta || '—'}</td>
                    <td className="px-3 py-2 text-xs text-gray-700 max-w-[140px] truncate">{a.titular || '—'}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{a.fechaSolicitud || '—'}</td>
                    <td className="px-3 py-2 text-xs text-center text-gray-600">{a.claseNiza ?? a.clase ?? '—'}</td>
                    <td className="px-3 py-2 text-sm font-semibold text-gray-900">{a.denominacion}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{a.tipoMarca || '—'}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{a.nroResolucion || '—'}</td>
                    <td className="px-3 py-2 text-xs font-medium text-gray-700">{a.estado || '—'}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{a.vencimiento || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
