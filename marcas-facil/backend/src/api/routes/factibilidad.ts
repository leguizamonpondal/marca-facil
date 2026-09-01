/**
 * Rutas de Estudio de Factibilidad — MARCA FÁCIL
 *
 * Flujo:
 * 1. Usuario ingresa denominación + clase NIZA
 * 2. Sistema consulta el Boletín (base de datos local) y el registro INPI
 * 3. Aplica algoritmo de confundibilidad sobre marcas similares en la misma clase
 * 4. Genera PDF con dictamen de factibilidad
 *
 * Niveles de factibilidad:
 * - VIABLE: Ningún antecedente confundible en la misma clase
 * - CONDICIONADA: Antecedentes colisionantes pero posiblemente coexistibles
 * - NO_VIABLE: Marca idéntica o prácticamente idéntica en la misma clase
 */

import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/client';
import { AppError } from '../../middleware/errorHandler';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { calcularSimilitudMarcas, esConfundible, normalizarMarca } from '../../utils/helpers';
import { logger } from '../../utils/logger';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as fs from 'fs';
import * as path from 'path';
import { buscarMarcasPublicoINPI, buscarPorTitularINPI } from '../../services/inpiService';

const router = Router();

const FACTIBILIDAD_DIR = path.join(process.cwd(), 'uploads', 'factibilidad');

