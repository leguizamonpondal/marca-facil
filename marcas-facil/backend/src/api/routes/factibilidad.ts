/**
 * Rutas de Estudio de Factibilidad — MARCAS FÁCIL
 *
 * Flujo:
 * 1. Usuario ingresa denominación + clase NIZA
 * 2. Sistema consulta el Boletín (base de datos local) y el registro INPI
 * 3. Aplica algoritmo de confusabilidad sobre marcas similares en la misma clase
 * 4. Genera PDF con dictamen de factibilidad
 *
 * Niveles de factibilidad:
 * - VIABLE: Ningún antecedente confundible en la misma clase
 * - CONDICIONADA: Antecedentes colisionantes pero posiblemente coexistibles
 * - NO_VIABLE: Marca idéntica o prácticamente idéntica en la misma clase
 */

import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/client';
import { AppError } from '../../middleware/errorHandler';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { calcularSimilitudMarcas, esConfundible, normalizarMarca } from '../../utils/helpers';
import { logger } from '../../utils/logger';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();
router.use(authenticate);

const FACTIBILIDAD_DIR = path.join(process.cwd(), 'uploads', 'factibilidad');

// ── GET /api/factibilidad — Historial de estudios ─────────────────────────────
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const estudios = await prisma.estudioFactibilidad.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json(estudios);
  } catch (err) { next(err); }
});

