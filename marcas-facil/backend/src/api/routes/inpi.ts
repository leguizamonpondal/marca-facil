/**
 * Rutas INPI — integración portal Trámites en Línea vía Clave ARCA
 *
 * Endpoints:
 *   POST /api/inpi/consultar-acta          — consulta estado (pública o autenticada)
 *   POST /api/inpi/presentar-solicitud     — presenta nueva solicitud de marca
 *   GET  /api/inpi/estado                  — estado del servicio (ping)
 */
import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { authenticate } from '../../middleware/auth';
import { logger } from '../../utils/logger';
import {
  consultarEstadoActaPublico,
  consultarEstadoActa,
  presentarSolicitud,
  type CredencialesARCA,
  type DatosSolicitud,
} from '../../services/inpiService';

const router = Router();

// Todas las rutas requieren JWT
router.use(authenticate);

// ── GET /estado ───────────────────────────────────────────────────────────────
router.get('/estado', (_req: Request, res: Response) => {
  res.json({
    servicio: 'INPI Trámites en Línea',
    estado: 'activo',
    modos: ['consulta-publica', 'consulta-autenticada', 'presentacion-solicitud'],
    nota: 'La presentación de solicitudes requiere Clave ARCA (ex-AFIP) nivel 2+',
  });
});

// ── POST /consultar-acta ──────────────────────────────────────────────────────
router.post(
  '/consultar-acta',
  [
    body('acta').notEmpty().withMessage('El número de acta es requerido'),
    body('cuit').optional().isLength({ min: 11, max: 11 }).withMessage('CUIT inválido (11 dígitos sin guiones)'),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { acta, cuit, claveFiscal } = req.body as {
      acta: string;
      cuit?: string;
      claveFiscal?: string;
    };

    try {
      // Intentar primero con la API pública (sin credenciales, más rápida)
      const resultadoPublico = await consultarEstadoActaPublico(acta);
      if (resultadoPublico) {
        return res.json({ fuente: 'api-publica', datos: resultadoPublico });
      }

      // Si la API pública falla y hay credenciales, usar Playwright con ARCA
      if (cuit && claveFiscal) {
        const creds: CredencialesARCA = { cuit, claveFiscal };
        const datos = await consultarEstadoActa(acta, creds);
        return res.json({ fuente: 'portal-arca', datos });
      }

      // Sin credenciales y sin API pública: informar al usuario
      return res.status(404).json({
        error: 'No se pudo obtener información del acta.',
        sugerencia: 'Podés incluir tu CUIT y Clave Fiscal para consultar directamente en el portal INPI.',
      });
    } catch (err: any) {
      logger.error('[INPI] Error consultando acta:', err);
      res.status(500).json({ error: err.message || 'Error al consultar el acta en el portal INPI' });
    }
  },
);

// ── POST /presentar-solicitud ─────────────────────────────────────────────────
router.post(
  '/presentar-solicitud',
  [
    body('cuit').notEmpty().isLength({ min: 11, max: 11 }).withMessage('CUIT requerido (11 dígitos)'),
    body('claveFiscal').notEmpty().withMessage('Clave Fiscal requerida'),
    body('denominacion').notEmpty().withMessage('Denominación requerida'),
    body('claseNiza').isInt({ min: 1, max: 45 }).withMessage('Clase de Niza inválida (1-45)'),
    body('tipoMarca').isIn(['DENOMINATIVA', 'FIGURATIVA', 'MIXTA', 'TRIDIMENSIONAL']),
    body('descripcionProductos').notEmpty().withMessage('Descripción de productos/servicios requerida'),
    body('titularNombre').notEmpty().withMessage('Nombre del titular requerido'),
    body('titularCuit').notEmpty().isLength({ min: 11, max: 11 }).withMessage('CUIT del titular requerido'),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      cuit, claveFiscal,
      denominacion, claseNiza, tipoMarca, descripcionProductos,
      titularNombre, titularCuit, titularDomicilio, titularEmail,
      imagenBase64, imagenMimeType,
    } = req.body;

    const creds: CredencialesARCA = { cuit, claveFiscal };
    const datos: DatosSolicitud = {
      denominacion,
      claseNiza: Number(claseNiza),
      tipoMarca,
      descripcionProductos,
      titularNombre,
      titularCuit,
      titularDomicilio,
      titularEmail,
      imagenBase64,
      imagenMimeType,
    };

    try {
      logger.info(`[INPI] Iniciando presentación de solicitud: "${denominacion}" Clase ${claseNiza}`);
      const resultado = await presentarSolicitud(datos, creds);

      const status = resultado.error ? 207 : 200; // 207 = pasos parciales con error
      res.status(status).json(resultado);
    } catch (err: any) {
      logger.error('[INPI] Error presentando solicitud:', err);
      res.status(500).json({ error: err.message || 'Error al presentar la solicitud en el portal INPI' });
    }
  },
);

export default router;
