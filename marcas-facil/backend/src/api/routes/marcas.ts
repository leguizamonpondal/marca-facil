/**
 * Rutas de Marcas — MARCAS FÁCIL
 * CRUD completo de marcas propias del usuario + consulta de estado INPI
 */

import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/client';
import { AppError } from '../../middleware/errorHandler';
import { authenticate, requirePlan, AuthRequest } from '../../middleware/auth';
import { addCalendarDays, addBusinessDays, formatCuit } from '../../utils/helpers';

const router = Router();
router.use(authenticate);

// ── Schemas ────────────────────────────────────────────────────────────────────

const marcaSchema = z.object({
  denominacion: z.string().min(1, 'La denominación es requerida'),
  tipoMarca: z.enum(['DENOMINATIVA', 'FIGURATIVA', 'MIXTA', 'TRIDIMENSIONAL', 'SONORA']),
  claseNiza: z.number().int().min(1).max(45),
  productos: z.string().min(1, 'Descripción de productos/servicios requerida'),
  acta: z.string().optional(),
  resolucion: z.string().optional(),
  estado: z.enum(['BORRADOR', 'EN_TRAMITE', 'PUBLICADA', 'CONCEDIDA', 'RECHAZADA', 'ABANDONADA', 'VENCIDA']).optional(),
  fechaIngreso: z.string().datetime().optional(),
  fechaPublicacion: z.string().datetime().optional(),
  fechaConcesion: z.string().datetime().optional(),
  logoUrl: z.string().url().optional(),
  vigilanciaActiva: z.boolean().optional(),
});

// ── GET /api/marcas — Listar marcas del usuario ───────────────────────────────
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { estado, clase, vigilancia, page = '1', limit = '20' } = req.query;

    const where: any = { userId: req.user!.id };
    if (estado) where.estado = estado;
    if (clase) where.claseNiza = Number(clase);
    if (vigilancia !== undefined) where.vigilanciaActiva = vigilancia === 'true';

    const skip = (Number(page) - 1) * Number(limit);

    const [marcas, total] = await Promise.all([
      prisma.marca.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { oposicionesRecibidas: true, documentos: true, alertas: true } },
        },
      }),
      prisma.marca.count({ where }),
    ]);

    res.json({
      data: marcas,
      meta: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
    });
  } catch (err) { next(err); }
});

// ── GET /api/marcas/:id — Detalle de una marca ────────────────────────────────
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const marca = await prisma.marca.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
      include: {
        documentos: { orderBy: { createdAt: 'desc' } },
        alertas: { where: { leida: false }, orderBy: { fechaVencimiento: 'asc' } },
        oposicionesRecibidas: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    });

    if (!marca) throw new AppError(404, 'Marca no encontrada', 'MARCA_NOT_FOUND');

    // Calcular plazos de DDJJ y renovación
    const info: any = { ...marca };

    if (marca.fechaConcesion) {
      const concesion = new Date(marca.fechaConcesion);
      const anoActual = new Date().getFullYear();
      const anoConcesion = concesion.getFullYear();
      const añosTranscurridos = anoActual - anoConcesion;

      // DDJJ de medio término: año 6 desde concesión
      if (añosTranscurridos >= 5 && añosTranscurridos <= 7 && !marca.ddjjUsoPresentada) {
        const inicioVentana = new Date(concesion);
        inicioVentana.setFullYear(anoConcesion + 5);
        const finVentana = new Date(concesion);
        finVentana.setFullYear(anoConcesion + 7);
        info.ddjjMedioTermino = {
          obligatoria: true,
          ventanaDesde: inicioVentana,
          ventanaHasta: finVentana,
          urgente: añosTranscurridos >= 6,
        };
      }

      // Renovación: 10 años desde concesión, con preaviso de 6 meses
      if (marca.fechaVencimiento) {
        const vencimiento = new Date(marca.fechaVencimiento);
        const mesesParaVencer = Math.round((vencimiento.getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30));
        info.renovacion = {
          fechaVencimiento: vencimiento,
          mesesRestantes: mesesParaVencer,
          urgente: mesesParaVencer <= 12,
          critico: mesesParaVencer <= 3,
        };
      }
    }

    res.json(info);
  } catch (err) { next(err); }
});

