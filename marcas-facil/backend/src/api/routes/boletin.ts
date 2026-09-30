/**
 * Rutas del Boletín de Marcas — MARCA FÁCIL
 * Boletín publicado todos los MIÉRCOLES por el INPI
 */

import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/client';
import { AppError } from '../../middleware/errorHandler';
import { authenticate, requirePlan, AuthRequest } from '../../middleware/auth';
import { boletinService, recuperarDenominacionesMixtas } from '../../services/boletinService';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { listarBoletines, boletinesDeMarcasNuevas, ultimoMiercoles, descargarPdf } from '../../services/boletinPortal';
import { extraerTextoDelPdf, parsearActas } from '../../services/boletinParser';
import { cruzarBoletin, cruzarUnaMarca, indexarActas, agruparPorActa } from '../../services/vigilanciaService';
import { buscarPorTitularWS } from '../../services/inpiWsService';
import { calcularHuella } from '../../utils/huellaVisual';
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
//   ?fecha=2026-09-16   — otra fecha
//   ?forzar=1           — vuelve a bajar los ya descargados
//   ?numero=11122       — UN boletín solo. Para probar a mano: los cuatro de
//                         una fecha son ~150 MB y el proxy de Railway corta la
//                         respuesta antes de que termine.
router.get('/portal/descargar', async (req, res: Response) => {
  if (!exigirToken(req, res)) return;

  const inicio = Date.now();
  let resultado: Awaited<ReturnType<typeof descargarBoletinesDeLaFecha>> | undefined;

  try {
    const fecha = req.query.fecha ? new Date(String(req.query.fecha)) : undefined;
    if (fecha && isNaN(fecha.getTime())) {
      return res.status(400).json({ error: 'Fecha inválida. Formato: ?fecha=2026-09-16' });
    }

    resultado = await descargarBoletinesDeLaFecha(fecha, {
      forzar: Boolean(req.query.forzar),
      soloNumero: req.query.numero ? String(req.query.numero) : undefined,
    });

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

// ── GET /api/boletin/vigilancia/probar ───────────────────────────────────────
//
// Cruza UNA denominación contra las actas ya guardadas, **sin escribir nada**.
//
// Es la herramienta de calibración: se van a probar decenas de marcas contra
// los mismos datos, y crear una marca de prueba por cada intento ensuciaría la
// base de producción con registros que después hay que acordarse de borrar.
//
//   ?marca=NAHANA&clase=35          — obligatorios
//   &ampliada=1                     — vigilancia en las 45 clases
//   &tipo=RENOMBRADA                — cambia el texto de la acción sugerida
//   &fecha=2026-09-23               — por defecto, el último miércoles
router.get('/vigilancia/probar', async (req, res: Response) => {
  if (!exigirToken(req, res)) return;

  const inicio = Date.now();
  try {
    const denominacion = String(req.query.marca || '').trim();
    const clase = Number(req.query.clase);

    if (!denominacion || !Number.isFinite(clase) || clase < 1 || clase > 45) {
      return res.status(400).json({
        error: 'Faltan parámetros',
        uso: '?marca=NAHANA&clase=35 [&ampliada=1] [&tipo=NOTORIA|RENOMBRADA] [&fecha=2026-09-23]',
      });
    }

    const fecha = req.query.fecha ? new Date(String(req.query.fecha)) : ultimoMiercoles();
    if (isNaN(fecha.getTime())) {
      return res.status(400).json({ error: 'Fecha inválida. Formato: ?fecha=2026-09-23' });
    }

    const { total, sinDenominacion, porClase, advertencias } = await indexarActas(fecha);

    const tipo = String(req.query.tipo || '').toUpperCase();
    const r = cruzarUnaMarca(
      {
        id: '(prueba)',
        denominacion,
        claseNiza: clase,
        vigilanciaAmpliada: Boolean(req.query.ampliada),
        tipoNotoriedad: tipo === 'RENOMBRADA' || tipo === 'NOTORIA' ? (tipo as any) : null,
      },
      porClase
    );

    const ordenadas = r.coincidencias.sort((a, b) => b.similitud - a.similitud);

    return res.json({
      marca: denominacion,
      clase,
      alcance: req.query.ampliada ? 'las 45 clases (ampliada)' : 'clase idéntica + afines',
      fecha: fecha.toLocaleDateString('es-AR'),
      actasEnLaFecha: total,
      actasCotejables: total - sinDenominacion,
      comparaciones: r.comparaciones,
      coincidencias: ordenadas.length,
      porMotivo: {
        afinidad: ordenadas.filter((c) => c.motivo === 'afinidad').length,
        cuasiIdentidad: ordenadas.filter((c) => c.motivo === 'cuasi-identidad').length,
      },
      resultados: ordenadas.slice(0, 50),
      hayMas: ordenadas.length > 50 ? ordenadas.length - 50 : 0,
      advertencias,
      aviso:
        'Prueba en seco: no se creó ninguna oposición ni alerta. Los umbrales de ' +
        'confundibilidad NO están calibrados todavía — esta lista es un borrador.',
      latenciaMs: Date.now() - inicio,
    });
  } catch (err: any) {
    logger.error(`[Vigilancia] Falló la prueba: ${err.message}`);
    return res.status(502).json({ error: 'No se pudo cruzar', detalle: err.message });
  }
});

// ── GET /api/boletin/vigilancia/cruzar ───────────────────────────────────────
//
// El cruce real: todas las marcas con vigilancia activa contra las actas de la
// fecha. Tampoco escribe nada todavía — devuelve lo que encontraría.
router.get('/vigilancia/cruzar', async (req, res: Response) => {
  if (!exigirToken(req, res)) return;

  try {
    const fecha = req.query.fecha ? new Date(String(req.query.fecha)) : ultimoMiercoles();
    if (isNaN(fecha.getTime())) {
      return res.status(400).json({ error: 'Fecha inválida. Formato: ?fecha=2026-09-23' });
    }

    const r = await cruzarBoletin(fecha);
    const solicitudes = agruparPorActa(r.coincidencias);

    return res.json({
      ...r,
      fecha: r.fecha.toLocaleDateString('es-AR'),
      // Lo que hay que mirar: una entrada por solicitud del Boletín, con las
      // marcas y clases propias que la detectaron.
      solicitudesADetectar: solicitudes.length,
      solicitudes,
      // Los pares sueltos quedan disponibles pero fuera del camino: sirven
      // para auditar el cotejo, no para decidir.
      totalCoincidencias: r.coincidencias.length,
      coincidencias: r.coincidencias.slice(0, 100),
      aviso:
        'No se creó ninguna oposición ni alerta: esto muestra lo que el motor encontraría. ' +
        `${r.coincidencias.length} pares marca-clase corresponden a ${solicitudes.length} ` +
        'solicitudes distintas. Los umbrales todavía no están calibrados.',
    });
  } catch (err: any) {
    logger.error(`[Vigilancia] Falló el cruce: ${err.message}`);
    return res.status(502).json({ error: 'No se pudo cruzar', detalle: err.message });
  }
});

// ── GET /api/boletin/vigilancia/escribir ─────────────────────────────────────
//
// La vigilancia COMPLETA: cruza y además deja cada coincidencia registrada
// como oposición PENDIENTE con su alerta.
//
// A diferencia de `/vigilancia/cruzar`, esta ruta **escribe**. Por eso el
// modo seco es el predeterminado y hay que pedir explícitamente que escriba.
//
//   (sin parámetros)   → SECO: calcula y muestra qué crearía, sin tocar nada
//   ?escribir=1        → escribe de verdad
//   ?limite=1          → corta después de N oposiciones creadas
//   ?fecha=2026-09-23  → otra fecha
//
// El límite además impide que se marquen las entradas como procesadas: si se
// cortó a la tercera coincidencia, quedaron actas sin revisar y darlas por
// vistas sería perder la vigilancia de esa fecha en silencio.
router.get('/vigilancia/escribir', async (req, res: Response) => {
  if (!exigirToken(req, res)) return;

  try {
    const fecha = req.query.fecha ? new Date(String(req.query.fecha)) : ultimoMiercoles();
    if (isNaN(fecha.getTime())) {
      return res.status(400).json({ error: 'Fecha inválida. Formato: ?fecha=2026-09-23' });
    }

    const limiteCrudo = req.query.limite ? Number(req.query.limite) : undefined;
    if (limiteCrudo !== undefined && (!Number.isInteger(limiteCrudo) || limiteCrudo < 1)) {
      return res.status(400).json({ error: 'El límite tiene que ser un entero de 1 para arriba.' });
    }

    const seco = !req.query.escribir;
    const r = await boletinService.procesarVigilancia(fecha, { seco, limite: limiteCrudo });

    return res.json({
      fecha: fecha.toLocaleDateString('es-AR'),
      ...r,
      aviso: seco
        ? 'MODO SECO: no se creó ni se modificó nada. `detalle` es lo que se crearía. ' +
          'Para escribir de verdad, agregá &escribir=1 a la URL.'
        : 'Se escribió en la base. Las oposiciones quedan en estado PENDIENTE: ' +
          'ninguna se presentó ante el INPI, eso sigue siendo un acto del matriculado.',
    });
  } catch (err: any) {
    logger.error(`[Vigilancia] Falló al escribir: ${err.message}`);
    return res.status(502).json({ error: 'No se pudo procesar', detalle: err.message });
  }
});

// ── GET /api/boletin/vigilancia/panel ────────────────────────────────────────
//
// La pantalla. Lo mismo que devuelve `/vigilancia/cruzar`, pero legible.
//
// Existe porque el JSON crudo deja de ser leíble apenas hay más de tres
// coincidencias, y lo que importa acá es un dato que se lee de un vistazo o no
// se lee: cuántos días quedan para oponerse. También es el esqueleto de lo que
// va a ver el cliente, así que conviene que exista temprano.
router.get('/vigilancia/panel', (req, res: Response) => {
  if (!exigirToken(req, res)) return;
  const token = encodeURIComponent(String(req.query.token));

  // ⚠️ SIN ESTO LA PANTALLA NO FUNCIONA Y NO AVISA.
  //
  // `app.use(helmet())` manda `Content-Security-Policy: script-src 'self'`,
  // que bloquea TODO script inline. El navegador no muestra ningún error a la
  // vista: la página carga, se ve bien, y el botón simplemente no hace nada.
  //
  // La salida es un nonce por respuesta: el navegador ejecuta sólo el script
  // que lo lleva. Queda más cerrado que el default de helmet, porque acá
  // `default-src` es 'none' y lo único que se permite es este script, este
  // estilo y las llamadas al propio backend.
  const nonce = crypto.randomBytes(16).toString('base64');
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; ` +
      `connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'`
  );
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vigilancia del Boletín</title>
<style nonce="${nonce}">
  :root { --tinta:#1a1a1a; --suave:#666; --linea:#e2e2e2; --marca:#1a3a6b;
          --alerta:#b3261e; --ambar:#c77700; --fondo:#fafbfc }
  * { box-sizing:border-box }
  body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;
         max-width:1000px; margin:0 auto; padding:28px 20px 80px;
         color:var(--tinta); line-height:1.5 }
  h1 { font-size:22px; margin:0 0 4px }
  .sub { color:var(--suave); font-size:14px; margin-bottom:22px }
  .fila { display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin:14px 0 }
  button { background:var(--marca); color:#fff; border:0; padding:11px 22px;
           border-radius:6px; font-size:15px; cursor:pointer }
  button.secundario { background:#fff; color:var(--marca); border:1px solid var(--marca) }
  button:disabled { opacity:.5; cursor:default }
  input[type=date] { padding:9px; border:1px solid var(--linea); border-radius:6px; font-size:14px }
  label, .estado { font-size:14px; color:var(--suave) }

  .plazo { border:1px solid var(--linea); border-left:4px solid var(--marca);
           border-radius:0 8px 8px 0; padding:14px 18px; margin:20px 0 }
  .plazo.apura { border-left-color:var(--alerta); background:#fff5f5 }
  .plazo b { font-size:19px }
  .plazo .dias { font-size:13px; color:var(--suave) }

  .resumen { display:flex; gap:26px; flex-wrap:wrap; margin:20px 0; padding:14px 0;
             border-top:1px solid var(--linea); border-bottom:1px solid var(--linea) }
  .dato b { display:block; font-size:21px; font-weight:600 }
  .dato span { font-size:12px; color:var(--suave) }

  .sol { border:1px solid var(--linea); border-radius:8px; padding:16px 18px; margin:14px 0 }
  .sol:hover { background:var(--fondo) }
  .sol h2 { font-size:17px; margin:0 0 2px; font-weight:600 }
  .sol .meta { font-size:13px; color:var(--suave); margin-bottom:12px }
  .pct { float:right; font-weight:600; font-size:17px }
  .pct.alto { color:var(--alerta) }

  .mia { border-top:1px solid var(--linea); padding:10px 0 2px; font-size:13px }
  .mia:first-of-type { border-top:0 }
  .mia .den { font-weight:600 }
  .chip { display:inline-block; background:#eceef1; padding:1px 8px;
          border-radius:10px; font-size:11px; margin-left:4px }
  .porque { color:var(--suave); font-size:12px; margin-top:3px }

  .aviso { background:#fff8e1; border-left:3px solid var(--ambar); padding:12px 16px;
           font-size:13px; border-radius:0 6px 6px 0; margin:16px 0 }
  .vacio { color:var(--suave); padding:28px 0; text-align:center }
  .pie { margin-top:34px; padding-top:16px; border-top:1px solid var(--linea);
         font-size:12px; color:var(--suave) }
</style></head><body>

<h1>Vigilancia del Boletín</h1>
<div class="sub">Toda la cartera contra las actas publicadas. Leer no escribe nada.</div>

<div class="fila">
  <button id="btn">Revisar</button>
  <label>Boletín del:</label>
  <input type="date" id="fecha">
  <span id="estado" class="estado"></span>
</div>

<div id="salida"></div>

<script nonce="${nonce}">
const TOKEN = ${JSON.stringify(token)};
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

$('btn').onclick = async () => {
  $('btn').disabled = true;
  $('estado').textContent = 'Revisando…';
  $('salida').innerHTML = '';
  try {
    const qs = '?token=' + TOKEN + ($('fecha').value ? '&fecha=' + $('fecha').value : '');
    const r = await fetch('/api/boletin/vigilancia/cruzar' + qs);
    const d = await r.json();
    if (!r.ok) throw new Error(d.detalle || d.error || 'Error ' + r.status);
    pintar(d);
    $('estado').textContent = d.milisegundos + ' ms';
  } catch (e) {
    $('salida').innerHTML = '<div class="aviso"><b>No se pudo revisar.</b><br>' + esc(e.message) + '</div>';
    $('estado').textContent = '';
  } finally {
    $('btn').disabled = false;
  }
};

function pintar(d) {
  let h = '';

  // El plazo primero y grande: es el único dato que, si no se ve, cuesta caro.
  const apura = d.diasRestantes <= 10;
  h += '<div class="plazo' + (apura ? ' apura' : '') + '">' +
       '<b>Vence el ' + esc(d.vencimiento) + '</b>' +
       '<div class="dias">' + d.diasRestantes + ' días corridos · boletín del ' +
       esc(d.fecha) + '</div></div>';

  h += '<div class="resumen">' +
    dato(d.solicitudesADetectar, 'solicitudes a revisar') +
    dato(d.marcasVigiladas, 'marcas vigiladas') +
    dato(d.entradasRevisadas, 'actas publicadas') +
    dato(d.comparaciones.toLocaleString('es-AR'), 'comparaciones') +
    '</div>';

  for (const a of (d.advertencias || [])) {
    h += '<div class="aviso">' + esc(a) + '</div>';
  }

  if (!d.solicitudes || d.solicitudes.length === 0) {
    h += '<div class="vacio">Ninguna solicitud de este boletín se parece a las marcas vigiladas.</div>';
  } else {
    for (const s of d.solicitudes) h += tarjeta(s);
  }

  h += '<div class="pie">Nada de esto se guardó: la pantalla sólo lee. ' +
       'Los umbrales de confundibilidad todavía no están calibrados, así que ' +
       'conviene leer el fundamento de cada coincidencia y no sólo el porcentaje.</div>';

  $('salida').innerHTML = h;
}

function dato(valor, etiqueta) {
  return '<div class="dato"><b>' + esc(valor) + '</b><span>' + esc(etiqueta) + '</span></div>';
}

function tarjeta(s) {
  let h = '<div class="sol">';
  h += '<span class="pct' + (s.similitudMaxima >= 80 ? ' alto' : '') + '">' +
       s.similitudMaxima + '%</span>';
  h += '<h2>' + esc(s.denominacion) + '</h2>';
  h += '<div class="meta">Acta ' + esc(s.acta) + ' · clase ' + s.clase +
       ' · ' + esc(s.titular) + '</div>';

  for (const m of s.marcasAfectadas) {
    const clases = m.clases.length === 1
      ? 'clase ' + m.clases[0]
      : 'clases ' + m.clases.join(', ');
    h += '<div class="mia">' +
         '<span class="den">' + esc(m.denominacion) + '</span>' +
         '<span class="chip">' + esc(clases) + '</span>' +
         '<span class="chip">' + m.similitudMaxima + '%</span>' +
         (m.ejeQueDisparo ? '<span class="chip">eje ' + esc(m.ejeQueDisparo) + '</span>' : '') +
         '<div class="porque">' + esc(m.explicacion) + '</div>' +
         '</div>';
  }
  return h + '</div>';
}
</script>
</body></html>`);
});

// ── GET /api/boletin/mixtas/probar ───────────────────────────────────────────
//
// LA PREGUNTA QUE DECIDE TODO EL BLOQUE DE LAS MIXTAS.
//
// El 52 % de las actas del Boletín no traen denominación: son mixtas y
// figurativas, y el (54) viene vacío porque el nombre está dentro del logo. Las
// mixtas SÍ tienen denominación y el plan es recuperarla entrando por el
// titular, que el Boletín publica para el 100 % de las actas:
//
//   ConsultaCuitOTitular(titular) → todas las marcas de ese titular, con Acta
//   y Denominación → se empareja por número de acta.
//
// ⚠️ Hay un supuesto sin verificar, y si es falso el camino entero no sirve:
//    el WS viene filtrado como «solo vigentes» —replica el filtro del portal;
//    medido con NIKE: 616 sin filtro, 202 con filtro, y el WS devuelve 202—.
//    **No se sabe si una solicitud recién publicada, todavía en trámite, entra
//    en ese filtro.** Y es exactamente lo que necesitamos: el Boletín de
//    marcas nuevas son, por definición, solicitudes en trámite.
//
// Esta ruta lo contesta con datos, no con suposiciones: toma actas reales sin
// denominación de una fecha, consulta el WS por el titular de cada una, y
// dice si el acta aparece y con qué denominación.
//
// Si la tasa de recuperación es alta, se programa este camino. Si es cero, el
// filtro deja afuera lo que buscamos y hay que ir por el portal, que sí
// consulta por número de acta.
//
//   ?fecha=2026-09-23   otra fecha (por defecto, el último miércoles)
//   ?limite=10          cuántas actas probar (por defecto 10, máximo 50)
router.get('/mixtas/probar', async (req, res: Response) => {
  if (!exigirToken(req, res)) return;

  const t0 = Date.now();
  try {
    const fecha = req.query.fecha ? new Date(String(req.query.fecha)) : ultimoMiercoles();
    if (isNaN(fecha.getTime())) {
      return res.status(400).json({ error: 'Fecha inválida. Formato: ?fecha=2026-09-23' });
    }
    const limite = Math.min(Number(req.query.limite) || 10, 50);

    // Actas sin denominación de esa fecha: las que hoy no se cotejan.
    const sinDenominacion = await prisma.boletinEntrada.findMany({
      where: { fechaBoletin: fecha, denominacion: null },
      select: { acta: true, claseNiza: true, titularNombre: true, tipoInid: true },
      take: limite,
    });

    if (sinDenominacion.length === 0) {
      return res.status(404).json({
        error: `No hay actas sin denominación para el ${fecha.toLocaleDateString('es-AR')}.`,
        pista: 'Puede que la fecha no tenga boletín cargado. Probá con ?fecha=2026-09-23.',
      });
    }

    // Una consulta por titular, no por acta: varias actas comparten titular.
    const porTitular = new Map<string, typeof sinDenominacion>();
    for (const e of sinDenominacion) {
      const t = (e.titularNombre || '').trim();
      if (!t || t === 'No informado') continue;
      const g = porTitular.get(t) || [];
      g.push(e);
      porTitular.set(t, g);
    }

    const resultados: {
      acta: string;
      tipo: string | null;
      clase: number;
      titular: string;
      cotitulares: number;
      consultadoComo?: string;
      titularDevolvioMarcas: number;
      encontrada: boolean;
      denominacion?: string;
      estadoEnElWS?: string;
    }[] = [];

    for (const [titular, actas] of porTitular) {
      // El Boletín junta los cotitulares en una línea separados por asterisco:
      //   PERON IGNACIO * PERON TOMAS * PERON JOAQUIN
      // El padrón del INPI los tiene por separado, y el WS busca "empieza con",
      // así que esa línea entera no encuentra a nadie y devuelve cero — medido
      // el 28/09: las 3 únicas actas que fallaron de 10 eran las 3 de
      // cotitularidad, y las 7 con titular único acertaron todas.
      //
      // Se prueba cotitular por cotitular hasta dar con el acta. Un acta en
      // cotitularidad figura bajo cada uno de sus titulares, así que alcanza
      // con que uno matchee.
      const variantes = titular.split('*').map((v) => v.trim()).filter(Boolean);
      const soloDigitos = (s: string) => String(s || '').replace(/\D/g, '');

      for (const e of actas) {
        let encontrada: (typeof resultados)[number] | undefined;
        let ultimoTotal = 0;
        let fallo = '';
        let usada = '';

        for (const v of variantes) {
          let delTitular: Awaited<ReturnType<typeof buscarPorTitularWS>> = [];
          try {
            delTitular = await buscarPorTitularWS(v);
          } catch (err: any) {
            fallo = err.message;
            continue;
          }
          ultimoTotal = delTitular.length;
          usada = v;
          const m = delTitular.find((x) => soloDigitos(x.acta) === soloDigitos(e.acta));
          if (m) {
            encontrada = {
              acta: e.acta,
              tipo: e.tipoInid,
              clase: e.claseNiza,
              titular,
              cotitulares: variantes.length,
              consultadoComo: v,
              titularDevolvioMarcas: delTitular.length,
              encontrada: true,
              denominacion: m.denominacion,
              estadoEnElWS: m.estado,
            };
            break;
          }
        }

        resultados.push(
          encontrada || {
            acta: e.acta,
            tipo: e.tipoInid,
            clase: e.claseNiza,
            titular,
            cotitulares: variantes.length,
            consultadoComo: usada || undefined,
            titularDevolvioMarcas: ultimoTotal,
            encontrada: false,
            estadoEnElWS: fallo ? `ERROR: ${fallo}` : undefined,
          }
        );
      }
    }

    const encontradas = resultados.filter((r) => r.encontrada).length;
    const tasa = resultados.length ? Math.round((encontradas / resultados.length) * 100) : 0;

    // La comparación que importa: el arreglo del asterisco sólo sirve si sube
    // la tasa de las actas en cotitularidad, que son las que fallaban.
    const unico = resultados.filter((r) => r.cotitulares === 1);
    const varios = resultados.filter((r) => r.cotitulares > 1);
    const pct = (g: typeof resultados) =>
      g.length ? `${Math.round((g.filter((r) => r.encontrada).length / g.length) * 100)} %` : '—';

    return res.json({
      fecha: fecha.toLocaleDateString('es-AR'),
      actasProbadas: resultados.length,
      titularesConsultados: porTitular.size,
      denominacionesRecuperadas: encontradas,
      tasaDeRecuperacion: `${tasa} %`,
      porTipoDeTitular: {
        titularUnico: `${pct(unico)} (${unico.filter((r) => r.encontrada).length}/${unico.length})`,
        enCotitularidad: `${pct(varios)} (${varios.filter((r) => r.encontrada).length}/${varios.length})`,
      },
      veredicto:
        tasa >= 70
          ? '✅ El filtro de vigentes NO deja afuera las solicitudes en trámite. ' +
            'El camino por titular sirve: se programa este.'
          : tasa === 0
            ? '❌ El WS no devuelve ninguna de estas actas. El filtro de vigentes deja ' +
              'afuera las solicitudes en trámite y este camino NO sirve. Hay que ir por ' +
              'el portal, que consulta por número de acta.'
            : '⚠️ Recuperación parcial. Hay que mirar fila por fila qué distingue a las ' +
              'que aparecen de las que no antes de decidir.',
      resultados,
      milisegundos: Date.now() - t0,
    });
  } catch (err: any) {
    logger.error(`[Mixtas] Falló la prueba: ${err.message}`);
    return res.status(502).json({ error: 'No se pudo consultar', detalle: err.message });
  }
});

// ── GET /api/boletin/mixtas/recuperar ────────────────────────────────────────
//
// Recupera y GUARDA la denominación de las actas que no la traen. Es el paso
// que sube la cobertura de la vigilancia del 47 % al 93 %.
//
// Va por tandas porque una semana son ~1.100 titulares distintos y el proxy de
// Railway corta las respuestas largas. Cada llamada procesa un tope y devuelve
// `pendientesQueQuedan`: se llama de nuevo hasta que dé 0. Es reanudable: sólo
// mira las actas que siguen sin denominación, así que nada se pide dos veces.
//
//   (sin parámetros)   → SECO: consulta y no guarda nada
//   ?guardar=1         → guarda de verdad
//   ?titulares=100     → cuántos titulares por tanda (por defecto 100, máx 300)
//   ?fecha=2026-09-23  → otra fecha
router.get('/mixtas/recuperar', async (req, res: Response) => {
  if (!exigirToken(req, res)) return;

  try {
    const fecha = req.query.fecha ? new Date(String(req.query.fecha)) : ultimoMiercoles();
    if (isNaN(fecha.getTime())) {
      return res.status(400).json({ error: 'Fecha inválida. Formato: ?fecha=2026-09-23' });
    }
    const limiteTitulares = Math.min(Number(req.query.titulares) || 100, 300);
    const seco = !req.query.guardar;

    const r = await recuperarDenominacionesMixtas(fecha, { limiteTitulares, seco });

    return res.json({
      ...r,
      fecha: r.fecha.toLocaleDateString('es-AR'),
      // Las que el WS devolvió sin denominación no son un fallo: son
      // figurativas puras, donde la marca ES el dibujo.
      figurativasSinTexto: r.sinDenominacionEnElWS.length,
      sinDenominacionEnElWS: r.sinDenominacionEnElWS.slice(0, 20),
      noEncontradas: r.noEncontradas.slice(0, 20),
      aviso: seco
        ? 'MODO SECO: se consultó al INPI pero NO se guardó nada. ' +
          'Para guardar, agregá &guardar=1 a la URL.'
        : r.pendientesQueQuedan > 0
          ? `Guardado. Quedan ~${r.pendientesQueQuedan} titulares: volvé a llamar la ` +
            'misma URL hasta que pendientesQueQuedan sea 0.'
          : 'Guardado. No quedan titulares pendientes para esta fecha.',
    });
  } catch (err: any) {
    logger.error(`[Mixtas] Falló la recuperación: ${err.message}`);
    return res.status(502).json({ error: 'No se pudo recuperar', detalle: err.message });
  }
});

// ── GET /api/boletin/logo/probar ─────────────────────────────────────────────
//
// ¿Se puede traer el logo de una marca desde el INPI, sabiendo sólo el acta?
//
// De esa respuesta depende quién hace un trabajo: si se puede, el sistema baja
// los 290 logos de la cartera solo; si no, hay que buscarlos a mano uno por uno.
// No lo sabemos, y no conviene suponerlo: esta ruta lo averigua probando las
// vías posibles y reportando lo que devuelve cada una, sin interpretar.
//
// Cuando alguna vía entrega bytes de imagen, además se le calcula la huella
// visual, porque eso prueba el camino entero —traer, reconocer, medir— y no
// sólo que el servidor contestó algo.
//
//   ?acta=3606253   el acta a probar (por defecto, una mixta de la cartera)
router.get('/logo/probar', async (req, res: Response) => {
  if (!exigirToken(req, res)) return;

  const acta = String(req.query.acta || '3606253').replace(/\D/g, '');
  if (!acta) return res.status(400).json({ error: 'Falta el número de acta. Ej: ?acta=3606253' });

  const { default: axios } = await import('axios');
  const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  type Intento = {
    via: string;
    url: string;
    estado: number | string;
    tipoDeContenido?: string;
    bytes?: number;
    /** Qué se encontró adentro, descrito en palabras. */
    hallazgo: string;
    /** Sólo si se obtuvo una imagen de verdad. */
    huella?: { hash: string; proporcion: number };
    /** Recorte de la respuesta, para poder mirar qué vino. */
    muestra?: string;
  };

  const intentos: Intento[] = [];

  /** Busca cualquier rastro de imagen en una respuesta JSON o HTML. */
  const rastrosDeImagen = (texto: string): string => {
    const rastros: string[] = [];
    if (/data:image\/[a-z]+;base64,/i.test(texto)) rastros.push('imagen embebida en base64');
    const imgs = texto.match(/<img[^>]+src=["']([^"']+)["']/gi) || [];
    if (imgs.length) rastros.push(`${imgs.length} etiqueta(s) <img>`);
    const campos = (texto.match(/"[^"]*(imagen|image|logo|foto|adjunto)[^"]*"\s*:/gi) || [])
      .map((c) => c.replace(/["\s:]/g, ''));
    if (campos.length) rastros.push(`campos JSON: ${[...new Set(campos)].join(', ')}`);
    return rastros.length ? rastros.join(' · ') : 'ningún rastro de imagen';
  };

  const probar = async (via: string, url: string, opciones: any = {}) => {
    try {
      const r = await axios.get(url, {
        timeout: 20_000,
        headers: { 'User-Agent': UA, 'Accept-Language': 'es-AR,es;q=0.9', ...(opciones.headers || {}) },
        responseType: opciones.responseType || 'text',
        validateStatus: () => true,
        maxRedirects: 5,
      });

      const tipo = String(r.headers['content-type'] || '');
      const intento: Intento = {
        via,
        url,
        estado: r.status,
        tipoDeContenido: tipo,
        hallazgo: '',
      };

      if (opciones.responseType === 'arraybuffer') {
        const buf = Buffer.from(r.data);
        intento.bytes = buf.length;
        if (r.status === 200 && /^image\//.test(tipo) && buf.length > 500) {
          intento.hallazgo = '✅ devolvió una imagen';
          try {
            const h = await calcularHuella(buf);
            intento.huella = { hash: h.hash, proporcion: h.proporcion };
          } catch (e: any) {
            intento.hallazgo += ` (pero no se pudo leer: ${e.message})`;
          }
        } else {
          intento.hallazgo = `no es una imagen (${tipo || 'sin tipo'})`;
        }
      } else {
        const texto = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
        intento.bytes = texto.length;
        intento.hallazgo = r.status === 200 ? rastrosDeImagen(texto) : `HTTP ${r.status}`;
        intento.muestra = texto.slice(0, 400);
      }

      intentos.push(intento);
    } catch (err: any) {
      intentos.push({ via, url, estado: 'ERROR', hallazgo: err.message });
    }
  };

  // ── Vía 1 · las dos APIs públicas de consulta por acta ────────────────────
  // Ya se usan para el estado del trámite. La pregunta es si el JSON trae
  // además la imagen o una URL a ella.
  await probar('API pública inpi.gob.ar', `https://www.inpi.gob.ar/rest/consulta/marcas/${acta}`);
  await probar('API portaltramitesline', `https://portaltramitesline.inpi.gob.ar/api/consulta/${acta}`);

  // ── Vía 2 · el detalle del portal ─────────────────────────────────────────
  // En la grilla de resultados cada fila tiene un botón «+» que despliega el
  // detalle. Si el logo se muestra ahí, tiene que salir de alguna de estas.
  const BASE = 'https://portaltramites.inpi.gob.ar';
  await probar('Portal · Resultado', `${BASE}/MarcasConsultas/Resultado?acta=${acta}`);
  await probar('Portal · DetalleMarca', `${BASE}/MarcasConsultas/DetalleMarca?acta=${acta}`);
  await probar('Portal · imagen directa', `${BASE}/MarcasConsultas/Imagen?acta=${acta}`, {
    responseType: 'arraybuffer',
  });
  await probar('Portal · ImagenMarca', `${BASE}/MarcasConsultas/ImagenMarca/${acta}`, {
    responseType: 'arraybuffer',
  });

  const conImagen = intentos.filter((i) => i.huella);
  const conRastro = intentos.filter((i) => /imagen|<img/i.test(i.hallazgo) && !i.huella);

  return res.json({
    acta,
    veredicto: conImagen.length
      ? `✅ SE PUEDE: ${conImagen.length} vía(s) devolvieron la imagen y se le calculó la huella. ` +
        'Los 290 logos de la cartera se bajan solos.'
      : conRastro.length
        ? '🔎 HAY RASTRO pero no la imagen todavía: alguna respuesta menciona imágenes. ' +
          'Mirá `muestra` de esas vías: probablemente haya una URL que falta seguir.'
        : '❌ NINGUNA de las vías probadas devolvió el logo. Habría que mirar el portal ' +
          'a mano con las herramientas de desarrollador, o buscarlos manualmente.',
    intentos,
  });
});

// ── Denominación y elemento figurativo ───────────────────────────────────────
//
// Las marcas importadas del export de Damlong traen el paréntesis pegado al
// nombre: «NAHANA (CASA)». NO es basura, y por poco lo tratamos como tal.
//
// Damlong exige cargar así las mixtas y las figurativas: el paréntesis
// describe el DIBUJO. «NAHANA (CASA)» es la denominación NAHANA acompañada de
// un dibujo de una casa. Es una descripción del elemento figurativo escrita
// por el propio agente, marca por marca, a lo largo de años.
//
// Eso vale mucho más de lo que parece. Es exactamente el dato que hace falta
// para clasificar por Viena, y lo tenemos ya escrito y sin costo: una casa es
// 07.01, y no hizo falta mirar la imagen ni pagarle a un clasificador por
// visión artificial para saberlo. También sirve para verificar la
// clasificación automática cuando exista: si el modelo dice «flor» donde el
// agente escribió «casa», hay algo mal y conviene mirarlo.
//
// Por eso se separa en dos, en lugar de descartarse:
//
//   denominacion       → el signo denominativo, limpio, que es lo que se
//                        coteja fonética y gráficamente contra el Boletín
//   elementoFigurativo → la descripción del dibujo, que alimenta Viena y el
//                        cotejo ideológico
//
// Dejar el paréntesis dentro de la denominación arruina el cotejo: los ejes
// fonético y gráfico se calculan sobre la cadena entera, y siete caracteres
// que ninguna solicitud del Boletín va a tener bajan el puntaje de todas las
// comparaciones de esa marca. Lo que se pierde ahí es una oposición, con el
// plazo perentorio del art. 15 corriendo igual.
//
// Se separa sólo lo que está entre paréntesis o corchetes. No se tocan
// guiones, apóstrofos, acentos ni `&`: esos sí aparecen en marcas de verdad.
export function partirDenominacion(d: string): {
  denominacion: string;
  elementoFigurativo: string;
} {
  const anotaciones = (d.match(/[([][^)\]]*[)\]]/g) || [])
    .map((a) => a.replace(/^[([]|[)\]]$/g, '').trim())
    .filter(Boolean);

  return {
    denominacion: d.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim(),
    elementoFigurativo: anotaciones.join(' · '),
  };
}

/** Sólo el signo denominativo, sin la descripción del dibujo. */
export function denominacionLimpia(d: string): string {
  return partirDenominacion(d).denominacion;
}

// ── GET /api/boletin/cartera/denominaciones ──────────────────────────────────
//
// Cuántas marcas de la cartera traen el dibujo anotado entre paréntesis, qué
// dibujos son y con qué frecuencia aparece cada uno.
//
// Dos cosas se miden acá, y las dos hacen falta antes de tocar un solo dato:
//
//   · Cuánto cotejo está degradado hoy. Cada marca con el paréntesis adentro
//     de la denominación se está vigilando peor que las demás.
//
//   · Qué hay en el catálogo de dibujos. Si se repiten quince o veinte
//     descripciones, mapearlas a Viena es un rato de trabajo y queda hecho
//     para siempre. Si hay cuatrocientas distintas, es otro problema.
//
// Se cruza con el tipo de marca porque ahí aparecen las anomalías: una
// DENOMINATIVA con dibujo anotado está mal tipificada —o mal cargada— y una
// FIGURATIVA sin nada entre paréntesis no tiene ningún dato de su dibujo.
//
//   ?muestra=40   cuántos ejemplos devolver (por defecto 30)
router.get('/cartera/denominaciones', async (req, res: Response) => {
  if (!exigirToken(req, res)) return;

  const cuantos = Math.min(Math.max(parseInt(String(req.query.muestra || '30')) || 30, 1), 300);

  const marcas = await prisma.marca.findMany({
    select: { acta: true, denominacion: true, claseNiza: true, tipoMarca: true, titularNombre: true },
    orderBy: { denominacion: 'asc' },
  });

  // `original` se guarda aparte porque el spread pisa `denominacion` con la
  // versión limpia, y para poder mostrar el antes y el después hacen falta las dos.
  const partidas = marcas.map((m) => ({
    ...m,
    original: m.denominacion,
    ...partirDenominacion(m.denominacion),
  }));
  const conDibujo = partidas.filter((m) => m.elementoFigurativo !== '');

  // Catálogo de dibujos: la materia prima para la tabla de Viena.
  const catalogo = new Map<string, number>();
  for (const m of conDibujo) {
    for (const parte of m.elementoFigurativo.split(' · ')) {
      const clave = parte.toUpperCase();
      catalogo.set(clave, (catalogo.get(clave) || 0) + 1);
    }
  }
  const ranking = [...catalogo.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([dibujo, veces]) => ({ dibujo, veces }));

  const contarPorTipo = (lista: typeof partidas) => {
    const t: Record<string, number> = {};
    for (const m of lista) t[String(m.tipoMarca)] = (t[String(m.tipoMarca)] || 0) + 1;
    return t;
  };

  // Figurativas puras: el paréntesis es TODO lo que hay, porque no hay
  // denominación que proteger. Es lo correcto, no un error: esas marcas se
  // cotejan sólo por dibujo y no tienen eje fonético.
  const sinDenominacion = conDibujo.filter((m) => m.denominacion.length < 2);

  // Anomalías: tipo y contenido no concuerdan.
  const denominativasConDibujo = conDibujo.filter((m) => String(m.tipoMarca) === 'DENOMINATIVA');
  const figurativasSinDibujo = partidas.filter(
    (m) => ['FIGURATIVA', 'MIXTA'].includes(String(m.tipoMarca)) && m.elementoFigurativo === '',
  );

  return res.json({
    total: marcas.length,

    conDibujoAnotado: {
      cantidad: conDibujo.length,
      porcentaje: marcas.length ? `${((conDibujo.length / marcas.length) * 100).toFixed(1)}%` : '0%',
      porTipo: contarPorTipo(conDibujo),
      nota: 'Son las que hoy se cotejan con el paréntesis adentro de la denominación, ' +
            'o sea con el puntaje degradado en los ejes fonético y gráfico.',
    },

    catalogoDeDibujos: {
      distintos: ranking.length,
      nota: 'Insumo directo para la clasificación de Viena, ya escrito por el agente. ' +
            'Si son pocos y repetidos, el mapeo a Viena se hace una vez y queda.',
      top: ranking.slice(0, 60),
    },

    figurativasPuras: {
      cantidad: sinDenominacion.length,
      nota: 'El paréntesis es todo: no hay denominación porque la marca es sólo dibujo. ' +
            'Correcto, no es un error. Se cotejan sólo por imagen, sin eje fonético.',
      porTipo: contarPorTipo(sinDenominacion),
      casos: sinDenominacion.slice(0, 20).map((m) => ({
        acta: m.acta, original: m.denominacion, dibujo: m.elementoFigurativo, tipo: m.tipoMarca,
      })),
    },

    anomalias: {
      nota: 'Tipo y contenido no concuerdan. Conviene mirarlas de a una.',
      denominativasConDibujo: {
        cantidad: denominativasConDibujo.length,
        casos: denominativasConDibujo.slice(0, 15).map((m) => ({
          acta: m.acta, original: m.denominacion, dibujo: m.elementoFigurativo,
        })),
      },
      mixtasOFigurativasSinDibujo: {
        cantidad: figurativasSinDibujo.length,
        casos: figurativasSinDibujo.slice(0, 15).map((m) => ({
          acta: m.acta, denominacion: m.denominacion, tipo: m.tipoMarca,
        })),
      },
    },

    muestra: conDibujo.slice(0, cuantos).map((m) => ({
      acta: m.acta,
      guardadoHoy: m.original,
      denominacionQuedaria: m.denominacion,
      dibujoQuedaria: m.elementoFigurativo,
      clase: m.claseNiza,
      tipo: m.tipoMarca,
      titular: m.titularNombre,
    })),
  });
});

// ── GET /api/boletin/logo/grilla ─────────────────────────────────────────────
//
// ¿Viene el logo en la respuesta de la grilla del portal?
//
// Sabemos que el logo existe como imagen embebida (`data:image/jpg;base64,…`)
// porque se copió una a mano desde el portal: un JPEG de 227×227 en color. Lo
// que no sabemos es en qué respuesta viaja, y sin eso no se puede bajar sola.
//
// Descartado: `MarcasConsultas/Resultado` no contiene ningún `data:image`.
// Queda la fuente que la grilla usa de verdad, el POST a
// `GrillaMarcasAvanzada`, que la app ya usa para buscar antecedentes. Su
// respuesta se parsea campo por campo quedándose con siete y descartando el
// resto en silencio: si la imagen viene ahí, la venimos tirando desde el
// primer día. Por eso esta ruta devuelve el ítem **crudo**.
//
// La grilla no busca por número de acta, así que hay que llegar a la marca por
// su denominación. Y ahí está la trampa que costó la primera corrida: la
// denominación guardada puede estar sucia, la búsqueda vuelve vacía, y una
// búsqueda vacía NO dice nada sobre si la imagen viene o no. Son dos
// respuestas distintas y antes se confundían en un solo veredicto.
//
// Ahora se prueba en cascada, de lo más preciso a lo más amplio, y se informa
// cuál intento encontró la marca:
//
//   1. denominación tal como está, empieza con, en su clase
//   2. denominación limpia, empieza con, en su clase
//   3. denominación limpia, contiene, en su clase
//   4. denominación limpia, contiene, en todas las clases
//   5. igual, incluyendo marcas no vigentes
//
//   ?acta=3606253
router.get('/logo/grilla', async (req, res: Response) => {
  if (!exigirToken(req, res)) return;

  const acta = String(req.query.acta || '').replace(/\D/g, '');
  if (!acta) return res.status(400).json({ error: 'Falta el acta. Ej: ?acta=3606253' });

  const marca = await prisma.marca.findFirst({
    where: { acta },
    select: { denominacion: true, claseNiza: true, tipoMarca: true },
  });
  if (!marca) {
    return res.status(404).json({
      error: `El acta ${acta} no está en la cartera, y la grilla del INPI no busca por acta. ` +
             'Probá con un acta de la cartera.',
    });
  }

  const limpia = denominacionLimpia(marca.denominacion);

  const { default: axios } = await import('axios');
  const BASE = 'https://portaltramites.inpi.gob.ar';
  const BUSQUEDA_URL = `${BASE}/marcasconsultas/busqueda/?Cod_Funcion=NQA0ADEA`;
  const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  // Cookie de sesión ASP.NET: sin ella la grilla contesta vacío.
  let cookies = '';
  try {
    const { headers } = await axios.get(BUSQUEDA_URL, {
      timeout: 15_000,
      headers: { 'User-Agent': UA, Accept: 'text/html' },
    });
    const sc = headers['set-cookie'] || [];
    cookies = (Array.isArray(sc) ? sc : [String(sc)]).map((c) => c.split(';')[0]).join('; ');
  } catch (err: any) {
    return res.status(502).json({ error: `No se pudo abrir sesión en el portal: ${err.message}` });
  }

  const consultar = async (cuerpo: any): Promise<any> => {
    const { data } = await axios.post(`${BASE}/MarcasConsultas/GrillaMarcasAvanzada`, cuerpo, {
      timeout: 25_000,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': UA,
        Referer: BUSQUEDA_URL,
        Origin: BASE,
        ...(cookies ? { Cookie: cookies } : {}),
      },
      maxRedirects: 0,
    });
    return data;
  };

  const base = {
    Tipo_Resolucion: '',
    Titular: '',
    TipoBusquedaTitular: '1',
    Fecha_IngresoDesde: '', Fecha_IngresoHasta: '',
    Fecha_ResolucionDesde: '', Fecha_ResolucionHasta: '',
    limit: 50,
    offset: 0,
  };

  const cascada = [
    { nombre: '1 · tal cual · empieza con · su clase',
      cuerpo: { ...base, Denominacion: marca.denominacion, TipoBusquedaDenominacion: '0', Clase: String(marca.claseNiza), vigentes: true } },
    { nombre: '2 · limpia · empieza con · su clase',
      cuerpo: { ...base, Denominacion: limpia, TipoBusquedaDenominacion: '0', Clase: String(marca.claseNiza), vigentes: true } },
    { nombre: '3 · limpia · contiene · su clase',
      cuerpo: { ...base, Denominacion: limpia, TipoBusquedaDenominacion: '1', Clase: String(marca.claseNiza), vigentes: true } },
    { nombre: '4 · limpia · contiene · todas las clases',
      cuerpo: { ...base, Denominacion: limpia, TipoBusquedaDenominacion: '1', Clase: '', vigentes: true } },
    { nombre: '5 · limpia · contiene · todas · incluyendo no vigentes',
      cuerpo: { ...base, Denominacion: limpia, TipoBusquedaDenominacion: '1', Clase: '', vigentes: false } },
  ];

  const bitacora: { intento: string; filas: number; actaEncontrada: boolean; error?: string }[] = [];
  let item: any = null;
  let intentoGanador = '';
  let ultimaLista: any[] = [];

  for (const paso of cascada) {
    let lista: any[] = [];
    try {
      const data = await consultar(paso.cuerpo);
      lista = Array.isArray(data) ? data : (data?.data ?? data?.marcas ?? data?.rows ?? data?.resultado ?? []);
    } catch (err: any) {
      bitacora.push({ intento: paso.nombre, filas: 0, actaEncontrada: false, error: err.message });
      continue;
    }
    ultimaLista = lista;
    const exacto = lista.find((i) => String(i.Acta ?? i.acta ?? '').replace(/\D/g, '') === acta);
    bitacora.push({ intento: paso.nombre, filas: lista.length, actaEncontrada: Boolean(exacto) });
    if (exacto) { item = exacto; intentoGanador = paso.nombre; break; }
  }

  // Si ningún intento dio con el acta exacta pero alguno trajo filas, sirve
  // igual para la pregunta de fondo: cualquier fila de la grilla alcanza para
  // ver si el objeto trae imagen.
  const itemParaInspeccionar = item ?? ultimaLista[0] ?? null;

  const campoImagen = itemParaInspeccionar
    ? Object.entries(itemParaInspeccionar).find(
        ([, v]) => typeof v === 'string' && /^\s*(data:image\/|\/9j\/|iVBORw0KGgo)/.test(v),
      )
    : undefined;

  let huella: any = null;
  if (campoImagen) {
    try {
      const crudo = String(campoImagen[1]).replace(/^\s*data:image\/[a-z+]+;base64,/i, '').trim();
      huella = await calcularHuella(Buffer.from(crudo, 'base64'));
    } catch (e: any) {
      huella = { error: e.message };
    }
  }

  const legible = (o: any) =>
    o
      ? Object.fromEntries(
          Object.entries(o).map(([k, v]) =>
            typeof v === 'string' && v.length > 120
              ? [k, `«${v.length} caracteres» ${v.slice(0, 60)}…`]
              : [k, v],
          ),
        )
      : null;

  // Tres respuestas distintas, que antes se confundían en una:
  //   · encontró la marca y trae imagen
  //   · encontró la marca y NO trae imagen  → la imagen sale de otra petición
  //   · no encontró nada                    → no se probó nada
  const veredicto = campoImagen
    ? `✅ LA IMAGEN VIENE EN LA GRILLA, en el campo «${campoImagen[0]}». ` +
      'Los logos de la cartera se bajan solos, sin buscar nada a mano.'
    : itemParaInspeccionar
      ? '❌ La grilla SÍ devuelve la marca, pero el objeto no trae ninguna imagen. ' +
        'La imagen sale de otra petición: la del botón «+». Mirá `clavesDelItem`.'
      : '⚠️ NO SE PROBÓ NADA: ningún intento encontró la marca en el portal, así que ' +
        'no hay objeto que inspeccionar. Esto no dice si la grilla trae la imagen o no. ' +
        'Mirá `bitacora` para ver dónde se cortó.';

  return res.json({
    acta,
    veredicto,
    denominacion: {
      guardada: marca.denominacion,
      limpia,
      estabaSucia: limpia !== marca.denominacion,
      clase: marca.claseNiza,
      tipo: marca.tipoMarca,
    },
    intentoGanador: intentoGanador || null,
    actaExacta: Boolean(item),
    bitacora,
    clavesDelItem: itemParaInspeccionar ? Object.keys(itemParaInspeccionar) : [],
    campoImagen: campoImagen
      ? { nombre: campoImagen[0], caracteres: String(campoImagen[1]).length }
      : null,
    huella,
    itemLegible: legible(itemParaInspeccionar),
  });
});

// ── La ficha del INPI ────────────────────────────────────────────────────────
//
// Cómo se pide, que es lo que costó averiguar: NO es un GET con el acta en la
// dirección —eso devuelve la página armada pero vacía, 31 KB de cáscara— sino
// un POST con el acta en el cuerpo, como formulario:
//
//     POST https://portaltramites.inpi.gob.ar/MarcasConsultas/Resultado
//     Content-Type: application/x-www-form-urlencoded
//     acta=4565664
//
// Un solo campo. Y esa página trae, en una sola consulta, todo lo que veníamos
// persiguiendo por separado: el logo embebido en base64, el CUIT del titular,
// el (57) de productos, el número de resolución y la fecha de vencimiento.

/** Entidades HTML, incluidas las numéricas. */
function decodificarEntidades(s: string): string {
  const nombradas: Record<string, string> = {
    nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>',
    aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
    Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
    ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', Uuml: 'Ü', copy: '©', deg: '°',
  };
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-zA-Z]+);/g, (todo, n) => (n in nombradas ? nombradas[n] : todo));
}

