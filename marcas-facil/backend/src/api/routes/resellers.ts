/**
 * Rutas de Resellers / Red de referidos — MARCAS FÁCIL
 * Gestión de códigos de referido y comisiones
 */

import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/client';
import { AppError } from '../../middleware/errorHandler';
import { authenticate, AuthRequest } from '../../middleware/auth';

const router = Router();
router.use(authenticate);

// ── GET /api/resellers/mi-codigo — Obtener código de referido propio ──────────
router.get('/mi-codigo', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { referralCode: true, razonSocial: true },
    });

    const referidos = await prisma.user.count({
      where: { referredByCode: user?.referralCode },
    });

    res.json({
      codigo: user?.referralCode,
      linkReferido: `${process.env.FRONTEND_URL}/registro?ref=${user?.referralCode}`,
      cantidadReferidos: referidos,
    });
  } catch (err) { next(err); }
});

// ── GET /api/resellers/mis-referidos — Ver referidos captados ─────────────────
router.get('/mis-referidos', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { referralCode: true },
    });

    const referidos = await prisma.user.findMany({
      where: { referredByCode: user?.referralCode },
      select: {
        id: true, razonSocial: true, plan: true, createdAt: true,
        pagos: {
          where: { estado: 'APROBADO' },
          select: { monto: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    type Referido = typeof referidos[0];
    type Pago = { monto: number; createdAt: Date };

    const stats = referidos.reduce((acc: { totalReferidos: number; totalFacturado: number; comisionEstimada: number }, r: Referido) => {
      const totalPagado = r.pagos.reduce((s: number, p: Pago) => s + p.monto, 0);
      return {
        totalReferidos: acc.totalReferidos + 1,
        totalFacturado: acc.totalFacturado + totalPagado,
        comisionEstimada: acc.comisionEstimada + totalPagado * 0.1,
      };
    }, { totalReferidos: 0, totalFacturado: 0, comisionEstimada: 0 });

    res.json({
      stats,
      referidos: referidos.map((r: Referido) => ({
        id: r.id,
        razonSocial: r.razonSocial,
        plan: r.plan,
        fechaRegistro: r.createdAt,
        totalPagado: r.pagos.reduce((s: number, p: Pago) => s + p.monto, 0),
      })),
    });
  } catch (err) { next(err); }
});

// ── GET /api/resellers — Listar resellers (solo admin) ───────────────────────
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Solo el agente principal puede ver todos los resellers
    const adminCuit = process.env.DEFAULT_AGENT_CUIT;
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { cuit: true },
    });

    if (user?.cuit !== adminCuit) {
      throw new AppError(403, 'Acceso no autorizado', 'FORBIDDEN');
    }

    const resellers = await prisma.reseller.findMany({
      orderBy: { createdAt: 'desc' },
    });

    res.json(resellers);
  } catch (err) { next(err); }
});

// ── POST /api/resellers — Registrar nuevo reseller (solo admin) ───────────────
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adminCuit = process.env.DEFAULT_AGENT_CUIT;
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { cuit: true },
    });

    if (user?.cuit !== adminCuit) {
      throw new AppError(403, 'Acceso no autorizado', 'FORBIDDEN');
    }

    const schema = z.object({
      cuit: z.string().regex(/^\d{11}$/),
      nombre: z.string().min(2),
      email: z.string().email(),
      referralCode: z.string().min(4).max(12),
      comisionPct: z.number().min(0).max(50).optional(),
      notas: z.string().optional(),
    });

    const data = schema.parse(req.body);

    const existe = await prisma.reseller.findUnique({
      where: { referralCode: data.referralCode },
    });
    if (existe) throw new AppError(409, 'El código de referido ya existe', 'CODE_EXISTS');

    const reseller = await prisma.reseller.create({
      data: {
        cuit: data.cuit,
        nombre: data.nombre,
        email: data.email,
        referralCode: data.referralCode,
        comisionPct: data.comisionPct ?? 10,
        notas: data.notas,
        activo: true,
      },
    });

    res.status(201).json(reseller);
  } catch (err) { next(err); }
});

// ── PUT /api/resellers/:id — Actualizar reseller ──────────────────────────────
router.put('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adminCuit = process.env.DEFAULT_AGENT_CUIT;
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { cuit: true },
    });
    if (user?.cuit !== adminCuit) throw new AppError(403, 'Acceso no autorizado', 'FORBIDDEN');

    const { activo, comisionPct, notas } = z.object({
      activo: z.boolean().optional(),
      comisionPct: z.number().min(0).max(50).optional(),
      notas: z.string().optional(),
    }).parse(req.body);

    const reseller = await prisma.reseller.update({
      where: { id: req.params.id },
      data: { activo, comisionPct, notas },
    });

    res.json(reseller);
  } catch (err) { next(err); }
});

export default router;
