/**
 * Rutas de Oposiciones — MARCAS FÁCIL
 *
 * Flujo según Resolución INPI 297/2026 (vigente para marcas desde 01/03/2026):
 * 1. Detección automática vía boletín → Oposición formulada (Art. 1: 30 días corridos)
 * 2. Mantenimiento: 15 días hábiles desde notificación INPI (Art. 1 Res. 297/2026)
 * 3. Traslado al solicitante: 15 días hábiles (Art. 2)
 * 4. Argumentos finales: 10 días hábiles (Art. 6)
 * 5. Resolución del INPI: FUNDADA / INFUNDADA
 *
 * Para marcas anteriores al 01/03/2026: procedimiento anterior (acuerdo directo).
 */

import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/client';
import { AppError } from '../../middleware/errorHandler';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { documentoService } from '../../services/documentoService';
import { addBusinessDays, addCalendarDays } from '../../utils/helpers';
import { logger } from '../../utils/logger';

const router = Router();
router.use(authenticate);

// ── GET /api/oposiciones — Listar oposiciones del usuario ─────────────────────
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { estado, page = '1', limit = '20' } = req.query;
    const where: any = { userId: req.user!.id };
    if (estado) where.estado = estado;

    const skip = (Number(page) - 1) * Number(limit);

    const [oposiciones, total] = await Promise.all([
      prisma.oposicion.findMany({
        where, skip, take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          marcaOponente: { select: { id: true, denominacion: true, claseNiza: true } },
        },
      }),
      prisma.oposicion.count({ where }),
    ]);

    // Calcular urgencia de plazos
    const hoy = new Date();
    const data = oposiciones.map((op: typeof oposiciones[0]) => {
      const proximoPlazo = calcularProximoPlazo(op, hoy);
      return { ...op, proximoPlazo };
    });

    res.json({
      data,
      meta: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
    });
  } catch (err) { next(err); }
});

// ── GET /api/oposiciones/:id — Detalle de una oposición ─────────────────────
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const op = await prisma.oposicion.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
      include: {
        marcaOponente: true,
        boletinEntrada: true,
        documentos: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!op) throw new AppError(404, 'Oposición no encontrada', 'OPOSICION_NOT_FOUND');

    const hoy = new Date();
    res.json({
      ...op,
      proximoPlazo: calcularProximoPlazo(op, hoy),
      esRes297: op.createdAt >= new Date('2026-03-01'), // Aplica Res. 297/2026
    });
  } catch (err) { next(err); }
});

// ── POST /api/oposiciones — Crear oposición manualmente ──────────────────────
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      marcaOponenteId: z.string().uuid(),
      actaOpuesta: z.string().min(1),
      denominacionOpuesta: z.string().min(1),
      claseOpuesta: z.number().int().min(1).max(45),
      oponenteNombre: z.string().optional(),
      oponenteCuit: z.string().optional(),
      fechaPublicacion: z.string().datetime(),
      fundamentosTexto: z.string().optional(),
    });

    const data = schema.parse(req.body);

    // Verificar que la marca base pertenece al usuario
    const marcaOponente = await prisma.marca.findFirst({
      where: { id: data.marcaOponenteId, userId: req.user!.id },
    });
    if (!marcaOponente) throw new AppError(404, 'Marca propia no encontrada', 'MARCA_NOT_FOUND');

    const fechaPublicacion = new Date(data.fechaPublicacion);
    // Plazo de oposición: 30 días corridos desde el día SIGUIENTE a la publicación
    const plazoOposicion = addCalendarDays(fechaPublicacion, 31);

    if (new Date() > plazoOposicion) {
      throw new AppError(400, `El plazo de 30 días para oponerse venció el ${plazoOposicion.toLocaleDateString('es-AR')}`, 'PLAZO_VENCIDO');
    }

    const op = await prisma.oposicion.create({
      data: {
        userId: req.user!.id,
        marcaOponenteId: data.marcaOponenteId,
        actaOpuesta: data.actaOpuesta,
        denominacionOpuesta: data.denominacionOpuesta,
        claseOpuesta: data.claseOpuesta,
        oponenteNombre: data.oponenteNombre,
        oponenteCuit: data.oponenteCuit,
        fechaPublicacion,
        plazoOposicion,
        fundamentosTexto: data.fundamentosTexto,
        estado: 'FORMULADA',
      },
    });

    // Crear alerta de mantenimiento
    await prisma.alerta.create({
      data: {
        userId: req.user!.id,
        marcaId: data.marcaOponenteId,
        oposicionId: op.id,
        tipo: 'OPOSICION_PLAZO',
        titulo: `Oposición acta ${data.actaOpuesta} — Presentar antes del ${plazoOposicion.toLocaleDateString('es-AR')}`,
        descripcion: `Oposición a "${data.denominacionOpuesta}" Clase ${data.claseOpuesta}`,
        fechaVencimiento: plazoOposicion,
        fechaAlerta: addCalendarDays(plazoOposicion, -5),
      },
    });

    res.status(201).json(op);
  } catch (err) { next(err); }
});

