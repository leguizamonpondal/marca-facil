/**
 * Rutas de Documentos — MARCAS FÁCIL
 * Gestión de documentos generados (PDFs de oposiciones, DDJJ, etc.)
 */

import { Router, Response, NextFunction } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '../../db/client';
import { AppError } from '../../middleware/errorHandler';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { documentoService } from '../../services/documentoService';

const router = Router();
router.use(authenticate);

// ── GET /api/documentos — Listar documentos del usuario ──────────────────────
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { tipo, marcaId, page = '1', limit = '20' } = req.query;
    const where: any = { userId: req.user!.id };
    if (tipo) where.tipo = tipo;
    if (marcaId) where.marcaId = String(marcaId);

    const skip = (Number(page) - 1) * Number(limit);

    const [docs, total] = await Promise.all([
      prisma.documento.findMany({
        where, skip, take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          marca: { select: { denominacion: true, claseNiza: true } },
        },
      }),
      prisma.documento.count({ where }),
    ]);

    res.json({
      data: docs,
      meta: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
    });
  } catch (err) { next(err); }
});

// ── GET /api/documentos/:id/descargar — Descargar un documento ────────────────
router.get('/:id/descargar', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = await prisma.documento.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!doc) throw new AppError(404, 'Documento no encontrado', 'DOC_NOT_FOUND');

    if (!fs.existsSync(doc.url)) {
      throw new AppError(404, 'Archivo no encontrado en el servidor', 'FILE_NOT_FOUND');
    }

    const filename = path.basename(doc.url);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    res.sendFile(doc.url);
  } catch (err) { next(err); }
});

// ── POST /api/documentos/ddjj-medio-termino — Generar DDJJ de uso ─────────────
router.post('/ddjj-medio-termino', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { marcaId, usada = true } = req.body;

    if (!marcaId) throw new AppError(400, 'marcaId es requerido');

    const pdfPath = await documentoService.generarDDJJUsoMedioTermino(marcaId, req.user!.id, usada);

    // Registrar presentación
    await prisma.marca.update({
      where: { id: marcaId },
      data: { ddjjUsoPresentada: true },
    });

    res.json({
      mensaje: 'DDJJ de uso de medio término generada',
      pdfPath,
      instrucciones: [
        '1. Imprima el documento generado',
        '2. El TITULAR debe firmarlo de puño y letra',
        '3. Escanéelo como PDF no editable (300 DPI recomendado)',
        '4. Ingrese al portal INPI con Clave Fiscal nivel 2+',
        '5. Marcas → Trámites → Escritos',
        '6. Seleccione el número de acta y adjunte el PDF firmado',
        '7. Pague el arancel Código 181000',
        '8. Guarde el VEP y el comprobante de presentación',
      ],
    });
  } catch (err) { next(err); }
});

// ── POST /api/documentos/ddjj-renovacion — Generar DDJJ para renovación ──────
router.post('/ddjj-renovacion', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { marcaId, actaRenovacion } = req.body;
    if (!marcaId || !actaRenovacion) {
      throw new AppError(400, 'marcaId y actaRenovacion son requeridos');
    }

    const pdfPath = await documentoService.generarDDJJUsoRenovacion(marcaId, req.user!.id, actaRenovacion);
    res.json({ mensaje: 'DDJJ de renovación generada', pdfPath });
  } catch (err) { next(err); }
});

// ── DELETE /api/documentos/:id — Eliminar documento ──────────────────────────
router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = await prisma.documento.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!doc) throw new AppError(404, 'Documento no encontrado', 'DOC_NOT_FOUND');

    // Eliminar archivo físico
    if (fs.existsSync(doc.url)) {
      fs.unlinkSync(doc.url);
    }

    await prisma.documento.delete({ where: { id: doc.id } });
    res.json({ mensaje: 'Documento eliminado' });
  } catch (err) { next(err); }
});

export default router;
