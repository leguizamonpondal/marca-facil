/**
 * Rutas del Boletín de Marcas — MARCA FÁCIL
 * Boletín publicado todos los MIÉRCOLES por el INPI
 */

import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/client';
import { AppError } from '../../middleware/errorHandler';
import { authenticate, requirePlan, AuthRequest } from '../../middleware/auth';
import { boletinService } from '../../services/boletinService';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { listarBoletines, boletinesDeMarcasNuevas, ultimoMiercoles, descargarPdf } from '../../services/boletinPortal';
import { extraerTextoDelPdf, parsearActas } from '../../services/boletinParser';
import { descargarBoletinesDeLaFecha, limpiar as limpiarTemporales } from '../../services/boletinDescarga';
import { logger } from '../../utils/logger';

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// DIAGNÓSTICO DEL PORTAL — temporal
// ═══════════════════════════════════════════════════════════════════════════
//
// Dos GET protegidos con INPI_TEST_TOKEN, para poder probar el descubrimiento
// y la descarga desde el navegador sin armar un JWT.
//
// ⚠️ Van a la misma lista de limpieza que /api/inpi/prueba-carga y los atajos
//    GET del portal: antes de abrir la app hay que pasarlos a `authenticate`
//    o borrarlos. Quedan declarados ANTES de `router.use(authenticate)`, así
//    que no están detrás del login.

function exigirToken(req: any, res: Response): boolean {
  const esperado = process.env.INPI_TEST_TOKEN || '';
  if (!esperado) {
    res.status(503).json({ error: 'Endpoint deshabilitado', detalle: 'Falta INPI_TEST_TOKEN.' });
    return false;
  }
  if (String(req.query.token || '') !== esperado) {
    res.status(403).json({ error: 'Token inválido' });
    return false;
  }
  return true;
}

// ── GET /api/boletin/portal/listado ──────────────────────────────────────────
//
// Qué boletines ve el portal. No descarga nada: es la consulta barata que
// conviene correr primero.
//
//   ?fecha=2026-09-16   → los de MARCAS NUEVAS de ese miércoles
//   (sin fecha)         → los del último miércoles
//   ?todos=1            → el listado crudo, con resoluciones y anexos incluidos
router.get('/portal/listado', async (req, res: Response) => {
  if (!exigirToken(req, res)) return;

  const inicio = Date.now();
  try {
    const fecha = req.query.fecha ? new Date(String(req.query.fecha)) : ultimoMiercoles();

    if (isNaN(fecha.getTime())) {
      return res.status(400).json({ error: 'Fecha inválida. Formato: ?fecha=2026-09-16' });
    }

    if (req.query.todos) {
      const filas = await listarBoletines();
      return res.json({
        aviso: 'Listado crudo: últimos 100 registros del sector Marcas, de todos los tipos.',
        total: filas.length,
        filas,
      });
    }

    const filas = await boletinesDeMarcasNuevas(fecha);

    return res.json({
      fecha: fecha.toLocaleDateString('es-AR'),
      cantidad: filas.length,
      numeros: filas.map((f) => f.numero),
      esperado: 'Entre 4 y 5 por miércoles. Menos de 4 amerita mirar el portal a mano.',
      latenciaMs: Date.now() - inicio,
      filas,
    });
  } catch (err: any) {
    // Se responde 502 y no 200 con lista vacía: no poder mirar el Boletín no
    // puede parecerse a haberlo mirado y no encontrar nada.
    logger.error(`[Boletín] Falló el listado: ${err.message}`);
    return res.status(502).json({
      error: 'No se pudo consultar el portal del INPI',
      detalle: err.message,
      latenciaMs: Date.now() - inicio,
    });
  }
});

// ── GET /api/boletin/portal/descargar ────────────────────────────────────────
//
// Descarga real de los 4-5 PDF y verificación de completitud. Tarda: son unos
// 100 MB. Los PDF se borran al terminar; lo que queda es el registro en
// boletin_descargas y este informe.
//
//   ?fecha=2026-09-16   ?forzar=1 (vuelve a bajar los ya descargados)
router.get('/portal/descargar', async (req, res: Response) => {
  if (!exigirToken(req, res)) return;

  const inicio = Date.now();
  let resultado: Awaited<ReturnType<typeof descargarBoletinesDeLaFecha>> | undefined;

  try {
    const fecha = req.query.fecha ? new Date(String(req.query.fecha)) : undefined;
    if (fecha && isNaN(fecha.getTime())) {
      return res.status(400).json({ error: 'Fecha inválida. Formato: ?fecha=2026-09-16' });
    }

    resultado = await descargarBoletinesDeLaFecha(fecha, { forzar: Boolean(req.query.forzar) });

    return res.status(resultado.completa ? 200 : 207).json({
      completa: resultado.completa,
      veredicto: resultado.completa
        ? `Se descargaron los ${resultado.publicados.length} boletines del ${resultado.fecha.toLocaleDateString('es-AR')}.`
        : '⚠️ La descarga está INCOMPLETA. No se puede dar la vigilancia de esta fecha por cerrada.',
      fecha: resultado.fecha.toLocaleDateString('es-AR'),
      publicados: resultado.publicados,
      descargados: resultado.descargados.map((d) => ({
        numero: d.numero,
        tamanoMb: d.tamanoMb,
        actasLeidas: d.actasLeidas,
        actasNuevas: d.actasNuevas,
        actasRepetidas: d.actasRepetidas,
        actasFallidas: d.actasFallidas,
        sinDenominacion: d.sinDenominacion,
      })),
      totales: {
        actasLeidas: resultado.descargados.reduce((n, d) => n + d.actasLeidas, 0),
        actasNuevas: resultado.descargados.reduce((n, d) => n + d.actasNuevas, 0),
        actasFallidas: resultado.descargados.reduce((n, d) => n + d.actasFallidas, 0),
        sinDenominacion: resultado.descargados.reduce((n, d) => n + d.sinDenominacion, 0),
      },
      fallidos: resultado.fallidos,
      huecos: resultado.huecos,
      advertencias: resultado.advertencias,
      latenciaMs: Date.now() - inicio,
      siguientePaso:
        'Las actas quedaron guardadas en boletin_entradas. Las que figuran en ' +
        '"sinDenominacion" son mixtas y figurativas: hay que pedirle la denominación ' +
        'al Web Service del INPI por número de acta antes de poder cotejarlas.',
    });
  } catch (err: any) {
    logger.error(`[Boletín] Falló la descarga: ${err.message}`);
    return res.status(502).json({
      error: 'No se pudieron descargar los boletines',
      detalle: err.message,
      latenciaMs: Date.now() - inicio,
    });
  } finally {
    // Siempre, incluso si algo explotó: son ~100 MB de temporales.
    if (resultado) limpiarTemporales(resultado);
  }
});

