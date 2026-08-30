import clsx from 'clsx';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function Spinner({ size = 'md', className }: SpinnerProps) {
  const sizeClass = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-10 h-10' }[size];
  return (
    <div className={clsx(
      'animate-spin rounded-full border-2 border-gray-200 border-t-primary-600',
      sizeClass, className
    )} />
  );
}

export function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[300px]">
      <div className="flex flex-col items-center gap-3">
        <Spinner size="lg" />
        <p className="text-sm text-gray-500">Cargando...</p>
      </div>
    </div>
  );
}

export function FullPageLoader() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-white z-50">
      <div className="flex flex-col items-center gap-4">
        <div className="text-2xl font-bold text-primary-600">MARCAS FÁCIL</div>
        <Spinner size="lg" />
      </div>
    </div>
  );
}