// ── POST /api/oposiciones/:id/mantener — Registrar mantenimiento ─────────────
// Art. 1 Res. 297/2026: 15 días hábiles desde notificación INPI
router.post('/:id/mantener', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { fechaNotificacion, ampliarFundamentos } = z.object({
      fechaNotificacion: z.string().datetime(),
      ampliarFundamentos: z.string().optional(),
    }).parse(req.body);

    const op = await prisma.oposicion.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!op) throw new AppError(404, 'Oposición no encontrada', 'OPOSICION_NOT_FOUND');

    const notif = new Date(fechaNotificacion);
    // 15 días hábiles desde la notificación (Art. 1 Res. 297/2026)
    const plazoMantenimiento = addBusinessDays(notif, 15);

    if (new Date() > plazoMantenimiento) {
      throw new AppError(400, `El plazo de mantenimiento (15 días hábiles) venció el ${plazoMantenimiento.toLocaleDateString('es-AR')}. La oposición puede haber caducado.`, 'PLAZO_MANTENIMIENTO_VENCIDO');
    }

    // Generar PDF de mantenimiento
    const pdfPath = await documentoService.generarMantenimientoOposicion(
      op.id, req.user!.id, ampliarFundamentos
    );

    // Actualizar estado
    await prisma.oposicion.update({
      where: { id: op.id },
      data: {
        estado: 'MANTENIDA',
        notificacionMantenimiento: notif,
        plazoMantenimiento,
        fechaMantenimiento: new Date(),
      },
    });

    // Crear alerta de traslado (Art. 2: 15 días hábiles para el solicitante)
    // El INPI notifica al solicitante después de recibir el mantenimiento
    await prisma.alerta.create({
      data: {
        userId: req.user!.id,
        oposicionId: op.id,
        tipo: 'OPOSICION_TRASLADO',
        titulo: `Traslado al solicitante — Acta ${op.actaOpuesta}`,
        descripcion: 'Aguardar traslado al solicitante de la marca opuesta (Art. 2 Res. 297/2026)',
        fechaVencimiento: addBusinessDays(new Date(), 60), // Estimativo
        fechaAlerta: addBusinessDays(new Date(), 30),
      },
    });

    res.json({
      mensaje: 'Oposición mantenida exitosamente',
      plazoMantenimiento,
      documentoPDF: pdfPath,
      instrucciones: [
        '1. Descargue el PDF generado',
        '2. Ingrese al portal INPI con Clave Fiscal nivel 2+',
        '3. Marcas → Trámites → Escritos → Seleccione el número de oposición',
        '4. Adjunte el PDF y confirme el envío',
        '5. Guarde el comprobante de presentación',
      ],
    });
  } catch (err) { next(err); }
});

