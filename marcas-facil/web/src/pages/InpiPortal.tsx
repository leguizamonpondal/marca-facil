/**
 * Portal INPI — MARCAS FÁCIL
 * Integración con el sistema de Trámites en Línea del INPI vía Clave ARCA (ex-AFIP)
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Search, FileText, CheckCircle, XCircle, Clock, AlertTriangle,
  ExternalLink, Eye, EyeOff, ChevronRight, Info,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { inpiApi, getApiError } from '../services/api';
import { CLASES_NIZA } from '../types';
import { Spinner } from '../components/ui/Spinner';

type Tab = 'consultar' | 'presentar';

// ── Componente principal ──────────────────────────────────────────────────────
export default function InpiPortal() {
  const [tab, setTab] = useState<Tab>('consultar');

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="page-title">Portal INPI</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Trámites en Línea · Autenticación vía Clave ARCA (ex-AFIP)
        </p>
      </div>

      {/* Aviso de autenticación */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex gap-3">
        <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-blue-800">
          <p className="font-medium mb-0.5">Autenticación con Clave ARCA</p>
          <p className="text-xs text-blue-700">
            Para presentar solicitudes o consultar con información completa necesitás tu CUIT y
            Clave Fiscal nivel 2+ habilitada para el servicio <strong>INPI</strong> en el portal ARCA.
            Tu contraseña <strong>nunca</strong> se guarda — se usa en el momento y se descarta.
          </p>
          <a
            href="https://www.inpi.gob.ar/tramites-en-linea"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-1.5 text-blue-600 hover:underline font-medium text-xs"
          >
            Ir al portal INPI <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {[
          { id: 'consultar', label: 'Consultar acta', icon: Search },
          { id: 'presentar', label: 'Presentar solicitud', icon: FileText },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id as Tab)}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === id
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'consultar' ? <TabConsultarActa /> : <TabPresentarSolicitud />}
    </div>
  );
}