/** Sin tildes y en mayúsculas, para reconocer etiquetas sin depender del acento. */
const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

// Todas las etiquetas de la ficha, para saber dónde TERMINA cada campo. Un
// campo llega hasta que empieza el siguiente: sin la lista completa, un campo
// vacío se come el contenido del que le sigue. Así fue como en la primera
// prueba la limitación —que estaba vacía— se tragó entera la titularidad.
const ETIQUETAS_FICHA = [
  'PRESENTACION:', 'DENOMINACION:', 'TIPO DE MARCA:', 'DOMICILO LEGAL:',
  'DOMICILIO LEGAL:', 'RENOVACION DE:', 'RENOVADA POR:', 'NRO DE EFECTOR:',
  'TITULARIDAD', 'CLASE:', 'PROTECCION:', 'LIMITACION:',
  'NOMBRE:', 'TIPO DNI:', 'DNI:', 'GENERO:', 'PAIS:', 'CUIT:',
  'TERRITORIO LEGAL:', 'DOMICILIO REAL:', 'LOCALIDAD:', 'CP.',
  'GESTION DEL TRAMITE', 'AGENTE:', 'CARACTER:', 'REGLAMENTO DE USO',
  'PRIORIDADES', 'PUBLICACION', 'OPOSICIONES', 'OPONENTE',
  'VISTAS Y NOTIFICACIONES', 'CONTESTACION',
  'RESOLUCION:', 'FEC DE PROY:', 'NRO:', 'TIPO:', 'MOTIVO:',
  'NOTIFICACION:', 'BOLETIN:', 'OBSERVACION:', 'DISPOSICION:', 'VENCE:',
  'UBICACION DEL EXPEDIENTE', 'UBICACION ACTUAL:', 'DICTAMENES',
].map(sinTildes);

