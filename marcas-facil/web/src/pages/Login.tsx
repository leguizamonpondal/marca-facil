/**
 * Página de Login y Registro — MARCA FACIL
 */
import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { Scale, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { getApiError } from '../services/api';

export default function Login() {
  const { isAuthenticated, login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [showPass, setShowPass] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    email: '',
    password: '',
    nombre: '',
    cuit: '',
    razonSocial: '',
    codigoReseller: '',
  });

  if (isAuthenticated) return <Navigate to="/dashboard" replace />;

  const set = (f: string, v: string) => {
    setForm(p => ({ ...p, [f]: v }));
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    try {
      if (mode === 'login') {
        await login(form.email, form.password);
      } else {
        await register({
          email: form.email,
          password: form.password,
          nombre: form.nombre,
          cuit: form.cuit || undefined,
          razonSocial: form.razonSocial || undefined,
          codigoReseller: form.codigoReseller || undefined,
        });
      }
      navigate('/dashboard');
    } catch (err) {
      setError(getApiError(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-blue-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-primary-600 rounded-2xl mb-3 shadow-lg">
            <Scale className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">MARCA FACIL</h1>
          <p className="text-sm text-gray-500 mt-1">
            Gestión integral de marcas para PyMEs argentinas
          </p>
        </div>

        {/* Card */}
        <div className="card p-8">
          {/* Tabs */}
          <div className="flex mb-6 border border-gray-200 rounded-xl overflow-hidden">
            <button
              onClick={() => setMode('login')}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                mode === 'login'
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              Ingresar
            </button>
            <button
              onClick={() => setMode('register')}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                mode === 'register'
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              Registrarse
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 mb-4">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Campos registro */}
            {mode === 'register' && (
              <>
                <div>
                  <label className="label">Nombre completo / Razón social *</label>
                  <input
                    type="text"
                    value={form.nombre}
                    onChange={(e) => set('nombre', e.target.value)}
                    className="input"
                    placeholder="Nombre completo o empresa"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">CUIT</label>
                    <input
                      type="text"
                      value={form.cuit}
                      onChange={(e) => set('cuit', e.target.value)}
                      className="input"
                      placeholder="20-12345678-9"
                    />
                  </div>
                  <div>
                    <label className="label">Razón social</label>
                    <input
                      type="text"
                      value={form.razonSocial}
                      onChange={(e) => set('razonSocial', e.target.value)}
                      className="input"
                      placeholder="Si tenés empresa"
                    />
                  </div>
                </div>
              </>
            )}

            {/* Email */}
            <div>
              <label className="label">Email *</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                className="input"
                placeholder="tu@email.com"
                required
                autoComplete="email"
              />
            </div>

            {/* Password */}
            <div>
              <label className="label">Contraseña *</label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  value={form.password}
                  onChange={(e) => set('password', e.target.value)}
                  className="input pr-10"
                  placeholder={mode === 'register' ? 'Mínimo 8 caracteres' : '••••••••'}
                  required
                  minLength={mode === 'register' ? 8 : undefined}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Código reseller */}
            {mode === 'register' && (
              <div>
                <label className="label">Código de referido (opcional)</label>
                <input
                  type="text"
                  value={form.codigoReseller}
                  onChange={(e) => set('codigoReseller', e.target.value.toUpperCase())}
                  className="input"
                  placeholder="Si te lo pasó alguien"
                />
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading}
              className="btn-primary w-full justify-center py-3 mt-2"
            >
              {isLoading
                ? (mode === 'login' ? 'Ingresando...' : 'Creando cuenta...')
                : (mode === 'login' ? 'Ingresar' : 'Crear cuenta gratuita')
              }
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-400 mt-6">
          Estudio Jurídico Leguizamón Pondal · Propiedad Industrial · CPACF
        </p>
      </div>
    </div>
  );
}