// ── GET /api/factibilidad/test — Diagnóstico Playwright INPI (SIN auth) ────────
router.get('/test', async (req: any, res: Response) => {
  const denominacion = String(req.query.denominacion || 'ADIDAS');
  const clase = parseInt(String(req.query.clase || '25'));
  const resultado: Record<string, any> = { denominacion, clase, timestamp: new Date().toISOString(), fuentes: {} };

  const INPI_URL = 'https://portaltramites.inpi.gob.ar/marcasconsultas/busqueda/?Cod_Funcion=NQA0ADEA';

  // 1. Test acceso HTTP básico al portal
  try {
    const { default: axios } = await import('axios');
    const t0 = Date.now();
    const { status, data } = await axios.get(INPI_URL, { timeout: 10_000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = String(data);
    const hasDenomInput = html.includes('id="Denominacion"') || html.includes('name="Denominacion"');
    const hasClaseSelect = html.includes('id="clase"') || html.includes('name="clase"');
    resultado.fuentes.httpGet = { status, ms: Date.now()-t0, bodyLength: html.length, hasDenomInput, hasClaseSelect };
  } catch (err: any) {
    resultado.fuentes.httpGet = { error: err.message, code: err.code };
  }

  // 2. Test Playwright con diagnóstico completo
  try {
    const { chromium } = await import('playwright');
    const t0 = Date.now();
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'es-AR',
    });
    const page = await context.newPage();
    await page.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });

    const allRequests: string[] = [];
    page.on('request', r => allRequests.push(`${r.method()} ${r.url()}`));

    await page.goto(INPI_URL, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const screenshot = (await page.screenshot({ type: 'jpeg', quality: 60 })).toString('base64');

    const todosInputs = await page.$$eval('input, select, textarea, button', (els: any[]) =>
      els.map((el: any) => ({ tag: el.tagName, id: el.id, name: el.name, type: el.type, value: el.value, visible: el.offsetParent !== null }))
    ).catch(() => []);

    const iframes = await page.$$eval('iframe', (frames: any[]) =>
      frames.map((f: any) => ({ src: f.src, id: f.id, name: f.name }))
    ).catch(() => []);

    const urlFinal = page.url();
    const titulo = await page.title().catch(() => '');

    const todosLinks = await page.$$eval('a, button[type="button"], .nav-link, [role="tab"]', (els: any[]) =>
      els.slice(0, 30).map((el: any) => ({ tag: el.tagName, text: el.innerText?.trim().slice(0,50), href: el.href || '', id: el.id, cls: el.className?.slice(0,50) }))
    ).catch(() => []);

    const postRequests: Array<{ url: string; postData: string; responseLength?: number; responseTD?: boolean }> = [];
    page.on('request', req => {
      if (req.method() === 'POST') {
        postRequests.push({ url: req.url(), postData: req.postData() || '' });
      }
    });
    page.on('response', async resp => {
      if (resp.request().method() === 'POST') {
        const match = postRequests.find(r => r.url === resp.url());
        if (match) {
          const body = await resp.text().catch(() => '');
          match.responseLength = body.length;
          match.responseTD = body.includes('<td');
        }
      }
    });

    const btnInfo = await page.evaluate(() => {
      const btn = document.querySelector('[name="BtnBuscarAvanzada"]') as any;
      if (!btn) return null;
      return { onclick: btn.getAttribute('onclick'), type: btn.type, id: btn.id, formAction: btn.form?.action };
    });

    const scriptRelevante = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script:not([src])'));
      for (const s of scripts) {
        const txt = s.textContent || '';
        if (txt.toLowerCase().includes('grilla') || txt.toLowerCase().includes('buscaravanzada') || txt.includes('BtnBuscar')) {
          return txt.slice(0, 3000);
        }
      }
      return null;
    });

    await page.evaluate(() => {
      const $ = (window as any).$;
      if ($) {
        const pane = $('#Denominacion').closest('.tab-pane, .collapse, [role="tabpanel"]');
        if (pane.length) {
          const id = pane.attr('id');
          pane.addClass('active in show').css('display', '');
          if (id) $(`[href="#${id}"], [data-target="#${id}"]`).addClass('active');
        }
      }
      let el: HTMLElement | null = document.getElementById('Denominacion');
      while (el && el !== document.body) {
        if ((el as HTMLElement).style) (el as HTMLElement).style.display = '';
        el = el.parentElement;
      }
    });
    await page.waitForTimeout(500);

    await page.evaluate(({ den, cls }: { den: string; cls: string }) => {
      const d = document.getElementById('Denominacion') as HTMLInputElement;
      if (d) { d.value = den; d.dispatchEvent(new Event('input', { bubbles: true })); }
      const c = document.getElementById('clase') as HTMLSelectElement;
      if (c) { c.value = cls; c.dispatchEvent(new Event('change', { bubbles: true })); }
      const btn = document.querySelector('[name="BtnBuscarAvanzada"]') as HTMLElement;
      if (btn) btn.click();
    }, { den: denominacion, cls: String(clase) });

    await page.waitForTimeout(5000);

    resultado.fuentes.playwright = {
      ms: Date.now() - t0,
      urlFinal,
      titulo,
      iframes,
      btnInfo,
      scriptRelevante: scriptRelevante?.slice(0, 2000),
      postRequests,
      allRequests: allRequests.filter(r => r.includes('POST') || r.includes('Grilla') || r.includes('busqueda')).slice(0, 15),
    };

    await browser.close();
  } catch (err: any) {
    resultado.fuentes.playwright = { error: err.message, stack: err.stack?.slice(0, 500) };
  }

  // 3. Prueba del servicio completo
  try {
    const t0 = Date.now();
    const marcas = await buscarMarcasPublicoINPI(denominacion, clase);
    resultado.fuentes.servicioCompleto = { marcas: marcas.slice(0, 10), total: marcas.length, ms: Date.now()-t0 };
  } catch (err: any) {
    resultado.fuentes.servicioCompleto = { error: err.message };
  }

  res.json(resultado);
});

router.use(authenticate);

// ── GET /api/factibilidad — Historial de estudios ─────────────────────────────
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const estudios = await prisma.estudioFactibilidad.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json(estudios);
  } catch (err) { next(err); }
});