// Una etiqueta puede ser el final de otra: `DNI:` está dentro de `TIPO DNI:`.
// Buscada a secas, `DNI:` cae sobre la de `TIPO DNI:` y el documento vuelve
// como «1-Documento Nacional de Identidad DNI: 92758680». Por eso se descartan
// las ocurrencias que en realidad son el final de una etiqueta más larga.
function indiceEtiqueta(TRAMO: string, et: string, etiquetas: string[], desde = 0): number {
  const masLargas = etiquetas.filter((o) => o !== et && o.endsWith(et));
  let cursor = desde;
  for (;;) {
    const i = TRAMO.indexOf(et, cursor);
    if (i < 0) return -1;
    const finDeEt = i + et.length;
    const esFinalDeOtra = masLargas.some((larga) => {
      const arranque = finDeEt - larga.length;
      return arranque >= 0 && TRAMO.slice(arranque, finDeEt) === larga;
    });
    if (!esFinalDeOtra) return i;
    cursor = i + 1;
  }
}

// Tope de seguridad por campo. NO es un límite de longitud: es una red por si
// falta una etiqueta en la lista de arriba y un campo se corre hasta el final
// de la página. La primera versión lo puso en 800, y eso cortó el (57) de 72
// marcas de la cartera —el (57) es el ALCANCE DE LA PROTECCIÓN, así que
// truncarlo es perder la parte del registro que dice qué ampara la marca—.
//
// 20.000 tampoco alcanzó. JUNGLE DENIM (acta 3872945) volvió justo en ese
// número, y la cola mostró diez términos del nomenclador en orden alfabético
// terminando en POLAINAS: no es un campo corrido, es una marca que enumera la
// clase 25 entera término por término y a los 20.000 caracteres todavía va por
// la P. El texto completo ronda los 31.000.
//
// De ahí 60.000: holgado para el caso extremo conocido, y la red de verdad no
// es el número sino el informe `enElTope`, que muestra cualquier campo que
// vuelva pegado al límite junto con su cola, para distinguir una lista larga
// de verdad de una etiqueta faltante.
const TOPE_CAMPO = 60_000;

