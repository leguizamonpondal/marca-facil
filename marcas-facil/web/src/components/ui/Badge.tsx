import clsx from 'clsx';
import type { EstadoMarca, EstadoOposicion, DictamenFactibilidad } from '../../types';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'gray';
  size?: 'sm' | 'md';
  className?: string;
}

const variantClasses = {
  default: 'bg-blue-100 text-blue-800',
  success: 'bg-green-100 text-green-800',
  warning: 'bg-yellow-100 text-yellow-800',
  danger: 'bg-red-100 text-red-800',
  info: 'bg-sky-100 text-sky-800',
  gray: 'bg-gray-100 text-gray-700',
};

export function Badge({ children, variant = 'default', size = 'sm', className }: BadgeProps) {
  return (
    <span className={clsx(
      'inline-flex items-center font-medium rounded-full',
      size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm',
      variantClasses[variant],
      className
    )}>
      {children}
    </span>
  );
}

// ── Badges especializados ──────────────────────────────────────────────────────
const MARCA_ESTADO_VARIANT: Record<EstadoMarca, BadgeProps['variant']> = {
  BORRADOR: 'warning',
  EN_TRAMITE: 'info',
  REGISTRADA: 'success',
  VIGENTE: 'success',
  VENCIDA: 'danger',
  ABANDONADA: 'gray',
  RECHAZADA: 'danger',
  CON_OPOSICION: 'warning',
};

const MARCA_ESTADO_LABEL: Record<EstadoMarca, string> = {
  BORRADOR: 'Borrador',
  EN_TRAMITE: 'En trámite',
  REGISTRADA: 'Registrada',
  VIGENTE: 'Vigente',
  VENCIDA: 'Vencida',
  ABANDONADA: 'Abandonada',
  RECHAZADA: 'Rechazada',
  CON_OPOSICION: 'Con oposición',
};

export function BadgeEstadoMarca({ estado }: { estado: EstadoMarca }) {
  return (
    <Badge variant={MARCA_ESTADO_VARIANT[estado] || 'gray'}>
      {MARCA_ESTADO_LABEL[estado] || estado}
    </Badge>
  );
}

const OP_ESTADO_VARIANT: Record<EstadoOposicion, BadgeProps['variant']> = {
  FORMULADA: 'info',
  MANTENIDA: 'default',
  EN_TRAMITE: 'warning',
  FUNDADA: 'success',
  INFUNDADA: 'danger',
  DESISTIDA: 'gray',
  ABANDONADA: 'gray',
};

const OP_ESTADO_LABEL: Record<EstadoOposicion, string> = {
  FORMULADA: 'Formulada',
  MANTENIDA: 'Mantenida',
  EN_TRAMITE: 'En trámite',
  FUNDADA: 'Fundada ✓',
  INFUNDADA: 'Infundada',
  DESISTIDA: 'Desistida',
  ABANDONADA: 'Abandonada',
};

export function BadgeEstadoOposicion({ estado }: { estado: EstadoOposicion }) {
  return (
    <Badge variant={OP_ESTADO_VARIANT[estado] || 'gray'}>
      {OP_ESTADO_LABEL[estado] || estado}
    </Badge>
  );
}

const DICTAMEN_VARIANT: Record<DictamenFactibilidad, BadgeProps['variant']> = {
  VIABLE: 'success',
  CONDICIONADA: 'warning',
  NO_VIABLE: 'danger',
};

export function BadgeDictamen({ dictamen }: { dictamen: DictamenFactibilidad }) {
  return (
    <Badge variant={DICTAMEN_VARIANT[dictamen]} size="md">
      {dictamen === 'VIABLE' && '✓ Viable'}
      {dictamen === 'CONDICIONADA' && '⚠ Condicionada'}
      {dictamen === 'NO_VIABLE' && '✗ No viable'}
    </Badge>
  );
}