// ── Tab: Consultar estado de acta ─────────────────────────────────────────────
function TabConsultarActa() {
  const [acta, setActa] = useState('');
  const [cuit, setCuit] = useState('');
  const [clave, setClave] = useState('');
  const [showClave, setShowClave] = useState(false);
  const [usarCredenciales, setUsarCredenciales] = useState(false);

  const consultarMutation = useMutation({
    mutationFn: () =>
      inpiApi.consultarActa({
        acta: acta.trim(),
        ...(usarCredenciales && cuit && clave ? { cuit, claveFiscal: clave } : {}),
      }),
    onError: (err) => toast.error(getApiError(err)),
  });

  const datos = consultarMutation.data?.datos;

  return (
    <div className="space-y-4">
      <div className="card p-5 space-y-4">
        <h2 className="section-title">Consultar estado de acta</h2>

        <div>
          <label className="label">Número de acta *</label>
          <input
            type="text"
            value={acta}
            onChange={(e) => setActa(e.target.value.replace(/\D/g, ''))}
            className="input"
            placeholder="Ej: 3876543"
            maxLength={10}
          />
          <p className="text-xs text-gray-400 mt-1">
            Primero se intenta la consulta pública del INPI (sin credenciales).
            Si no está disponible, usará el portal autenticado.
          </p>
        </div>

        {/* Credenciales opcionales */}
        <div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={usarCredenciales}
              onChange={(e) => setUsarCredenciales(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm text-gray-700">Usar Clave ARCA para consulta completa</span>
          </label>
        </div>

        {usarCredenciales && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">CUIT (sin guiones)</label>
              <input
                type="text"
                value={cuit}
                onChange={(e) => setCuit(e.target.value.replace(/\D/g, '').slice(0, 11))}
                className="input"
                placeholder="20123456789"
              />
            </div>
            <div>
              <label className="label">Clave Fiscal ARCA</label>
              <div className="relative">
                <input
                  type={showClave ? 'text' : 'password'}
                  value={clave}
                  onChange={(e) => setClave(e.target.value)}
                  className="input pr-10"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowClave(!showClave)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showClave ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        )}

        <button
          onClick={() => consultarMutation.mutate()}
          disabled={!acta || consultarMutation.isPending}
          className="btn-primary w-full justify-center"
        >
          {consultarMutation.isPending ? (
            <><Spinner size="sm" /> Consultando portal INPI...</>
          ) : (
            <><Search className="w-4 h-4" /> Consultar estado</>
          )}
        </button>
      </div>

      {/* Resultado */}
      {datos && (
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="section-title">Resultado — Acta {datos.acta}</h2>
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${
              consultarMutation.data?.fuente === 'api-publica'
                ? 'bg-green-100 text-green-700'
                : 'bg-blue-100 text-blue-700'
            }`}>
              {consultarMutation.data?.fuente === 'api-publica' ? 'API pública' : 'Portal autenticado'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Denominación', value: datos.denominacion },
              { label: 'Estado', value: datos.estado, highlight: true },
              { label: 'Clase de Niza', value: datos.claseNiza ? `Clase ${datos.claseNiza}` : '—' },
              { label: 'Tipo', value: datos.tipoMarca || '—' },
              { label: 'Titular', value: datos.titular || '—' },
              { label: 'Fecha solicitud', value: datos.fechaSolicitud ? new Date(datos.fechaSolicitud).toLocaleDateString('es-AR') : '—' },
              { label: 'Fecha publicación', value: datos.fechaPublicacion ? new Date(datos.fechaPublicacion).toLocaleDateString('es-AR') : '—' },
            ].map(({ label, value, highlight }) => (
              <div key={label} className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-500">{label}</p>
                <p className={`text-sm font-medium mt-0.5 ${highlight ? 'text-primary-700' : 'text-gray-900'}`}>
                  {value}
                </p>
              </div>
            ))}
          </div>

          {datos.observaciones && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3">
              <p className="text-xs font-medium text-yellow-800 mb-0.5">Observaciones</p>
              <p className="text-xs text-yellow-700">{datos.observaciones}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Tab: Presentar solicitud de marca ─────────────────────────────────────────
function TabPresentarSolicitud() {
  const [step, setStep] = useState(1);
  const [cuit, setCuit] = useState('');
  const [clave, setClave] = useState('');
  const [showClave, setShowClave] = useState(false);
  const [form, setForm] = useState({
    denominacion: '',
    claseNiza: 35,
    tipoMarca: 'DENOMINATIVA',
    descripcionProductos: '',
    titularNombre: '',
    titularCuit: '',
    titularDomicilio: '',
    titularEmail: '',
  });

  const presentarMutation = useMutation({
    mutationFn: () =>
      inpiApi.presentarSolicitud({
        cuit,
        claveFiscal: clave,
        ...form,
        claseNiza: Number(form.claseNiza),
      }),
    onError: (err) => toast.error(getApiError(err)),
  });

  const setF = (k: string, v: string | number) => setForm(p => ({ ...p, [k]: v }));

  const pasos = presentarMutation.data?.pasos;
  const resultado = presentarMutation.data?.resultado;
  const errorGlobal = presentarMutation.data?.error;

  if (pasos) {
    return (
      <div className="card p-5 space-y-4">
        <h2 className="section-title">
          {resultado ? '✓ Solicitud presentada' : errorGlobal ? '✗ Error en la presentación' : 'Procesando...'}
        </h2>

        {/* Timeline de pasos */}
        <div className="space-y-2">
          {pasos.map(p => (
            <div key={p.paso} className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-0.5">
                {p.estado === 'completado' ? (
                  <CheckCircle className="w-5 h-5 text-green-500" />
                ) : p.estado === 'error' ? (
                  <XCircle className="w-5 h-5 text-red-500" />
                ) : (
                  <Clock className="w-5 h-5 text-gray-300" />
                )}
              </div>
              <div>
                <p className={`text-sm font-medium ${
                  p.estado === 'completado' ? 'text-gray-900' :
                  p.estado === 'error' ? 'text-red-700' : 'text-gray-400'
                }`}>{p.descripcion}</p>
                {p.detalle && (
                  <p className="text-xs text-gray-500 mt-0.5">{p.detalle}</p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Resultado exitoso */}
        {resultado && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4">
            <p className="font-semibold text-green-800">Acta N° {resultado.acta}</p>
            <p className="text-sm text-green-700 mt-1">{resultado.mensaje}</p>
            <p className="text-xs text-green-600 mt-1">
              Fecha: {new Date(resultado.fechaPresentacion).toLocaleDateString('es-AR')}
            </p>
          </div>
        )}

        {/* Error global */}
        {errorGlobal && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <div className="flex gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-800">No se pudo completar la presentación</p>
                <p className="text-xs text-red-700 mt-1">{errorGlobal}</p>
                <p className="text-xs text-red-600 mt-2">
                  Podés completar el trámite manualmente en{' '}
                  <a href="https://portaltramitesline.inpi.gob.ar" target="_blank" rel="noopener noreferrer" className="underline">
                    portaltramitesline.inpi.gob.ar
                  </a>
                </p>
              </div>
            </div>
          </div>
        )}

        <button
          onClick={() => { presentarMutation.reset(); setStep(1); }}
          className="btn-secondary w-full justify-center"
        >
          Nueva presentación
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Indicador de paso */}
      <div className="flex items-center gap-2">
        {[1, 2, 3].map(n => (
          <div key={n} className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
              n < step ? 'bg-green-500 text-white' :
              n === step ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-500'
            }`}>{n < step ? '✓' : n}</div>
            <span className={`text-xs ${n === step ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>
              {n === 1 ? 'Credenciales' : n === 2 ? 'Datos de la marca' : 'Titular'}
            </span>
            {n < 3 && <ChevronRight className="w-3 h-3 text-gray-300" />}
          </div>
        ))}
      </div>

      {/* Paso 1: Credenciales ARCA */}
      {step === 1 && (
        <div className="card p-5 space-y-4">
          <h2 className="section-title">Paso 1 — Credenciales ARCA</h2>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
            <p className="font-medium mb-1">Antes de continuar verificá:</p>
            <ul className="space-y-0.5 list-disc list-inside">
              <li>Tenés habilitado el servicio <strong>INPI - Trámites en Línea</strong> en ARCA</li>
              <li>Tu Clave Fiscal es <strong>nivel 2 o superior</strong></li>
              <li>Tenés saldo o VEP habilitado para el pago del arancel</li>
            </ul>
          </div>

          <div>
            <label className="label">CUIT (sin guiones) *</label>
            <input
              type="text"
              value={cuit}
              onChange={(e) => setCuit(e.target.value.replace(/\D/g, '').slice(0, 11))}
              className="input"
              placeholder="20123456789"
            />
          </div>
          <div>
            <label className="label">Clave Fiscal ARCA *</label>
            <div className="relative">
              <input
                type={showClave ? 'text' : 'password'}
                value={clave}
                onChange={(e) => setClave(e.target.value)}
                className="input pr-10"
                placeholder="Tu clave fiscal"
              />
              <button type="button" onClick={() => setShowClave(!showClave)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                {showClave ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Tu contraseña no se guarda — se usa sólo para esta sesión y luego se descarta.
            </p>
          </div>
          <button
            onClick={() => setStep(2)}
            disabled={!cuit || cuit.length !== 11 || !clave}
            className="btn-primary w-full justify-center"
          >
            Continuar
          </button>
        </div>
      )}

      {/* Paso 2: Datos de la marca */}
      {step === 2 && (
        <div className="card p-5 space-y-4">
          <h2 className="section-title">Paso 2 — Datos de la marca</h2>

          <div>
            <label className="label">Denominación *</label>
            <input
              type="text"
              value={form.denominacion}
              onChange={(e) => setF('denominacion', e.target.value.toUpperCase())}
              className="input"
              placeholder="Nombre de la marca"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Clase de Niza *</label>
              <select value={form.claseNiza} onChange={(e) => setF('claseNiza', e.target.value)} className="input">
                {Object.entries(CLASES_NIZA).map(([n, d]) => (
                  <option key={n} value={n}>Clase {n} — {d}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Tipo de marca *</label>
              <select value={form.tipoMarca} onChange={(e) => setF('tipoMarca', e.target.value)} className="input">
                {['DENOMINATIVA', 'FIGURATIVA', 'MIXTA', 'TRIDIMENSIONAL'].map(t => (
                  <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="label">Descripción de productos/servicios *</label>
            <textarea
              value={form.descripcionProductos}
              onChange={(e) => setF('descripcionProductos', e.target.value)}
              className="input"
              rows={4}
              placeholder="Describe los productos o servicios que identificará la marca. Sé preciso — el INPI lo requiere tal como aparecerá en el certificado."
            />
          </div>

          {(form.tipoMarca === 'FIGURATIVA' || form.tipoMarca === 'MIXTA') && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700">
              Para marcas figurativas y mixtas el portal INPI solicita subir la imagen durante el proceso.
              El sistema la adjuntará automáticamente si la tenés disponible.
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={() => setStep(1)} className="btn-secondary flex-1 justify-center">← Atrás</button>
            <button
              onClick={() => setStep(3)}
              disabled={!form.denominacion || !form.descripcionProductos}
              className="btn-primary flex-1 justify-center"
            >
              Continuar
            </button>
          </div>
        </div>
      )}

      {/* Paso 3: Titular + Confirmar */}
      {step === 3 && (
        <div className="card p-5 space-y-4">
          <h2 className="section-title">Paso 3 — Datos del titular</h2>

          <div>
            <label className="label">Nombre / Razón social del titular *</label>
            <input
              type="text"
              value={form.titularNombre}
              onChange={(e) => setF('titularNombre', e.target.value)}
              className="input"
              placeholder="Nombre completo o razón social"
            />
          </div>

          <div>
            <label className="label">CUIT del titular *</label>
            <input
              type="text"
              value={form.titularCuit}
              onChange={(e) => setF('titularCuit', e.target.value.replace(/\D/g, '').slice(0, 11))}
              className="input"
              placeholder="20123456789"
            />
          </div>

          <div>
            <label className="label">Domicilio constituido</label>
            <input
              type="text"
              value={form.titularDomicilio}
              onChange={(e) => setF('titularDomicilio', e.target.value)}
              className="input"
              placeholder="Calle, número, piso, localidad, provincia"
            />
          </div>

          <div>
            <label className="label">Email de contacto</label>
            <input
              type="email"
              value={form.titularEmail}
              onChange={(e) => setF('titularEmail', e.target.value)}
              className="input"
              placeholder="correo@empresa.com.ar"
            />
          </div>

          {/* Resumen */}
          <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
            <p className="font-semibold text-gray-900">Resumen de la solicitud</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <span className="text-gray-500">Denominación:</span><span className="font-medium">{form.denominacion}</span>
              <span className="text-gray-500">Clase de Niza:</span><span className="font-medium">{form.claseNiza}</span>
              <span className="text-gray-500">Tipo:</span><span className="font-medium">{form.tipoMarca}</span>
              <span className="text-gray-500">CUIT solicitante:</span><span className="font-medium">{cuit}</span>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
            <strong>Importante:</strong> Al confirmar, el sistema se autenticará con Clave ARCA y completará
            el formulario en el portal INPI. El pago del arancel deberá procesarse en el portal.
            Este proceso puede tardar 1-2 minutos.
          </div>

          <div className="flex gap-3">
            <button onClick={() => setStep(2)} className="btn-secondary flex-1 justify-center">← Atrás</button>
            <button
              onClick={() => presentarMutation.mutate()}
              disabled={!form.titularNombre || !form.titularCuit || presentarMutation.isPending}
              className="btn-primary flex-1 justify-center"
            >
              {presentarMutation.isPending ? (
                <><Spinner size="sm" /> Presentando en INPI...</>
              ) : (
                'Presentar solicitud'
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
