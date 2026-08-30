/**
 * Servicios Legales — MARCAS FÁCIL
 * Presentación de los servicios profesionales del estudio
 */
import { Scale, Shield, FileText, RefreshCw, Search, Phone, Mail, Star } from 'lucide-react';

const SERVICIOS = [
  {
    icon: Search,
    titulo: 'Búsqueda de antecedentes profesional',
    descripcion: 'Estudio completo de viabilidad de registro con informe jurídico personalizado. Análisis en todas las clases relacionadas.',
    precio: 'A consultar',
    tiempo: '48-72 hs hábiles',
    color: 'bg-purple-100 text-purple-600',
  },
  {
    icon: FileText,
    titulo: 'Presentación de solicitud de registro',
    descripcion: 'Preparación y presentación del trámite de registro ante el INPI, incluyendo el arancel oficial. Una clase de Niza.',
    precio: 'A consultar',
    tiempo: 'Inmediato',
    color: 'bg-blue-100 text-blue-600',
  },
  {
    icon: Shield,
    titulo: 'Oposición a solicitud de marca',
    descripcion: 'Redacción y presentación de la oposición ante el INPI. Incluye seguimiento del trámite conforme Res. 297/2026.',
    precio: 'A consultar',
    tiempo: 'Según plazos INPI',
    color: 'bg-orange-100 text-orange-600',
  },
  {
    icon: Scale,
    titulo: 'Mantenimiento de oposición',
    descripcion: 'Presentación del escrito de mantenimiento en el plazo de 15 días hábiles (Art. 1 Res. 297/2026). Incluye PDF.',
    precio: 'A consultar',
    tiempo: 'Urgente',
    color: 'bg-red-100 text-red-600',
  },
  {
    icon: FileText,
    titulo: 'Declaración jurada de uso (Art. 26)',
    descripcion: 'Preparación de la DDJJ de uso de medio término, obligatoria entre el 5º y 6º año de la concesión.',
    precio: 'A consultar',
    tiempo: '24 hs hábiles',
    color: 'bg-green-100 text-green-600',
  },
  {
    icon: RefreshCw,
    titulo: 'Renovación de registro',
    descripcion: 'Gestión completa de la renovación decenal del registro marcario. Incluye DDJJ de uso.',
    precio: 'A consultar',
    tiempo: 'Previo al vencimiento',
    color: 'bg-teal-100 text-teal-600',
  },
];

const TESTIMONIOS = [
  {
    texto: '"Excelente servicio. En menos de 48 horas tuve el estudio de factibilidad y pude presentar la solicitud. El seguimiento fue impecable."',
    autor: 'PyME del sector textil, CABA',
  },
  {
    texto: '"Detectaron una marca confundible en el Boletín y presentaron la oposición antes de que venciera el plazo. Sin el sistema automático, lo hubiera perdido."',
    autor: 'Empresa de alimentos, Córdoba',
  },
];

export default function Servicios() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="text-center">
        <h1 className="page-title">Servicios legales</h1>
        <p className="text-gray-500 mt-2 max-w-xl mx-auto">
          Asesoramiento jurídico en Propiedad Industrial con más de 20 años de trayectoria.
          Matriculado en el CPACF y Agente de la Propiedad Industrial (Mat. N° 1974).
        </p>
      </div>

      {/* Credenciales */}
      <div className="card p-5">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-2xl bg-primary-100 flex items-center justify-center flex-shrink-0">
            <Scale className="w-7 h-7 text-primary-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900">Dr. Honorio Leguizamón Pondal</h2>
            <p className="text-sm text-gray-600 mt-0.5">
              Abogado — T° 93 F° 651 C.P.A.C.F.
            </p>
            <p className="text-sm text-gray-600">
              Agente de la Propiedad Industrial — Mat. N° 1974
            </p>
            <p className="text-xs text-gray-400 mt-2">
              Especialista en Propiedad Industrial · Más de 20 años de trayectoria en registro y defensa marcaria
            </p>
          </div>
        </div>
      </div>

      {/* Servicios */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {SERVICIOS.map((s, i) => (
          <div key={i} className="card p-5">
            <div className="flex items-start gap-4">
              <div className={`w-10 h-10 rounded-xl ${s.color} flex items-center justify-center flex-shrink-0`}>
                <s.icon className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900 text-sm">{s.titulo}</h3>
                <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">{s.descripcion}</p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs font-medium text-primary-600">{s.precio}</span>
                  <span className="text-xs text-gray-400">{s.tiempo}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Testimonios */}
      <div className="space-y-3">
        <h2 className="section-title">Lo que dicen nuestros clientes</h2>
        {TESTIMONIOS.map((t, i) => (
          <div key={i} className="card p-5">
            <div className="flex gap-1 mb-3">
              {[...Array(5)].map((_, j) => (
                <Star key={j} className="w-4 h-4 fill-amber-400 text-amber-400" />
              ))}
            </div>
            <p className="text-sm text-gray-700 italic leading-relaxed">{t.texto}</p>
            <p className="text-xs text-gray-400 mt-2">— {t.autor}</p>
          </div>
        ))}
      </div>

      {/* CTA Contacto */}
      <div className="bg-gradient-to-r from-primary-600 to-primary-700 rounded-xl p-6 text-white text-center">
        <h2 className="text-xl font-bold mb-2">¿Necesitás asesoramiento?</h2>
        <p className="text-primary-100 text-sm mb-5">
          Consultanos sin cargo por el servicio que necesitás. Respondemos en menos de 24 hs hábiles.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <a
            href="mailto:estudio@marcasfacil.com.ar"
            className="inline-flex items-center gap-2 bg-white text-primary-700 px-5 py-2.5 rounded-xl font-semibold text-sm hover:bg-primary-50 transition-colors"
          >
            <Mail className="w-4 h-4" />
            Enviar consulta por email
          </a>
          <a
            href="https://wa.me/5491100000000"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-primary-500 text-white px-5 py-2.5 rounded-xl font-semibold text-sm hover:bg-primary-400 transition-colors"
          >
            <Phone className="w-4 h-4" />
            WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
}
