/**
 * Lista de Marcas — MARCAS FÁCIL
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Search, Filter, Eye, Shield, Bell, Trash2,
  Tag, MoreVertical, Download,
} from 'lucide-react';
import { format, parseISO, differenceInDays } from 'date-fns';
import toast from 'react-hot-toast';
import { marcasApi } from '../services/api';
import { BadgeEstadoMarca } from '../components/ui/Badge';
import { PageLoader } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import { ConfirmModal } from '../components/ui/Modal';
import { getApiError } from '../services/api';
import type { EstadoMarca, Marca } from '../types';
import { CLASES_NIZA } from '../types';

const ESTADOS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Todos los estados' },
  { value: 'EN_TRAMITE', label: 'En trámite' },
  { value: 'REGISTRADA', label: 'Registrada' },
  { value: 'VIGENTE', label: 'Vigente' },
  { value: 'CON_OPOSICION', label: 'Con oposición' },
  { value: 'VENCIDA', label: 'Vencida' },
  { value: 'ABANDONADA', label: 'Abandonada' },
  { value: 'BORRADOR', label: 'Borrador' },
];

export default function MarcasList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filtroEstado, setFiltroEstado] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<Marca | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['marcas', filtroEstado, page],
    queryFn: () => marcasApi.listar({
      estado: filtroEstado || undefined,
      page,
      limit: 20,
    }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => marcasApi.eliminar(id),
    onSuccess: () => {
      toast.success('Marca eliminada');
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ['marcas'] });
    },
    onError: (err) => toast.error(getApiError(err)),
  });

  const vigilanciaMutation = useMutation({
    mutationFn: (id: string) => marcasApi.activarVigilancia(id),
    onSuccess: () => {
      toast.success('Vigilancia actualizada');
      queryClient.invalidateQueries({ queryKey: ['marcas'] });
    },
    onError: (err) => toast.error(getApiError(err)),
  });

  const marcas = data?.data || [];
  const filtradas = busqueda
    ? marcas.filter(m =>
        m.denominacion.toLowerCase().includes(busqueda.toLowerCase()) ||
        m.numeroActa?.includes(busqueda)
      )
    : marcas;

  if (isLoading && !data) return <PageLoader />;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Mis Marcas</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {data?.meta.total || 0} marca{(data?.meta.total || 0) !== 1 ? 's' : ''} registrada{(data?.meta.total || 0) !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={() => navigate('/marcas/nueva')}
          className="btn-primary"
        >
          <Plus className="w-4 h-4" />
          Nueva marca
        </button>
      </div>

      {/* Filtros */}
      <div className="card p-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por denominación o acta..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="input pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <select
            value={filtroEstado}
            onChange={(e) => { setFiltroEstado(e.target.value); setPage(1); }}
            className="input w-auto"
          >
            {ESTADOS.map(e => (
              <option key={e.value} value={e.value}>{e.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Lista */}
      {filtradas.length === 0 ? (
        <EmptyState
          icon={Tag}
          title={busqueda ? 'Sin resultados' : 'Todavía no cargaste marcas'}
          description={busqueda
            ? `No hay marcas que coincidan con "${busqueda}"`
            : 'Registrá tu primera marca o hacé una búsqueda de antecedentes'
          }
          action={!busqueda ? {
            label: 'Registrar primera marca',
            onClick: () => navigate('/marcas/nueva'),
          } : undefined}
        />
      ) : (
        <div className="space-y-3">
          {filtradas.map((marca) => (
            <MarcaCard
              key={marca.id}
              marca={marca}
              onView={() => navigate(`/marcas/${marca.id}`)}
              onDelete={() => setDeleteTarget(marca)}
              onToggleVigilancia={() => vigilanciaMutation.mutate(marca.id)}
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
          <span className="text-sm text-gray-600">
            Página {page} de {data.meta.pages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(data.meta.pages, p + 1))}
            disabled={page === data.meta.pages}
            className="btn-secondary py-1.5 px-3 text-sm"
          >
            Siguiente →
          </button>
        </div>
      )}

      {/* Modal confirmar eliminación */}
      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        title="Eliminar marca"
        message={`¿Eliminar "${deleteTarget?.denominacion}"? Solo se pueden eliminar marcas en estado Borrador.`}
        confirmLabel="Eliminar"
        variant="danger"
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}

// ── Tarjeta de marca ───────────────────────────────────────────────────────────
function MarcaCard({
  marca, onView, onDelete, onToggleVigilancia,
}: {
  marca: Marca;
  onView: () => void;
  onDelete: () => void;
  onToggleVigilancia: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  const diasVencimiento = marca.fechaVencimiento
    ? differenceInDays(parseISO(marca.fechaVencimiento), new Date())
    : null;

  const pronto = diasVencimiento !== null && diasVencimiento < 365 && diasVencimiento > 0;
  const vencida = diasVencimiento !== null && diasVencimiento <= 0;

  return (
    <div className="card hover:shadow-md transition-shadow">
      <div className="p-4">
        <div className="flex items-start gap-4">
          {/* Ícono clase */}
          <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center flex-shrink-0">
            <span className="text-sm font-bold text-primary-700">{marca.claseNiza}</span>
          </div>

          {/* Info principal */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3
                  onClick={onView}
                  className="font-semibold text-gray-900 hover:text-primary-600 cursor-pointer"
                >
                  {marca.denominacion}
                </h3>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <BadgeEstadoMarca estado={marca.estado as EstadoMarca} />
                  <span className="text-xs text-gray-400">Clase {marca.claseNiza} — {CLASES_NIZA[marca.claseNiza]}</span>
                </div>
              </div>

              {/* Menú acciones */}
              <div className="relative flex-shrink-0">
                <button
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
                  className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  <MoreVertical className="w-4 h-4" />
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                    <div className="absolute right-0 top-8 z-20 bg-white border border-gray-200 rounded-xl shadow-lg py-1 w-44">
                      <button
                        onClick={() => { onView(); setMenuOpen(false); }}
                        className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <Eye className="w-4 h-4" /> Ver detalle
                      </button>
                      <button
                        onClick={() => { onToggleVigilancia(); setMenuOpen(false); }}
                        className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <Shield className="w-4 h-4" />
                        {marca.vigilanciaActiva ? 'Desactivar vigilancia' : 'Activar vigilancia'}
                      </button>
                      {marca.estado === 'BORRADOR' && (
                        <button
                          onClick={() => { onDelete(); setMenuOpen(false); }}
                          className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4" /> Eliminar
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Datos secundarios */}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
              {marca.numeroActa && <span>Acta {marca.numeroActa}</span>}
              {marca.numeroCertificado && <span>Cert. {marca.numeroCertificado}</span>}
              {marca.fechaSolicitud && (
                <span>Solicitada: {format(parseISO(marca.fechaSolicitud), 'dd/MM/yyyy')}</span>
              )}
              {marca.fechaVencimiento && (
                <span className={pronto ? 'text-orange-600 font-medium' : vencida ? 'text-red-600 font-medium' : ''}>
                  Vence: {format(parseISO(marca.fechaVencimiento), 'dd/MM/yyyy')}
                  {pronto && ` (en ${diasVencimiento} días)`}
                  {vencida && ' — VENCIDA'}
                </span>
              )}
            </div>

            {/* Chips de estado especial */}
            <div className="mt-2 flex gap-2">
              {marca.vigilanciaActiva && (
                <span className="inline-flex items-center gap-1 text-[11px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                  <Shield className="w-3 h-3" /> Vigilada
                </span>
              )}
              {(marca._count?.oposicionesRecibidas || 0) > 0 && (
                <span className="inline-flex items-center gap-1 text-[11px] bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">
                  <Bell className="w-3 h-3" /> {marca._count?.oposicionesRecibidas} oposición{(marca._count?.oposicionesRecibidas || 0) > 1 ? 'es' : ''}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