// ── POST /api/marcas — Crear marca ────────────────────────────────────────────
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = marcaSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { cuit: true, razonSocial: true },
    });

    // Calcular fechas derivadas si hay fecha de concesión
    let fechaVencimiento: Date | undefined;
    let ddjjVencimiento: Date | undefined;

    if (data.fechaConcesion) {
      const concesion = new Date(data.fechaConcesion);
      // Vencimiento: 10 años exactos
      fechaVencimiento = new Date(concesion);
      fechaVencimiento.setFullYear(fechaVencimiento.getFullYear() + 10);
      // DDJJ uso medio término vence al año 7 desde concesión
      ddjjVencimiento = new Date(concesion);
      ddjjVencimiento.setFullYear(ddjjVencimiento.getFullYear() + 7);
    }

    const marca = await prisma.marca.create({
      data: {
        ...data,
        userId: req.user!.id,
        titularCuit: user!.cuit,
        titularNombre: user!.razonSocial,
        fechaIngreso: data.fechaIngreso ? new Date(data.fechaIngreso) : undefined,
        fechaPublicacion: data.fechaPublicacion ? new Date(data.fechaPublicacion) : undefined,
        fechaConcesion: data.fechaConcesion ? new Date(data.fechaConcesion) : undefined,
        fechaVencimiento,
        ddjjVencimiento,
        estado: data.estado || 'BORRADOR',
               vigilanciaActiva: data.vigilanciaActiva ?? true,
      } as any,
    });

    // Si tiene fecha de vencimiento, crear alerta
    if (fechaVencimiento) {
      await crearAlertasVencimiento(marca.id, req.user!.id, fechaVencimiento, ddjjVencimiento);
    }

    res.status(201).json(marca);
  } catch (err) { next(err); }
});

// ── PUT /api/marcas/:id — Actualizar marca ────────────────────────────────────
router.put('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.marca.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!existing) throw new AppError(404, 'Marca no encontrada', 'MARCA_NOT_FOUND');

    const data = marcaSchema.partial().parse(req.body);

    // Recalcular vencimiento si cambia la fecha de concesión
    let extras: any = {};
    if (data.fechaConcesion) {
      const concesion = new Date(data.fechaConcesion);
      const fv = new Date(concesion);
      fv.setFullYear(fv.getFullYear() + 10);
      const dv = new Date(concesion);
      dv.setFullYear(dv.getFullYear() + 7);
      extras.fechaVencimiento = fv;
      extras.ddjjVencimiento = dv;
    }

    const marca = await prisma.marca.update({
      where: { id: req.params.id },
      data: {
        ...data,
        ...extras,
        fechaIngreso: data.fechaIngreso ? new Date(data.fechaIngreso) : undefined,
        fechaPublicacion: data.fechaPublicacion ? new Date(data.fechaPublicacion) : undefined,
        fechaConcesion: data.fechaConcesion ? new Date(data.fechaConcesion) : undefined,
      },
    });

    res.json(marca);
  } catch (err) { next(err); }
});

// ── DELETE /api/marcas/:id — Eliminar marca (soft delete) ────────────────────
router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.marca.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!existing) throw new AppError(404, 'Marca no encontrada', 'MARCA_NOT_FOUND');

    // Solo permitir borrar marcas en borrador
    if (existing.estado !== 'BORRADOR') {
      throw new AppError(400, 'Solo se pueden eliminar marcas en estado BORRADOR. Para otras marcas, use el campo "vigilanciaActiva".');
    }

    await prisma.marca.delete({ where: { id: req.params.id } });
    res.json({ mensaje: 'Marca eliminada' });
  } catch (err) { next(err); }
});

