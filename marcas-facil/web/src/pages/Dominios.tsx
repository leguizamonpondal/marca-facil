/**
 * Dominios NIC.AR — MARCAS FÁCIL
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Globe, Plus, Trash2, Edit, AlertTriangle } from 'lucide-react';
import { format, parseISO, differenceInDays } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { dominiosApi, getApiError } from '../services/api';
import { PageLoader } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal, ConfirmModal } from '../components/ui/Modal';
import type { Dominio } from '../types';

function FormDominio({
  initial, onSave, onCancel, isLoading,
}: {
  initial?: Partial<Dominio>;
  onSave: (data: any) => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  const [form, setForm] = useState({
    nombre: initial?.nombre || '',
    registrante: initial?.registrante || '',
    fechaRegistro: initial?.fechaRegistro?.slice(0, 10) || '',
    fechaVencimiento: initial?.fechaVencimiento?.slice(0, 10) || '',
    notas: initial?.notas || '',
  });
  const set = (f: string, v: string) => setForm(p => ({ ...p, [f]: v }));

  return (
    <div className="space-y-4">
      <div>
        <label className="label">Dominio *</label>
        <input
          type="text"
          value={form.nombre}
          onChange={(e) => set('nombre', e.target.value.toLowerCase())}
          className="input"
          placeholder="tudominio.com.ar"
          required
          disabled={!!initial?.id}
        />
      </div>
      <div>
        <label className="label">Registrante</label>
        <input type="text" value={form.registrante} onChange={(e) => set('registrante', e.target.value)} className="input" placeholder="Nombre del registrante" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Fecha de registro</label>
          <input type="date" value={form.fechaRegistro} onChange={(e) => set('fechaRegistro', e.target.value)} className="input" />
        </div>
        <div>
          <label className="label">Fecha de vencimiento</label>
          <input type="date" value={form.fechaVencimiento} onChange={(e) => set('fechaVencimiento', e.target.value)} className="input" />
        </div>
      </div>
      <div>
        <label className="label">Notas</label>
        <textarea value={form.notas} onChange={(e) => set('notas', e.target.value)} className="input" rows={2} />
      </div>
      <div className="flex justify-end gap-3">
        <button onClick={onCancel} className="btn-secondary">Cancelar</button>
        <button onClick={() => onSave(form)} disabled={!form.nombre || isLoading} className="btn-primary">
          {isLoading ? 'Guardando...' : initial?.id ? 'Guardar cambios' : 'Agregar dominio'}
        </button>
      </div>
    </div>
  );
}

export default function Dominios() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Dominio | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Dominio | null>(null);

  const { data: dominios, isLoading } = useQuery({
    queryKey: ['dominios'],
    queryFn: () => dominiosApi.listar(),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => dominiosApi.crear(data),
    onSuccess: () => {
      toast.success('Dominio agregado');
      queryClient.invalidateQueries({ queryKey: ['dominios'] });
      setShowForm(false);
    },
    onError: (err) => toast.error(getApiError(err)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => dominiosApi.actualizar(id, data),
    onSuccess: () => {
      toast.success('Dominio actualizado');
      queryClient.invalidateQueries({ queryKey: ['dominios'] });
      setEditTarget(null);
    },
    onError: (err) => toast.error(getApiError(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => dominiosApi.eliminar(id),
    onSuccess: () => {
      toast.success('Dominio eliminado');
      queryClient.invalidateQueries({ queryKey: ['dominios'] });
      setDeleteTarget(null);
    },
    onError: (err) => toast.error(getApiError(err)),
  });

  if (isLoading) return <PageLoader />;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Dominios NIC.AR</h1>
          <p className="text-sm text-gray-500 mt-0.5">Monitoreo de vencimientos de dominios</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary">
          <Plus className="w-4 h-4" /> Agregar dominio
        </button>
      </div>

      {/* Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
        <p className="font-medium mb-1">¿Por qué registrar tus dominios acá?</p>
        <p className="text-xs text-blue-700">
          El nombre de dominio puede ser un elemento de tu identidad comercial. MARCAS FÁCIL
          te alerta cuando el vencimiento de tu .ar se acerca, para que no pierdas el dominio
          que usás como marca en internet. NIC.AR no hace la vigilancia marcaria — eso lo hacemos nosotros.
        </p>
      </div>

      {/* Lista */}
      {!dominios || dominios.length === 0 ? (
        <EmptyState
          icon={Globe}
          title="Sin dominios registrados"
          description="Agregá los dominios .ar de tu empresa para recibir alertas de vencimiento"
          action={{ label: 'Agregar dominio', onClick: () => setShowForm(true) }}
        />
      ) : (
        <div className="space-y-3">
          {dominios.map(dominio => {
            const dias = dominio.fechaVencimiento
              ? differenceInDays(parseISO(dominio.fechaVencimiento), new Date())
              : null;
            const urgente = dias !== null && dias <= 30 && dias >= 0;
            const vencido = dias !== null && dias < 0;

            return (
              <div key={dominio.id} className={`card p-4 ${urgente ? 'border-orange-200' : vencido ? 'border-red-200' : ''}`}>
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    urgente ? 'bg-orange-100' : vencido ? 'bg-red-100' : 'bg-blue-50'
                  }`}>
                    <Globe className={`w-5 h-5 ${urgente ? 'text-orange-500' : vencido ? 'text-red-500' : 'text-blue-500'}`} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900">{dominio.nombre}</p>
                    {dominio.registrante && (
                      <p className="text-xs text-gray-500">Registrante: {dominio.registrante}</p>
                    )}
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-gray-400">
                      {dominio.fechaRegistro && (
                        <span>Registro: {format(parseISO(dominio.fechaRegistro), 'd MMM yyyy', { locale: es })}</span>
                      )}
                      {dominio.fechaVencimiento && (
                        <span className={urgente ? 'text-orange-600 font-medium' : vencido ? 'text-red-600 font-medium' : ''}>
                          Vence: {format(parseISO(dominio.fechaVencimiento), 'd MMM yyyy', { locale: es })}
                          {urgente && ` (${dias} días)`}
                          {vencido && ' — VENCIDO'}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => setEditTarget(dominio)}
                      className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(dominio)}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {urgente && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-orange-700 bg-orange-50 rounded-lg px-3 py-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Renovación pendiente — quedan {dias} días
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal agregar */}
      <Modal isOpen={showForm} onClose={() => setShowForm(false)} title="Agregar dominio" size="md">
        <FormDominio
          onSave={(data) => createMutation.mutate(data)}
          onCancel={() => setShowForm(false)}
          isLoading={createMutation.isPending}
        />
      </Modal>

      {/* Modal editar */}
      <Modal isOpen={!!editTarget} onClose={() => setEditTarget(null)} title="Editar dominio" size="md">
        {editTarget && (
          <FormDominio
            initial={editTarget}
            onSave={(data) => updateMutation.mutate({ id: editTarget.id, data })}
            onCancel={() => setEditTarget(null)}
            isLoading={updateMutation.isPending}
          />
        )}
      </Modal>

      {/* Modal eliminar */}
      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        title="Eliminar dominio"
        message={`¿Eliminar el dominio "${deleteTarget?.nombre}"?`}
        confirmLabel="Eliminar"
        variant="danger"
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
