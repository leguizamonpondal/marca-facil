/**
 * Servicio de generación de documentos PDF
 * Para MARCAS FÁCIL — Honorio M. Leguizamón Pondal
 *
 * Genera documentos legales listos para presentar en el portal INPI:
 * - Fundamentos de oposición
 * - Mantenimiento de oposición
 * - DDJJ de uso de medio término (Art. 26 Ley 22.362)
 * - DDJJ de uso para renovación
 * - Contestación de vistas
 */

import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib';
import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '../db/client';
import { logger } from '../utils/logger';
import { formatCuit } from '../utils/helpers';

const DOCS_DIR = path.join(process.cwd(), 'uploads', 'documentos');

// Datos del agente por defecto (Honorio)
const AGENTE = {
  nombre: 'Honorio M. Leguizamón Pondal',
  matricula_abogado: 'T° 93 F° 651 C.P.A.C.F.',
  matricula_federal: 'T° 137 F° 434 Matrícula Federal',
  matricula_pi: 'Agente de la Propiedad Industrial Mat. N° 1974',
  domicilio: 'CONSTITUIDO ANTE EL INPI',
  email: process.env.AGENTE_EMAIL || 'honorio@marcasfacil.com.ar',
};

export const documentoService = {

  // ── OPOSICIÓN ──────────────────────────────────────────────────────────────

  /**
   * Genera PDF de fundamentos de oposición listo para adjuntar en portal INPI.
   * Ruta portal: Marcas → Trámites → Oposiciones
   */
  async generarOposicion(oposicionId: string, userId: string): Promise<string> {
    const oposicion = await prisma.oposicion.findFirst({
      where: { id: oposicionId, userId },
      include: {
        marcaOponente: true,
        boletinEntrada: true,
      },
    });

    if (!oposicion) throw new Error('Oposición no encontrada');

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { razonSocial: true, cuit: true, domicilio: true, email: true },
    });

    const fecha = new Date().toLocaleDateString('es-AR', {
      day: 'numeric', month: 'long', year: 'numeric'
    });

    // Texto de fundamentos: plantilla fija del estudio (igual para todas las oposiciones).
    // Fuente: PLANTILLA MODELO FUNDAMENTOS OPOSICION A SOLICITUD DE MARCA.docx
    const FUNDAMENTOS_PLANTILLA = 'La solicitud de marca presentada es directamente confundible con la/s marca/s de nuestra propiedad. Niego, por no constarme, que el/la solicitante tenga interés legítimo para registrar la marca opuesta. Fundo el derecho de nuestra parte en los arts. 3, 4, 24 y demás concordantes de la Ley 22.362 y jurisprudencia del fuero. Formulo reserva de ampliar los fundamentos de la presente oposición, tanto en sede administrativa como judicial.';

    const contenido = `
FORMULACIÓN DE OPOSICIÓN
Acta N° ${oposicion.actaOpuesta} — Clase ${oposicion.claseOpuesta}

Buenos Aires, ${fecha}

SEÑOR DIRECTOR NACIONAL DE MARCAS:

${FUNDAMENTOS_PLANTILLA}

---

${AGENTE.nombre}
${AGENTE.matricula_pi}
${AGENTE.matricula_abogado}

En nombre y representación de:
${user?.razonSocial || 'TITULAR'}
CUIT: ${formatCuit(user?.cuit || '')}
${user?.domicilio ? `Domicilio: ${user.domicilio}` : ''}
${user?.email ? `Email: ${user.email}` : ''}
    `.trim();

    const filePath = path.join(DOCS_DIR, `oposicion-${oposicion.actaOpuesta}-${Date.now()}.pdf`);
    await generarPDFTexto(contenido, filePath, {
      titulo: `OPOSICIÓN — Acta ${oposicion.actaOpuesta}`,
      subtitulo: `"${oposicion.denominacionOpuesta}" — Clase ${oposicion.claseOpuesta}`,
    });

    // Registrar en BD
    await prisma.documento.create({
      data: {
        userId,
        tipo: 'OPOSICION',
        nombre: `Oposición Acta ${oposicion.actaOpuesta}`,
        descripcion: `Oposición a marca "${oposicion.denominacionOpuesta}"`,
        url: filePath,
        marcaId: oposicion.marcaOponenteId,
        oposicionId,
      },
    });

    logger.info(`📄 PDF oposición generado: ${filePath}`);
    return filePath;
  },

  // ── MANTENIMIENTO DE OPOSICIÓN ─────────────────────────────────────────────

  /**
   * Genera PDF para mantener/ratificar una oposición (Art. 1 Res. INPI 297/2026).
   * Ruta portal: Marcas → Trámites → Escritos
   */
  async generarMantenimientoOposicion(oposicionId: string, userId: string, ampliarFundamentos?: string): Promise<string> {
    const oposicion = await prisma.oposicion.findFirst({
      where: { id: oposicionId, userId },
      include: { marcaOponente: true },
    });

    if (!oposicion) throw new Error('Oposición no encontrada');

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { razonSocial: true, cuit: true, domicilio: true },
    });

    const fecha = new Date().toLocaleDateString('es-AR', {
      day: 'numeric', month: 'long', year: 'numeric'
    });

    const contenido = `
RATIFICA Y MANTIENE OPOSICIÓN N° ${oposicion.numeroOposicion || '[NÚMERO]'}
EN LA SOLICITUD DE MARCA "${oposicion.denominacionOpuesta}", ACTA N° ${oposicion.actaOpuesta}, CLASE ${oposicion.claseOpuesta}

Buenos Aires, ${fecha}

SEÑOR DIRECTOR NACIONAL DE MARCAS:

${AGENTE.nombre}, en mi carácter de Agente de la Propiedad Industrial (${AGENTE.matricula_pi}), constituyendo domicilio en el acta de referencia, representando a ${user?.razonSocial || 'el titular'} (CUIT ${formatCuit(user?.cuit || '')}), a V.S. respetuosamente digo:

I. OBJETO

Que en tiempo y forma MANTENGO LA OPOSICIÓN N° ${oposicion.numeroOposicion || '[NÚMERO]'} formulada contra la solicitud de marca "${oposicion.denominacionOpuesta}", Acta N° ${oposicion.actaOpuesta}, Clase ${oposicion.claseOpuesta} del Nomenclador Internacional de Niza, conforme lo establecido en el Art. 1° del Reglamento aprobado por Resolución INPI N° 297/2026.

II. FUNDAMENTOS ORIGINALES

Ratifico en su totalidad los fundamentos vertidos al momento de formular la oposición, los cuales se tienen por reproducidos en este acto.

${ampliarFundamentos ? `III. AMPLIACIÓN DE FUNDAMENTOS\n\n${ampliarFundamentos}` : ''}

IV. PRUEBA

Ofrezco como prueba documental los registros marcarios del oponente que obran en los registros del INPI, cuya constatación solicito.

V. PETICIÓN

Por lo expuesto, solicito:
1. Se tenga por mantenida la oposición N° ${oposicion.numeroOposicion || '[NÚMERO]'};
2. Se tenga por presentada la ampliación de fundamentos adjunta;
3. Se resuelva la oposición declarándola FUNDADA con los efectos previstos en la Ley N° 22.362.

Proveer de conformidad.

---

${AGENTE.nombre}
${AGENTE.matricula_pi}
${AGENTE.matricula_abogado}
    `.trim();

    const filePath = path.join(DOCS_DIR, `mantenimiento-opo-${oposicion.actaOpuesta}-${Date.now()}.pdf`);
    await generarPDFTexto(contenido, filePath, {
      titulo: `MANTIENE OPOSICIÓN — Acta ${oposicion.actaOpuesta}`,
      subtitulo: `"${oposicion.denominacionOpuesta}" — Clase ${oposicion.claseOpuesta}`,
    });

    await prisma.documento.create({
      data: {
        userId,
        tipo: 'MANTENIMIENTO_OPOSICION',
        nombre: `Mantenimiento Oposición Acta ${oposicion.actaOpuesta}`,
        url: filePath,
        oposicionId,
      },
    });

    return filePath;
  },

  // ── DDJJ DE USO — MEDIO TÉRMINO ──────────────────────────────────────────

  /**
   * Genera DDJJ de uso de medio término (Art. 26 Ley 22.362).
   * Código arancel INPI: 181000
   * Ruta portal: Marcas → Trámites → Escritos
   *
   * Obligatoria para marcas concedidas/renovadas desde 12/01/2013.
   * Debe presentarse en el AÑO 6 desde la concesión.
   */
  async generarDDJJUsoMedioTermino(marcaId: string, userId: string, usada: boolean = true): Promise<string> {
    const marca = await prisma.marca.findFirst({
      where: { id: marcaId, userId },
    });

    if (!marca) throw new Error('Marca no encontrada');
    if (!marca.acta) throw new Error('La marca no tiene número de acta');

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { razonSocial: true, cuit: true, domicilio: true },
    });

    const fecha = new Date().toLocaleDateString('es-AR', {
      day: 'numeric', month: 'long', year: 'numeric'
    });

    // Modelo exacto según PresentacionDDJJ_JUL26.pdf
    const contenido = `
DECLARACIÓN JURADA DE USO DE MARCAS
Art. 26° Ley N° 22.362 — Medio Término

Buenos Aires, ${fecha}

SEÑOR DIRECTOR DE MARCAS:

${user?.razonSocial || marca.titularNombre}, CUIT ${formatCuit(user?.cuit || marca.titularCuit)}, domicilio constituido en ${user?.domicilio || '[DOMICILIO CONSTITUIDO EN EL ACTA]'}, en mi carácter de titular de registro ACTA ${marca.acta}${marca.resolucion ? `, Resolución N° ${marca.resolucion}` : ''}, manteniendo domicilio constituido en el acta de referencia digo:

Que el legal tiempo y forma vengo a FORMULAR DECLARACIÓN JURADA DE USO DE MEDIO TÉRMINO declarando bajo juramento que ${usada ? 'HA SIDO UTILIZADA' : 'NO HA SIDO UTILIZADA'} la marca "${marca.denominacion}" para distinguir los siguientes ${marca.productos.toLowerCase().includes('servic') ? 'servicios' : 'productos'}: ${marca.productos}, protegidos en la Clase ${marca.claseNiza} del Nomenclador Internacional de Niza.

Se tenga presente.

---

FIRMA DEL TITULAR:

${marca.titularNombre}
CUIT: ${formatCuit(marca.titularCuit)}

NOTA: Este documento debe ser FIRMADO DE PUÑO Y LETRA por el titular, escaneado en formato PDF no editable, y adjuntado en el portal INPI al momento de presentar el escrito.

Arancel a pagar: Código 181000 — MARCAS — DECLARACIÓN DE USO ART. 26 LEY 22.362
    `.trim();

    const filePath = path.join(DOCS_DIR, `ddjj-medio-termino-${marca.acta}-${Date.now()}.pdf`);
    await generarPDFTexto(contenido, filePath, {
      titulo: `DDJJ DE USO — Medio Término`,
      subtitulo: `Marca "${marca.denominacion}" — Acta ${marca.acta} — Clase ${marca.claseNiza}`,
    });

    await prisma.documento.create({
      data: {
        userId,
        tipo: 'DDJJ_USO_MEDIO_TERMINO',
        nombre: `DDJJ Uso Medio Término — ${marca.denominacion}`,
        descripcion: `Declaración jurada art. 26 Ley 22.362`,
        url: filePath,
        marcaId,
      },
    });

    logger.info(`📄 DDJJ uso medio término generada: ${filePath}`);
    return filePath;
  },

  // ── DDJJ DE USO PARA RENOVACIÓN ──────────────────────────────────────────

  /**
   * Genera DDJJ de uso para la renovación (últimos 5 años).
   * Modelo según VistaAdministrativaDDJJUso_JUL26.pdf
   */
  async generarDDJJUsoRenovacion(marcaId: string, userId: string, actaRenovacion: string): Promise<string> {
    const marca = await prisma.marca.findFirst({
      where: { id: marcaId, userId },
    });

    if (!marca) throw new Error('Marca no encontrada');

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { razonSocial: true, cuit: true },
    });

    const esTipo = marca.productos.toLowerCase().includes('servic') ? 'prestación del servicio' : 'comercialización del producto';

    // Modelo exacto según VistaAdministrativaDDJJUso_JUL26.pdf
    const contenido = `
DECLARACIÓN JURADA DE USO — RENOVACIÓN
Art. 26° Ley N° 22.362

Declaro bajo juramento que la marca N° ${marca.resolucion || marca.acta}, cuya renovación se solicita por acta N° ${actaRenovacion}, ha sido utilizada en los últimos 5 (cinco) años anteriores a su vencimiento en la clase ${marca.claseNiza} en la ${esTipo} ${marca.productos}.

Lugar y fecha: Buenos Aires, ${new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })}

---

FIRMA DEL TITULAR:

${marca.titularNombre}
CUIT: ${formatCuit(marca.titularCuit)}

NOTA: Firmar de puño y letra. Escanear como PDF no editable. Adjuntar en el portal INPI.
    `.trim();

    const filePath = path.join(DOCS_DIR, `ddjj-renovacion-${marca.acta}-${Date.now()}.pdf`);
    await generarPDFTexto(contenido, filePath, {
      titulo: `DDJJ DE USO — Renovación`,
      subtitulo: `Marca "${marca.denominacion}" — Registro ${marca.resolucion || marca.acta}`,
    });

    await prisma.documento.create({
      data: {
        userId,
        tipo: 'DDJJ_USO_RENOVACION',
        nombre: `DDJJ Uso Renovación — ${marca.denominacion}`,
        url: filePath,
        marcaId,
      },
    });

    return filePath;
  },
};

