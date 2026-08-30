import { useEffect } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showClose?: boolean;
}

const sizeClass = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
};

export function Modal({
  isOpen, onClose, title, children, size = 'md', showClose = true,
}: ModalProps) {
  // Cerrar con Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // Bloquear scroll del body
  useEffect(() => {
    if (isOpen) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className={clsx(
        'relative bg-white rounded-xl shadow-xl w-full fade-in',
        sizeClass[size]
      )}>
        {/* Header */}
        {(title || showClose) && (
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            {title && <h3 className="text-lg font-semibold text-gray-900">{title}</h3>}
            {showClose && (
              <button
                onClick={onClose}
                className="ml-auto p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        )}

        {/* Content */}
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ── Modal de confirmación ──────────────────────────────────────────────────────
interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  variant?: 'danger' | 'primary';
  isLoading?: boolean;
}

export function ConfirmModal({
  isOpen, onClose, onConfirm, title, message,
  confirmLabel = 'Confirmar', variant = 'primary', isLoading,
}: ConfirmModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <p className="text-sm text-gray-600 mb-5">{message}</p>
      <div className="flex gap-3 justify-end">
        <button onClick={onClose} className="btn-secondary">Cancelar</button>
        <button
          onClick={onConfirm}
          disabled={isLoading}
          className={variant === 'danger' ? 'btn-danger' : 'btn-primary'}
        >
          {isLoading ? 'Procesando...' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