// ── POST /api/factibilidad — Ejecutar estudio de factibilidad ─────────────────
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      denominacion: z.string().min(2, 'Denominación debe tener al menos 2 caracteres'),
      claseNiza: z.number().int().min(1).max(45),
      tipoMarca: z.enum(['DENOMINATIVA', 'FIGURATIVA', 'MIXTA']).optional(),
      productos: z.string().optional(),
    });

    const { denominacion, claseNiza, tipoMarca, productos } = schema.parse(req.body);

    logger.info(`🔍 Estudio factibilidad: "${denominacion}" Clase ${claseNiza} — Usuario ${req.user!.id}`);

    // 1. Buscar en el Boletín (base de datos local de marcas publicadas/solicitadas)
    const enBoletinMismaClase = await prisma.boletinEntrada.findMany({
      where: { claseNiza },
      select: { acta: true, denominacion: true, claseNiza: true, titularNombre: true, fechaPublicacion: true },
    });

    // 2. Buscar en marcas registradas propias del sistema
    const enSistema = await prisma.marca.findMany({
      where: {
        claseNiza,
        estado: { in: ['EN_TRAMITE', 'PUBLICADA', 'CONCEDIDA'] },
      },
      select: { acta: true, denominacion: true, claseNiza: true, titularNombre: true, estado: true },
    });

    // 3. Analizar confusabilidad
    const antecedentes: Array<{
      fuente: 'BOLETIN' | 'SISTEMA';
      acta: string;
      denominacion: string;
      clase: number;
      titular: string;
      similitud: number;
      confundible: boolean;
      razon: string;
      estado?: string;
    }> = [];

    // Clases relacionadas a analizar también (criterio jurisprudencial INPI)
    const clasesRelacionadas = getClasesRelacionadas(claseNiza);

    for (const entrada of enBoletinMismaClase) {
      const resultado = esConfundible(denominacion, entrada.denominacion, claseNiza, entrada.claseNiza);
      if (resultado.similitud >= 50) { // Mostrar cualquier similitud >= 50%
        antecedentes.push({
          fuente: 'BOLETIN',
          acta: entrada.acta,
          denominacion: entrada.denominacion,
          clase: entrada.claseNiza,
          titular: entrada.titularNombre || 'No informado',
          similitud: resultado.similitud,
          confundible: resultado.confundible,
          razon: resultado.razon,
        });
      }
    }

    for (const marca of enSistema) {
      const resultado = esConfundible(denominacion, marca.denominacion, claseNiza, marca.claseNiza);
      if (resultado.similitud >= 50) {
        antecedentes.push({
          fuente: 'SISTEMA',
          acta: marca.acta || 'S/N',
          denominacion: marca.denominacion,
          clase: marca.claseNiza,
          titular: marca.titularNombre || 'Registrado en sistema',
          similitud: resultado.similitud,
          confundible: resultado.confundible,
          razon: resultado.razon,
          estado: marca.estado,
        });
      }
    }

    // Ordenar por similitud descendente
    antecedentes.sort((a, b) => b.similitud - a.similitud);

    // 4. Determinar factibilidad
    const maxSimilitud = antecedentes.length > 0 ? antecedentes[0].similitud : 0;
    const tieneConfundibles = antecedentes.some(a => a.confundible);

    let dictamen: 'VIABLE' | 'CONDICIONADA' | 'NO_VIABLE';
    let riesgo: 'BAJO' | 'MEDIO' | 'ALTO';
    let resumenDictamen: string;

    if (!tieneConfundibles || maxSimilitud < 60) {
      dictamen = 'VIABLE';
      riesgo = 'BAJO';
      resumenDictamen = `No se detectaron antecedentes confundibles para la marca "${denominacion}" en la Clase ${claseNiza}. La solicitud de registro tiene perspectivas favorables.`;
    } else if (maxSimilitud >= 60 && maxSimilitud < 85) {
      dictamen = 'CONDICIONADA';
      riesgo = 'MEDIO';
      resumenDictamen = `Se detectaron ${antecedentes.filter(a => a.confundible).length} antecedente(s) con similitud considerable. La solicitud puede tramitarse pero podría enfrentar oposiciones. Se recomienda analizar la coexistencia.`;
    } else {
      dictamen = 'NO_VIABLE';
      riesgo = 'ALTO';
      resumenDictamen = `Se detectó un antecedente con similitud del ${maxSimilitud}% (${antecedentes[0].denominacion}). El riesgo de rechazo por confundibilidad es alto. Se recomienda modificar la denominación.`;
    }

    // 5. Generar PDF del estudio
    const pdfPath = await generarPDFFactibilidad({
      denominacion,
      claseNiza,
      tipoMarca: tipoMarca || 'DENOMINATIVA',
      productos: productos || '',
      antecedentes,
      dictamen,
      riesgo,
      resumenDictamen,
      fecha: new Date(),
      userId: req.user!.id,
    });

    // 6. Guardar en BD
    const estudio = await prisma.estudioFactibilidad.create({
      data: {
        userId: req.user!.id,
        denominacion,
        claseNiza,
        tipoMarca: tipoMarca || 'DENOMINATIVA',
        productos,
        antecedentes: JSON.stringify(antecedentes),
        dictamen,
        riesgo,
        resumenDictamen,
        pdfUrl: pdfPath,
        totalAntecedentes: antecedentes.length,
        antecedentesConfundibles: antecedentes.filter(a => a.confundible).length,
      },
    });

    res.json({
      estudio,
      antecedentes,
      dictamen,
      riesgo,
      resumenDictamen,
      pdfUrl: `/api/factibilidad/${estudio.id}/pdf`,
    });
  } catch (err) { next(err); }
});

// ── GET /api/factibilidad/:id — Detalle de un estudio ────────────────────────
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const estudio = await prisma.estudioFactibilidad.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!estudio) throw new AppError(404, 'Estudio no encontrado', 'ESTUDIO_NOT_FOUND');

    res.json({
      ...estudio,
      antecedentes: estudio.antecedentes ? JSON.parse(estudio.antecedentes as string) : [],
    });
  } catch (err) { next(err); }
});

// ── GET /api/factibilidad/:id/pdf — Descargar PDF ─────────────────────────────
router.get('/:id/pdf', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const estudio = await prisma.estudioFactibilidad.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!estudio) throw new AppError(404, 'Estudio no encontrado', 'ESTUDIO_NOT_FOUND');
    if (!estudio.pdfUrl || !fs.existsSync(estudio.pdfUrl)) {
      throw new AppError(404, 'PDF no disponible', 'PDF_NOT_FOUND');
    }

    res.setHeader('Content-Disposition', `attachment; filename="factibilidad-${estudio.denominacion.replace(/\s/g, '_')}.pdf"`);
    res.setHeader('Content-Type', 'application/pdf');
    res.sendFile(estudio.pdfUrl);
  } catch (err) { next(err); }
});