// ── POST /api/marcas/:id/vigilancia — Activar/desactivar vigilancia ───────────
router.post('/:id/vigilancia', requirePlan('BASICO', 'PROFESIONAL', 'EMPRESARIAL'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { activa } = z.object({ activa: z.boolean() }).parse(req.body);

      const marca = await prisma.marca.findFirst({
        where: { id: req.params.id, userId: req.user!.id },
      });
      if (!marca) throw new AppError(404, 'Marca no encontrada', 'MARCA_NOT_FOUND');

      await prisma.marca.update({
        where: { id: req.params.id },
        data: { vigilanciaActiva: activa },
      });

      res.json({ mensaje: `Vigilancia ${activa ? 'activada' : 'desactivada'} para "${marca.denominacion}"` });
    } catch (err) { next(err); }
  });

// ── GET /api/marcas/:id/timeline — Timeline del trámite ──────────────────────
router.get('/:id/timeline', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const marca = await prisma.marca.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
      include: {
        documentos: { orderBy: { createdAt: 'asc' } },
        alertas: { orderBy: { createdAt: 'asc' } },
        oposicionesRecibidas: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!marca) throw new AppError(404, 'Marca no encontrada', 'MARCA_NOT_FOUND');

    // Construir timeline de eventos
    const eventos: Array<{ fecha: Date; tipo: string; descripcion: string; icono: string }> = [];

    if (marca.createdAt) eventos.push({ fecha: marca.createdAt, tipo: 'REGISTRO_SISTEMA', descripcion: 'Marca agregada al sistema', icono: '📝' });
    if (marca.fechaIngreso) eventos.push({ fecha: marca.fechaIngreso, tipo: 'PRESENTACION_INPI', descripcion: `Solicitud presentada en INPI${marca.acta ? ` — Acta ${marca.acta}` : ''}`, icono: '📨' });
    if (marca.fechaPublicacion) eventos.push({ fecha: marca.fechaPublicacion, tipo: 'PUBLICACION_BOLETIN', descripcion: 'Publicada en el Boletín de Marcas', icono: '📰' });
    if (marca.fechaConcesion) eventos.push({ fecha: marca.fechaConcesion, tipo: 'CONCESION', descripcion: `Marca concedida${marca.resolucion ? ` — Res. ${marca.resolucion}` : ''}`, icono: '✅' });

    marca.oposicionesRecibidas.forEach((op: { createdAt: Date; oponenteNombre?: string | null }) => {
      eventos.push({ fecha: op.createdAt, tipo: 'OPOSICION_RECIBIDA', descripcion: `Oposición recibida de "${op.oponenteNombre || 'tercero'}"`, icono: '⚠️' });
    });

    eventos.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());

    res.json({ marca: { id: marca.id, denominacion: marca.denominacion, estado: marca.estado }, eventos });
  } catch (err) { next(err); }
});

// ── Helper: crear alertas de vencimiento ──────────────────────────────────────
async function crearAlertasVencimiento(marcaId: string, userId: string, fechaVencimiento: Date, ddjjVencimiento?: Date) {
  const alertas: any[] = [];

  // Alerta DDJJ de medio término (6 meses antes del cierre de la ventana de año 7)
  if (ddjjVencimiento) {
    const alertaDdjj = addCalendarDays(ddjjVencimiento, -180);
    alertas.push({
      userId,
      marcaId,
      tipo: 'DDJJ_VENCIMIENTO',
      titulo: 'DDJJ de Uso — Medio Término',
      descripcion: 'La Declaración Jurada de uso de medio término (Art. 26 Ley 22.362) vence pronto.',
      fechaVencimiento: ddjjVencimiento,
      fechaAlerta: alertaDdjj,
    });
  }

  // Alertas de renovación (12 meses, 6 meses, 3 meses antes)
  for (const meses of [12, 6, 3]) {
    const fecha = addCalendarDays(fechaVencimiento, -meses * 30);
    alertas.push({
      userId,
      marcaId,
      tipo: 'RENOVACION_VENCIMIENTO',
      titulo: `Renovación en ${meses} ${meses === 1 ? 'mes' : 'meses'}`,
      descripcion: `La marca vence el ${fechaVencimiento.toLocaleDateString('es-AR')}. Presentar renovación anticipadamente.`,
      fechaVencimiento,
      fechaAlerta: fecha,
    });
  }

  await prisma.alerta.createMany({ data: alertas, skipDuplicates: true });
}

export default router;