// ── POST /api/factibilidad — Ejecutar estudio de factibilidad ─────────────────
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      denominacion: z.string().min(2, 'Denominación debe tener al menos 2 caracteres'),
      claseNiza: z.number().int().min(0).max(45),  // 0 = todas las clases
      tipoMarca: z.enum(['DENOMINATIVA', 'FIGURATIVA', 'MIXTA']).optional(),
      productos: z.string().optional(),
    });

    const { denominacion, claseNiza, tipoMarca, productos } = schema.parse(req.body);

    logger.info(`🔍 Estudio factibilidad: "${denominacion}" Clase ${claseNiza} — Usuario ${req.user!.id}`);

    // 1. Buscar en el Boletín local — best-effort
    let enBoletinMismaClase: Array<{ acta: string; denominacion: string; claseNiza: number; titularNombre: string }> = [];
    try {
      enBoletinMismaClase = await prisma.boletinEntrada.findMany({
        where: { claseNiza },
        select: { acta: true, denominacion: true, claseNiza: true, titularNombre: true },
      });
    } catch (dbErr: any) {
      logger.warn(`[Factibilidad] boletinEntrada no disponible: ${dbErr.message}`);
    }

    // 2. Buscar en marcas del sistema — best-effort
    let enSistema: Array<{ acta: string | null; denominacion: string; claseNiza: number; titularNombre: string; estado: string }> = [];
    try {
      enSistema = await prisma.marca.findMany({
        where: {
          claseNiza,
          estado: { in: ['EN_TRAMITE', 'PUBLICADA', 'CONCEDIDA'] },
        },
        select: { acta: true, denominacion: true, claseNiza: true, titularNombre: true, estado: true },
      });
    } catch (dbErr: any) {
      logger.warn(`[Factibilidad] marcas no disponibles: ${dbErr.message}`);
    }

    // 3. Buscar en INPI público (fuente principal)
    let marcasINPI: Awaited<ReturnType<typeof buscarMarcasPublicoINPI>> = [];
    try {
      marcasINPI = await buscarMarcasPublicoINPI(denominacion, claseNiza);
      logger.info(`[Factibilidad] INPI público: ${marcasINPI.length} marcas para "${denominacion}" clase ${claseNiza}`);
    } catch (inpiErr: any) {
      logger.warn(`[Factibilidad] INPI público no disponible: ${inpiErr.message}`);
    }

    // 4. Analizar confundibilidad (tres ejes: gráfico, fonético, ideológico — Art. 3° b) Ley 22.362)
    const antecedentes: Array<{
      fuente: 'BOLETIN' | 'SISTEMA' | 'INPI';
      acta: string;
      denominacion: string;
      clase: number;
      titular: string;
      tipoMarca?: string;
      nroResolucion?: string;
      fechaSolicitud?: string;
      vencimiento?: string;
      similitud: number;
      similitudGrafica: number;
      similitudFonetica: number;
      similitudIdeologica: number;
      ejesDominantes: string[];
      confundible: boolean;
      razon: string;
      estado?: string;
    }> = [];

    // Boletín local
    for (const entrada of enBoletinMismaClase) {
      const resultado = esConfundible(denominacion, entrada.denominacion, claseNiza, entrada.claseNiza);
      if (resultado.similitud >= 50) {
        antecedentes.push({
          fuente: 'BOLETIN',
          acta: entrada.acta,
          denominacion: entrada.denominacion,
          clase: entrada.claseNiza,
          titular: entrada.titularNombre || 'No informado',
          similitud: resultado.similitud,
          similitudGrafica: resultado.detalle?.similitudGrafica ?? 0,
          similitudFonetica: resultado.detalle?.similitudFonetica ?? 0,
          similitudIdeologica: resultado.detalle?.similitudIdeologica ?? 0,
          ejesDominantes: resultado.detalle?.ejesDominantes ?? [],
          confundible: resultado.confundible,
          razon: resultado.razon,
        });
      }
    }

    // Marcas del sistema
    for (const marca of enSistema) {
      const resultado = esConfundible(denominacion, marca.denominacion, claseNiza, marca.claseNiza);
      if (resultado.similitud >= 50) {
        antecedentes.push({
          fuente: 'SISTEMA',
          acta: marca.acta || 'S/N',
          denominacion: marca.denominacion,
          clase: marca.claseNiza,
          titular: marca.titularNombre || 'Registrado en sistema',
          similitud: resultado.similitud,
          similitudGrafica: resultado.detalle?.similitudGrafica ?? 0,
          similitudFonetica: resultado.detalle?.similitudFonetica ?? 0,
          similitudIdeologica: resultado.detalle?.similitudIdeologica ?? 0,
          ejesDominantes: resultado.detalle?.ejesDominantes ?? [],
          confundible: resultado.confundible,
          razon: resultado.razon,
          estado: marca.estado,
        });
      }
    }

    // Marcas del INPI (fuente principal)
    const actasVistas = new Set(antecedentes.map(a => a.acta).filter(Boolean));
    for (const marca of marcasINPI) {
      if (!marca.denominacion) continue;
      if (marca.acta && actasVistas.has(marca.acta)) continue;
      const resultado = esConfundible(denominacion, marca.denominacion, claseNiza, marca.claseNiza);
      if (resultado.similitud >= 50) {
        antecedentes.push({
          fuente: 'INPI',
          acta: marca.acta || 'S/N',
          denominacion: marca.denominacion,
          clase: marca.claseNiza,
          tipoMarca: marca.tipoMarca || undefined,
          nroResolucion: marca.nroResolucion || undefined,
          fechaSolicitud: marca.fechaSolicitud || undefined,
          vencimiento: marca.vencimiento || undefined,
          titular: marca.titular || 'No informado',
          similitud: resultado.similitud,
          similitudGrafica: resultado.detalle?.similitudGrafica ?? 0,
          similitudFonetica: resultado.detalle?.similitudFonetica ?? 0,
          similitudIdeologica: resultado.detalle?.similitudIdeologica ?? 0,
          ejesDominantes: resultado.detalle?.ejesDominantes ?? [],
          confundible: resultado.confundible,
          razon: resultado.razon,
          estado: marca.estado || undefined,
        });
        if (marca.acta) actasVistas.add(marca.acta);
      }
    }

    antecedentes.sort((a, b) => b.similitud - a.similitud);

    // 5. Determinar registrabilidad y dictamen
    const registrabilidad = calcularRegistrabilidad(antecedentes);
    const { dictamen, riesgo, resumenDictamen, recomienda } =
      dictamenPorRegistrabilidad(registrabilidad, denominacion, claseNiza, antecedentes);

    // 6. Generar PDF — best-effort
    let pdfPath: string | undefined;
    try {
      pdfPath = await generarPDFFactibilidad({
        denominacion,
        claseNiza,
        tipoMarca: tipoMarca || 'DENOMINATIVA',
        productos: productos || '',
        antecedentes,
        dictamen,
        riesgo,
        resumenDictamen,
        fecha: new Date(),
        userId: req.user!.id,
      });
    } catch (pdfErr: any) {
      logger.warn(`[Factibilidad] PDF no generado: ${pdfErr.message}`);
    }

    // 7. Guardar en BD — best-effort
    let estudio: any = null;
    try {
      estudio = await prisma.estudioFactibilidad.create({
        data: {
          userId: req.user!.id,
          denominacion,
          claseNiza,
          tipoMarca: tipoMarca || 'DENOMINATIVA',
          productos,
          antecedentes: JSON.stringify(antecedentes),
          dictamen,
          riesgo,
          resumenDictamen,
          pdfUrl: pdfPath,
          totalAntecedentes: antecedentes.length,
          antecedentesConfundibles: antecedentes.filter(a => a.confundible).length,
        },
      });
    } catch (dbErr: any) {
      logger.warn(`[Factibilidad] No se pudo guardar en BD: ${dbErr.message}`);
    }

    res.json({
      estudio,
      antecedentes,
      dictamen,
      riesgo,
      resumenDictamen,
      registrabilidad,
      recomienda,
      totalAntecedentes: antecedentes.length,
      antecedentesINPI: marcasINPI.length,
      ...(estudio ? { pdfUrl: `/api/factibilidad/${estudio.id}/pdf` } : {}),
    });
  } catch (err) { next(err); }
});

