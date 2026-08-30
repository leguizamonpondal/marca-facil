import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { AppLayout } from './components/layout/AppLayout';
import { FullPageLoader } from './components/ui/Spinner';

// Páginas con lazy loading
const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const MarcasList = lazy(() => import('./pages/MarcasList'));
const MarcaForm = lazy(() => import('./pages/MarcaForm'));
const MarcaDetail = lazy(() => import('./pages/MarcaDetail'));
const Oposiciones = lazy(() => import('./pages/Oposiciones'));
const OposicionDetail = lazy(() => import('./pages/OposicionDetail'));
const Alertas = lazy(() => import('./pages/Alertas'));
const Boletin = lazy(() => import('./pages/Boletin'));
const Factibilidad = lazy(() => import('./pages/Factibilidad'));
const Dominios = lazy(() => import('./pages/Dominios'));
const Planes = lazy(() => import('./pages/Planes'));
const Servicios = lazy(() => import('./pages/Servicios'));
const InpiPortal = lazy(() => import('./pages/InpiPortal'));

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<FullPageLoader />}>
        <Routes>
          {/* Auth */}
          <Route path="/login" element={<Login />} />

          {/* App protegida */}
          <Route path="/" element={<AppLayout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />

            {/* Marcas */}
            <Route path="marcas" element={<MarcasList />} />
            <Route path="marcas/nueva" element={<MarcaForm />} />
            <Route path="marcas/:id" element={<MarcaDetail />} />
            <Route path="marcas/:id/editar" element={<MarcaForm />} />

            {/* Oposiciones */}
            <Route path="oposiciones" element={<Oposiciones />} />
            <Route path="oposiciones/:id" element={<OposicionDetail />} />

            {/* Resto */}
            <Route path="alertas" element={<Alertas />} />
            <Route path="boletin" element={<Boletin />} />
            <Route path="factibilidad" element={<Factibilidad />} />
            <Route path="dominios" element={<Dominios />} />
            <Route path="planes" element={<Planes />} />
            <Route path="servicios" element={<Servicios />} />
            <Route path="inpi" element={<InpiPortal />} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