// ── Generador PDF con pdf-lib ─────────────────────────────────────────────────

async function generarPDFTexto(
  texto: string,
  outputPath: string,
  opciones: { titulo: string; subtitulo?: string }
): Promise<void> {
  if (!fs.existsSync(DOCS_DIR)) {
    fs.mkdirSync(DOCS_DIR, { recursive: true });
  }

  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 595.28;  // A4
  const pageHeight = 841.89;
  const margin = 60;
  const contentWidth = pageWidth - 2 * margin;

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  // Encabezado
  page.drawText('MARCAS FÁCIL', {
    x: margin, y,
    size: 10, font: fontBold, color: rgb(0.2, 0.4, 0.8),
  });
  y -= 14;

  page.drawText('Honorio M. Leguizamón Pondal — Agente de la Propiedad Industrial Mat. N° 1974', {
    x: margin, y,
    size: 8, font: fontRegular, color: rgb(0.4, 0.4, 0.4),
  });
  y -= 20;

  // Línea separadora
  page.drawLine({
    start: { x: margin, y }, end: { x: pageWidth - margin, y },
    thickness: 0.5, color: rgb(0.7, 0.7, 0.7),
  });
  y -= 20;

  // Título
  page.drawText(opciones.titulo, {
    x: margin, y,
    size: 14, font: fontBold, color: rgb(0.1, 0.1, 0.1),
  });
  y -= 18;

  if (opciones.subtitulo) {
    page.drawText(opciones.subtitulo, {
      x: margin, y,
      size: 11, font: fontRegular, color: rgb(0.3, 0.3, 0.3),
    });
    y -= 25;
  }

  // Contenido del documento
  const lineas = texto.split('\n');
  const fontSize = 9.5;
  const lineHeight = 13;

  for (const linea of lineas) {
    if (y < margin + 40) {
      // Nueva página
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }

    // Detectar si es sección (mayúsculas al inicio de línea)
    const esSecccion = /^[IVX]+\.|^[A-Z\s]{5,}:/.test(linea.trim());
    const font = esSecccion ? fontBold : fontRegular;
    const size = esSecccion ? 10 : fontSize;

    if (linea.trim() === '') {
      y -= lineHeight / 2;
      continue;
    }

    if (linea.startsWith('---')) {
      page.drawLine({
        start: { x: margin, y: y + 4 }, end: { x: pageWidth - margin, y: y + 4 },
        thickness: 0.3, color: rgb(0.7, 0.7, 0.7),
      });
      y -= lineHeight;
      continue;
    }

    // Wrap de texto largo
    const palabras = linea.split(' ');
    let lineaActual = '';

    for (const palabra of palabras) {
      const prueba = lineaActual ? `${lineaActual} ${palabra}` : palabra;
      const ancho = font.widthOfTextAtSize(prueba, size);

      if (ancho > contentWidth) {
        if (lineaActual) {
          page.drawText(lineaActual, { x: margin, y, size, font, color: rgb(0.1, 0.1, 0.1) });
          y -= lineHeight;
          if (y < margin + 40) {
            page = pdfDoc.addPage([pageWidth, pageHeight]);
            y = pageHeight - margin;
          }
        }
        lineaActual = palabra;
      } else {
        lineaActual = prueba;
      }
    }

    if (lineaActual) {
      page.drawText(lineaActual, { x: margin, y, size, font, color: rgb(0.1, 0.1, 0.1) });
      y -= lineHeight;
    }
  }

  // Pie de página en última página
  y = margin - 10;
  page.drawText(
    `Documento generado por MARCAS FÁCIL — ${new Date().toLocaleDateString('es-AR')}`,
    { x: margin, y, size: 7, font: fontRegular, color: rgb(0.6, 0.6, 0.6) }
  );

  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(outputPath, pdfBytes);
}