/** Lo que sigue a una etiqueta dentro de un tramo, hasta que empieza otra. */
function campoDe(tramo: string, etiqueta: string, etiquetas = ETIQUETAS_FICHA): string {
  const TRAMO = sinTildes(tramo);
  const et = sinTildes(etiqueta);
  const i = indiceEtiqueta(TRAMO, et, etiquetas);
  if (i < 0) return '';
  const desde = i + et.length;
  let fin = TRAMO.length;
  for (const otra of etiquetas) {
    if (otra === et) continue;
    const j = indiceEtiqueta(TRAMO, otra, etiquetas, desde);
    if (j >= 0 && j < fin) fin = j;
  }
  return tramo.slice(desde, fin).replace(/^[\s:·`-]+|[\s:·`-]+$/g, '').trim().slice(0, TOPE_CAMPO);
}

/**
 * Parte el (57) por `///`.
 *
 * ⚠️ `///` NO significa «acá viene la renuncia». Es un separador de tramos a
 * secas, y el último tramo muchas veces no es una renuncia. La primera versión
 * de esta función suponía lo contrario, y la corrida en seco del 30/09/2026 la
 * desmintió en el acto: SAN FILI, VORKAMPFER y ME EVERYDAY terminan en
 * `///NUEVA`, y guardaban «NUEVA» como si fuera la renuncia de la marca. Peor
 * todavía, NAHANA JEANS tiene renuncia de verdad Y un `///NUEVA` detrás, así
 * que las dos cosas conviven en el mismo campo.
 *
 * Entonces no se corta por posición, se clasifica por contenido:
 *
 *   · el primer tramo son los PRODUCTOS;
 *   · los tramos que dicen RENUNCIA son la renuncia —pueden ser varios—;
 *   · lo demás NO se guarda en ningún lado y se devuelve en `otros`, para
 *     mirarlo. Escribirlo en `renuncia` sería inventarle al registro una
 *     limitación que el titular no aceptó, y eso en un escrito se paga caro.
 *
 * La renuncia dice qué término el titular NO puede reivindicar en exclusiva.
 * Mezclada adentro de `productos` ensucia el cotejo por afinidad —se compara
 * contra palabras que justamente no están monopolizadas— y se pierde de vista
 * en el momento en que hay que citarla.
 */