// ── POST /api/oposiciones/:id/argumentos — Presentar argumentos finales ───────
// Art. 6 Res. 297/2026: 10 días hábiles
router.post('/:id/argumentos', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { fechaTraslado, argumentos } = z.object({
      fechaTraslado: z.string().datetime(),
      argumentos: z.string().min(50, 'Los argumentos deben tener al menos 50 caracteres'),
    }).parse(req.body);

    const op = await prisma.oposicion.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!op) throw new AppError(404, 'Oposición no encontrada', 'OPOSICION_NOT_FOUND');

    const traslado = new Date(fechaTraslado);
    // 10 días hábiles para argumentos finales (Art. 6 Res. 297/2026)
    const plazoArgumentos = addBusinessDays(traslado, 10);

    if (new Date() > plazoArgumentos) {
      throw new AppError(400, `El plazo para argumentos finales venció el ${plazoArgumentos.toLocaleDateString('es-AR')}`, 'PLAZO_ARGUMENTOS_VENCIDO');
    }

    await prisma.oposicion.update({
      where: { id: op.id },
      data: {
        estado: 'EN_TRAMITE',
        trasladoFecha: traslado,
        plazoTraslado: plazoArgumentos,
        argumentosFinales: argumentos,
      },
    });

    res.json({
      mensaje: 'Argumentos finales registrados',
      plazoArgumentos,
    });
  } catch (err) { next(err); }
});

// ── POST /api/oposiciones/:id/resolucion — Registrar resolución del INPI ──────
router.post('/:id/resolucion', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { resolucion, numeroResolucion, fundamentosResolucion } = z.object({
      resolucion: z.enum(['FUNDADA', 'INFUNDADA', 'DESISTIDA', 'ABANDONADA']),
      numeroResolucion: z.string().optional(),
      fundamentosResolucion: z.string().optional(),
    }).parse(req.body);

    const op = await prisma.oposicion.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!op) throw new AppError(404, 'Oposición no encontrada', 'OPOSICION_NOT_FOUND');

    await prisma.oposicion.update({
      where: { id: op.id },
      data: {
        estado: resolucion === 'FUNDADA' ? 'FUNDADA' : 'INFUNDADA',
        resolucionFecha: new Date(),
        resolucionNumero: numeroResolucion,
        resolucionTexto: fundamentosResolucion,
      },
    });

    res.json({
      mensaje: `Oposición resuelta: ${resolucion}`,
      resultado: resolucion === 'FUNDADA'
        ? 'La marca opuesta NO podrá registrarse. La resolución puede ser recurrida.'
        : 'La oposición fue desestimada. La marca opuesta puede ser concedida.',
    });
  } catch (err) { next(err); }
});

// ── POST /api/oposiciones/:id/pdf — Generar PDF de oposición ─────────────────
router.post('/:id/pdf', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    const pdfPath = await documentoService.generarOposicion(id, req.user!.id);
    res.json({
      mensaje: 'PDF generado',
      url: `/api/documentos/${encodeURIComponent(String(pdfPath))}`,
      instrucciones: [
        '1. Descargue el PDF generado',
        '2. Ingrese a https://www.inpi.gob.ar con Clave Fiscal nivel 2+',
        '3. Marcas → Trámites → Oposiciones → Nueva Oposición',
        '4. Complete el número de acta y adjunte el PDF',
        '5. Realice el pago del arancel (Código 126000)',
        '6. Descargue el comprobante VEP',
      ],
    });
  } catch (err) { next(err); }
});

// ── Helper: calcular próximo plazo activo ─────────────────────────────────────
function calcularProximoPlazo(op: any, hoy: Date): { tipo: string; fecha: Date; diasRestantes: number; urgente: boolean } | null {
  const plazos: Array<{ tipo: string; fecha: Date | null }> = [
    { tipo: 'Presentar oposición', fecha: op.plazoOposicion },
    { tipo: 'Mantener oposición (15 días hábiles)', fecha: op.plazoMantenimiento },
    { tipo: 'Traslado/Argumentos finales (10 días hábiles)', fecha: op.plazoTraslado },
  ];

  for (const plazo of plazos) {
    if (plazo.fecha && plazo.fecha > hoy) {
      const diff = Math.ceil((plazo.fecha.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24));
      return {
        tipo: plazo.tipo,
        fecha: plazo.fecha,
        diasRestantes: diff,
        urgente: diff <= 5,
      };
    }
  }

  return null;
}

export default router;