// ── GET /api/boletin/portal/parsear ──────────────────────────────────────────
//
// Baja UN boletín y lo parsea, sin guardar nada. Es la prueba de que el
// circuito completo funciona contra el servidor real.
//
//   ?numero=11121   → ese boletín
//   (sin número)    → el primero del último miércoles
router.get('/portal/parsear', async (req, res: Response) => {
  if (!exigirToken(req, res)) return;

  const inicio = Date.now();
  try {
    const numero = req.query.numero ? String(req.query.numero) : undefined;
    const filas = await boletinesDeMarcasNuevas(ultimoMiercoles());
    const fila = numero ? filas.find((f) => f.numero === numero) : filas[0];

    if (!fila) {
      return res.status(404).json({
        error: numero
          ? `El boletín ${numero} no figura entre los de MARCAS NUEVAS del último miércoles`
          : 'No hay boletines para el último miércoles',
        disponibles: filas.map((f) => f.numero),
      });
    }

    const pdf = await descargarPdf(fila);
    const tmp = path.join(os.tmpdir(), `boletin-${fila.numero}.pdf`);
    fs.writeFileSync(tmp, pdf.bytes);

    try {
      const texto = await extraerTextoDelPdf(tmp);
      const r = parsearActas(texto);

      const porTipo: Record<string, number> = {};
      const porClase: Record<number, number> = {};
      for (const a of r.actas) {
        porTipo[a.tipo] = (porTipo[a.tipo] || 0) + 1;
        porClase[a.clase] = (porClase[a.clase] || 0) + 1;
      }
      const conDenominacion = r.actas.filter((a) => a.denominacion).length;

      return res.json({
        boletin: fila.numero,
        fecha: fila.fecha.toLocaleDateString('es-AR'),
        tamanoMb: pdf.tamanoMb,
        caracteresDeTexto: texto.length,
        bloques: r.bloques,
        actasLeidas: r.actas.length,
        fallidos: r.fallidos.length,
        veredicto:
          r.fallidos.length === 0
            ? `Se leyeron las ${r.actas.length} actas del boletín, sin fallos.`
            : `⚠️ ${r.fallidos.length} de ${r.bloques} bloques no se pudieron leer.`,
        porTipo,
        conDenominacion,
        sinDenominacion: r.actas.length - conDenominacion,
        notaSinDenominacion:
          'Las mixtas y figurativas traen el (54) vacío: la denominación está dentro del logo. ' +
          'Hay que pedírsela al Web Service por número de acta.',
        clasesMasPobladas: Object.entries(porClase)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([clase, n]) => ({ clase: Number(clase), actas: n })),
        muestra: r.actas.filter((a) => a.denominacion).slice(0, 5),
        primerosFallidos: r.fallidos.slice(0, 3),
        latenciaMs: Date.now() - inicio,
      });
    } finally {
      try { fs.unlinkSync(tmp); } catch { /* el temporal ya no importa */ }
    }
  } catch (err: any) {
    logger.error(`[Boletín] Falló el parseo: ${err.message}`);
    return res.status(502).json({
      error: 'No se pudo parsear el boletín',
      detalle: err.message,
      latenciaMs: Date.now() - inicio,
    });
  }
});

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
    // El campo del schema es `fechaBoletin`. Decía `fechaPublicacion`, que no
    // existe en BoletinEntrada: filtrar por fecha tiraba en tiempo de ejecución.
    if (desde || hasta) {
      where.fechaBoletin = {};
      if (desde) where.fechaBoletin.gte = new Date(String(desde));
      if (hasta) where.fechaBoletin.lte = new Date(String(hasta));
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

      // Mapear fechaPublicacion → fechaBoletin, que es el nombre del schema.
      const datosConFecha = datos.map(d => ({
        acta: d.acta,
        denominacion: d.denominacion,
        tipoMarca: d.tipoMarca || 'DENOMINATIVA',
        claseNiza: d.claseNiza,
        titularNombre: d.titularNombre || 'No informado',
        titularCuit: d.titularCuit,
        productos: d.productos,
        fechaBoletin: new Date(d.fechaPublicacion),
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
