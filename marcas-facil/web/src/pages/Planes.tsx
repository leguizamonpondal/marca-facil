/**
 * Planes y Pagos — MARCAS FÁCIL
 */
import { useQuery, useMutation } from '@tanstack/react-query';
import { CheckCircle, Star, Zap, Shield, Building2, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { pagosApi, getApiError } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { PageLoader } from '../components/ui/Spinner';
import type { Plan } from '../types';

const PLAN_ICON: Record<Plan, React.ElementType> = {
  GRATUITO: Shield,
  BASICO: Zap,
  PROFESIONAL: Star,
  EMPRESARIAL: Building2,
};

const PLAN_COLOR: Record<Plan, string> = {
  GRATUITO: 'text-gray-600',
  BASICO: 'text-blue-600',
  PROFESIONAL: 'text-purple-600',
  EMPRESARIAL: 'text-amber-600',
};

export default function Planes() {
  const { user, refreshUser } = useAuth();

  const { data: planes, isLoading } = useQuery({
    queryKey: ['planes'],
    queryFn: () => pagosApi.planes(),
  });

  const { data: estado } = useQuery({
    queryKey: ['plan-estado'],
    queryFn: () => pagosApi.estado(),
    enabled: !!user,
  });

  const suscribirMutation = useMutation({
    mutationFn: (plan: string) => pagosApi.suscribir(plan),
    onSuccess: (data) => {
      // Redirigir al init point de MercadoPago
      window.location.href = data.initPoint;
    },
    onError: (err) => toast.error(getApiError(err)),
  });

  if (isLoading) return <PageLoader />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="page-title">Planes y suscripción</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Activá la vigilancia automática de tu cartera de marcas
        </p>
      </div>

      {/* Plan actual */}
      {estado && (
        <div className={`rounded-xl border p-4 ${
          estado.activo ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'
        }`}>
          <div className="flex items-center gap-3">
            <CheckCircle className={`w-5 h-5 ${estado.activo ? 'text-green-600' : 'text-gray-400'}`} />
            <div>
              <p className="text-sm font-semibold text-gray-900">
                Plan actual: <span className={PLAN_COLOR[user?.plan as Plan] || 'text-gray-600'}>{user?.plan}</span>
              </p>
              {estado.vencimiento && (
                <p className="text-xs text-gray-500">
                  Vence el {new Date(estado.vencimiento).toLocaleDateString('es-AR')}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Grilla de planes */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {planes?.map((plan) => {
          const Icon = PLAN_ICON[plan.plan as Plan] || Shield;
          const esCurrent = user?.plan === plan.plan;
          const isPremium = plan.popular;

          return (
            <div
              key={plan.plan}
              className={`card p-6 flex flex-col relative ${
                isPremium ? 'ring-2 ring-primary-400' : ''
              } ${esCurrent ? 'border-green-300' : ''}`}
            >
              {isPremium && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-primary-600 text-white text-xs font-bold px-3 py-1 rounded-full">
                    Recomendado
                  </span>
                </div>
              )}

              <div className="flex items-center gap-3 mb-4">
                <div className={`w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center ${PLAN_COLOR[plan.plan as Plan]}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900">{plan.nombre}</h3>
                  <p className="text-xs text-gray-500">{plan.vigencia}</p>
                </div>
              </div>

              {/* Precio */}
              <div className="mb-4">
                {plan.precio === 0 ? (
                  <p className="text-3xl font-extrabold text-gray-900">Gratis</p>
                ) : (
                  <div>
                    <p className="text-3xl font-extrabold text-gray-900">
                      ${plan.precio.toLocaleString('es-AR')}
                      <span className="text-base font-normal text-gray-500">/mes</span>
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">ARS · Pago con MercadoPago</p>
                  </div>
                )}
              </div>

              {/* Descripción */}
              <p className="text-sm text-gray-600 mb-4">{plan.descripcion}</p>

              {/* Beneficios */}
              <ul className="space-y-2 flex-1 mb-6">
                {plan.beneficios.map((b, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                    {b}
                  </li>
                ))}
              </ul>

              {/* CTA */}
              {esCurrent ? (
                <button disabled className="btn-secondary justify-center w-full opacity-60 cursor-not-allowed">
                  Plan actual
                </button>
              ) : plan.precio === 0 ? (
                <button disabled className="btn-secondary justify-center w-full opacity-60">
                  Disponible sin costo
                </button>
              ) : (
                <button
                  onClick={() => suscribirMutation.mutate(plan.plan)}
                  disabled={suscribirMutation.isPending}
                  className={`w-full justify-center ${isPremium ? 'btn-primary' : 'btn-secondary'}`}
                >
                  {suscribirMutation.isPending ? 'Redirigiendo...' : `Suscribirse a ${plan.nombre}`}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Aviso legal */}
      <div className="flex gap-3 bg-blue-50 rounded-xl p-4 text-sm text-blue-800">
        <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-medium mb-1">Sobre la vigilancia del Boletín de Marcas</p>
          <p className="text-xs text-blue-700">
            El sistema descarga y procesa automáticamente el Boletín de Marcas del INPI todos los
            <strong> jueves a las 9:00 AM</strong> (hora Argentina). Ante la detección de una marca
            confundible, recibís una notificación con el número de acta, denominación y plazo de
            oposición (30 días corridos desde la publicación). El análisis es automático y orientativo
            — la decisión legal sobre si oponerse es tuya.
          </p>
        </div>
      </div>

      {/* Servicios adicionales */}
      <div className="card p-5">
        <h2 className="section-title mb-3">Servicios legales adicionales</h2>
        <p className="text-sm text-gray-600">
          Además de la vigilancia automática, podés contratar servicios legales directamente:
          redacción y presentación de oposiciones, mantenimiento, declaraciones juradas de uso,
          renovaciones y asesoramiento personalizado.
        </p>
        <button
          onClick={() => window.location.href = '/servicios'}
          className="btn-secondary mt-4"
        >
          Ver servicios legales
        </button>
      </div>
    </div>
  );
}
