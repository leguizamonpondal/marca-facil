/**
 * Alertas y vencimientos — MARCAS FÁCIL
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bell, BellOff, Check, CheckCheck, AlertTriangle, Clock, Filter,
} from 'lucide-react';
import { format, parseISO, differenceInDays } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { alertasApi, getApiError } from '../services/api';
import { PageLoader } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import type { TipoAlerta } from '../types';

const TIPO_LABEL: Record<TipoAlerta, string> = {
  DDJJ_VENCIMIENTO: 'DDJJ',
  RENOVACION: 'Renovación',
  OPOSICION_DETECTADA: 'Oposición detectada',
  OPOSICION_PLAZO: 'Plazo oposición',
  OPOSICION_TRASLADO: 'Traslado',
  DOMINIO_VENCIMIENTO: 'Dominio NIC.AR',
  CUSTOM: 'Personalizada',
};

const TIPO_COLOR: Record<TipoAlerta, string> = {
  DDJJ_VENCIMIENTO: 'bg-purple-100 text-purple-700',
  RENOVACION: 'bg-blue-100 text-blue-700',
  OPOSICION_DETECTADA: 'bg-red-100 text-red-700',
  OPOSICION_PLAZO: 'bg-orange-100 text-orange-700',
  OPOSICION_TRASLADO: 'bg-yellow-100 text-yellow-700',
  DOMINIO_VENCIMIENTO: 'bg-cyan-100 text-cyan-700',
  CUSTOM: 'bg-gray-100 text-gray-700',
};

function AlertaItem({ alerta, onLeer }: { alerta: any; onLeer: () => void }) {
  const diasVence = alerta.fechaVencimiento
    ? differenceInDays(parseISO(alerta.fechaVencimiento), new Date())
    : null;

  const urgente = diasVence !== null && diasVence <= 7 && diasVence >= 0;
  const vencida = diasVence !== null && diasVence < 0;

  return (
    <div className={`flex items-start gap-4 p-4 rounded-xl border transition-all ${
      !alerta.leida ? 'bg-white border-gray-200 shadow-sm' : 'bg-gray-50 border-gray-100'
    } ${urgente ? 'border-l-4 border-l-red-400' : vencida ? 'border-l-4 border-l-gray-300' : ''}`}>
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
        urgente ? 'bg-red-100' : vencida ? 'bg-gray-100' : 'bg-blue-50'
      }`}>
        {urgente
          ? <AlertTriangle className="w-4 h-4 text-red-500" />
          : vencida
          ? <Clock className="w-4 h-4 text-gray-400" />
          : <Bell className="w-4 h-4 text-blue-500" />
        }
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <p className={`text-sm ${!alerta.leida ? 'font-semibold text-gray-900' : 'font-medium text-gray-600'}`}>
                {alerta.titulo}
              </p>
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${TIPO_COLOR[alerta.tipo as TipoAlerta] || 'bg-gray-100 text-gray-600'}`}>
                {TIPO_LABEL[alerta.tipo as TipoAlerta] || alerta.tipo}
              </span>
            </div>
            {alerta.descripcion && (
              <p className="text-xs text-gray-500 mt-0.5">{alerta.descripcion}</p>
            )}
            {alerta.marca && (
              <p className="text-xs text-gray-400 mt-0.5">
                Marca: {alerta.marca.denominacion} — Clase {alerta.marca.claseNiza}
              </p>
            )}
          </div>

          {!alerta.leida && (
            <button
              onClick={onLeer}
              className="flex-shrink-0 p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
              title="Marcar como leída"
            >
              <Check className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="mt-1.5 flex items-center gap-3 text-xs text-gray-400">
          {diasVence !== null && (
            <span className={
              urgente ? 'text-red-600 font-semibold' :
              vencida ? 'text-gray-500 line-through' :
              diasVence <= 30 ? 'text-orange-600 font-medium' : ''
            }>
              {vencida
                ? `Venció ${Math.abs(diasVence)} días atrás`
                : diasVence === 0 ? 'Vence HOY'
                : `Vence en ${diasVence} días (${format(parseISO(alerta.fechaVencimiento), 'd MMM yyyy', { locale: es })})`
              }
            </span>
          )}
          {alerta.leida
            ? <span className="flex items-center gap-1 text-green-600"><CheckCheck className="w-3 h-3" /> Leída</span>
            : <span className="w-2 h-2 rounded-full bg-blue-500" />
          }
        </div>
      </div>
    </div>
  );
}

export default function Alertas() {
  const queryClient = useQueryClient();
  const [filtro, setFiltro] = useState<'todas' | 'no-leidas' | 'urgentes'>('todas');
  const [page, setPage] = useState(1);

  const queryParams = {
    leida: filtro === 'no-leidas' ? false : undefined,
    urgentes: filtro === 'urgentes' ? true : undefined,
    page,
    limit: 30,
  };

  const { data, isLoading } = useQuery({
    queryKey: ['alertas', filtro, page],
    queryFn: () => alertasApi.listar(queryParams),
  });

  const marcarLeidaMutation = useMutation({
    mutationFn: (id: string) => alertasApi.marcarLeida(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alertas'] }),
    onError: (err) => toast.error(getApiError(err)),
  });

  const marcarTodasMutation = useMutation({
    mutationFn: () => alertasApi.marcarTodasLeidas(),
    onSuccess: () => {
      toast.success('Todas las alertas marcadas como leídas');
      queryClient.invalidateQueries({ queryKey: ['alertas'] });
    },
    onError: (err) => toast.error(getApiError(err)),
  });

  const alertas = data?.data || [];
  const total = data?.meta.total || 0;
  const noLeidas = alertas.filter(a => !a.leida).length;

  if (isLoading && !data) return <PageLoader />;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Alertas</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {total} alerta{total !== 1 ? 's' : ''}
            {noLeidas > 0 && ` · ${noLeidas} sin leer`}
          </p>
        </div>
        {noLeidas > 0 && (
          <button
            onClick={() => marcarTodasMutation.mutate()}
            disabled={marcarTodasMutation.isPending}
            className="btn-secondary"
          >
            <CheckCheck className="w-4 h-4" />
            Marcar todas como leídas
          </button>
        )}
      </div>

      {/* Filtros */}
      <div className="card p-3 flex items-center gap-3">
        <Filter className="w-4 h-4 text-gray-400" />
        <div className="flex gap-2">
          {([
            { id: 'todas', label: 'Todas' },
            { id: 'no-leidas', label: 'Sin leer' },
            { id: 'urgentes', label: 'Urgentes' },
          ] as const).map(f => (
            <button
              key={f.id}
              onClick={() => { setFiltro(f.id); setPage(1); }}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                filtro === f.id
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Lista */}
      {alertas.length === 0 ? (
        <EmptyState
          icon={BellOff}
          title="Sin alertas"
          description={
            filtro === 'urgentes' ? 'No hay alertas urgentes en este momento' :
            filtro === 'no-leidas' ? 'Todo al día — no tenés alertas sin leer' :
            'No hay alertas configuradas todavía'
          }
        />
      ) : (
        <div className="space-y-2">
          {alertas.map(alerta => (
            <AlertaItem
              key={alerta.id}
              alerta={alerta}
              onLeer={() => marcarLeidaMutation.mutate(alerta.id)}
            />
          ))}
        </div>
      )}

      {/* Paginación */}
      {data && data.meta.pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn-secondary py-1.5 px-3 text-sm">← Anterior</button>
          <span className="text-sm text-gray-600">Página {page} de {data.meta.pages}</span>
          <button onClick={() => setPage(p => Math.min(data.meta.pages, p + 1))} disabled={page === data.meta.pages} className="btn-secondary py-1.5 px-3 text-sm">Siguiente →</button>
        </div>
      )}
    </div>
  );
}
