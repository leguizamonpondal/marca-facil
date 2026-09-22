/**
 * Correo — diagnóstico y previsualización
 * ------------------------------------------------------------------
 * Tres cosas, en el orden en que hay que usarlas:
 *
 *   1. `/config`      — qué credenciales ve el servidor (sin exponer la clave)
 *   2. `/verificar`   — prueba la conexión SMTP sin mandar nada
 *   3. `/prueba`      — manda un mail real
 *
 * Y aparte `/vista/:plantilla`, que renderiza cada mail en el navegador con
 * datos de ejemplo. Es para revisar los textos ANTES de que salgan: hablan de
 * plazos de caducidad y de efectos de una presentación ante el INPI, así que
 * conviene que los lea el matriculado y no que se descubran los errores
 * después.
 *
 * ⚠️ Protegidos con INPI_TEST_TOKEN, igual que los endpoints del portal, hasta
 *    que estén detrás del middleware de auth de la app.
 */
import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger';
import {
  verificarConexion,
  mailDePrueba,
  previsualizar,
  PLANTILLAS,
  type NombrePlantilla,
} from '../../services/emailService';
import { marca, agente, correo, correoConfigurado } from '../../utils/identidad';

const router = Router();

function exigirToken(req: Request, res: Response): boolean {
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

// ── GET /api/email/config ────────────────────────────────────────────────────
//
// Lo primero que hay que mirar cuando algo no anda: qué está viendo realmente
// el servidor. La clave nunca se devuelve, solo si está presente y su largo —
// suficiente para detectar el error clásico de haberla pegado con un espacio.
router.get('/config', (req: Request, res: Response) => {
  if (!exigirToken(req, res)) return;

  return res.json({
    listoParaEnviar: correoConfigurado(),
    identidad: {
      marca: marca.nombre,
      razonSocial: marca.razonSocial,
      urlApp: marca.urlApp,
      color: marca.colorPrincipal,
    },
    agente: {
      nombre: agente.nombre,
      numero: agente.numero,
      matriculaApi: agente.matriculaApi,
    },
    correo: {
      remitente: `${correo.remitenteNombre} <${correo.remitenteEmail}>`,
      responderA: correo.responderA,
      copiaOculta: correo.copiaOculta || '(ninguna)',
      servidor: correo.smtp.host || '❌ FALTA SMTP_HOST',
      puerto: correo.smtp.puerto,
      modo: correo.smtp.seguro ? 'SSL directo (465)' : 'STARTTLS (587)',
      usuario: correo.smtp.usuario || '❌ FALTA SMTP_USER',
      claveCargada: correo.smtp.clave
        ? `sí (${correo.smtp.clave.length} caracteres)`
        : '❌ FALTA SMTP_PASS',
    },
    nota:
      'Si el puerto es 465 el modo tiene que ser SSL (SMTP_SECURE=true). Si es 587, STARTTLS (SMTP_SECURE=false). ' +
      'Cruzarlos es el error más común y falla de formas poco informativas.',
  });
});

// ── GET /api/email/verificar ─────────────────────────────────────────────────
//
// Abre la conexión, autentica y corta. No manda nada. Separa un problema de
// credenciales de uno de contenido, que si no se confunden entre sí.
router.get('/verificar', async (req: Request, res: Response) => {
  if (!exigirToken(req, res)) return;

  const inicio = Date.now();
  const r = await verificarConexion();

  return res.status(r.ok ? 200 : 502).json({
    ...r,
    latenciaMs: Date.now() - inicio,
    servidor: `${correo.smtp.host}:${correo.smtp.puerto}`,
    ayuda: r.ok
      ? undefined
      : [
          'Revisá que el hosting permita SMTP saliente desde fuera de su red.',
          'Probá el otro puerto: si estás en 587 pasá a 465 con SMTP_SECURE=true, o al revés.',
          'El usuario suele ser la dirección completa, no solo la parte antes del arroba.',
          'Algunos hostings piden habilitar el acceso SMTP externo desde su panel.',
        ],
  });
});

// ── GET /api/email/prueba ────────────────────────────────────────────────────
//
// ?para=alguien@dominio.com
router.get('/prueba', async (req: Request, res: Response) => {
  if (!exigirToken(req, res)) return;

  const para = String(req.query.para || '');
  if (!para.includes('@')) {
    return res.status(400).json({ error: 'Falta el parámetro ?para= con una dirección válida' });
  }

  const inicio = Date.now();
  const r = await mailDePrueba(para);

  if (r.simulado) {
    return res.json({
      ok: true,
      simulado: true,
      aviso: 'No hay SMTP configurado: el mail se registró en el log pero NO se envió.',
    });
  }

  return res.status(r.ok ? 200 : 502).json({
    ...r,
    latenciaMs: Date.now() - inicio,
    para,
    siguientePaso: r.ok
      ? 'Revisá la bandeja de entrada Y la carpeta de correo no deseado. Si cayó en spam, hay que configurar SPF y DKIM en el DNS del dominio.'
      : undefined,
  });
});

// ── GET /api/email/vista/:plantilla ──────────────────────────────────────────
//
// Renderiza el mail en el navegador con datos de ejemplo. No envía nada.
router.get('/vista/:plantilla', (req: Request, res: Response) => {
  if (!exigirToken(req, res)) return;

  const nombre = String(req.params.plantilla) as NombrePlantilla;
  if (!PLANTILLAS.includes(nombre)) {
    return res.status(404).json({ error: 'Plantilla desconocida', disponibles: PLANTILLAS });
  }

  const { asunto, html } = previsualizar(nombre);
  logger.info(`[Mail] Previsualización de la plantilla "${nombre}"`);

  // Se antepone una barra con el asunto: en un mail real es lo primero que ve
  // el destinatario y merece revisarse igual que el cuerpo.
  const barra = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#1a1a1a;color:#fff;padding:12px 20px;font-size:13px;">
    <strong style="color:#8ab4f8;">VISTA PREVIA</strong> &nbsp;·&nbsp; Asunto: <em>${asunto.replace(/</g, '&lt;')}</em>
    &nbsp;·&nbsp; <span style="color:#aaa;">datos de ejemplo, no se envió nada</span>
  </div>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(html.replace(/(<body[^>]*>)/i, `$1${barra}`));
});

// ── GET /api/email/vista ─────────────────────────────────────────────────────
// Índice con enlaces a cada plantilla, para no tener que tipearlas.
router.get('/vista', (req: Request, res: Response) => {
  if (!exigirToken(req, res)) return;
  const token = String(req.query.token);
  const items = PLANTILLAS.map(
    (p) => `<li style="margin:8px 0;"><a href="/api/email/vista/${p}?token=${encodeURIComponent(token)}">${p}</a></li>`
  ).join('');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(
    `<html><head><meta charset="utf-8"><title>Plantillas de correo</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;padding:40px;max-width:600px;margin:0 auto;">
<h1 style="font-size:20px;">Plantillas de correo</h1>
<p style="color:#666;font-size:14px;">Vista previa con datos de ejemplo. No se envía nada.</p>
<ul style="font-size:16px;">${items}</ul>
</body></html>`
  );
});

export default router;