export function partirRenuncia(texto: string | null | undefined): {
  productos: string | null;
  renuncia: string | null;
  otros: string[];
} {
  if (!texto) return { productos: null, renuncia: null, otros: [] };

  const tramos = texto.split('///').map((s) => s.trim()).filter(Boolean);
  if (!tramos.length) return { productos: null, renuncia: null, otros: [] };

  const productos = tramos.shift() || null;
  const esRenuncia = (s: string) => /RENUNCI/.test(sinTildes(s));

  return {
    productos,
    renuncia: tramos.filter(esRenuncia).join(' /// ') || null,
    otros: tramos.filter((s) => !esRenuncia(s)),
  };
}

export interface TitularINPI {
  nombre: string; porcentaje: string; tipoDocumento: string; documento: string;
  genero: string; pais: string; cuit: string; domicilioReal: string;
  localidad: string; codigoPostal: string;
}

export interface FichaINPI {
  presentacion: string; denominacion: string; tipoMarca: string;
  domicilioLegal: string; renovacionDe: string; renovadaPor: string;
  clase: string; proteccion: string; limitacion: string;
  titulares: TitularINPI[];
  agente: { numero: string; nombre: string; caracter: string };
  resolucion: {
    estado: string; fechaProyecto: string; numero: string; tipo: string;
    motivo: string; notificacion: string; boletin: string; observacion: string;
    disposicion: string; vence: string;
  };
  ubicacionActual: string;
  /** El logo, si la marca tiene. */
  logo: { formato: string; base64: string } | null;
}