// ── Helper: clases NIZA relacionadas ─────────────────────────────────────────
function getClasesRelacionadas(clase: number): number[] {
  const mapa: Record<number, number[]> = {
    3: [44], 5: [44, 42], 9: [42, 38], 14: [35],
    16: [35, 41], 25: [35, 18, 26], 30: [43],
    32: [43], 33: [43], 35: [36, 41, 42, 45],
    36: [35], 41: [35], 42: [35, 9], 43: [30, 32, 33],
    44: [3, 5],
  };
  return mapa[clase] || [];
}

// ── Helper: generar PDF del estudio de factibilidad ──────────────────────────
async function generarPDFFactibilidad(params: {
  denominacion: string;
  claseNiza: number;
  tipoMarca: string;
  productos: string;
  antecedentes: any[];
  dictamen: string;
  riesgo: string;
  resumenDictamen: string;
  fecha: Date;
  userId: string;
}): Promise<string> {
  if (!fs.existsSync(FACTIBILIDAD_DIR)) {
    fs.mkdirSync(FACTIBILIDAD_DIR, { recursive: true });
  }

  const pdfDoc = await PDFDocument.create();
  const fontR = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const W = 595.28, H = 841.89, M = 50;
  const CW = W - 2 * M;

  // Colores por dictamen
  const dictamenColor = {
    'VIABLE': rgb(0.1, 0.6, 0.1),
    'CONDICIONADA': rgb(0.9, 0.6, 0.0),
    'NO_VIABLE': rgb(0.8, 0.1, 0.1),
  }[params.dictamen] || rgb(0.5, 0.5, 0.5);

  let page = pdfDoc.addPage([W, H]);
  let y = H - M;

  const escribir = (texto: string, bold = false, size = 10, color = rgb(0.1, 0.1, 0.1), indent = 0) => {
    if (y < M + 30) {
      page = pdfDoc.addPage([W, H]);
      y = H - M;
    }
    const font = bold ? fontB : fontR;
    const palabras = texto.split(' ');
    let linea = '';
    for (const p of palabras) {
      const prueba = linea ? `${linea} ${p}` : p;
      if (font.widthOfTextAtSize(prueba, size) > CW - indent) {
        page.drawText(linea, { x: M + indent, y, size, font, color });
        y -= size + 4;
        linea = p;
        if (y < M + 30) { page = pdfDoc.addPage([W, H]); y = H - M; }
      } else linea = prueba;
    }
    if (linea) { page.drawText(linea, { x: M + indent, y, size, font, color }); y -= size + 4; }
  };

  const separador = () => {
    page.drawLine({ start: { x: M, y: y + 2 }, end: { x: W - M, y: y + 2 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
    y -= 8;
  };

  // ENCABEZADO
  page.drawRectangle({ x: 0, y: H - 80, width: W, height: 80, color: rgb(0.15, 0.35, 0.65) });
  page.drawText('MARCAS FÁCIL', { x: M, y: H - 35, size: 18, font: fontB, color: rgb(1, 1, 1) });
  page.drawText('ESTUDIO DE FACTIBILIDAD MARCARIA', { x: M, y: H - 55, size: 11, font: fontR, color: rgb(0.8, 0.9, 1) });
  page.drawText(`Agente PI Mat. N° 1974 — Honorio M. Leguizamón Pondal`, { x: M, y: H - 70, size: 8, font: fontR, color: rgb(0.6, 0.8, 1) });

  y = H - 95;

  // DATOS DEL ESTUDIO
  y -= 8;
  escribir('DATOS DEL ESTUDIO', true, 11, rgb(0.2, 0.2, 0.6));
  separador();
  escribir(`Denominación analizada: ${params.denominacion.toUpperCase()}`, true, 11);
  escribir(`Clase NIZA: ${params.claseNiza}    Tipo de marca: ${params.tipoMarca}`, false, 10);
  if (params.productos) escribir(`Productos/servicios: ${params.productos}`, false, 9, rgb(0.3, 0.3, 0.3));
  escribir(`Fecha del estudio: ${params.fecha.toLocaleDateString('es-AR')}`, false, 9, rgb(0.4, 0.4, 0.4));
  y -= 6;

  // DICTAMEN DESTACADO
  const boxH = 50;
  page.drawRectangle({ x: M, y: y - boxH, width: CW, height: boxH, color: rgb(0.95, 0.95, 0.95), borderColor: dictamenColor, borderWidth: 2 });
  page.drawText(`DICTAMEN: ${params.dictamen.replace('_', ' ')}`, { x: M + 10, y: y - 20, size: 14, font: fontB, color: dictamenColor });
  page.drawText(`Nivel de riesgo: ${params.riesgo}`, { x: M + 10, y: y - 38, size: 10, font: fontR, color: rgb(0.3, 0.3, 0.3) });
  y -= boxH + 12;

  // RESUMEN
  escribir('RESUMEN DEL DICTAMEN', true, 11, rgb(0.2, 0.2, 0.6));
  separador();
  escribir(params.resumenDictamen, false, 10);
  y -= 8;

  // ANTECEDENTES
  escribir('ANTECEDENTES ENCONTRADOS', true, 11, rgb(0.2, 0.2, 0.6));
  separador();

  if (params.antecedentes.length === 0) {
    escribir('No se encontraron antecedentes en la base de datos del sistema.', false, 10, rgb(0.4, 0.4, 0.4));
  } else {
    for (const ant of params.antecedentes.slice(0, 20)) { // máx 20 en PDF
      const confLabel = ant.confundible ? '⚠ CONFUNDIBLE' : '◌ Similar';
      const confColor = ant.confundible ? rgb(0.8, 0.1, 0.1) : rgb(0.5, 0.5, 0.5);
      escribir(`${ant.denominacion.toUpperCase()} — Clase ${ant.clase}  |  Similitud: ${ant.similitud}%  |  ${confLabel}`, ant.confundible, 9, confColor, 10);
      escribir(`Acta: ${ant.acta}  |  Titular: ${ant.titular}  |  Fuente: ${ant.fuente}`, false, 8, rgb(0.5, 0.5, 0.5), 10);
      if (ant.razon) escribir(`   → ${ant.razon}`, false, 8, rgb(0.6, 0.2, 0.2), 10);
      y -= 3;
    }
    if (params.antecedentes.length > 20) {
      escribir(`... y ${params.antecedentes.length - 20} antecedentes más con similitud inferior.`, false, 8, rgb(0.5, 0.5, 0.5));
    }
  }

  y -= 8;

  // NOTA LEGAL
  escribir('NOTA LEGAL', true, 9, rgb(0.4, 0.4, 0.4));
  separador();
  escribir('Este estudio de factibilidad tiene carácter informativo y no constituye asesoramiento jurídico vinculante. La factibilidad final del registro marcario depende de la evaluación del INPI y de las oposiciones que pudieren formularse durante el período de publicación en el Boletín de Marcas. Se recomienda confirmar con el portal del INPI (www.inpi.gob.ar) la vigencia de los antecedentes detectados.', false, 8, rgb(0.5, 0.5, 0.5));

  const pdfBytes = await pdfDoc.save();
  const filename = `factibilidad-${params.denominacion.replace(/[^a-zA-Z0-9]/g, '_')}-clase${params.claseNiza}-${Date.now()}.pdf`;
  const filePath = path.join(FACTIBILIDAD_DIR, filename);
  fs.writeFileSync(filePath, pdfBytes);

  return filePath;
}

export default router;
