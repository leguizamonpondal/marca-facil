/**
 * Panel Principal — MARCAS FÁCIL
 * Vista consolidada: KPIs, alertas urgentes, oposiciones activas
 */
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Tag, Shield, Bell, AlertTriangle, Clock,
  Plus, Search, ChevronRight, TrendingUp, CheckCircle,
} from 'lucide-react';
import { format, differenceInDays, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { useAuth } from '../hooks/useAuth';
import { marcasApi, alertasApi, oposicionesApi } from '../services/api';
import { BadgeEstadoMarca, BadgeEstadoOposicion } from '../components/ui/Badge';
import { PageLoader } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import type { EstadoMarca } from '../types';

// ── Tarjeta de KPI ─────────────────────────────────────────────────────────────
function KPICard({
  label, value, icon: Icon, color, onClick,
}: {
  label: string; value: number | string; icon: React.ElementType;
  color: string; onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`card p-5 flex items-center gap-4 w-full text-left transition-all
        ${onClick ? 'hover:shadow-md hover:-translate-y-0.5 cursor-pointer' : 'cursor-default'}`}
    >
      <div className={`w-12 h-12 rounded-xl ${color} flex items-center justify-center flex-shrink-0`}>
        <Icon className="w-6 h-6" />
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        <p className="text-sm text-gray-500">{label}</p>
      </div>
    </button>
  );
}