// ── GET /api/factibilidad/buscar-titular — Marcas de un titular en INPI ──────
router.get('/buscar-titular', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const titular = String(req.query.titular || '').trim();
    if (titular.length < 2) throw new AppError(400, 'El nombre del titular debe tener al menos 2 caracteres', 'INVALID_PARAM');
    logger.info(`[Factibilidad] Búsqueda por titular: "${titular}" — Usuario ${req.user!.id}`);
    const marcas = await buscarPorTitularINPI(titular);
    res.json({ titular, total: marcas.length, marcas });
  } catch (err) { next(err); }
});

// ── GET /api/factibilidad/:id — Detalle de un estudio ────────────────────────
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const estudio = await prisma.estudioFactibilidad.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!estudio) throw new AppError(404, 'Estudio no encontrado', 'ESTUDIO_NOT_FOUND');

    res.json({
      ...estudio,
      antecedentes: estudio.antecedentes ? JSON.parse(estudio.antecedentes as string) : [],
    });
  } catch (err) { next(err); }
});

// ── GET /api/factibilidad/:id/pdf — Descargar PDF ─────────────────────────────
router.get('/:id/pdf', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const estudio = await prisma.estudioFactibilidad.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!estudio) throw new AppError(404, 'Estudio no encontrado', 'ESTUDIO_NOT_FOUND');
    if (!estudio.pdfUrl || !fs.existsSync(estudio.pdfUrl)) {
      throw new AppError(404, 'PDF no disponible', 'PDF_NOT_FOUND');
    }

    res.setHeader('Content-Disposition', `attachment; filename="factibilidad-${estudio.denominacion.replace(/\s/g, '_')}.pdf"`);
    res.setHeader('Content-Type', 'application/pdf');
    res.sendFile(estudio.pdfUrl);
  } catch (err) { next(err); }
});

