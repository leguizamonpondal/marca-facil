/**
 * Boletín de Marcas INPI — MARCAS FÁCIL
 */
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { FileText, Download, RefreshCw, Search, CheckCircle, XCircle, Clock } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { boletinApi, getApiError } from '../services/api';
import { PageLoader, Spinner } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';

export default function Boletin() {
  const [busqueda, setBusqueda] = useState('');
  const [claseFilter, setClaseFilter] = useState('');
  const [page, setPage] = useState(1);

  const { data: stats } = useQuery({
    queryKey: ['boletin-stats'],
    queryFn: () => boletinApi.stats(),
  });

  const { data: descargas, isLoading: loadingDescargas } = useQuery({
    queryKey: ['boletin-descargas'],
    queryFn: () => boletinApi.listarDescargas(),
  });

  const { data: entradas, isLoading: loadingEntradas } = useQuery({
    queryKey: ['boletin-entradas', busqueda, claseFilter, page],
    queryFn: () => boletinApi.buscarEntradas({
      q: busqueda || undefined,
      clase: claseFilter ? Number(claseFilter) : undefined,
      page,
      limit: 20,
    }),
  });

  const descargarMutation = useMutation({
    mutationFn: () => boletinApi.descargar(),
    onSuccess: () => {
      toast.success('Boletín descargado y procesado');
    },
    onError: (err) => toast.error(getApiError(err)),
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Boletín de Marcas INPI</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Actualizado automáticamente todos los jueves a las 9:00 AM
          </p>
        </div>
        <button
          onClick={() => descargarMutation.mutate()}
          disabled={descargarMutation.isPending}
          className="btn-secondary"
        >
          {descargarMutation.isPending ? (
            <><Spinner size="sm" /> Descargando...</>
          ) : (
            <><RefreshCw className="w-4 h-4" /> Descargar ahora</>
          )}
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Entradas totales', value: stats.totalEntradas?.toLocaleString('es-AR') || '0' },
            { label: 'Boletines descargados', value: stats.boletinesDescargados || '0' },
            { label: 'Marcas vigiladas', value: stats.marcasVigiladas || '0' },
            {
              label: 'Última descarga',
              value: stats.ultimaBoletin
                ? format(parseISO(stats.ultimaBoletin), "d MMM yyyy", { locale: es })
                : 'Nunca'
            },
          ].map(s => (
            <div key={s.label} className="card p-4">
              <p className="text-xl font-bold text-gray-900">{s.value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Búsqueda de entradas */}
      <div className="card p-5 space-y-4">
        <h2 className="section-title">Buscar en el Boletín</h2>
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={busqueda}
              onChange={(e) => { setBusqueda(e.target.value); setPage(1); }}
              className="input pl-9"
              placeholder="Buscar denominación, titular, acta..."
            />
          </div>
          <input
            type="number"
            value={claseFilter}
            onChange={(e) => { setClaseFilter(e.target.value); setPage(1); }}
            className="input w-24"
            placeholder="Clase"
            min="1"
            max="45"
          />
        </div>

        {loadingEntradas ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : entradas?.data.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="Sin resultados"
            description={busqueda ? `No se encontraron marcas para "${busqueda}"` : 'El boletín aún no tiene entradas cargadas'}
          />
        ) : (
          <>
            <div className="space-y-2">
              {entradas?.data.map(entrada => (
                <div key={entrada.id} className="p-3.5 rounded-xl border border-gray-100 hover:border-gray-200 hover:bg-gray-50">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{entrada.denominacion}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Acta {entrada.acta} · Clase {entrada.claseNiza} · {entrada.tipoMarca}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Titular: {entrada.titularNombre}
                        {entrada.titularCuit && ` (CUIT ${entrada.titularCuit})`}
                      </p>
                    </div>
                    <span className="text-xs text-gray-400 flex-shrink-0">
                      {format(parseISO(entrada.boletinFecha), 'd MMM yyyy', { locale: es })}
                    </span>
                  </div>
                  {entrada.productos && (
                    <p className="text-xs text-gray-500 mt-1.5 truncate">{entrada.productos}</p>
                  )}
                </div>
              ))}
            </div>

            {entradas && entradas.meta.pages > 1 && (
              <div className="flex items-center justify-center gap-2">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn-secondary py-1.5 px-3 text-sm">← Anterior</button>
                <span className="text-sm text-gray-600">Página {page} de {entradas.meta.pages} ({entradas.meta.total} resultados)</span>
                <button onClick={() => setPage(p => Math.min(entradas.meta.pages, p + 1))} disabled={page === entradas.meta.pages} className="btn-secondary py-1.5 px-3 text-sm">Siguiente →</button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Historial de descargas */}
      <div className="card p-5">
        <h2 className="section-title mb-4">Historial de descargas</h2>
        {loadingDescargas ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : !descargas || descargas.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="Sin descargas registradas"
            description="El historial de boletines descargados aparecerá aquí"
          />
        ) : (
          <div className="space-y-2">
            {descargas.slice(0, 10).map(d => (
              <div key={d.id} className="flex items-center justify-between p-3 rounded-xl bg-gray-50">
                <div className="flex items-center gap-3">
                  {d.exitosa
                    ? <CheckCircle className="w-4 h-4 text-green-500" />
                    : <XCircle className="w-4 h-4 text-red-400" />
                  }
                  <div>
                    <p className="text-sm font-medium text-gray-900">Boletín {d.boletinNumero}</p>
                    <p className="text-xs text-gray-400">
                      {format(parseISO(d.fechaBoletin), "d 'de' MMMM 'de' yyyy", { locale: es })}
                    </p>
                  </div>
                </div>
                <div className="text-right text-xs text-gray-400">
                  <p>{d.exitosa ? 'Exitosa' : 'Fallida'}</p>
                  <p>{new Date(d.createdAt).toLocaleDateString('es-AR')}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
