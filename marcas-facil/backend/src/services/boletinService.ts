/**
 * SERVICIO DE VIGILANCIA MARCARIA — Boletín de Marcas INPI
 *
 * El Boletín de Marcas se publica todos los MIÉRCOLES.
 * Plazo para oponerse: 30 días corridos desde el día siguiente a la publicación.
 *
 * Ref: PresentacionOposicion_JUL26.pdf + Resolución INPI 297/2026
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '../db/client';
import { logger } from '../utils/logger';
import { esConfundible, addCalendarDays } from '../utils/helpers';
import { notificacionService } from './notificacionService';

// URL base del Boletín de Marcas INPI
const BOLETIN_BASE_URL = 'https://portaltramites.inpi.gob.ar/boletin';
const UPLOADS_DIR = path.join(process.cwd(), 'uploads', 'boletines');

export const boletinService = {

  /**
   * Descarga el boletín del miércoles correspondiente.
   * Puede recibir una fecha específica (para re-procesar) o tomar el último miércoles.
   */
  async descargarBoletin(fecha?: Date): Promise<{ exitosa: boolean; totalActas: number; error?: string }> {
    const fechaBoletin = fecha || getUltimoMiercoles();
    const fechaStr = fechaBoletin.toISOString().split('T')[0];

    logger.info(`📰 Descargando Boletín de Marcas INPI: ${fechaStr}`);

    // Crear directorio si no existe
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }

    const registro = await prisma.boletinDescarga.create({
      data: { fecha: fechaBoletin, exitosa: false },
    });

    try {
      // El INPI publica el boletín en formato PDF accesible públicamente
      // URL real: https://portaltramites.inpi.gob.ar/boletin/YYYY/boletin-YYYYMMDD.pdf
      // También está disponible como lista de actas en formato estructurado
      const url = `${BOLETIN_BASE_URL}/${fechaBoletin.getFullYear()}/boletin-${fechaStr.replace(/-/g, '')}.pdf`;

      logger.info(`  URL: ${url}`);

      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 60000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MarcasFacil/1.0; +info@marcasfacil.com.ar)',
        },
      });

      const pdfPath = path.join(UPLOADS_DIR, `boletin-${fechaStr}.pdf`);
      fs.writeFileSync(pdfPath, response.data);
      logger.info(`  ✅ PDF guardado: ${pdfPath}`);

      // Parsear el PDF para extraer marcas nuevas
      const marcas = await parsearBoletinPDF(pdfPath, fechaBoletin);
      logger.info(`  📊 ${marcas.length} solicitudes encontradas en el boletín`);

      // Guardar en base de datos (upsert para evitar duplicados)
      let guardadas = 0;
      for (const marca of marcas) {
        try {
          await prisma.boletinEntrada.upsert({
            where: { acta: marca.acta },
            create: {
              boletinFecha: fechaBoletin,
              acta: marca.acta,
              denominacion: marca.denominacion,
              tipoMarca: marca.tipoMarca,
              claseNiza: marca.claseNiza,
              titularNombre: marca.titularNombre,
              titularCuit: marca.titularCuit,
              productos: marca.productos,
            },
            update: {}, // Si ya existe, no actualizar
          });
          guardadas++;
        } catch (err) {
          // Silenciar duplicados individuales
        }
      }

      await prisma.boletinDescarga.update({
        where: { id: registro.id },
        data: { exitosa: true, totalActas: guardadas, url },
      });

      return { exitosa: true, totalActas: guardadas };

    } catch (err: any) {
      const errorMsg = err.message || 'Error desconocido';
      logger.error(`❌ Error descargando boletín ${fechaStr}: ${errorMsg}`);

      await prisma.boletinDescarga.update({
        where: { id: registro.id },
        data: { exitosa: false, error: errorMsg },
      });

      return { exitosa: false, totalActas: 0, error: errorMsg };
    }
  },

  /**
   * Procesa el boletín descargado y cruza con marcas de usuarios.
   * Genera alertas de oposición cuando detecta confundibilidad.
   */
  async procesarVigilancia(fechaBoletin?: Date): Promise<{ alertasGeneradas: number }> {
    const fecha = fechaBoletin || getUltimoMiercoles();
    logger.info(`🔍 Procesando vigilancia marcaria para boletín: ${fecha.toISOString().split('T')[0]}`);

    // Obtener entradas del boletín sin procesar
    const entradasNuevas = await prisma.boletinEntrada.findMany({
      where: { boletinFecha: fecha, procesado: false },
    });

    if (entradasNuevas.length === 0) {
      logger.info('  No hay entradas nuevas para procesar');
      return { alertasGeneradas: 0 };
    }

    // Obtener todas las marcas con vigilancia activa
    const marcasVigiladas = await prisma.marca.findMany({
      where: {
        vigilanciaActiva: true,
        estado: { in: ['EN_TRAMITE', 'PUBLICADA', 'OPOSICION', 'EXAMEN_FONDO', 'CONCEDIDA'] },
      },
      include: { user: { select: { id: true, email: true, agenteCuit: true } } },
    });

    let alertasGeneradas = 0;
    const plazoOposicion = addCalendarDays(fecha, 31); // 30 días corridos desde DÍA SIGUIENTE

    for (const entrada of entradasNuevas) {
      for (const marcaVigilada of marcasVigiladas) {
        // Solo comparar en la misma clase (oposición directa) o clases relacionadas
        if (!clasesRelacionadas(marcaVigilada.claseNiza, entrada.claseNiza)) continue;

        const { confundible, similitud, razon } = esConfundible(
          marcaVigilada.denominacion,
          entrada.denominacion,
          marcaVigilada.claseNiza,
          entrada.claseNiza
        );

        if (!confundible) continue;

        logger.info(`  ⚠️  CONFUNDIBLE: "${marcaVigilada.denominacion}" vs "${entrada.denominacion}" — similitud ${similitud}%`);

        // Verificar que no existe ya una alerta/oposición para esta combinación
        const existente = await prisma.oposicion.findFirst({
          where: { marcaOponenteId: marcaVigilada.id, actaOpuesta: entrada.acta },
        });
        if (existente) continue;

        // Crear oposición pendiente
        const oposicion = await prisma.oposicion.create({
          data: {
            userId: marcaVigilada.userId,
            marcaOponenteId: marcaVigilada.id,
            boletinEntradaId: entrada.id,
            actaOpuesta: entrada.acta,
            denominacionOpuesta: entrada.denominacion,
            claseOpuesta: entrada.claseNiza,
            titularOpuesto: entrada.titularNombre,
            plazoVence: plazoOposicion,
            estado: 'PENDIENTE',
            fundamentosTexto: generarFundamentosOposicion({
              marcaOponente: marcaVigilada.denominacion,
              actaOponente: marcaVigilada.acta || '',
              resolucionOponente: marcaVigilada.resolucion || '',
              claseOponente: marcaVigilada.claseNiza,
              productosOponente: marcaVigilada.productos,
              marcaOpuesta: entrada.denominacion,
              actaOpuesta: entrada.acta,
              claseOpuesta: entrada.claseNiza,
              productosOpuestos: entrada.productos || '',
              titularOponente: marcaVigilada.titularNombre,
              similitud,
              razon,
            }),
          },
        });

        // Crear alerta urgente para el usuario
        await prisma.alerta.create({
          data: {
            userId: marcaVigilada.userId,
            tipo: 'OPOSICION_DETECTADA',
            titulo: `⚠️ Marca confundible detectada: "${entrada.denominacion}"`,
            descripcion:
              `Se publicó en el Boletín del ${fecha.toLocaleDateString('es-AR')} la solicitud de marca ` +
              `"${entrada.denominacion}" (Acta ${entrada.acta}, Clase ${entrada.claseNiza}) ` +
              `por ${entrada.titularNombre}, que es confundible con tu marca ` +
              `"${marcaVigilada.denominacion}" (similitud ${similitud}%). ` +
              `Plazo para oponerse: ${plazoOposicion.toLocaleDateString('es-AR')}.`,
            urgente: true,
            marcaId: marcaVigilada.id,
            oposicionId: oposicion.id,
            fechaAlerta: new Date(),
          },
        });

        // Enviar push notification
        await notificacionService.enviarAlertaOposicion(
          marcaVigilada.userId,
          marcaVigilada.denominacion,
          entrada.denominacion,
          entrada.acta,
          plazoOposicion
        );

        alertasGeneradas++;
      }

      // Marcar entrada como procesada
      await prisma.boletinEntrada.update({
        where: { id: entrada.id },
        data: { procesado: true },
      });
    }

    logger.info(`✅ Vigilancia completada: ${alertasGeneradas} alertas generadas`);
    return { alertasGeneradas };
  },

  /**
   * Carga manual de marcas del boletín (cuando el PDF no se puede parsear automáticamente)
   */
  async cargarManual(datos: {
    boletinFecha: Date;
    acta: string;
    denominacion: string;
    tipoMarca: string;
    claseNiza: number;
    titularNombre: string;
    titularCuit?: string;
    productos?: string;
  }[]) {
    const results = await Promise.allSettled(
      datos.map(d =>
        prisma.boletinEntrada.upsert({
          where: { acta: d.acta },
          create: d,
          update: {},
        })
      )
    );
    return results.filter(r => r.status === 'fulfilled').length;
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getUltimoMiercoles(): Date {
  const hoy = new Date();
  const dia = hoy.getDay(); // 0=Dom, 3=Mie
  const diasAtras = dia >= 3 ? dia - 3 : dia + 4;
  const mie = new Date(hoy);
  mie.setDate(hoy.getDate() - diasAtras);
  mie.setHours(0, 0, 0, 0);
  return mie;
}

/**
 * Determina si dos clases NIZA son comparables a efectos de oposición.
 * En la misma clase siempre. En clases relacionadas, criterio amplio del INPI.
 */
function clasesRelacionadas(clase1: number, clase2: number): boolean {
  if (clase1 === clase2) return true;

  // Clases con alta relación comercial según jurisprudencia INPI
  const relacionadas: Record<number, number[]> = {
    3: [44],          // Cosmética / servicios de salud/belleza
    5: [44, 3],       // Farmacéutica / cosmética / salud
    9: [42, 38],      // Software / tecnología / telecomunicaciones
    25: [26, 35, 18], // Indumentaria / accesorios / moda / comercio
    35: [36, 42, 45], // Servicios comerciales / financieros / tecnológicos / legales
    36: [35, 45],     // Financiero / comercial / legal
    41: [42, 45, 35], // Educación / entretenimiento
    43: [30, 32, 33], // Restauración / alimentos / bebidas
    44: [5, 3],       // Servicios médicos / farmacéutica / cosmética
  };

  return relacionadas[clase1]?.includes(clase2) || relacionadas[clase2]?.includes(clase1) || false;
}

/**
 * Genera el BORRADOR de fundamentos de oposición siguiendo la estructura
 * de la plantilla estándar del estudio.
 *
 * IMPORTANTE: Este texto es un borrador pre-completado que el profesional
 * (Honorio) revisa y ajusta antes de presentar. Los campos entre [CORCHETES]
 * deben completarse manualmente según el caso concreto.
 */
function generarFundamentosOposicion(params: {
  marcaOponente: string;
  actaOponente: string;
  resolucionOponente: string;
  claseOponente: number;
  productosOponente: string;
  marcaOpuesta: string;
  actaOpuesta: string;
  claseOpuesta: number;
  productosOpuestos: string;
  titularOponente: string;
  similitud: number;
  razon: string;
}): string {
  const {
    marcaOponente, actaOponente, resolucionOponente, claseOponente,
    productosOponente, marcaOpuesta, actaOpuesta, claseOpuesta,
    productosOpuestos, titularOponente,
  } = params;

  const mismaClase = claseOponente === claseOpuesta;
  const referenciaPropia = resolucionOponente
    ? `Resolución N° ${resolucionOponente}`
    : `Acta N° ${actaOponente}`;

  // Texto exacto de la plantilla oficial del estudio.
  // Es el mismo para todas las oposiciones — no se modifica.
  return `La solicitud de marca presentada es directamente confundible con la/s marca/s de nuestra propiedad. Niego, por no constarme, que el/la solicitante tenga interés legítimo para registrar la marca opuesta. Fundo el derecho de nuestra parte en los arts. 3, 4, 24 y demás concordantes de la Ley 22.362 y jurisprudencia del fuero. Formulo reserva de ampliar los fundamentos de la presente oposición, tanto en sede administrativa como judicial.`;
}

/**
 * Parsea el PDF del Boletín de Marcas para extraer las solicitudes publicadas.
 * El boletín tiene un formato estructurado: N° Acta, Titular, Clase, Denominación, Tipo.
 *
 * NOTA: La implementación real usa pdfjs-dist para parsear el PDF.
 * Para MVP inicial se puede hacer scraping del portal del INPI.
 */
async function parsearBoletinPDF(pdfPath: string, fecha: Date): Promise<Array<{
  acta: string;
  denominacion: string;
  tipoMarca: string;
  claseNiza: number;
  titularNombre: string;
  titularCuit?: string;
  productos?: string;
}>> {
  try {
    // Parseo con pdf-parse (CommonJS compatible)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse') as (buffer: Buffer) => Promise<{ text: string }>;
    const dataBuffer = fs.readFileSync(pdfPath);
    const pdfData = await pdfParse(dataBuffer);
    const fullText = pdfData.text;
    const marcas: any[] = [];

    // El boletín INPI tiene páginas — las dividimos por saltos
    const pages = fullText.split('\f').filter((p: string) => p.trim());
    for (const text of pages.length > 0 ? pages : [fullText]) {

      // El boletín tiene formato tabular: extraer con regex
      // Formato típico: ACTA N° XXXXXXX DENOMINACION (TIPO) CLASE XX TITULAR
      const regexActa = /ACTA\s+N[°º]\s*(\d[\d.,]+)/gi;
      let match;

      while ((match = regexActa.exec(text)) !== null) {
        const acta = match[1].replace(/[.,]/g, '');
        // Extraer datos del contexto alrededor del acta
        const contexto = text.substring(match.index, match.index + 500);

        const claseMatch = contexto.match(/CLASE\s+(\d{1,2})/i);
        const clase = claseMatch ? parseInt(claseMatch[1]) : 0;

        if (clase > 0 && clase <= 45) {
          marcas.push({
            acta,
            denominacion: extraerDenominacion(contexto) || `MARCA-${acta}`,
            tipoMarca: extraerTipoMarca(contexto) || 'DENOMINATIVA',
            claseNiza: clase,
            titularNombre: extraerTitular(contexto) || 'TITULAR NO IDENTIFICADO',
            titularCuit: extraerCuit(contexto),
            productos: extraerProductos(contexto),
          });
        }
      }
    }

    return marcas;
  } catch (err) {
    logger.warn(`No se pudo parsear PDF automáticamente: ${err}. Se requiere carga manual.`);
    return [];
  }
}

// Funciones auxiliares de parsing del PDF
function extraerDenominacion(texto: string): string {
  const match = texto.match(/["«»"]([^"«»"]+)["«»"]/);
  return match ? match[1].trim() : '';
}

function extraerTipoMarca(texto: string): string {
  const tipos = ['DENOMINATIVA', 'FIGURATIVA', 'MIXTA', 'TRIDIMENSIONAL', 'SONORA', 'OLFATIVA'];
  for (const tipo of tipos) {
    if (texto.toUpperCase().includes(tipo)) return tipo;
  }
  return 'DENOMINATIVA';
}

function extraerTitular(texto: string): string {
  const match = texto.match(/TITULAR[:\s]+([A-ZÁÉÍÓÚÑ\s,.-]+?)(?:CLASE|CUIT|$)/i);
  return match ? match[1].trim().substring(0, 100) : '';
}

function extraerCuit(texto: string): string | undefined {
  const match = texto.match(/CUIT[:\s]+(\d{2}-?\d{8}-?\d)/i);
  return match ? match[1].replace(/\D/g, '') : undefined;
}

function extraerProductos(texto: string): string | undefined {
  const match = texto.match(/PRODUCTOS?[:\s]+(.+?)(?:TITULAR|CLASE|$)/i);
  return match ? match[1].trim().substring(0, 500) : undefined;
}