export function parsearFichaINPI(html: string): FichaINPI {
  // El logo viaja embebido. Si hay varias imágenes, la del signo es la de más
  // peso: las otras son iconos del sitio. Se decide midiendo, no por posición.
  const embebidas = [...html.matchAll(/data:image\/([a-z+]+);base64,([A-Za-z0-9+/=]+)/gi)]
    .map((m) => ({ formato: m[1], base64: m[2] }))
    .sort((a, b) => b.base64.length - a.base64.length);

  let plano = decodificarEntidades(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ').trim();

  // Sólo el tramo con datos. Más abajo la página trae encabezados de tablas
  // vacías —DICTAMENES, RESERVAS, DEMANDAS— que repiten palabras como CLASE o
  // PRESENTACION y descolocan el reconocimiento.
  const PLANO = sinTildes(plano);
  const ini = PLANO.indexOf('DATOS GENERALES');
  const fin = PLANO.indexOf('DICTAMENES');
  if (ini >= 0) plano = plano.slice(ini, fin > ini ? fin : undefined);

  // ── Titulares ─────────────────────────────────────────────────────────────
  // Pueden ser varios: cada uno empieza con NOMBRE:. Se recorta el tramo de
  // titularidad y se parte ahí, para que un cotitular no quede afuera.
  const P = sinTildes(plano);
  const iNombre = P.indexOf('NOMBRE:');
  const iGestion = P.indexOf('GESTION DEL TRAMITE');
  const tramoTitulares =
    iNombre >= 0 ? plano.slice(iNombre, iGestion > iNombre ? iGestion : undefined) : '';

  const titulares: TitularINPI[] = tramoTitulares
    .split(/(?=NOMBRE:)/i)
    .map((t) => t.trim())
    .filter((t) => sinTildes(t).startsWith('NOMBRE:'))
    .map((t) => {
      const crudo = campoDe(t, 'NOMBRE:');
      const m = crudo.match(/^(.*?)\s*(\d+[.,]\d+)\s*%\s*$/);
      return {
        nombre: (m ? m[1] : crudo).trim(),
        porcentaje: m ? m[2] : '',
        tipoDocumento: campoDe(t, 'TIPO DNI:'),
        documento: campoDe(t, 'DNI:'),
        genero: campoDe(t, 'GENERO:'),
        pais: campoDe(t, 'PAIS:'),
        cuit: campoDe(t, 'CUIT:').replace(/\D/g, ''),
        domicilioReal: campoDe(t, 'DOMICILIO REAL:'),
        localidad: campoDe(t, 'LOCALIDAD:'),
        codigoPostal: campoDe(t, 'CP.'),
      };
    });

  // La limitación termina donde empieza el primer titular, no donde termina la
  // ficha. Por eso se corta el tramo antes de buscarla.
  const tramoGeneral = iNombre >= 0 ? plano.slice(0, iNombre) : plano;

  return {
    presentacion: campoDe(tramoGeneral, 'PRESENTACION:'),
    denominacion: campoDe(tramoGeneral, 'DENOMINACION:'),
    tipoMarca: campoDe(tramoGeneral, 'TIPO DE MARCA:'),
    domicilioLegal: campoDe(tramoGeneral, 'DOMICILO LEGAL:') || campoDe(tramoGeneral, 'DOMICILIO LEGAL:'),
    renovacionDe: campoDe(tramoGeneral, 'RENOVACION DE:').replace(/\D/g, ''),
    renovadaPor: campoDe(tramoGeneral, 'RENOVADA POR:').replace(/\D/g, ''),
    clase: campoDe(tramoGeneral, 'CLASE:'),
    proteccion: campoDe(tramoGeneral, 'PROTECCION:'),
    limitacion: campoDe(tramoGeneral, 'LIMITACION:'),
    titulares,
    agente: {
      numero: (campoDe(plano, 'AGENTE:').match(/^\s*(\d+)/) || ['', ''])[1],
      nombre: campoDe(plano, 'AGENTE:').replace(/^\s*\d+\s*/, '').trim(),
      caracter: campoDe(plano, 'CARACTER:'),
    },
    resolucion: {
      estado: campoDe(plano, 'RESOLUCION:').replace(/[[\]]/g, '').trim(),
      fechaProyecto: campoDe(plano, 'FEC DE PROY:'),
      numero: campoDe(plano, 'NRO:').replace(/\D/g, ''),
      tipo: campoDe(plano, 'TIPO:'),
      motivo: campoDe(plano, 'MOTIVO:'),
      notificacion: campoDe(plano, 'NOTIFICACION:'),
      boletin: campoDe(plano, 'BOLETIN:').replace(/\D/g, ''),
      observacion: campoDe(plano, 'OBSERVACION:'),
      disposicion: campoDe(plano, 'DISPOSICION:'),
      vence: campoDe(plano, 'VENCE:'),
    },
    ubicacionActual: campoDe(plano, 'UBICACION ACTUAL:'),
    logo: embebidas[0] || null,
  };
}

/** Pide la ficha al INPI. Devuelve el HTML crudo. */
export async function pedirFichaINPI(acta: string): Promise<string> {
  const { default: axios } = await import('axios');
  const BASE = 'https://portaltramites.inpi.gob.ar';
  const r = await axios.post(
    `${BASE}/MarcasConsultas/Resultado`,
    new URLSearchParams({ acta }).toString(),
    {
      timeout: 30_000,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'es-AR,es;q=0.9',
        Referer: `${BASE}/marcasconsultas/busqueda/?Cod_Funcion=NQA0ADEA`,
        Origin: BASE,
      },
      maxRedirects: 5,
      validateStatus: () => true,
    },
  );
  if (r.status !== 200) throw new Error(`El portal respondió HTTP ${r.status}`);
  return String(r.data);
}

// ── GET /api/boletin/detalle/probar ──────────────────────────────────────────
//
// Reconocimiento, no carga. Trae la ficha, la parsea y la devuelve entera para
// poder compararla campo por campo contra lo que muestra el portal en pantalla.
//
// Se mantiene separado de la carga masiva a propósito: un parser de HTML ajeno
// que nadie verificó contra el original no falla con un error, guarda el dato
// equivocado y sigue. En la primera corrida de esta ruta la limitación se
// tragó entera la titularidad, y los nombres con acento volvían rotos
// —LEGUIZAM&#211;N— porque no se decodificaban las entidades numéricas. Dos
// errores que, escritos a la base, habrían quedado en 843 filas.
//
//   ?acta=4565664
router.get('/detalle/probar', async (req, res: Response) => {
  if (!exigirToken(req, res)) return;

  const acta = String(req.query.acta || '').replace(/\D/g, '');
  if (!acta) return res.status(400).json({ error: 'Falta el acta. Ej: ?acta=4565664' });

  let html = '';
  try {
    html = await pedirFichaINPI(acta);
  } catch (err: any) {
    return res.status(502).json({ error: `No se pudo pedir la ficha: ${err.message}` });
  }

  const ficha = parsearFichaINPI(html);

  let logo: any = null;
  if (ficha.logo) {
    const bytes = Buffer.from(ficha.logo.base64, 'base64');
    logo = { formato: ficha.logo.formato, bytes: bytes.length };
    try {
      const h = await calcularHuella(bytes);
      logo.huella = { hash: h.hash, proporcion: h.proporcion };
    } catch (e: any) {
      logo.error = e.message;
    }
  }

  const { logo: _descartado, ...resto } = ficha;
  const vacios = Object.entries(resto)
    .filter(([, v]) => v === '' || (Array.isArray(v) && v.length === 0))
    .map(([k]) => k);

  return res.json({
    acta,
    veredicto: logo
      ? `✅ Ficha completa y logo de ${logo.bytes} bytes con huella calculada.`
      : '✅ Ficha completa. Sin logo embebido: puede ser una denominativa, que no tiene.',
    ficha: { ...resto, logo },
    camposVacios: vacios,
    aviso:
      'Compará campo por campo contra el portal antes de la carga masiva. Interesa sobre ' +
      'todo `limitacion` (no debe contener titulares), los nombres con acento (no deben ' +
      'traer &#NNN;) y `titulares` (deben estar TODOS los cotitulares, con su porcentaje).',
  });
});


/** «26/09/2035 0:00:00» → Date. Devuelve null si no se puede leer. */
function fechaArgentina(s: string): Date | null {
  const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const [, d, mes, a, h, min, seg] = m;
  const f = new Date(
    Number(a), Number(mes) - 1, Number(d),
    Number(h || 0), Number(min || 0), Number(seg || 0),
  );
  return isNaN(f.getTime()) ? null : f;
}

