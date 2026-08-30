/**
 * Rutas de Alertas — MARCAS FÁCIL
 * Gestión del calendario de vencimientos marcarios
 */

import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/client';
import { AppError } from '../../middleware/errorHandler';
import { authenticate, AuthRequest } from '../../middleware/auth';

const router = Router();
router.use(authenticate);

// ── GET /api/alertas — Listar alertas del usuario ─────────────────────────────
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { leida, tipo, urgentes, page = '1', limit = '30' } = req.query;
    const where: any = { userId: req.user!.id };

    if (leida !== undefined) where.leida = leida === 'true';
    if (tipo) where.tipo = tipo;

    // Alertas urgentes: vencen en los próximos 7 días
    if (urgentes === 'true') {
      const ahora = new Date();
      const en7dias = new Date(ahora.getTime() + 7 * 24 * 60 * 60 * 1000);
      where.fechaVencimiento = { gte: ahora, lte: en7dias };
      where.leida = false;
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [alertas, total, noLeidas] = await Promise.all([
      prisma.alerta.findMany({
        where, skip, take: Number(limit),
        orderBy: [{ fechaVencimiento: 'asc' }, { createdAt: 'desc' }],
        include: {
          marca: { select: { denominacion: true, claseNiza: true } },
        },
      }),
      prisma.alerta.count({ where }),
      prisma.alerta.count({ where: { userId: req.user!.id, leida: false } }),
    ]);

    // Enriquecer con días restantes
    const hoy = new Date();
    const data = alertas.map((alerta: typeof alertas[0]) => {
      const diasRestantes = alerta.fechaVencimiento
        ? Math.ceil((alerta.fechaVencimiento.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24))
        : null;
      return {
        ...alerta,
        diasRestantes,
        critica: diasRestantes !== null && diasRestantes <= 3,
        urgente: diasRestantes !== null && diasRestantes <= 7,
      };
    });

    res.json({
      data,
      meta: { total, noLeidas, page: Number(page), limit: Number(limit) },
    });
  } catch (err) { next(err); }
});

// ── GET /api/alertas/calendario — Vista calendario de vencimientos ────────────
router.get('/calendario', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { mes, anio } = req.query;
    const hoy = new Date();
    const year = anio ? Number(anio) : hoy.getFullYear();
    const month = mes ? Number(mes) - 1 : hoy.getMonth();

    const inicio = new Date(year, month, 1);
    const fin = new Date(year, month + 1, 0);

    const alertas = await prisma.alerta.findMany({
      where: {
        userId: req.user!.id,
        fechaVencimiento: { gte: inicio, lte: fin },
      },
      include: {
        marca: { select: { denominacion: true, claseNiza: true } },
      },
      orderBy: { fechaVencimiento: 'asc' },
    });

    // Agrupar por día
    const calendario: Record<string, typeof alertas> = {};
    for (const alerta of alertas) {
      if (alerta.fechaVencimiento) {
        const dia = alerta.fechaVencimiento.toISOString().split('T')[0];
        if (!calendario[dia]) calendario[dia] = [];
        calendario[dia].push(alerta);
      }
    }

    res.json({ año: year, mes: month + 1, dias: calendario });
  } catch (err) { next(err); }
});

// ── GET /api/alertas/proximas — Próximas 10 alertas no leídas ────────────────
router.get('/proximas', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const alertas = await prisma.alerta.findMany({
      where: {
        userId: req.user!.id,
        leida: false,
        fechaVencimiento: { gte: new Date() },
      },
      take: 10,
      orderBy: { fechaVencimiento: 'asc' },
      include: {
        marca: { select: { denominacion: true, claseNiza: true } },
      },
    });

    const hoy = new Date();
    res.json(alertas.map((a: typeof alertas[0]) => ({
      ...a,
      diasRestantes: a.fechaVencimiento
        ? Math.ceil((a.fechaVencimiento.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24))
        : null,
    })));
  } catch (err) { next(err); }
});

// ── PATCH /api/alertas/:id/leer — Marcar alerta como leída ───────────────────
router.patch('/:id/leer', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const alerta = await prisma.alerta.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!alerta) throw new AppError(404, 'Alerta no encontrada', 'ALERTA_NOT_FOUND');

    await prisma.alerta.update({
      where: { id: alerta.id },
      data: { leida: true, leidaEn: new Date() },
    });

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── POST /api/alertas/leer-todas — Marcar todas como leídas ──────────────────
router.post('/leer-todas', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { count } = await prisma.alerta.updateMany({
      where: { userId: req.user!.id, leida: false },
      data: { leida: true, leidaEn: new Date() },
    });
    res.json({ mensaje: `${count} alertas marcadas como leídas` });
  } catch (err) { next(err); }
});

// ── POST /api/alertas — Crear alerta manual ───────────────────────────────────
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      marcaId: z.string().uuid().optional(),
      tipo: z.enum([
        'OPOSICION_DETECTADA', 'OPOSICION_PLAZO', 'OPOSICION_MANTENIMIENTO',
        'OPOSICION_TRASLADO', 'DDJJ_VENCIMIENTO', 'RENOVACION_VENCIMIENTO',
        'DOMINIO_VENCIMIENTO', 'VISTA_OFICIAL', 'CUSTOM'
      ]),
      titulo: z.string().min(1),
      descripcion: z.string().optional(),
      fechaVencimiento: z.string().datetime(),
      fechaAlerta: z.string().datetime().optional(),
    });

    const data = schema.parse(req.body);

    const alerta = await prisma.alerta.create({
      data: {
        userId: req.user!.id,
        marcaId: data.marcaId,
        tipo: data.tipo,
        titulo: data.titulo,
        descripcion: data.descripcion,
        fechaVencimiento: new Date(data.fechaVencimiento),
        fechaAlerta: data.fechaAlerta ? new Date(data.fechaAlerta) : undefined,
      },
    });

    res.status(201).json(alerta);
  } catch (err) { next(err); }
});

// ── DELETE /api/alertas/:id — Eliminar alerta ─────────────────────────────────
router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const alerta = await prisma.alerta.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!alerta) throw new AppError(404, 'Alerta no encontrada', 'ALERTA_NOT_FOUND');

    await prisma.alerta.delete({ where: { id: alerta.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
