/**
 * Rutas de Dominios NIC.AR — MARCAS FÁCIL
 * Gestión de dominios de internet registrados en NIC Argentina
 */

import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/client';
import { AppError } from '../../middleware/errorHandler';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { addCalendarDays } from '../../utils/helpers';

const router = Router();
router.use(authenticate);

// ── GET /api/dominios — Listar dominios del usuario ──────────────────────────
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { estado } = req.query;
    const where: any = { userId: req.user!.id };
    if (estado) where.estado = estado;

    const dominios = await prisma.dominio.findMany({
      where,
      orderBy: { fechaVencimiento: 'asc' },
    });

    const hoy = new Date();
    const data = dominios.map((d: typeof dominios[0]) => {
      const diasRestantes = d.fechaVencimiento
        ? Math.ceil((d.fechaVencimiento.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24))
        : null;
      return { ...d, diasRestantes, urgente: diasRestantes !== null && diasRestantes <= 30 };
    });

    res.json(data);
  } catch (err) { next(err); }
});

// ── GET /api/dominios/:id — Detalle de un dominio ────────────────────────────
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const dominio = await prisma.dominio.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!dominio) throw new AppError(404, 'Dominio no encontrado', 'DOMINIO_NOT_FOUND');
    res.json(dominio);
  } catch (err) { next(err); }
});

// ── POST /api/dominios — Registrar dominio para vigilancia ───────────────────
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      nombre: z.string().min(3).refine(
        v => v.endsWith('.ar') || v.endsWith('.com.ar') || v.endsWith('.org.ar') || v.endsWith('.net.ar'),
        'Solo se soportan dominios .ar'
      ),
      fechaRegistro: z.string().datetime().optional(),
      fechaVencimiento: z.string().datetime().optional(),
      registrante: z.string().optional(),
      notas: z.string().optional(),
    });

    const data = schema.parse(req.body);

    // Verificar que el dominio no ya esté registrado para este usuario
    const existe = await prisma.dominio.findFirst({
      where: { userId: req.user!.id, nombre: data.nombre.toLowerCase() },
    });
    if (existe) throw new AppError(409, 'Ya tenés ese dominio registrado', 'DOMINIO_EXISTE');

    const dominio = await prisma.dominio.create({
      data: {
        userId: req.user!.id,
        nombre: data.nombre.toLowerCase(),
        fechaRegistro: data.fechaRegistro ? new Date(data.fechaRegistro) : undefined,
        fechaVencimiento: data.fechaVencimiento ? new Date(data.fechaVencimiento) : undefined,
        registrante: data.registrante,
        notas: data.notas,
        estado: 'ACTIVO',
      },
    });

    // Crear alertas de renovación si hay fecha de vencimiento
    if (dominio.fechaVencimiento) {
      const venc = dominio.fechaVencimiento;
      await prisma.alerta.createMany({
        data: [
          {
            userId: req.user!.id,
            dominioId: dominio.id,
            tipo: 'DOMINIO_VENCIMIENTO',
            titulo: `Renovación dominio ${dominio.nombre} — 30 días`,
            descripcion: `El dominio ${dominio.nombre} vence el ${venc.toLocaleDateString('es-AR')}`,
            fechaVencimiento: venc,
            fechaAlerta: addCalendarDays(venc, -30),
          },
          {
            userId: req.user!.id,
            dominioId: dominio.id,
            tipo: 'DOMINIO_VENCIMIENTO',
            titulo: `Renovación dominio ${dominio.nombre} — 7 días`,
            descripcion: `URGENTE: El dominio ${dominio.nombre} vence en 7 días`,
            fechaVencimiento: venc,
            fechaAlerta: addCalendarDays(venc, -7),
          },
        ],
      });
    }

    res.status(201).json(dominio);
  } catch (err) { next(err); }
});

// ── PUT /api/dominios/:id — Actualizar dominio ────────────────────────────────
router.put('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.dominio.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!existing) throw new AppError(404, 'Dominio no encontrado', 'DOMINIO_NOT_FOUND');

    const schema = z.object({
      fechaVencimiento: z.string().datetime().optional(),
      estado: z.enum(['ACTIVO', 'VENCIDO', 'EN_DISPUTA', 'CEDIDO']).optional(),
      notas: z.string().optional(),
    });

    const data = schema.parse(req.body);

    const dominio = await prisma.dominio.update({
      where: { id: req.params.id },
      data: {
        ...data,
        fechaVencimiento: data.fechaVencimiento ? new Date(data.fechaVencimiento) : undefined,
      },
    });

    res.json(dominio);
  } catch (err) { next(err); }
});

// ── DELETE /api/dominios/:id — Eliminar dominio de vigilancia ────────────────
router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const dominio = await prisma.dominio.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!dominio) throw new AppError(404, 'Dominio no encontrado', 'DOMINIO_NOT_FOUND');

    await prisma.dominio.delete({ where: { id: dominio.id } });
    res.json({ mensaje: 'Dominio eliminado de vigilancia' });
  } catch (err) { next(err); }
});

export default router;