// ── GET /api/boletin/cartera/enriquecer ──────────────────────────────────────
//
// Trae la ficha del INPI para las marcas de la cartera y guarda lo que falta:
// el logo con su huella, los titulares con CUIT, los productos, la resolución,
// la disposición y el vencimiento.
//
// EN SECO POR DEFECTO. Sin `&guardar=1` no escribe una sola fila: hace las
// consultas, muestra qué guardaría y qué discrepancias encontró. La primera
// corrida se mira antes de escribir.
//
// RESUMIBLE POR CONSTRUCCIÓN: toma sólo marcas con `fichaActualizadaEn` en
// NULL, así que cada llamada sigue donde quedó la anterior. No hace falta
// llevar la cuenta ni acordarse de dónde se cortó: si el proceso se corta a la
// mitad, se vuelve a llamar y sigue.
//
// Va de a lotes porque son 843 marcas y una consulta por marca: el pedido HTTP
// se agotaría mucho antes de terminar. Se llama varias veces.
//
// NO TOCA `denominacion` NI `tipoMarca`, aunque el INPI diga otra cosa. Esos
// dos son criterio del matriculado: la denominación guardada puede estar
// recortada respecto del registro —«NAHANA» contra «NAHANA JEANS DESDE 1989»—
// y qué se coteja contra el Boletín, el signo completo o el elemento
// dominante, no lo decide un parser. Las diferencias se REPORTAN en
// `discrepancias` para que se miren.
//
//   ?limite=25    cuántas marcas por llamada (por defecto 10; máximo 100)
//   &guardar=1    escribe. Sin esto, sólo informa.
router.get('/cartera/enriquecer', async (req, res: Response) => {
  if (!exigirToken(req, res)) return;

  const limite = Math.min(Math.max(parseInt(String(req.query.limite || '10')) || 10, 1), 100);
  const guardar = String(req.query.guardar || '') === '1';

  // ⚠️ «acta IS NOT NULL» no alcanza. Damlong exporta `0` para las marcas que
  //    no tienen número de acta cargado, y `0` no es nulo: pasa el filtro, se
  //    le pide la ficha al INPI, el portal contesta 200 con una página vacía y
  //    la marca queda registrada como consultada con éxito y sin datos.
  //
  //    O sea: el error no aparece en `fallidas`. Se ve sólo si alguien mira
  //    que todo volvió en blanco. Por eso el acta se valida por forma —sólo
  //    dígitos, seis o más— y no por «no es nulo».
  const VALIDA = `acta ~ '^[0-9]{6,}$'`;

  // El genérico de `$queryRawUnsafe` no compila contra el cliente generado, así
  // que el tipo se declara con `as`. `VALIDA` es una constante de este archivo,
  // no entra nada del usuario; el límite va parametrizado.
  const filas = (await prisma.$queryRawUnsafe(
    `SELECT id FROM marcas
      WHERE "fichaActualizadaEn" IS NULL AND ${VALIDA}
      ORDER BY acta ASC LIMIT $1`,
    limite,
  )) as { id: string }[];

  const pendientes = await prisma.marca.findMany({
    where: { id: { in: filas.map((f) => f.id) } },
    select: {
      id: true, acta: true, denominacion: true, claseNiza: true,
      tipoMarca: true, titularNombre: true, titularCuit: true, productos: true,
    },
    orderBy: { acta: 'asc' },
  });

  const [conteo] = (await prisma.$queryRawUnsafe(
    `SELECT
       COUNT(*) FILTER (WHERE "fichaActualizadaEn" IS NULL AND ${VALIDA})::int AS pendientes,
       COUNT(*) FILTER (WHERE NOT (${VALIDA}) OR acta IS NULL)::int AS sinacta
     FROM marcas`,
  )) as { pendientes: number; sinacta: number }[];
  const quedanAntes = conteo?.pendientes ?? 0;

  // Las marcas sin acta utilizable: no se pueden pedir al INPI ni identificar
  // en el Boletín. No es un problema de esta ruta, pero es acá donde se ve.
  const sinActa = (await prisma.$queryRawUnsafe(
    `SELECT acta, denominacion, "claseNiza", "titularNombre" FROM marcas
      WHERE NOT (${VALIDA}) OR acta IS NULL
      ORDER BY denominacion LIMIT 20`,
  )) as { acta: string | null; denominacion: string; claseNiza: number; titularNombre: string }[];

  const procesadas: any[] = [];
  const fallidas: any[] = [];
  const discrepancias: any[] = [];

  for (const m of pendientes) {
    const acta = m.acta!;
    try {
      const ficha = parsearFichaINPI(await pedirFichaINPI(acta));

      // El dibujo. La huella se calcula acá y no después: si la imagen no se
      // puede leer, conviene saberlo ahora y no cuando haga falta cotejar.
      // ⚠️ `hashNegativo` NO es opcional. Es la huella de la MISMA imagen con
      //    los colores invertidos, y es lo único que detecta ese disimulo:
      //    invertir un logo hace saltar la distancia cerca de 64, o sea que
      //    dHash lo ve como una imagen sin relación. Complementar los bits
      //    tampoco sirve —medido sobre un logo real dio 45, no 64—.
      //
      //    La primera versión de esta ruta lo calculaba y lo tiraba, porque no
      //    había columna donde ponerlo. Guardar sólo `hash` es guardar media
      //    huella, y lo que se pierde es justo el caso que esa función existe
      //    para atrapar.
      let huella: { hash: string; hashNegativo: string; proporcion: number } | null = null;
      let bytesLogo = 0;
      if (ficha.logo) {
        const buf = Buffer.from(ficha.logo.base64, 'base64');
        bytesLogo = buf.length;
        try {
          const h = await calcularHuella(buf);
          huella = { hash: h.hash, hashNegativo: h.hashNegativo, proporcion: h.proporcion };
        } catch { /* imagen ilegible: se guarda igual, sin huella */ }
      }

      // El (57). «Toda la clase» es el dato oficial del INPI, no un relleno
      // nuestro: dice que la marca ampara la clase entera. Distinto de copiarle
      // el encabezado de Niza, que sería inventarle un alcance.
      const { productos, renuncia } = partirRenuncia(
        ficha.limitacion || ficha.proteccion || null,
      );

      // Los paréntesis de Damlong pasan a su campo. La denominación NO se
      // toca: separarla es una decisión aparte.
      const { elementoFigurativo } = partirDenominacion(m.denominacion);

      const titularPrincipal =
        [...ficha.titulares].sort(
          (a, b) => parseFloat(b.porcentaje || '0') - parseFloat(a.porcentaje || '0'),
        )[0] || null;

      // ── Lo que no cuadra, se informa; no se corrige solo ──────────────────
      const dif: string[] = [];
      const tipoInpi = (ficha.tipoMarca || '').toUpperCase();
      const tipoNuestro = String(m.tipoMarca).toUpperCase();
      if (tipoInpi && !tipoNuestro.startsWith(tipoInpi.slice(0, 5))) {
        dif.push(`tipo: nuestra base dice ${tipoNuestro}, el INPI dice ${ficha.tipoMarca}`);
      }
      const denomInpi = (ficha.denominacion || '').trim().toUpperCase();
      const denomNuestra = partirDenominacion(m.denominacion).denominacion.toUpperCase();
      if (denomInpi && denomNuestra && denomInpi !== denomNuestra) {
        dif.push(`denominación: guardada «${denomNuestra}», INPI «${ficha.denominacion}»`);
      }
      if (String(ficha.clase) && parseInt(ficha.clase) && parseInt(ficha.clase) !== m.claseNiza) {
        dif.push(`clase: guardada ${m.claseNiza}, INPI ${ficha.clase}`);
      }
      if (dif.length) discrepancias.push({ acta, denominacion: m.denominacion, diferencias: dif });

      if (guardar) {
        await prisma.$transaction(async (tx) => {
          await tx.marca.update({
            where: { id: m.id },
            data: {
              logoBase64: ficha.logo?.base64 ?? null,
              logoFormato: ficha.logo?.formato ?? null,
              huellaVisual: huella?.hash ?? null,
              huellaNegativa: huella?.hashNegativo ?? null,
              huellaProporcion: huella?.proporcion ?? null,
              elementoFigurativo: elementoFigurativo || null,
              productos: productos ?? undefined,
              renuncia: renuncia ?? undefined,
              productosRevisadoEn: new Date(),
              titularCuit: titularPrincipal?.cuit || undefined,
              resolucion: ficha.resolucion.numero || undefined,
              resolucionTipo: ficha.resolucion.tipo || null,
              resolucionMotivo: ficha.resolucion.motivo || null,
              disposicionNumero:
                (ficha.resolucion.disposicion.match(/DI-[\w#-]+/) || [null])[0],
              disposicionFecha: fechaArgentina(ficha.resolucion.disposicion),
              boletinNotificacion: ficha.resolucion.boletin || null,
              fechaVencimiento: fechaArgentina(ficha.resolucion.vence) ?? undefined,
              fechaPublicacion: fechaArgentina(ficha.resolucion.notificacion) ?? undefined,
              fichaActualizadaEn: new Date(),
            },
          });

          // Se reemplazan sólo los titulares que vinieron del INPI. Los
          // cargados a mano sobreviven: quien los escribió sabía algo que la
          // ficha no dice.
          await tx.titularMarca.deleteMany({ where: { marcaId: m.id, origen: 'INPI' } });
          if (ficha.titulares.length) {
            await tx.titularMarca.createMany({
              data: ficha.titulares.map((t) => ({
                marcaId: m.id,
                nombre: t.nombre,
                porcentaje: t.porcentaje || null,
                cuit: t.cuit || null,
                tipoDocumento: t.tipoDocumento || null,
                documento: t.documento || null,
                genero: t.genero || null,
                pais: t.pais || null,
                domicilioReal: t.domicilioReal || null,
                localidad: t.localidad || null,
                codigoPostal: t.codigoPostal || null,
                origen: 'INPI',
              })),
            });
          }
        });
      }

      procesadas.push({
        acta,
        denominacion: m.denominacion,
        logo: ficha.logo ? `${ficha.logo.formato} · ${bytesLogo} bytes` : 'sin logo',
        huella: huella?.hash ?? null,
        titulares: ficha.titulares.map((t) => `${t.nombre}${t.porcentaje ? ` ${t.porcentaje}%` : ''}`),
        cuitPrincipal: titularPrincipal?.cuit || null,
        productos: productos ? productos.slice(0, 120) : null,
        renuncia: renuncia || null,
        resolucion: ficha.resolucion.numero || null,
        vence: ficha.resolucion.vence || null,
        elementoFigurativo: elementoFigurativo || null,
      });
    } catch (err: any) {
      fallidas.push({ acta, denominacion: m.denominacion, error: err.message });
    }

    // Un respiro entre consultas. El portal es de un organismo público y esto
    // son 843 pedidos: no hay ninguna razón para apurarlo.
    await new Promise((r) => setTimeout(r, 400));
  }

  const conLogo = procesadas.filter((p) => p.huella).length;
  const conCuit = procesadas.filter((p) => p.cuitPrincipal).length;
  const conProductos = procesadas.filter((p) => p.productos).length;

  return res.json({
    modo: guardar ? '💾 GUARDANDO' : '👁️ SECO — no se escribió nada. Agregá &guardar=1 para escribir.',
    quedabanAntes: quedanAntes,
    procesadasAhora: procesadas.length,
    quedanDespues: guardar ? quedanAntes - procesadas.length : quedanAntes,
    sinActaUtilizable: {
      nota:
        'Marcas cuyo número de acta no es un acta: Damlong exporta «0» cuando no lo tiene ' +
        'cargado. No se les puede pedir la ficha al INPI ni identificarlas en el Boletín, ' +
        'así que quedan fuera de la vigilancia por acta. Se listan para poder completarlas.',
      cantidad: conteo?.sinacta ?? 0,
      muestra: sinActa,
    },
    resumen: {
      conLogoYHuella: conLogo,
      conCuitDeTitular: conCuit,
      conProductos: conProductos,
      fallidas: fallidas.length,
    },
    discrepancias: {
      nota:
        'Diferencias entre lo guardado y lo que dice el INPI. NO se corrigen solas: ' +
        'la denominación y el tipo de marca son criterio del matriculado.',
      cantidad: discrepancias.length,
      casos: discrepancias,
    },
    fallidas,
    procesadas,
  });
});


// ── GET /api/boletin/cartera/huellas-negativas ───────────────────────────────
//
// Completa la huella del NEGATIVO en las marcas que ya tienen logo guardado.
//
// Por qué hace falta una pasada aparte: la primera versión de
// `/cartera/enriquecer` calculaba `hashNegativo` y lo descartaba, porque no
// existía la columna. Guardar sólo `hash` es guardar media huella — invertir
// los colores de un logo hace saltar la distancia de dHash cerca de 64, o sea
// que el sistema lo ve como una imagen sin relación, que es exactamente el
// disimulo que esa función existe para atrapar.
//
// NO vuelve a consultar al INPI. La imagen quedó guardada en `logoBase64`, así
// que la huella se recalcula leyendo la base. Eso ahorra las 838 consultas de
// vuelta, y es la razón por la que se guardó la imagen y no sólo el código:
// una clasificación que no se puede rehacer no se puede corregir.
//
// Resumible por construcción: toma las que tienen logo y no tienen todavía la
// huella negativa.
//
//   ?limite=200   cuántas por llamada (por defecto 100; máximo 500)
//   &guardar=1    escribe. Sin esto, sólo informa.
router.get('/cartera/huellas-negativas', async (req, res: Response) => {
  if (!exigirToken(req, res)) return;

  const limite = Math.min(Math.max(parseInt(String(req.query.limite || '100')) || 100, 1), 500);
  const guardar = String(req.query.guardar || '') === '1';

  const pendientes = await prisma.marca.findMany({
    where: { logoBase64: { not: null }, huellaNegativa: null },
    select: { id: true, acta: true, denominacion: true, logoBase64: true, huellaVisual: true },
    take: limite,
  });

  const quedanAntes = await prisma.marca.count({
    where: { logoBase64: { not: null }, huellaNegativa: null },
  });

  const hechas: any[] = [];
  const fallidas: any[] = [];
  // Cuando la huella recalculada no coincide con la guardada, algo cambió
  // entre una corrida y otra —la imagen, la librería, el muestreo— y eso
  // invalidaría comparaciones hechas antes. Se verifica en vez de suponer.
  const discordantes: any[] = [];

  for (const m of pendientes) {
    try {
      const h = await calcularHuella(Buffer.from(m.logoBase64!, 'base64'));

      if (m.huellaVisual && m.huellaVisual !== h.hash) {
        discordantes.push({
          acta: m.acta,
          denominacion: m.denominacion,
          guardada: m.huellaVisual,
          recalculada: h.hash,
        });
      }

      if (guardar) {
        await prisma.marca.update({
          where: { id: m.id },
          data: { huellaNegativa: h.hashNegativo, huellaVisual: h.hash, huellaProporcion: h.proporcion },
        });
      }

      hechas.push({ acta: m.acta, denominacion: m.denominacion, negativa: h.hashNegativo });
    } catch (err: any) {
      fallidas.push({ acta: m.acta, denominacion: m.denominacion, error: err.message });
    }
  }

  return res.json({
    modo: guardar ? '💾 GUARDANDO' : '👁️ SECO — no se escribió nada. Agregá &guardar=1 para escribir.',
    quedabanAntes: quedanAntes,
    procesadasAhora: hechas.length,
    quedanDespues: guardar ? quedanAntes - hechas.length : quedanAntes,
    fallidas,
    verificacion: {
      nota:
        'Huellas cuya recalculación no coincide con la guardada. Si hay alguna, las ' +
        'comparaciones hechas antes no son reproducibles y hay que entender por qué.',
      cantidad: discordantes.length,
      casos: discordantes.slice(0, 20),
    },
    hechas: hechas.slice(0, 40),
  });
});

// ── GET /api/boletin/cartera/productos-completos ─────────────────────────────
//
// Repara el (57) de las marcas a las que la primera pasada se lo cortó, y
// separa la renuncia.
//
// QUÉ SE ROMPIÓ: `campoDe` truncaba TODO campo de la ficha a 800 caracteres.
// En los campos cortos no se nota; en el (57) sí, y el (57) es el ALCANCE DE
// LA PROTECCIÓN. 72 marcas de la cartera quedaron con la lista de productos
// cortada a la mitad de una palabra. Una marca con el (57) incompleto no se
// puede cotejar bien por afinidad de productos ni se puede invocar entera en
// una oposición. El tope ahora es 20.000 y quedó como red, no como límite.
//
// DOS FASES, y la segunda no toca el INPI:
//
//   1. Las cortadas (`length(productos) = 800`) se vuelven a pedir al portal.
//      Resumible por construcción, igual que la pasada grande: lleva
//      `productosRevisadoEn`, y cada llamada toma las que lo tienen en NULL.
//   2. Las que ya están completas pero tienen la renuncia pegada adentro se
//      parten acá mismo, leyendo la base. No hace falta volver al INPI para
//      cortar por `///` un texto que ya tenemos.
//
// La fase 2 se saltea a propósito las que siguen marcadas como cortadas: no
// tiene sentido partir un texto que todavía está incompleto.
//
//   ?limite=10    cuántas re-consultar por llamada (por defecto 10; máximo 50)
//   &guardar=1    escribe. Sin esto, sólo informa.
router.get('/cartera/productos-completos', async (req, res: Response) => {
  if (!exigirToken(req, res)) return;

  const limite = Math.min(Math.max(parseInt(String(req.query.limite || '10')) || 10, 1), 50);
  const guardar = String(req.query.guardar || '') === '1';

  // ── Fase 1 · las cortadas, contra el INPI ──────────────────────────────────
  const VALIDA = `acta ~ '^[0-9]{6,}$'`;
  const CORTADAS = `length(productos) = 800 AND "productosRevisadoEn" IS NULL AND ${VALIDA}`;

  const quedabanAntes = Number(
    ((await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM marcas WHERE ${CORTADAS}`,
    )) as { n: number }[])[0]?.n ?? 0,
  );

  const filas = (await prisma.$queryRawUnsafe(
    `SELECT id, acta, denominacion, productos FROM marcas WHERE ${CORTADAS} ORDER BY acta ASC LIMIT $1`,
    limite,
  )) as { id: string; acta: string; denominacion: string; productos: string }[];

  const reparadas: any[] = [];
  const fallidas: any[] = [];
  const otrosTramos: any[] = [];
  // Un campo que vuelve JUSTO en el tope no está completo: está cortado de
  // nuevo, ahora en 20.000. Puede ser un (57) enorme de verdad, o una etiqueta
  // que falta en ETIQUETAS_FICHA y hace que el campo se corra hasta el final
  // de la página. Se distingue mirando la cola: si termina enumerando
  // productos es lo primero, si termina en otra sección es lo segundo.
  // (La versión anterior de este control miraba el 800 viejo en vez del tope
  // vigente, así que no habría visto nada.)
  const enElTope: any[] = [];

  for (const m of filas) {
    try {
      const ficha = parsearFichaINPI(await pedirFichaINPI(m.acta));
      const crudo = ficha.limitacion || ficha.proteccion || null;
      const { productos, renuncia, otros } = partirRenuncia(crudo);

      if (!productos) {
        fallidas.push({ acta: m.acta, denominacion: m.denominacion, error: 'la ficha volvió sin (57)' });
        continue;
      }
      const enElLimite = !!crudo && crudo.length >= TOPE_CAMPO;
      if (enElLimite) {
        enElTope.push({
          acta: m.acta,
          denominacion: m.denominacion,
          largo: crudo!.length,
          cola: crudo!.slice(-300),
        });
      }
      if (otros.length) otrosTramos.push({ acta: m.acta, denominacion: m.denominacion, otros });

      if (guardar) {
        await prisma.marca.update({
          where: { id: m.id },
          data: {
            productos,
            renuncia: renuncia ?? null,
            // Si volvió pegada al tope, sigue cortada: se guarda lo que hay
            // —más que antes— pero NO se marca como revisada. Queda en la cola
            // y vuelve a salir en cada corrida hasta que el texto entre entero.
            // Marcarla sería darla por buena y perderla de vista, que es
            // exactamente como se nos escaparon las 72 del corte de 800.
            productosRevisadoEn: enElLimite ? undefined : new Date(),
          },
        });
      }

      reparadas.push({
        acta: m.acta,
        denominacion: m.denominacion,
        antes: m.productos.length,
        despues: productos.length,
        gano: productos.length - m.productos.length,
        renuncia: renuncia ? renuncia.slice(0, 160) : null,
      });
    } catch (err: any) {
      fallidas.push({ acta: m.acta, denominacion: m.denominacion, error: err.message });
    }

    await new Promise((r) => setTimeout(r, 400));
  }

  // ── Fase 2 · la renuncia, sin salir de la base ─────────────────────────────
  const PARTIBLES = `productos LIKE '%///%' AND renuncia IS NULL AND length(productos) <> 800`;

  const pendientesDePartir = (await prisma.$queryRawUnsafe(
    `SELECT id, acta, denominacion, productos FROM marcas WHERE ${PARTIBLES} ORDER BY acta ASC`,
  )) as { id: string; acta: string; denominacion: string; productos: string }[];

  const partidas: any[] = [];
  const sinRenunciaReal: any[] = [];
  for (const m of pendientesDePartir) {
    const { productos, renuncia, otros } = partirRenuncia(m.productos);

    // Tenía `///` pero ningún tramo dice RENUNCIA: el separador estaba
    // marcando otra cosa. Se limpia `productos` igual —el tramo suelto no es
    // parte de lo que la marca ampara— pero NO se le inventa una renuncia.
    if (!renuncia) {
      if (otros.length) sinRenunciaReal.push({ acta: m.acta, denominacion: m.denominacion, otros });
      continue;
    }

    if (guardar) {
      await prisma.marca.update({
        where: { id: m.id },
        data: { productos: productos ?? undefined, renuncia },
      });
    }
    partidas.push({ acta: m.acta, denominacion: m.denominacion, renuncia: renuncia.slice(0, 160) });
  }

  return res.json({
    modo: guardar ? '💾 GUARDANDO' : '👁️ SECO — no se escribió nada. Agregá &guardar=1 para escribir.',
    fase1_cortadas: {
      nota: 'El (57) que la primera pasada truncó a 800 caracteres. Se vuelve a pedir al INPI.',
      quedabanAntes,
      reparadasAhora: reparadas.length,
      quedanDespues: guardar ? quedabanAntes - reparadas.length : quedabanAntes,
      caracteresRecuperados: reparadas.reduce((a, r) => a + r.gano, 0),
      fallidas,
      enElTope: {
        nota:
          `Volvieron justo en ${TOPE_CAMPO} caracteres, o sea cortadas otra vez. Mirá la ` +
          'cola: si termina enumerando productos, el (57) es realmente así de largo y hay ' +
          'que subir el tope. Si termina en otra cosa, falta una etiqueta en ETIQUETAS_FICHA ' +
          'y el campo se está corriendo hasta el final de la página.',
        cantidad: enElTope.length,
        casos: enElTope,
      },
      reparadas: reparadas.slice(0, 30),
    },
    fase2_renuncia: {
      nota:
        'La renuncia dice qué término el titular NO puede reivindicar en exclusiva. ' +
        'Separada de `productos` para que no ensucie el cotejo por afinidad.',
      separadasAhora: partidas.length,
      casos: partidas.slice(0, 30),
    },
    tramosSinClasificar: {
      nota:
        'Tramos separados por `///` que NO dicen RENUNCIA. No se guardan en ningún campo: ' +
        'ponerlos en `renuncia` sería inventarle al registro una limitación que el titular ' +
        'no aceptó. Se listan para decidir qué son.',
      enFase1: otrosTramos,
      enFase2: sinRenunciaReal,
    },
  });
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
