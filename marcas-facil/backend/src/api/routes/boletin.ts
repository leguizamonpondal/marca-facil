/**
 * Rutas del Boletín de Marcas — MARCAS FÁCIL
 * Boletín publicado todos los MIÉRCOLES por el INPI
 */

import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/client';
import { AppError } from '../../middleware/errorHandler';
import { authenticate, requirePlan, AuthRequest } from '../../middleware/auth';
import { boletinService } from '../../services/boletinService';
import { logger } from '../../utils/logger';

const router = Router();
router.use(authenticate);

// ── GET /api/boletin — Listar boletines descargados ──────────────────────────
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { page = '1', limit = '20' } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [boletines, total] = await Promise.all([
      prisma.boletinDescarga.findMany({
        skip, take: Number(limit),
        orderBy: { fechaBoletin: 'desc' },
      }),
      prisma.boletinDescarga.count(),
    ]);

    res.json({ data: boletines, meta: { total, page: Number(page), limit: Number(limit) } });
  } catch (err) { next(err); }
});

// ── POST /api/boletin/descargar — Descargar y procesar último boletín ────────
// Requiere plan BASICO o superior
router.post('/descargar', requirePlan('BASICO', 'PROFESIONAL', 'EMPRESARIAL'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { fecha } = z.object({
        fecha: z.string().datetime().optional(),
      }).parse(req.body);

      const fechaObj = fecha ? new Date(fecha) : undefined;

      logger.info(`📥 Descarga de boletín solicitada por usuario ${req.user!.id}`);
      const resultado = await boletinService.descargarBoletin(fechaObj);

      res.json({
        mensaje: 'Boletín procesado exitosamente',
        resultado,
      });
    } catch (err) { next(err); }
  });

// ── POST /api/boletin/vigilancia — Ejecutar vigilancia manual ────────────────
router.post('/vigilancia', requirePlan('BASICO', 'PROFESIONAL', 'EMPRESARIAL'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { fecha } = z.object({
        fecha: z.string().datetime().optional(),
      }).parse(req.body);

      const resultado = await boletinService.procesarVigilancia(fecha ? new Date(fecha) : undefined);

      res.json({
        mensaje: 'Vigilancia ejecutada',
        resultado,
      });
    } catch (err) { next(err); }
  });

// ── GET /api/boletin/entradas — Buscar en el boletín ─────────────────────────
router.get('/entradas', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { q, clase, titular, desde, hasta, page = '1', limit = '50' } = req.query;

    const where: any = {};
    if (q) {
      where.denominacion = { contains: String(q), mode: 'insensitive' };
    }
    if (clase) where.claseNiza = Number(clase);
    if (titular) {
      where.titularNombre = { contains: String(titular), mode: 'insensitive' };
    }
    if (desde || hasta) {
      where.fechaPublicacion = {};
      if (desde) where.fechaPublicacion.gte = new Date(String(desde));
      if (hasta) where.fechaPublicacion.lte = new Date(String(hasta));
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [entradas, total] = await Promise.all([
      prisma.boletinEntrada.findMany({
        where, skip, take: Number(limit),
        orderBy: { fechaBoletin: 'desc' },
      }),
      prisma.boletinEntrada.count({ where }),
    ]);

    res.json({
      data: entradas,
      meta: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
    });
  } catch (err) { next(err); }
});

// ── GET /api/boletin/entradas/:acta — Detalle de una entrada ─────────────────
router.get('/entradas/:acta', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const entrada = await prisma.boletinEntrada.findUnique({
      where: { acta: req.params.acta },
    });
    if (!entrada) throw new AppError(404, 'Entrada de boletín no encontrada', 'ENTRADA_NOT_FOUND');
    res.json(entrada);
  } catch (err) { next(err); }
});

// ── POST /api/boletin/carga-manual — Carga manual de entradas ────────────────
// Para cuando el PDF del INPI no se puede parsear automáticamente
router.post('/carga-manual',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const schema = z.object({
        datos: z.array(z.object({
          acta: z.string(),
          denominacion: z.string(),
          tipoMarca: z.string().optional(),
          claseNiza: z.number().int().min(1).max(45),
          productos: z.string().optional(),
          titularNombre: z.string().optional(),
          titularCuit: z.string().optional(),
          fechaPublicacion: z.string().datetime(),
        })).min(1),
      });

      const { datos } = schema.parse(req.body);

      // Mapear fechaPublicacion → boletinFecha para el servicio (nombre en schema)
      const datosConFecha = datos.map(d => ({
        acta: d.acta,
        denominacion: d.denominacion,
        tipoMarca: d.tipoMarca || 'DENOMINATIVA',
        claseNiza: d.claseNiza,
        titularNombre: d.titularNombre || 'No informado',
        titularCuit: d.titularCuit,
        productos: d.productos,
        boletinFecha: new Date(d.fechaPublicacion),
      }));

      const resultado = await boletinService.cargarManual(datosConFecha);

      res.json({
        mensaje: `Entradas cargadas correctamente`,
        resultado,
      });
    } catch (err) { next(err); }
  });

// ── GET /api/boletin/stats — Estadísticas del boletín ────────────────────────
router.get('/stats', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const totalEntradas = await prisma.boletinEntrada.count();
    const ultimaDescarga = await prisma.boletinDescarga.findFirst({
      orderBy: { fechaBoletin: 'desc' },
    });

    const entradasPorClase = await prisma.boletinEntrada.groupBy({
      by: ['claseNiza'],
      _count: true,
      orderBy: { _count: { claseNiza: 'desc' } },
      take: 10,
    });

    res.json({
      totalEntradas,
      ultimaBoletin: ultimaDescarga?.fechaBoletin,
      ultimaDescarga: ultimaDescarga?.descargadoEn,
      entradasPorClase,
    });
  } catch (err) { next(err); }
});

export default router;