// ── Helper: porcentaje de registrabilidad ─────────────────────────────────────
function calcularRegistrabilidad(antecedentes: any[]): number {
  if (antecedentes.length === 0) return 90;
  const maxSim = Math.max(...antecedentes.map((a: any) => a.similitud as number));
  const nConf  = antecedentes.filter((a: any) => a.confundible).length;
  let base = Math.max(5, 100 - maxSim);
  if (nConf > 3) base = Math.max(5, base - 10);
  else if (nConf > 1) base = Math.max(5, base - 5);
  return Math.round(base / 5) * 5;
}

function dictamenPorRegistrabilidad(pct: number, denominacion: string, claseNiza: number, antecedentes: any[]): {
  dictamen: 'VIABLE' | 'CONDICIONADA' | 'NO_VIABLE';
  riesgo: 'BAJO' | 'MEDIO' | 'ALTO';
  resumenDictamen: string;
  recomienda: boolean;
} {
  const primero = antecedentes[0];
  if (pct > 75) return {
    dictamen: 'VIABLE', riesgo: 'BAJO', recomienda: true,
    resumenDictamen: `Registrabilidad estimada: ${pct}%. Es muy probable que la marca "${denominacion}" se registre en la Clase ${claseNiza}. Las probabilidades de objeción u oposición son bajas. Recomendamos presentar la solicitud.`,
  };
  if (pct > 50) return {
    dictamen: 'CONDICIONADA', riesgo: 'MEDIO', recomienda: true,
    resumenDictamen: `Registrabilidad estimada: ${pct}%. Hay una buena probabilidad de que la marca pueda ser registrada, pero ciertos obstáculos podrían surgir durante el proceso (objeciones u oposiciones${primero ? ` — antecedente más relevante: ${primero.denominacion}` : ''}). Recomendamos evaluar con un profesional antes de presentar.`,
  };
  if (pct > 25) return {
    dictamen: 'NO_VIABLE', riesgo: 'ALTO', recomienda: false,
    resumenDictamen: `Registrabilidad estimada: ${pct}%. Se espera que el proceso de registro sea difícil y es probable que surjan obstáculos (objeciones u oposiciones${primero ? ` — antecedente principal: ${primero.denominacion}` : ''}). No recomendamos presentar la solicitud sin modificar la denominación.`,
  };
  return {
    dictamen: 'NO_VIABLE', riesgo: 'ALTO', recomienda: false,
    resumenDictamen: `Registrabilidad estimada: ${pct}%. Las probabilidades para el registro de la marca "${denominacion}" son bajas. Existen antecedentes con alta similitud que harían muy probable el rechazo de la solicitud.`,
  };
}