// ── Alerta urgente ─────────────────────────────────────────────────────────────
function AlertaCard({ alerta, onClick }: { alerta: any; onClick: () => void }) {
  const diasRestantes = alerta.fechaVencimiento
    ? differenceInDays(parseISO(alerta.fechaVencimiento), new Date())
    : null;

  const urgente = diasRestantes !== null && diasRestantes <= 7;

  return (
    <div
      onClick={onClick}
      className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer
        hover:shadow-sm transition-all ${urgente ? 'border-red-200 bg-red-50' : 'border-orange-200 bg-orange-50'}`}
    >
      <AlertTriangle className={`w-5 h-5 flex-shrink-0 mt-0.5 ${urgente ? 'text-red-500' : 'text-orange-500'}`} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${urgente ? 'text-red-900' : 'text-orange-900'}`}>
          {alerta.titulo}
        </p>
        {alerta.marca && (
          <p className="text-xs text-gray-600 mt-0.5 truncate">
            Marca: {alerta.marca.denominacion} — Clase {alerta.marca.claseNiza}
          </p>
        )}
      </div>
      {diasRestantes !== null && (
        <span className={`text-xs font-bold flex-shrink-0 ${diasRestantes <= 3 ? 'text-red-700' : 'text-orange-700'}`}>
          {diasRestantes <= 0 ? 'VENCIDA' : `${diasRestantes}d`}
        </span>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: marcasData, isLoading: loadingMarcas } = useQuery({
    queryKey: ['marcas-dashboard'],
    queryFn: () => marcasApi.listar({ limit: 100 }),
  });

  const { data: alertasData, isLoading: loadingAlertas } = useQuery({
    queryKey: ['alertas-dashboard'],
    queryFn: () => alertasApi.listar({ urgentes: true, limit: 5 }),
  });

  const { data: oposicionesData, isLoading: loadingOp } = useQuery({
    queryKey: ['oposiciones-dashboard'],
    queryFn: () => oposicionesApi.listar({ limit: 5 }),
  });

  const isLoading = loadingMarcas || loadingAlertas || loadingOp;
  if (isLoading) return <PageLoader />;

  const marcas = marcasData?.data || [];
  const alertas = alertasData?.data || [];
  const oposiciones = oposicionesData?.data || [];

  // Calcular KPIs
  const marcasVigentes = marcas.filter(m =>
    ['VIGENTE', 'REGISTRADA', 'EN_TRAMITE'].includes(m.estado)
  ).length;
  const marcasConOposicion = marcas.filter(m => m.estado === 'CON_OPOSICION').length;
  const alertasUrgentes = alertasData?.meta?.total || 0;
  const oposicionesActivas = oposiciones.filter(o =>
    !['FUNDADA', 'INFUNDADA', 'DESISTIDA', 'ABANDONADA'].includes(o.estado)
  ).length;

  // Últimas marcas (recientes)
  const ultimasMarcas = marcas.slice(0, 5);

  const hora = new Date().getHours();
  const saludo = hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches';

  return (
    <div className="space-y-6">
      {/* Bienvenida */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          {saludo}, {user?.nombre?.split(' ')[0] || 'Usuario'}
        </h1>
        <p className="text-gray-500 text-sm mt-0.5">
          {format(new Date(), "EEEE d 'de' MMMM 'de' yyyy", { locale: es })}
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label="Marcas activas"
          value={marcasVigentes}
          icon={Tag}
          color="bg-blue-100 text-blue-600"
          onClick={() => navigate('/marcas')}
        />
        <KPICard
          label="Con oposición"
          value={marcasConOposicion}
          icon={Shield}
          color="bg-orange-100 text-orange-600"
          onClick={() => navigate('/oposiciones')}
        />
        <KPICard
          label="Alertas pendientes"
          value={alertasUrgentes}
          icon={Bell}
          color={alertasUrgentes > 0 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}
          onClick={() => navigate('/alertas')}
        />
        <KPICard
          label="Oposiciones activas"
          value={oposicionesActivas}
          icon={Shield}
          color="bg-purple-100 text-purple-600"
          onClick={() => navigate('/oposiciones')}
        />
      </div>

      {/* Plan gratuito — aviso de upgrade */}
      {user?.plan === 'GRATUITO' && (
        <div className="bg-gradient-to-r from-primary-600 to-primary-700 rounded-xl p-5 text-white">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-semibold text-lg">Activá la vigilancia automática</p>
              <p className="text-primary-100 text-sm mt-1">
                Con el plan Básico, monitoreamos el Boletín de Marcas del INPI todos los jueves
                y te alertamos si aparece una marca confundible con la tuya.
              </p>
            </div>
            <button
              onClick={() => navigate('/planes')}
              className="flex-shrink-0 bg-white text-primary-700 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary-50 transition-colors"
            >
              Ver planes
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Alertas urgentes */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="section-title">Alertas urgentes</h2>
            <button
              onClick={() => navigate('/alertas')}
              className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
            >
              Ver todas <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {alertas.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <CheckCircle className="w-10 h-10 text-green-400 mb-2" />
              <p className="text-sm font-medium text-gray-700">Sin alertas urgentes</p>
              <p className="text-xs text-gray-500">Todo al día</p>
            </div>
          ) : (
            <div className="space-y-2">
              {alertas.map((alerta) => (
                <AlertaCard
                  key={alerta.id}
                  alerta={alerta}
                  onClick={() => navigate('/alertas')}
                />
              ))}
            </div>
          )}
        </div>

        {/* Oposiciones activas */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="section-title">Oposiciones activas</h2>
            <button
              onClick={() => navigate('/oposiciones')}
              className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
            >
              Ver todas <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {oposiciones.length === 0 ? (
            <EmptyState
              icon={Shield}
              title="Sin oposiciones activas"
              description="Las oposiciones detectadas en el Boletín del INPI aparecerán aquí"
            />
          ) : (
            <div className="space-y-2">
              {oposiciones.slice(0, 4).map((op) => (
                <div
                  key={op.id}
                  onClick={() => navigate(`/oposiciones/${op.id}`)}
                  className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:border-gray-200 hover:bg-gray-50 cursor-pointer transition-all"
                >
                  <Shield className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {op.denominacionOpuesta}
                    </p>
                    <p className="text-xs text-gray-500">Acta {op.actaOpuesta} · Clase {op.claseOpuesta}</p>
                  </div>
                  <div className="flex-shrink-0 flex flex-col items-end gap-1">
                    <BadgeEstadoOposicion estado={op.estado} />
                    {op.proximoPlazo && (
                      <span className={`text-[11px] font-medium ${op.proximoPlazo.urgente ? 'text-red-600' : 'text-orange-600'}`}>
                        {op.proximoPlazo.diasRestantes}d para {op.proximoPlazo.tipo.split(' ')[0].toLowerCase()}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Mis marcas — últimas */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="section-title">Mis marcas</h2>
          <div className="flex gap-2">
            <button
              onClick={() => navigate('/factibilidad')}
              className="btn-secondary text-xs py-1.5 px-3"
            >
              <Search className="w-3.5 h-3.5" />
              Factibilidad
            </button>
            <button
              onClick={() => navigate('/marcas/nueva')}
              className="btn-primary text-xs py-1.5 px-3"
            >
              <Plus className="w-3.5 h-3.5" />
              Nueva
            </button>
          </div>
        </div>

        {ultimasMarcas.length === 0 ? (
          <EmptyState
            icon={Tag}
            title="Todavía no cargaste marcas"
            description="Registrá tu primera marca o buscá antecedentes antes de iniciar el trámite"
            action={{
              label: 'Registrar marca',
              onClick: () => navigate('/marcas/nueva'),
            }}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left font-medium text-gray-500 pb-3 pr-4">Denominación</th>
                  <th className="text-left font-medium text-gray-500 pb-3 pr-4">Clase</th>
                  <th className="text-left font-medium text-gray-500 pb-3 pr-4">Estado</th>
                  <th className="text-right font-medium text-gray-500 pb-3">Vencimiento</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {ultimasMarcas.map((marca) => (
                  <tr
                    key={marca.id}
                    onClick={() => navigate(`/marcas/${marca.id}`)}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900">{marca.denominacion}</span>
                        {marca.vigilanciaActiva && (
                          <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">
                            Vigilada
                          </span>
                        )}
                      </div>
                      {marca.numeroActa && (
                        <p className="text-xs text-gray-400">Acta {marca.numeroActa}</p>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-gray-600">Clase {marca.claseNiza}</td>
                    <td className="py-3 pr-4">
                      <BadgeEstadoMarca estado={marca.estado as EstadoMarca} />
                    </td>
                    <td className="py-3 text-right text-gray-500">
                      {marca.fechaVencimiento
                        ? format(parseISO(marca.fechaVencimiento), 'dd/MM/yyyy')
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(marcasData?.meta.total || 0) > 5 && (
              <div className="text-center mt-3">
                <button
                  onClick={() => navigate('/marcas')}
                  className="text-sm text-primary-600 hover:text-primary-700"
                >
                  Ver las {marcasData!.meta.total} marcas →
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Acciones rápidas */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Búsqueda de antecedentes', icon: Search, to: '/factibilidad', color: 'text-purple-600 bg-purple-50' },
          { label: 'Nueva marca', icon: Plus, to: '/marcas/nueva', color: 'text-blue-600 bg-blue-50' },
          { label: 'Ver boletín', icon: TrendingUp, to: '/boletin', color: 'text-green-600 bg-green-50' },
          { label: 'Oposiciones', icon: Shield, to: '/oposiciones', color: 'text-orange-600 bg-orange-50' },
        ].map((action) => (
          <button
            key={action.to}
            onClick={() => navigate(action.to)}
            className="card p-4 flex flex-col items-center gap-2.5 text-center hover:shadow-md hover:-translate-y-0.5 transition-all"
          >
            <div className={`w-10 h-10 rounded-xl ${action.color} flex items-center justify-center`}>
              <action.icon className="w-5 h-5" />
            </div>
            <span className="text-xs font-medium text-gray-700 leading-tight">{action.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
