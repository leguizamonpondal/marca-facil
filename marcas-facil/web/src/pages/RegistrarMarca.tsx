/**
 * Registrar Marca — Stepper de 3 pasos
 * Paso 1: Clasificador de productos/servicios (Nomenclador de Niza)
 * Paso 2: Búsqueda de antecedentes en el INPI
 * Paso 3: Presentar solicitud (pre-rellena el formulario)
 */
import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2, Circle, ChevronRight, Search, Layers,
  FileText, ArrowRight, X, Loader2, AlertCircle, Plus,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../hooks/useAuth';

const API_BASE =
  ((import.meta as any).env?.VITE_API_URL?.replace(/\/$/, '') ?? '') + '/api';

function authHeaders() {
  const token = localStorage.getItem('mf_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface ClaseNiza {
  clase: number;
  descripcionClase: string;
  terminos: { termino: string; descripcion: string }[];
}

interface MarcaResultado {
  acta: string;
  denominacion: string;
  claseNiza: number;
  tipoMarca: string;
  titular: string;
  titularCuit?: string;
  nroResolucion: string;
  estado: string;
  fechaSolicitud?: string;
  vencimiento?: string;
}

// ── Stepper header ────────────────────────────────────────────────────────────
const PASOS = [
  { num: 1, label: 'Clasificar productos/servicios', icon: Layers },
  { num: 2, label: 'Buscar antecedentes', icon: Search },
  { num: 3, label: 'Presentar solicitud', icon: FileText },
];

function StepperHeader({ paso }: { paso: number }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {PASOS.map((p, i) => (
        <div key={p.num} className="flex items-center flex-1">
          <div className={clsx(
            'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium flex-1 justify-center',
            paso === p.num && 'bg-primary-50 text-primary-700',
            paso > p.num && 'text-green-600',
            paso < p.num && 'text-gray-400',
          )}>
            {paso > p.num
              ? <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
              : <Circle className={clsx('w-5 h-5 flex-shrink-0', paso === p.num && 'text-primary-600')} />
            }
            <span className="hidden sm:inline">{p.label}</span>
            <span className="sm:hidden">Paso {p.num}</span>
          </div>
          {i < PASOS.length - 1 && (
            <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Paso 1 — Clasificador ─────────────────────────────────────────────────────
function PasoClasificador({
  onNext,
}: {
  onNext: (clases: ClaseNiza[], denominacion: string) => void;
}) {
  const [descripcion, setDescripcion] = useState('');
  const [terminos, setTerminos] = useState<string[]>([]);
  const [terminoInput, setTerminoInput] = useState('');
  const [clases, setClases] = useState<ClaseNiza[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [denominacion, setDenominacion] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const agregarTermino = () => {
    const t = terminoInput.trim();
    if (t && !terminos.includes(t)) {
      setTerminos(prev => [...prev, t]);
    }
    setTerminoInput('');
    inputRef.current?.focus();
  };

  const quitarTermino = (t: string) => setTerminos(prev => prev.filter(x => x !== t));

  const clasificar = async () => {
    const lista = terminos.length > 0
      ? terminos
      : descripcion.split(/[,;]+/).map(s => s.trim()).filter(Boolean);

    if (lista.length === 0) {
      setError('Ingresá al menos un producto o servicio para clasificar.');
      return;
    }
    setError('');
    setCargando(true);
    setClases([]);
    try {
      const res = await fetch(
        `${API_BASE}/clasificador/buscar?terminos=${encodeURIComponent(lista.join(','))}`,
        { headers: { ...authHeaders(), 'Content-Type': 'application/json' } }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al clasificar');
      setClases(data.clases || []);
      if ((data.clases || []).length === 0) {
        setError('No se encontraron coincidencias en el Nomenclador de Niza. Probá con otros términos.');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-1">
          ¿Qué productos o servicios querés proteger?
        </h2>
        <p className="text-sm text-gray-500">
          Ingresá cada producto o servicio por separado. Te indicaremos en qué clases del Nomenclador de Niza debés buscar antecedentes.
        </p>
      </div>

      {/* Nombre de la marca */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Nombre de la marca <span className="text-gray-400">(para la búsqueda del paso 2)</span>
        </label>
        <input
          type="text"
          value={denominacion}
          onChange={e => setDenominacion(e.target.value)}
          placeholder="Ej: AURORA, TERRA, BLUE SKY..."
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      </div>

      {/* Ingreso de términos */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Productos y/o servicios
        </label>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={terminoInput}
            onChange={e => setTerminoInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); agregarTermino(); } }}
            placeholder="Ej: indumentaria, perfumes, calzado..."
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <button
            onClick={agregarTermino}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" /> Agregar
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-1">Presioná Enter o cliqueá "Agregar" para cada producto/servicio.</p>
      </div>

      {/* Chips de términos */}
      {terminos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {terminos.map(t => (
            <span key={t} className="inline-flex items-center gap-1.5 bg-primary-50 text-primary-700 px-3 py-1 rounded-full text-sm font-medium">
              {t}
              <button onClick={() => quitarTermino(t)} className="hover:text-primary-900">
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          {error}
        </div>
      )}

      <button
        onClick={clasificar}
        disabled={cargando || (terminos.length === 0 && !descripcion.trim())}
        className="flex items-center gap-2 px-6 py-2.5 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
      >
        {cargando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
        {cargando ? 'Clasificando...' : 'Clasificar según Nomenclador de Niza'}
      </button>

      {/* Resultados */}
      {clases.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-900">
              Clases identificadas
              <span className="ml-2 bg-primary-100 text-primary-700 text-xs font-bold px-2 py-0.5 rounded-full">
                {clases.length} {clases.length === 1 ? 'clase' : 'clases'}
              </span>
            </h3>
          </div>

          <div className="divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden">
            {clases.map(c => (
              <div key={c.clase} className="p-4 bg-white hover:bg-gray-50 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-xl bg-primary-50 flex items-center justify-center flex-shrink-0">
                    <span className="text-xl font-bold text-primary-700">{c.clase}</span>
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-gray-900 text-sm">Clase {c.clase}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{c.descripcionClase}</p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {c.terminos.map(t => (
                        <span key={t.termino} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                          {t.termino}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={() => onNext(clases, denominacion)}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-semibold transition-colors"
          >
            Continuar — Buscar antecedentes en {clases.length === 1 ? 'clase' : 'clases'} {clases.map(c => c.clase).join(', ')}
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Paso 2 — Búsqueda de antecedentes ────────────────────────────────────────
function PasoAntecedentes({
  clases,
  denominacionInicial,
  onNext,
}: {
  clases: ClaseNiza[];
  denominacionInicial: string;
  onNext: (denominacion: string, clases: ClaseNiza[]) => void;
}) {
  const [denominacion, setDenominacion] = useState(denominacionInicial);
  const [clasesSeleccionadas, setClasesSeleccionadas] = useState<number[]>(clases.map(c => c.clase));
  const [resultados, setResultados] = useState<MarcaResultado[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [buscado, setBuscado] = useState(false);

  const toggleClase = (n: number) =>
    setClasesSeleccionadas(prev =>
      prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n]
    );

  const buscar = async () => {
    if (!denominacion.trim()) {
      setError('Ingresá el nombre de la marca a buscar.');
      return;
    }
    if (clasesSeleccionadas.length === 0) {
      setError('Seleccioná al menos una clase.');
      return;
    }
    setError('');
    setCargando(true);
    setResultados([]);
    setBuscado(false);

    try {
      const todos: MarcaResultado[] = [];
      for (const clase of clasesSeleccionadas) {
        const res = await fetch(
          `${API_BASE}/factibilidad/buscar-denominacion?denominacion=${encodeURIComponent(denominacion)}&clase=${clase}`,
          { headers: authHeaders() }
        );
        const data = await res.json();
        if (res.ok && Array.isArray(data)) {
          todos.push(...data);
        }
      }
      // Deduplicar por acta
      const seen = new Set<string>();
      setResultados(todos.filter(m => {
        if (seen.has(m.acta)) return false;
        seen.add(m.acta);
        return true;
      }));
      setBuscado(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  };

  const riesgo = resultados.filter(m => {
    const d = m.denominacion.toUpperCase();
    const q = denominacion.toUpperCase();
    return d.includes(q) || q.includes(d);
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-1">Búsqueda de antecedentes</h2>
        <p className="text-sm text-gray-500">
          Buscamos en el INPI si ya existe una marca igual o similar registrada en las clases identificadas.
        </p>
      </div>

      {/* Marca a buscar */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Nombre de la marca</label>
        <input
          type="text"
          value={denominacion}
          onChange={e => setDenominacion(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      </div>

      {/* Clases a buscar */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Clases a buscar <span className="text-gray-400 font-normal">(podés deseleccionar alguna)</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {clases.map(c => (
            <button
              key={c.clase}
              onClick={() => toggleClase(c.clase)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
                clasesSeleccionadas.includes(c.clase)
                  ? 'bg-primary-50 border-primary-300 text-primary-700'
                  : 'bg-gray-50 border-gray-200 text-gray-400'
              )}
            >
              <span className="font-bold">Cl. {c.clase}</span>
              <span className="hidden sm:inline text-xs">— {c.descripcionClase.split(';')[0]}</span>
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {error}
        </div>
      )}

      <button
        onClick={buscar}
        disabled={cargando}
        className="flex items-center gap-2 px-6 py-2.5 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
      >
        {cargando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
        {cargando ? 'Buscando en INPI...' : 'Buscar antecedentes'}
      </button>

      {/* Resultados */}
      {buscado && (
        <div className="space-y-4">
          {/* Resumen de riesgo */}
          <div className={clsx(
            'p-4 rounded-xl border text-sm',
            riesgo.length === 0
              ? 'bg-green-50 border-green-200 text-green-800'
              : 'bg-amber-50 border-amber-200 text-amber-800'
          )}>
            {riesgo.length === 0
              ? `✅ Sin antecedentes idénticos o similares encontrados para "${denominacion}" en las clases ${clasesSeleccionadas.join(', ')}.`
              : `⚠️ Se encontraron ${riesgo.length} marcas potencialmente similares a "${denominacion}". Revisalas antes de presentar la solicitud.`
            }
          </div>

          {resultados.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-500 uppercase tracking-wide">
                  <tr>
                    <th className="px-3 py-2 text-left">Acta</th>
                    <th className="px-3 py-2 text-left">Denominación</th>
                    <th className="px-3 py-2 text-left">Titular</th>
                    <th className="px-3 py-2 text-center">Cl.</th>
                    <th className="px-3 py-2 text-left">Estado</th>
                    <th className="px-3 py-2 text-left">Venc.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {resultados.slice(0, 30).map(m => (
                    <tr key={m.acta} className={clsx(
                      'hover:bg-gray-50',
                      riesgo.some(r => r.acta === m.acta) && 'bg-amber-50'
                    )}>
                      <td className="px-3 py-2 font-mono">{m.acta}</td>
                      <td className="px-3 py-2 font-semibold">{m.denominacion}</td>
                      <td className="px-3 py-2 text-gray-600">{m.titular}</td>
                      <td className="px-3 py-2 text-center">{m.claseNiza}</td>
                      <td className="px-3 py-2">{m.estado}</td>
                      <td className="px-3 py-2">{m.vencimiento || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {resultados.length > 30 && (
                <p className="text-xs text-gray-400 p-3 border-t">
                  Mostrando 30 de {resultados.length} resultados. Para ver todos, usá la búsqueda de Factibilidad.
                </p>
              )}
            </div>
          )}

          {resultados.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-4">
              No se encontraron marcas registradas en las clases seleccionadas.
            </p>
          )}

          <button
            onClick={() => onNext(denominacion, clases)}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-semibold transition-colors"
          >
            Continuar — Completar solicitud de registro
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Paso 3 — Presentar solicitud ──────────────────────────────────────────────
function PasoPresentarSolicitud({
  clases,
  denominacion,
}: {
  clases: ClaseNiza[];
  denominacion: string;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();

  const irAFormulario = (clase: number) => {
    navigate('/marcas/nueva', {
      state: {
        denominacion,
        claseNiza: clase,
        titular: user?.nombre || '',
        descripcionProductos: clases.find(c => c.clase === clase)
          ?.terminos.map(t => t.termino).join(', ') || '',
        desde: 'registrar',
      },
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-1">Presentar solicitud</h2>
        <p className="text-sm text-gray-500">
          Completá el formulario de registro para cada clase. Los datos de la marca y el titular se pre-rellenan automáticamente.
        </p>
      </div>

      {/* Resumen */}
      <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-500">Marca</span>
          <span className="font-semibold text-gray-900">{denominacion || '(sin nombre)'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Titular</span>
          <span className="font-semibold text-gray-900">{user?.nombre || '(no disponible)'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Clases</span>
          <span className="font-semibold text-gray-900">{clases.map(c => c.clase).join(', ')}</span>
        </div>
      </div>

      {/* Una solicitud por clase */}
      <div className="space-y-3">
        <p className="text-sm font-medium text-gray-700">
          Presentar solicitud por clase:
        </p>
        {clases.map(c => (
          <div key={c.clase} className="flex items-center justify-between p-4 border border-gray-200 rounded-xl hover:border-primary-300 transition-colors">
            <div>
              <p className="font-semibold text-gray-900 text-sm">Clase {c.clase}</p>
              <p className="text-xs text-gray-500 mt-0.5">{c.descripcionClase}</p>
              <p className="text-xs text-gray-400 mt-1">
                {c.terminos.map(t => t.termino).join(', ')}
              </p>
            </div>
            <button
              onClick={() => irAFormulario(c.clase)}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap ml-4"
            >
              Completar formulario
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl text-sm text-blue-800">
        <p className="font-semibold mb-1">¿Necesitás asistencia profesional?</p>
        <p className="text-xs text-blue-700">
          La presentación ante el INPI puede realizarse con o sin la intervención de un Agente de la Propiedad Industrial.
          Nuestros servicios incluyen la preparación y seguimiento completo del trámite.
        </p>
        <button
          onClick={() => navigate('/servicios')}
          className="mt-2 text-xs font-semibold text-blue-800 hover:underline"
        >
          Ver servicios legales →
        </button>
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function RegistrarMarca() {
  const [paso, setPaso] = useState(1);
  const [clasesIdentificadas, setClasesIdentificadas] = useState<ClaseNiza[]>([]);
  const [denominacionFinal, setDenominacionFinal] = useState('');

  const handleClasificadorNext = (clases: ClaseNiza[], denominacion: string) => {
    setClasesIdentificadas(clases);
    setDenominacionFinal(denominacion);
    setPaso(2);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleAntecedentesNext = (denominacion: string, clases: ClaseNiza[]) => {
    setDenominacionFinal(denominacion);
    setClasesIdentificadas(clases);
    setPaso(3);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Registrar una marca</h1>
        <p className="text-sm text-gray-500 mt-1">
          Seguí los pasos para clasificar tus productos, verificar antecedentes y presentar la solicitud.
        </p>
      </div>

      <StepperHeader paso={paso} />

      <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
        {paso === 1 && (
          <PasoClasificador onNext={handleClasificadorNext} />
        )}
        {paso === 2 && (
          <PasoAntecedentes
            clases={clasesIdentificadas}
            denominacionInicial={denominacionFinal}
            onNext={handleAntecedentesNext}
          />
        )}
        {paso === 3 && (
          <PasoPresentarSolicitud
            clases={clasesIdentificadas}
            denominacion={denominacionFinal}
          />
        )}
      </div>

      {/* Navegación entre pasos */}
      {paso > 1 && (
        <button
          onClick={() => { setPaso(p => p - 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
          className="mt-4 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          ← Volver al paso anterior
        </button>
      )}
    </div>
  );
}
