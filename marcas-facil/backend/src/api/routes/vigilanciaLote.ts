/**
 * CRUCE EN LOTE — una cartera entera contra el Boletín, sin guardar nada
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Una pantalla donde se pega la lista de marcas y devuelve la tabla de
 * coincidencias de la semana.
 *
 * ── Por qué no pasa por la base ────────────────────────────────────────────
 *
 * Las marcas llegan en el cuerpo del pedido, se cruzan en memoria y se
 * descartan. **No se guarda ninguna.**
 *
 * La razón es concreta: la cartera del estudio son marcas de clientes. Los
 * datos marcarios en sí son públicos —están en el Boletín y en el buscador del
 * INPI—, pero la lista de quiénes son clientes de quién no lo es. Y hoy esa
 * base no tiene backups configurados, los endpoints de diagnóstico no están
 * detrás del login y hay credenciales sin rotar.
 *
 * Mientras eso siga así, una cartera real no tiene por qué quedar almacenada
 * para probar un cotejo que se puede hacer en memoria en medio segundo.
 *
 * ── Por qué devuelve HTML y no JSON ────────────────────────────────────────
 *
 * Porque lo va a leer una persona, no un programa. Una lista de coincidencias
 * en JSON crudo, con explicaciones de dos renglones cada una, es ilegible en
 * la barra del navegador — y el objetivo de esta pantalla es justamente que el
 * matriculado pueda mirar los resultados y decir "esta sí, esta no".
 *
 * ⚠️ Protegido con INPI_TEST_TOKEN, como el resto del diagnóstico. Va a la
 *    misma lista de limpieza.
 */

import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { ultimoMiercoles } from '../../services/boletinPortal';
import { cruzarUnaMarca, indexarActas, type Coincidencia } from '../../services/vigilanciaService';

const router = Router();

function exigirToken(req: Request, res: Response): boolean {
  const esperado = process.env.INPI_TEST_TOKEN || '';
  if (!esperado) {
    res.status(503).send('Endpoint deshabilitado: falta INPI_TEST_TOKEN.');
    return false;
  }
  if (String(req.query.token || '') !== esperado) {
    res.status(403).send('Token inválido');
    return false;
  }
  return true;
}

// ── Parseo de la lista pegada ────────────────────────────────────────────────

interface MarcaDeLaLista {
  denominacion: string;
  clase: number;
  ampliada: boolean;
  linea: number;
}

/**
 * Cada renglón es `DENOMINACIÓN;CLASE` y, si la marca es notoria o renombrada,
 * `DENOMINACIÓN;CLASE;A`.
 *
 * Acepta punto y coma, coma o tabulación como separador — así se puede pegar
 * directo desde Excel sin convertir nada.
 *
 * Los renglones que no se entienden **se informan**, no se descartan en
 * silencio: una marca que no se cotejó es una marca sin vigilar, y quien pegó
 * la lista tiene que enterarse.
 */
function parsearLista(texto: string): { marcas: MarcaDeLaLista[]; errores: string[] } {
  const marcas: MarcaDeLaLista[] = [];
  const errores: string[] = [];

  texto.split(/\r?\n/).forEach((cruda, i) => {
    const linea = cruda.trim();
    if (!linea) return;

    const partes = linea.split(/[;,\t]/).map((p) => p.trim());
    const denominacion = partes[0];
    const clase = Number(partes[1]);

    if (!denominacion) {
      errores.push(`Renglón ${i + 1}: sin denominación — "${linea}"`);
      return;
    }
    if (!Number.isFinite(clase) || clase < 1 || clase > 45) {
      errores.push(
        `Renglón ${i + 1}: clase inválida ("${partes[1] ?? ''}") — "${linea}". ` +
          'El formato es DENOMINACIÓN;CLASE'
      );
      return;
    }

    marcas.push({
      denominacion,
      clase,
      ampliada: /^(a|amp|ampliada|s|si|sí)$/i.test(partes[2] || ''),
      linea: i + 1,
    });
  });

  return { marcas, errores };
}

// ── POST /api/vigilancia-lote/cruzar ─────────────────────────────────────────

