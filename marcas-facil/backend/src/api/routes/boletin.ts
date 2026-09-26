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
import * as crypto from 'crypto';
import { listarBoletines, boletinesDeMarcasNuevas, ultimoMiercoles, descargarPdf } from '../../services/boletinPortal';
import { extraerTextoDelPdf, parsearActas } from '../../services/boletinParser';
import { cruzarBoletin, cruzarUnaMarca, indexarActas, agruparPorActa } from '../../services/vigilanciaService';
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
