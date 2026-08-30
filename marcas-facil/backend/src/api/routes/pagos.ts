/**
 * Rutas de Pagos — MARCAS FÁCIL
 * Integración con MercadoPago para suscripciones y pagos únicos
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';
import { prisma } from '../../db/client';
import { AppError } from '../../middleware/errorHandler';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { logger } from '../../utils/logger';

const router = Router();

const mp = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN!,
});

// Precios de planes (en ARS)
const PLANES_PRECIOS: Record<string, number> = {
  BASICO: 4999,
  PROFESIONAL: 9999,
  EMPRESARIAL: 24999,
};

const PLAN_LABELS: Record<string, string> = {
  BASICO: 'Plan Básico — Vigilancia 1 marca',
  PROFESIONAL: 'Plan Profesional — Vigilancia hasta 5 marcas',
  EMPRESARIAL: 'Plan Empresarial — Vigilancia ilimitada',
};

// ── GET /api/pagos — Historial de pagos ──────────────────────────────────────
router.get('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const pagos = await prisma.pago.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json(pagos);
  } catch (err) { next(err); }
});

// ── GET /api/pagos/planes — Información de planes ────────────────────────────
router.get('/planes', (_req: Request, res: Response) => {
  res.json({
    planes: [
      {
        id: 'BASICO',
        nombre: 'Básico',
        precio: PLANES_PRECIOS.BASICO,
        descripcion: 'Vigilancia de 1 marca — Alertas automáticas — Generación de documentos básicos',
        caracteristicas: [
          '1 marca en vigilancia activa',
          'Alertas de oposición automáticas',
          'Generación de PDF de oposición',
          'DDJJ de uso de medio término',
          'Calendario de vencimientos',
        ],
      },
      {
        id: 'PROFESIONAL',
        nombre: 'Profesional',
        precio: PLANES_PRECIOS.PROFESIONAL,
        descripcion: 'Ideal para PyMEs con portfolio de marcas',
        caracteristicas: [
          'Hasta 5 marcas en vigilancia activa',
          'Todo lo del plan Básico',
          'Gestión de dominios .ar',
          'Estudio de factibilidad completo',
          'Soporte prioritario',
        ],
        recomendado: true,
      },
      {
        id: 'EMPRESARIAL',
        nombre: 'Empresarial',
        precio: PLANES_PRECIOS.EMPRESARIAL,
        descripcion: 'Para empresas con múltiples marcas',
        caracteristicas: [
          'Marcas ilimitadas en vigilancia',
          'Todo lo del plan Profesional',
          'Gestión de múltiples titulares',
          'Reportes avanzados',
          'API access',
        ],
      },
    ],
  });
});

// ── POST /api/pagos/suscripcion — Crear preferencia de pago mensual ───────────
router.post('/suscripcion', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { plan } = z.object({
      plan: z.enum(['BASICO', 'PROFESIONAL', 'EMPRESARIAL']),
    }).parse(req.body);

    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { email: true, razonSocial: true, cuit: true },
    });

    const precio = PLANES_PRECIOS[plan];
    const label = PLAN_LABELS[plan];

    const preference = new Preference(mp);
    const result = await preference.create({
      body: {
        items: [{
          id: `plan-${plan.toLowerCase()}`,
          title: `MARCAS FÁCIL — ${label}`,
          quantity: 1,
          unit_price: precio,
          currency_id: 'ARS',
        }],
        payer: {
          email: user?.email,
          name: user?.razonSocial,
        },
        back_urls: {
          success: `${process.env.FRONTEND_URL}/pagos/exito`,
          failure: `${process.env.FRONTEND_URL}/pagos/error`,
          pending: `${process.env.FRONTEND_URL}/pagos/pendiente`,
        },
        auto_return: 'approved',
        notification_url: `${process.env.API_URL}/api/pagos/webhook`,
        external_reference: `${req.user!.id}|${plan}|suscripcion`,
        statement_descriptor: 'MARCAS FACIL',
        metadata: {
          userId: req.user!.id,
          plan,
          tipo: 'suscripcion',
        },
      },
    });

    // Registrar intención de pago
    await prisma.pago.create({
      data: {
        userId: req.user!.id,
        tipo: 'SUSCRIPCION',
        monto: precio,
        moneda: 'ARS',
        estado: 'PENDIENTE',
        mpPreferenceId: result.id,
        concepto: label,
        planContratado: plan,
      },
    });

    res.json({
      preferenceId: result.id,
      initPoint: result.init_point,       // Redirect URL producción
      sandboxInitPoint: result.sandbox_init_point, // Redirect URL sandbox
    });
  } catch (err) { next(err); }
});

// ── POST /api/pagos/webhook — Webhook de MercadoPago ─────────────────────────
// Esta ruta NO requiere autenticación JWT (es llamada por MP)
router.post('/webhook', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { type, data } = req.body;

    logger.info(`📨 Webhook MP: ${type} — ID: ${data?.id}`);

    if (type !== 'payment') {
      return res.status(200).json({ ok: true });
    }

    const payment = new Payment(mp);
    const paymentData = await payment.get({ id: data.id });

    const { status, external_reference, transaction_amount } = paymentData;
    if (!external_reference) return res.status(200).json({ ok: true });

    const [userId, plan, tipo] = external_reference.split('|');

    // Buscar y actualizar el pago pendiente
    const pagoExistente = await prisma.pago.findFirst({
      where: { userId, mpPreferenceId: { not: null }, estado: 'PENDIENTE' },
    });

    const estadoPago = status === 'approved' ? 'APROBADO' : status === 'rejected' ? 'RECHAZADO' : 'PENDIENTE';

    if (pagoExistente) {
      await prisma.pago.update({
        where: { id: pagoExistente.id },
        data: {
          estado: estadoPago,
          mpPaymentId: String(paymentData.id),
          monto: transaction_amount || pagoExistente.monto,
          estadoMP: status,
        },
      });
    } else {
      await prisma.pago.create({
        data: {
          userId,
          tipo: tipo === 'suscripcion' ? 'SUSCRIPCION' : 'PAGO_UNICO',
          monto: transaction_amount || 0,
          moneda: 'ARS',
          estado: estadoPago,
          mpPaymentId: String(paymentData.id),
          concepto: `Plan ${plan}`,
          planContratado: plan,
          estadoMP: status,
        },
      });
    }

    // Si el pago fue aprobado, actualizar el plan del usuario
    if (status === 'approved' && userId && plan) {
      const ahora = new Date();
      const vencimiento = new Date(ahora);
      vencimiento.setMonth(vencimiento.getMonth() + 1);

      await prisma.user.update({
        where: { id: userId },
        data: {
          plan: plan as any,
          planVencimiento: vencimiento,
        },
      });

      logger.info(`✅ Plan ${plan} activado para usuario ${userId} hasta ${vencimiento.toLocaleDateString('es-AR')}`);
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    logger.error(`Error en webhook MP: ${err}`);
    res.status(200).json({ ok: true }); // Siempre 200 para MP
  }
});

// ── GET /api/pagos/estado — Estado actual del plan ────────────────────────────
router.get('/estado', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { plan: true, planVencimiento: true },
    });

    const activo = user?.planVencimiento
      ? user.planVencimiento > new Date()
      : user?.plan === 'GRATUITO';

    res.json({
      plan: user?.plan,
      vencimiento: user?.planVencimiento,
      activo,
      diasRestantes: user?.planVencimiento
        ? Math.ceil((user.planVencimiento.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : null,
    });
  } catch (err) { next(err); }
});

export default router;