router.post('/cruzar', async (req: Request, res: Response) => {
  if (!exigirToken(req, res)) return;

  const t0 = Date.now();
  try {
    const { marcas, errores } = parsearLista(String(req.body?.lista || ''));
    if (marcas.length === 0) {
      return res.status(400).json({ error: 'La lista está vacía o no se entendió ningún renglón', errores });
    }

    const fecha = req.body?.fecha ? new Date(String(req.body.fecha)) : ultimoMiercoles();
    if (isNaN(fecha.getTime())) return res.status(400).json({ error: 'Fecha inválida' });

    const { total, sinDenominacion, porClase, advertencias } = await indexarActas(fecha);

    const todas: Coincidencia[] = [];
    let comparaciones = 0;
    for (const m of marcas) {
      const r = cruzarUnaMarca(
        {
          id: `linea-${m.linea}`,
          denominacion: m.denominacion,
          claseNiza: m.clase,
          vigilanciaAmpliada: m.ampliada,
          tipoNotoriedad: m.ampliada ? 'RENOMBRADA' : null,
        },
        porClase
      );
      todas.push(...r.coincidencias);
      comparaciones += r.comparaciones;
    }
    todas.sort((a, b) => b.similitud - a.similitud);

    logger.info(
      `[Vigilancia] Lote de ${marcas.length} marcas: ${comparaciones} comparaciones, ` +
        `${todas.length} coincidencias en ${Date.now() - t0} ms`
    );

    return res.json({
      fecha: fecha.toLocaleDateString('es-AR'),
      marcasEnLaLista: marcas.length,
      actasEnLaFecha: total,
      actasCotejables: total - sinDenominacion,
      comparaciones,
      coincidencias: todas,
      errores,
      advertencias,
      milisegundos: Date.now() - t0,
    });
  } catch (err: any) {
    logger.error(`[Vigilancia] Falló el lote: ${err.message}`);
    return res.status(502).json({ error: err.message });
  }
});

// ── GET /api/vigilancia-lote ─────────────────────────────────────────────────
// La pantalla.