// ── Helper: clases NIZA relacionadas ─────────────────────────────────────────
function getClasesRelacionadas(clase: number): number[] {
  const mapa: Record<number, number[]> = {
    3: [44], 5: [44, 42], 9: [42, 38], 14: [35],
    16: [35, 41], 25: [35, 18, 26], 30: [43],
    32: [43], 33: [43], 35: [36, 41, 42, 45],
    36: [35], 41: [35], 42: [35, 9], 43: [30, 32, 33],
    44: [3, 5],
  };
  return mapa[clase] || [];
}

// ── Helper: generar PDF del estudio de factibilidad ──────────────────────────
async function generarPDFFactibilidad(params: {
  denominacion: string;
  claseNiza: number;
  tipoMarca: string;
  productos: string;
  antecedentes: any[];
  dictamen: string;
  riesgo: string;
  resumenDictamen: string;
  fecha: Date;
  userId: string;
}): Promise<string> {
  if (!fs.existsSync(FACTIBILIDAD_DIR)) {
    fs.mkdirSync(FACTIBILIDAD_DIR, { recursive: true });
  }

  const pdfDoc = await PDFDocument.create();
  const fontR = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const W = 595.28, H = 841.89, M = 50;
  const CW = W - 2 * M;

  const dictamenColor = {
    'VIABLE': rgb(0.1, 0.6, 0.1),
    'CONDICIONADA': rgb(0.9, 0.6, 0.0),
    'NO_VIABLE': rgb(0.8, 0.1, 0.1),
  }[params.dictamen] || rgb(0.5, 0.5, 0.5);

  let page = pdfDoc.addPage([W, H]);
  let y = H - M;

  const escribir = (texto: string, bold = false, size = 10, color = rgb(0.1, 0.1, 0.1), indent = 0) => {
    if (y < M + 30) {
      page = pdfDoc.addPage([W, H]);
      y = H - M;
    }
    const font = bold ? fontB : fontR;
    const palabras = texto.split(' ');
    let linea = '';
    for (const p of palabras) {
      const prueba = linea ? `${linea} ${p}` : p;
      if (font.widthOfTextAtSize(prueba, size) > CW - indent) {
        page.drawText(linea, { x: M + indent, y, size, font, color });
        y -= size + 4;
        linea = p;
        if (y < M + 30) { page = pdfDoc.addPage([W, H]); y = H - M; }
      } else linea = prueba;
    }
    if (linea) { page.drawText(linea, { x: M + indent, y, size, font, color }); y -= size + 4; }
  };

  const separador = () => {
    page.drawLine({ start: { x: M, y: y + 2 }, end: { x: W - M, y: y + 2 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
    y -= 8;
  };

  page.drawRectangle({ x: 0, y: H - 80, width: W, height: 80, color: rgb(0.15, 0.35, 0.65) });
  page.drawText('MARCA FÁCIL', { x: M, y: H - 35, size: 18, font: fontB, color: rgb(1, 1, 1) });
  page.drawText('ESTUDIO DE FACTIBILIDAD MARCARIA', { x: M, y: H - 55, size: 11, font: fontR, color: rgb(0.8, 0.9, 1) });
  page.drawText(`Agente PI Mat. N° 1974 — Honorio M. Leguizamón Pondal`, { x: M, y: H - 70, size: 8, font: fontR, color: rgb(0.6, 0.8, 1) });

  y = H - 95;

  y -= 8;
  escribir('DATOS DEL ESTUDIO', true, 11, rgb(0.2, 0.2, 0.6));
  separador();
  escribir(`Denominación analizada: ${params.denominacion.toUpperCase()}`, true, 11);
  escribir(`Clase NIZA: ${params.claseNiza}    Tipo de marca: ${params.tipoMarca}`, false, 10);
  if (params.productos) escribir(`Productos/servicios: ${params.productos}`, false, 9, rgb(0.3, 0.3, 0.3));
  escribir(`Fecha del estudio: ${params.fecha.toLocaleDateString('es-AR')}`, false, 9, rgb(0.4, 0.4, 0.4));
  y -= 6;

  const boxH = 50;
  page.drawRectangle({ x: M, y: y - boxH, width: CW, height: boxH, color: rgb(0.95, 0.95, 0.95), borderColor: dictamenColor, borderWidth: 2 });
  page.drawText(`DICTAMEN: ${params.dictamen.replace('_', ' ')}`, { x: M + 10, y: y - 20, size: 14, font: fontB, color: dictamenColor });
  page.drawText(`Nivel de riesgo: ${params.riesgo}`, { x: M + 10, y: y - 38, size: 10, font: fontR, color: rgb(0.3, 0.3, 0.3) });
  y -= boxH + 12;

  escribir('RESUMEN DEL DICTAMEN', true, 11, rgb(0.2, 0.2, 0.6));
  separador();
  escribir(params.resumenDictamen, false, 10);
  y -= 8;

  escribir('ANTECEDENTES ENCONTRADOS', true, 11, rgb(0.2, 0.2, 0.6));
  separador();

  if (params.antecedentes.length === 0) {
    escribir('No se encontraron antecedentes en la base de datos del sistema.', false, 10, rgb(0.4, 0.4, 0.4));
  } else {
    for (const ant of params.antecedentes.slice(0, 20)) {
      const confLabel = ant.confundible ? '⚠ CONFUNDIBLE' : '◌ Similar';
      const confColor = ant.confundible ? rgb(0.8, 0.1, 0.1) : rgb(0.5, 0.5, 0.5);
      escribir(`${ant.denominacion.toUpperCase()} — Clase ${ant.clase}  |  Similitud: ${ant.similitud}%  |  ${confLabel}`, ant.confundible, 9, confColor, 10);
      escribir(`Acta: ${ant.acta}  |  Titular: ${ant.titular}  |  Fuente: ${ant.fuente}`, false, 8, rgb(0.5, 0.5, 0.5), 10);
      if (ant.razon) escribir(`   → ${ant.razon}`, false, 8, rgb(0.6, 0.2, 0.2), 10);
      y -= 3;
    }
    if (params.antecedentes.length > 20) {
      escribir(`... y ${params.antecedentes.length - 20} antecedentes más con similitud inferior.`, false, 8, rgb(0.5, 0.5, 0.5));
    }
  }

  y -= 8;

  escribir('NOTA LEGAL', true, 9, rgb(0.4, 0.4, 0.4));
  separador();
  escribir('Este estudio de factibilidad tiene carácter informativo y no constituye asesoramiento jurídico vinculante. La factibilidad final del registro marcario depende de la evaluación del INPI y de las oposiciones que pudieren formularse durante el período de publicación en el Boletín de Marcas. Se recomienda confirmar con el portal del INPI (www.inpi.gob.ar) la vigencia de los antecedentes detectados.', false, 8, rgb(0.5, 0.5, 0.5));

  const pdfBytes = await pdfDoc.save();
  const filename = `factibilidad-${params.denominacion.replace(/[^a-zA-Z0-9]/g, '_')}-clase${params.claseNiza}-${Date.now()}.pdf`;
  const filePath = path.join(FACTIBILIDAD_DIR, filename);
  fs.writeFileSync(filePath, pdfBytes);

  return filePath;
}

export default router;
