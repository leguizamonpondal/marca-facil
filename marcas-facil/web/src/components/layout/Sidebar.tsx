import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Tag, FileText, Bell, Shield,
  Search, Globe, CreditCard, LogOut, ChevronDown, ChevronRight,
  Scale, Menu, X, BookOpen,
} from 'lucide-react';
import clsx from 'clsx';
import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import type { Plan } from '../../types';

const PLAN_BADGE: Record<Plan, { label: string; color: string }> = {
  GRATUITO: { label: 'Gratuito', color: 'bg-gray-100 text-gray-600' },
  BASICO: { label: 'Básico', color: 'bg-blue-100 text-blue-700' },
  PROFESIONAL: { label: 'Profesional', color: 'bg-purple-100 text-purple-700' },
  EMPRESARIAL: { label: 'Empresarial', color: 'bg-amber-100 text-amber-700' },
};

interface NavItem {
  label: string;
  to: string;
  icon: React.ElementType;
  badge?: string;
}

const navItems: NavItem[] = [
  { label: 'Panel', to: '/dashboard', icon: LayoutDashboard },
  { label: 'Mis Marcas', to: '/marcas', icon: Tag },
  { label: 'Oposiciones', to: '/oposiciones', icon: Shield },
  { label: 'Alertas', to: '/alertas', icon: Bell },
  { label: 'Boletín INPI', to: '/boletin', icon: FileText },
  { label: 'Factibilidad', to: '/factibilidad', icon: Search },
  { label: 'Dominios NIC.AR', to: '/dominios', icon: Globe },
  { label: 'Portal INPI', to: '/inpi', icon: BookOpen },
  { label: 'Planes', to: '/planes', icon: CreditCard },
  { label: 'Servicios legales', to: '/servicios', icon: Scale },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const planInfo = user ? PLAN_BADGE[user.plan] || PLAN_BADGE.GRATUITO : PLAN_BADGE.GRATUITO;

  const handleLogout = () => {
    logout();
  };

  return (
    <>
      {/* Overlay mobile */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-30 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside className={clsx(
        'fixed top-0 left-0 h-full w-64 bg-white border-r border-gray-200 z-40',
        'flex flex-col transition-transform duration-300 ease-in-out',
        'lg:translate-x-0 lg:static lg:z-auto',
        open ? 'translate-x-0' : '-translate-x-full'
      )}>
        {/* Logo */}
        <div className="flex items-center justify-between h-16 px-5 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
              <Scale className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-gray-900 text-lg">MARCA FACIL</span>
          </div>
          <button
            onClick={onClose}
            className="lg:hidden p-1.5 text-gray-400 hover:text-gray-600 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* User info */}
        <div className="px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-primary-100 flex items-center justify-center">
              <span className="text-sm font-bold text-primary-700">
                {user?.nombre?.charAt(0)?.toUpperCase() || 'U'}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{user?.nombre}</p>
              <span className={clsx(
                'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium',
                planInfo.color
              )}>
                {planInfo.label}
              </span>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-3 px-2">
          <div className="space-y-0.5">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onClose}
                className={({ isActive }) => clsx(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                )}
              >
                <item.icon className="w-4.5 h-4.5 flex-shrink-0 w-[18px] h-[18px]" />
                {item.label}
                {item.badge && (
                  <span className="ml-auto bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                    {item.badge}
                  </span>
                )}
              </NavLink>
            ))}
          </div>
        </nav>

        {/* Footer */}
        <div className="border-t border-gray-100 p-3">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 py-2.5 text-sm text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Cerrar sesión
          </button>
        </div>
      </aside>
    </>
  );
}