router.get('/', (req: Request, res: Response) => {
  if (!exigirToken(req, res)) return;
  const token = encodeURIComponent(String(req.query.token));

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cruce de cartera contra el Boletín</title>
<style>
  :root { --tinta:#1a1a1a; --suave:#666; --linea:#e2e2e2; --marca:#1a3a6b; --alerta:#b3261e; }
  * { box-sizing:border-box }
  body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;
         max-width:1100px; margin:0 auto; padding:32px 20px 80px; color:var(--tinta); line-height:1.5 }
  h1 { font-size:22px; margin:0 0 4px }
  .sub { color:var(--suave); font-size:14px; margin-bottom:24px }
  textarea { width:100%; height:220px; font-family:ui-monospace,Menlo,Consolas,monospace;
             font-size:13px; padding:12px; border:1px solid var(--linea); border-radius:6px; resize:vertical }
  .fila { display:flex; gap:12px; align-items:center; margin:14px 0 }
  button { background:var(--marca); color:#fff; border:0; padding:11px 22px; border-radius:6px;
           font-size:15px; cursor:pointer }
  button:disabled { opacity:.5; cursor:default }
  input[type=date] { padding:9px; border:1px solid var(--linea); border-radius:6px; font-size:14px }
  .ayuda { background:#f6f7f9; border-left:3px solid var(--marca); padding:12px 16px;
           font-size:13px; border-radius:0 6px 6px 0; margin-bottom:18px }
  code { background:#eceef1; padding:1px 5px; border-radius:3px; font-size:12px }
  table { width:100%; border-collapse:collapse; margin-top:18px; font-size:13px }
  th { text-align:left; border-bottom:2px solid var(--linea); padding:9px 8px; font-size:12px;
       text-transform:uppercase; letter-spacing:.04em; color:var(--suave) }
  td { border-bottom:1px solid var(--linea); padding:10px 8px; vertical-align:top }
  tr:hover td { background:#fafbfc }
  .pct { font-weight:600; white-space:nowrap }
  .alto { color:var(--alerta) }
  .chip { display:inline-block; background:#eceef1; padding:1px 7px; border-radius:10px; font-size:11px }
  .nota { color:var(--suave); font-size:12px; margin-top:3px }
  .aviso { background:#fff8e1; border-left:3px solid #c77700; padding:12px 16px;
           font-size:13px; border-radius:0 6px 6px 0; margin:16px 0 }
  .resumen { display:flex; gap:26px; flex-wrap:wrap; margin:20px 0; padding:14px 0;
             border-top:1px solid var(--linea); border-bottom:1px solid var(--linea) }
  .dato b { display:block; font-size:21px; font-weight:600 }
  .dato span { font-size:12px; color:var(--suave) }
</style></head><body>

<h1>Cruce de cartera contra el Boletín</h1>
<div class="sub">Pegá tus marcas y se cotejan contra las actas publicadas. <b>No se guarda ninguna.</b></div>

<div class="ayuda">
  Un renglón por marca: <code>DENOMINACIÓN;CLASE</code><br>
  Si es notoria o renombrada, agregá <code>;A</code> al final para vigilarla en las 45 clases.<br><br>
  <code>NAKAMA;35</code><br>
  <code>CUERO ARGENTINO;18</code><br>
  <code>COCA COLA;32;A</code><br><br>
  Se puede pegar directo desde Excel — también acepta coma o tabulación como separador.
</div>

<textarea id="lista" placeholder="NAKAMA;35&#10;LUXOR;35&#10;ITALPASTA;30"></textarea>

<div class="fila">
  <button id="btn">Cruzar</button>
  <label style="font-size:14px;color:var(--suave)">Boletín del:</label>
  <input type="date" id="fecha">
  <span id="estado" style="font-size:14px;color:var(--suave)"></span>
</div>

<div id="salida"></div>

<script>
const TOKEN = ${JSON.stringify(token)};
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

$('btn').onclick = async () => {
  const lista = $('lista').value.trim();
  if (!lista) { $('estado').textContent = 'Pegá al menos una marca.'; return; }

  $('btn').disabled = true;
  $('estado').textContent = 'Cruzando…';
  $('salida').innerHTML = '';

  try {
    const r = await fetch('/api/vigilancia-lote/cruzar?token=' + TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lista, fecha: $('fecha').value || undefined }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Error ' + r.status);
    pintar(d);
    $('estado').textContent = d.milisegundos + ' ms';
  } catch (e) {
    $('salida').innerHTML = '<div class="aviso"><b>No se pudo cruzar.</b><br>' + esc(e.message) + '</div>';
    $('estado').textContent = '';
  } finally {
    $('btn').disabled = false;
  }
};

function pintar(d) {
  let h = '<div class="resumen">'
    + dato(d.marcasEnLaLista, 'marcas en la lista')
    + dato(d.actasEnLaFecha.toLocaleString('es-AR'), 'actas del ' + d.fecha)
    + dato(d.actasCotejables.toLocaleString('es-AR'), 'cotejables')
    + dato(d.comparaciones.toLocaleString('es-AR'), 'comparaciones')
    + dato(d.coincidencias.length, 'coincidencias')
    + '</div>';

  for (const a of d.advertencias || []) h += '<div class="aviso">' + esc(a) + '</div>';
  if (d.errores && d.errores.length) {
    h += '<div class="aviso"><b>Renglones que no se pudieron leer — esas marcas NO se cotejaron:</b><br>'
       + d.errores.map(esc).join('<br>') + '</div>';
  }

  if (!d.coincidencias.length) {
    h += '<p style="margin-top:22px">Ninguna coincidencia. Recordá que el cotejo solo alcanza a las '
       + d.actasCotejables.toLocaleString('es-AR') + ' actas con denominación en el texto.</p>';
    $('salida').innerHTML = h;
    return;
  }

  h += '<table><thead><tr><th>Tu marca</th><th>Publicada</th><th>Cl.</th><th>Similitud</th>'
     + '<th>Motivo</th><th>Titular de la solicitud</th></tr></thead><tbody>';
  for (const c of d.coincidencias) {
    h += '<tr>'
      + '<td><b>' + esc(c.marcaDenominacion) + '</b><div class="nota">clase ' + c.marcaClase + '</div></td>'
      + '<td><b>' + esc(c.actaDenominacion) + '</b><div class="nota">acta ' + esc(c.acta) + '</div></td>'
      + '<td>' + c.actaClase + '</td>'
      + '<td class="pct ' + (c.similitud >= 85 ? 'alto' : '') + '">' + c.similitud + ' %</td>'
      + '<td><span class="chip">' + esc(c.motivo === 'afinidad' ? c.gradoAfinidad : c.regla) + '</span>'
      + '<div class="nota">' + esc(c.explicacion) + '</div>'
      + '<div class="nota"><b>' + esc(c.accion) + '</b></div></td>'
      + '<td>' + esc(c.actaTitular) + '</td>'
      + '</tr>';
  }
  h += '</tbody></table>'
    + '<div class="aviso" style="margin-top:20px"><b>Los umbrales todavía no están calibrados.</b> '
    + 'Esta lista es un borrador: sirve para decidir qué umbrales mover, no para presentar nada.</div>';

  $('salida').innerHTML = h;
}

function dato(v, t) { return '<div class="dato"><b>' + v + '</b><span>' + t + '</span></div>'; }
</script>
</body></html>`);
});

export default router;
