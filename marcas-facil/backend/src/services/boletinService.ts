/**
 * SERVICIO DE VIGILANCIA MARCARIA — Boletín de Marcas INPI
 *
 * El Boletín de Marcas se publica todos los MIÉRCOLES.
 * Plazo para oponerse: 30 días corridos desde el día siguiente a la publicación.
 *
 * Ref: PresentacionOposicion_JUL26.pdf + Resolución INPI 297/2026
 */

import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '../db/client';
import { logger } from '../utils/logger';
import { vencimientoOposicion, vencimientoLegible, diasHastaVencimiento } from '../utils/plazos';
import { notificacionService } from './notificacionService';
// `cruzarBoletin` es el motor de cotejo, el mismo que usa el endpoint de
// cruce. Acá se importa para que lo que la app GUARDA sea exactamente lo que
// le MUESTRA al cliente; antes esta función tenía su propio cotejo, más
// simple, y los dos resultados no coincidían.
import { cruzarBoletin, agruparPorActa, type SolicitudDetectada } from './vigilanciaService';

export const boletinService = {

  /**
   * ⛔ RETIRADA — 23/09/2026.
   *
   * Esta función descargaba "el" boletín del miércoles desde una URL inventada
   * (`/boletin/{año}/boletin-{YYYYMMDD}.pdf`, que no existe) y daba la semana
   * por vigilada con un solo archivo. Tres suposiciones, ninguna verificada:
   * la URL, el formato del PDF y que hubiera un boletín por semana. Son cuatro
   * o cinco.
   *
   * La reemplaza `descargarBoletinesDeLaFecha()` en `boletinDescarga.ts`, que
   * descubre los boletines en el portal, los baja todos y verifica que estén
   * todos.
   *
   * Se deja tirando en lugar de borrarla porque el scheduler viejo puede
   * seguir llamándola: es preferible un error ruidoso a una vigilancia que
   * parece correr y no mira nada.
   */
  async descargarBoletin(_fecha?: Date): Promise<never> {
    throw new Error(
      'boletinService.descargarBoletin() está retirada: usaba una URL inexistente y ' +
        'asumía un boletín por semana cuando son cuatro o cinco. ' +
        'Usar descargarBoletinesDeLaFecha() de services/boletinDescarga.ts.'
    );
  },

  /**
   * Corre la vigilancia de una fecha y deja registrada cada coincidencia como
   * una oposición en estado PENDIENTE, con su alerta.
   *
   * ── Por qué esta función se reescribió (26/09/2026) ──────────────────────
   *
   * Antes tenía su propio cotejo: recorría las entradas contra las marcas y
   * decidía con `esConfundible()`, que aplica umbrales fijos de 0,72 y 0,85
   * sobre los tres ejes y nada más. El endpoint de cruce, en cambio, usa
   * `cruzarBoletin()`, que aplica afinidad de clases, cuasi-identidad,
   * vigilancia ampliada para notorias y mot vedette, e informa por qué eje
   * entró cada coincidencia.
   *
   * O sea: **la app le mostraba al cliente un resultado y guardaba otro.**
   * Nadie lo había notado porque el camino que escribe nunca se había
   * ejecutado. Ahora las dos usan el mismo motor, que es la única forma de
   * que lo que se ve sea lo que se guarda.
   *
   * ── El modo seco ─────────────────────────────────────────────────────────
   *
   * `seco: true` calcula todo pero no escribe nada: ni oposiciones, ni
   * alertas, ni avisos push, ni la marca de `procesado` en las entradas.
   * Existe porque esta función tiene tres efectos irreversibles —crea
   * registros, notifica al cliente y consume el boletín— y hacía falta poder
   * verla funcionar antes de dejarla suelta sobre 3.685 actas.
   *
   * `limite` corta después de N coincidencias escritas. Para la primera
   * corrida de verdad: una sola, se revisa, y recién después el resto.
   */
  async procesarVigilancia(
    fechaBoletin?: Date,
    opciones: { seco?: boolean; limite?: number } = {}
  ): Promise<{
    seco: boolean;
    coincidenciasEncontradas: number;
    oposicionesCreadas: number;
    alertasCreadas: number;
    yaExistian: number;
    entradasMarcadasProcesadas: number;
    detalle: { marca: string; acta: string; actaDenominacion: string; similitud: number; motivo: string }[];
    /** Las mismas coincidencias, juntadas por solicitud: es lo que hay que mirar. */
    solicitudes: SolicitudDetectada[];
    advertencias: string[];
  }> {
    const { seco = false, limite } = opciones;
    const fecha = fechaBoletin || getUltimoMiercoles();

    logger.info(
      `🔍 [Vigilancia] ${seco ? 'SECO — no escribe — ' : ''}` +
        `boletín del ${fecha.toLocaleDateString('es-AR')}` +
        (limite ? ` · límite ${limite}` : '')
    );

    // El mismo motor que ve el cliente. Ver el comentario de arriba.
    const cruce = await cruzarBoletin(fecha);

    const detalle: { marca: string; acta: string; actaDenominacion: string; similitud: number; motivo: string }[] = [];
    let oposicionesCreadas = 0;
    let alertasCreadas = 0;
    let yaExistian = 0;

    if (cruce.coincidencias.length === 0) {
      return {
        seco,
        coincidenciasEncontradas: 0,
        oposicionesCreadas: 0,
        alertasCreadas: 0,
        yaExistian: 0,
        entradasMarcadasProcesadas: 0,
        detalle,
        solicitudes: [],
        advertencias: cruce.advertencias,
      };
    }

    // Los datos que la oposición necesita de la marca propia y que el cruce no
    // devuelve. Se traen de una sola vez y no de a una por coincidencia.
    const marcas = await prisma.marca.findMany({
      where: { id: { in: [...new Set(cruce.coincidencias.map((c) => c.marcaId))] } },
      select: {
        id: true, userId: true, denominacion: true, claseNiza: true,
        acta: true, resolucion: true, productos: true, titularNombre: true,
      },
    });
    // El tipo explícito no es decorativo: sin él, `new Map(array.map(...))`
    // infiere Map<unknown, unknown> y se pierde todo el tipado de la marca.
    type MarcaBase = {
      id: string; userId: string; denominacion: string; claseNiza: number;
      acta: string | null; resolucion: string | null;
      productos: string | null; titularNombre: string;
    };
    const porId = new Map<string, MarcaBase>(
      (marcas as MarcaBase[]).map((m) => [m.id, m])
    );

    const plazoOposicion = vencimientoOposicion(fecha);
    const vencimientoTexto = vencimientoLegible(plazoOposicion);

    for (const c of cruce.coincidencias) {
      if (limite !== undefined && oposicionesCreadas >= limite) break;

      const marca = porId.get(c.marcaId);
      if (!marca) continue;

      // Una oposición por par marca-acta. Si la vigilancia se vuelve a correr
      // sobre la misma fecha, no se duplica.
      const existente = await prisma.oposicion.findFirst({
        where: { marcaOponenteId: marca.id, actaOpuesta: c.acta },
        select: { id: true },
      });
      if (existente) { yaExistian++; continue; }

      detalle.push({
        marca: `${marca.denominacion} (cl. ${marca.claseNiza})`,
        acta: c.acta,
        actaDenominacion: c.actaDenominacion,
        similitud: c.similitud,
        motivo: c.ejeQueDisparo ? `${c.motivo} · eje ${c.ejeQueDisparo}` : c.motivo,
      });

      if (seco) continue;

      const oposicion = await prisma.oposicion.create({
        data: {
          userId: marca.userId,
          marcaOponenteId: marca.id,
          boletinEntradaId: c.entradaId,
          actaOpuesta: c.acta,
          denominacionOpuesta: c.actaDenominacion,
          claseOpuesta: c.actaClase,
          // El modelo llama `oponenteNombre` al titular de la marca OPUESTA
          // (así lo documenta el schema). No existe `titularOpuesto`.
          oponenteNombre: c.actaTitular,
          // Requerido por el modelo: es la fecha del boletín, la que hace
          // correr el plazo del art. 15 de la Ley 22.362.
          fechaPublicacion: fecha,
          // El campo es `plazoOposicion`, no `plazoVence`.
          plazoOposicion,
          estado: 'PENDIENTE',
          fundamentosTexto: generarFundamentosOposicion({
            marcaOponente: marca.denominacion,
            actaOponente: marca.acta || '',
            resolucionOponente: marca.resolucion || '',
            claseOponente: marca.claseNiza,
            productosOponente: marca.productos || '',
            marcaOpuesta: c.actaDenominacion,
            actaOpuesta: c.acta,
            claseOpuesta: c.actaClase,
            productosOpuestos: '',
            titularOponente: marca.titularNombre,
            similitud: c.similitud,
            razon: c.explicacion,
          }),
        },
      });
      oposicionesCreadas++;

      await prisma.alerta.create({
        data: {
          userId: marca.userId,
          tipo: 'OPOSICION_DETECTADA',
          titulo: `⚠️ Marca confundible detectada: "${c.actaDenominacion}"`,
          descripcion:
            `Se publicó en el Boletín del ${fecha.toLocaleDateString('es-AR')} la solicitud ` +
            `"${c.actaDenominacion}" (Acta ${c.acta}, Clase ${c.actaClase}) de ${c.actaTitular}, ` +
            `confundible con tu marca "${marca.denominacion}" (Clase ${marca.claseNiza}). ` +
            `${c.explicacion} ` +
            `Plazo para oponerse: hasta el ${vencimientoTexto} a las 23:59 ` +
            `(${diasHastaVencimiento(plazoOposicion)} días corridos).`,
          // `urgente` no existe en el modelo Alerta. La urgencia ya está en el
          // tipo, y lo que sí hacía falta es la fecha de vencimiento: el modelo
          // la indexa y es lo que ordena el panel por plazo más próximo.
          fechaVencimiento: plazoOposicion,
          marcaId: marca.id,
          oposicionId: oposicion.id,
          fechaAlerta: new Date(),
        },
      });
      alertasCreadas++;

      await notificacionService.enviarAlertaOposicion(
        marca.userId,
        marca.denominacion,
        c.actaDenominacion,
        c.acta,
        plazoOposicion
      );
    }

    // Marcar las entradas como procesadas es lo que impide volver a mirarlas.
    // En seco no se toca, y con `limite` tampoco: quedaron actas sin revisar.
    let entradasMarcadasProcesadas = 0;
    if (!seco && limite === undefined) {
      const r = await prisma.boletinEntrada.updateMany({
        where: { fechaBoletin: fecha, procesado: false },
        data: { procesado: true },
      });
      entradasMarcadasProcesadas = r.count;
    }

    logger.info(
      `✅ [Vigilancia] ${cruce.coincidencias.length} coincidencias · ` +
        `${oposicionesCreadas} oposiciones · ${alertasCreadas} alertas · ` +
        `${yaExistian} ya existían${seco ? ' (SECO: no se escribió nada)' : ''}`
    );

    return {
      seco,
      coincidenciasEncontradas: cruce.coincidencias.length,
      oposicionesCreadas,
      alertasCreadas,
      yaExistian,
      entradasMarcadasProcesadas,
      detalle,
      solicitudes: agruparPorActa(cruce.coincidencias),
      advertencias: cruce.advertencias,
    };
  },

  /**
   * Carga manual de marcas del boletín (cuando el PDF no se puede parsear automáticamente)
   */
  async cargarManual(datos: {
    fechaBoletin: Date;
    acta: string;
    denominacion: string;
    tipoMarca: string;
    claseNiza: number;
    titularNombre: string;
    titularCuit?: string;
    productos?: string;
  }[]) {
    const results = await Promise.allSettled(
      datos.map(d =>
        prisma.boletinEntrada.upsert({
          where: { acta: d.acta },
          create: d,
          update: {},
        })
      )
    );
    return results.filter(r => r.status === 'fulfilled').length;
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getUltimoMiercoles(): Date {
  const hoy = new Date();
  const dia = hoy.getDay(); // 0=Dom, 3=Mie
  const diasAtras = dia >= 3 ? dia - 3 : dia + 4;
  const mie = new Date(hoy);
  mie.setDate(hoy.getDate() - diasAtras);
  mie.setHours(0, 0, 0, 0);
  return mie;
}

/**
 * Determina si dos clases NIZA son comparables a efectos de oposición.
 * En la misma clase siempre. En clases relacionadas, criterio amplio del INPI.
 */
function clasesRelacionadas(clase1: number, clase2: number): boolean {
  if (clase1 === clase2) return true;

  // Clases con alta relación comercial según jurisprudencia INPI
  const relacionadas: Record<number, number[]> = {
    3: [44],          // Cosmética / servicios de salud/belleza
    5: [44, 3],       // Farmacéutica / cosmética / salud
    9: [42, 38],      // Software / tecnología / telecomunicaciones
    25: [26, 35, 18], // Indumentaria / accesorios / moda / comercio
    35: [36, 42, 45], // Servicios comerciales / financieros / tecnológicos / legales
    36: [35, 45],     // Financiero / comercial / legal
    41: [42, 45, 35], // Educación / entretenimiento
    43: [30, 32, 33], // Restauración / alimentos / bebidas
    44: [5, 3],       // Servicios médicos / farmacéutica / cosmética
  };

  return relacionadas[clase1]?.includes(clase2) || relacionadas[clase2]?.includes(clase1) || false;
}

/**
 * Genera el BORRADOR de fundamentos de oposición siguiendo la estructura
 * de la plantilla estándar del estudio.
 *
 * IMPORTANTE: Este texto es un borrador pre-completado que el profesional
 * (Honorio) revisa y ajusta antes de presentar. Los campos entre [CORCHETES]
 * deben completarse manualmente según el caso concreto.
 */
function generarFundamentosOposicion(params: {
  marcaOponente: string;
  actaOponente: string;
  resolucionOponente: string;
  claseOponente: number;
  productosOponente: string;
  marcaOpuesta: string;
  actaOpuesta: string;
  claseOpuesta: number;
  productosOpuestos: string;
  titularOponente: string;
  similitud: number;
  razon: string;
}): string {
  const {
    marcaOponente, actaOponente, resolucionOponente, claseOponente,
    productosOponente, marcaOpuesta, actaOpuesta, claseOpuesta,
    productosOpuestos, titularOponente,
  } = params;

  const mismaClase = claseOponente === claseOpuesta;
  const referenciaPropia = resolucionOponente
    ? `Resolución N° ${resolucionOponente}`
    : `Acta N° ${actaOponente}`;

  // Texto exacto de la plantilla oficial del estudio.
  // Es el mismo para todas las oposiciones — no se modifica.
  return `La solicitud de marca presentada es directamente confundible con la/s marca/s de nuestra propiedad. Niego, por no constarme, que el/la solicitante tenga interés legítimo para registrar la marca opuesta. Fundo el derecho de nuestra parte en los arts. 3, 4, 24 y demás concordantes de la Ley 22.362 y jurisprudencia del fuero. Formulo reserva de ampliar los fundamentos de la presente oposición, tanto en sede administrativa como judicial.`;
}

/**
 * Parsea el PDF del Boletín de Marcas para extraer las solicitudes publicadas.
 * El boletín tiene un formato estructurado: N° Acta, Titular, Clase, Denominación, Tipo.
 *
 * NOTA: La implementación real usa pdfjs-dist para parsear el PDF.
 * Para MVP inicial se puede hacer scraping del portal del INPI.
 */
async function parsearBoletinPDF(pdfPath: string, fecha: Date): Promise<Array<{
  acta: string;
  denominacion: string;
  tipoMarca: string;
  claseNiza: number;
  titularNombre: string;
  titularCuit?: string;
  productos?: string;
}>> {
  try {
    // Parseo con pdf-parse (CommonJS compatible)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse') as (buffer: Buffer) => Promise<{ text: string }>;
    const dataBuffer = fs.readFileSync(pdfPath);
    const pdfData = await pdfParse(dataBuffer);
    const fullText = pdfData.text;
    const marcas: any[] = [];

    // El boletín INPI tiene páginas — las dividimos por saltos
    const pages = fullText.split('\f').filter((p: string) => p.trim());
    for (const text of pages.length > 0 ? pages : [fullText]) {

      // El boletín tiene formato tabular: extraer con regex
      // Formato típico: ACTA N° XXXXXXX DENOMINACION (TIPO) CLASE XX TITULAR
      const regexActa = /ACTA\s+N[°º]\s*(\d[\d.,]+)/gi;
      let match;

      while ((match = regexActa.exec(text)) !== null) {
        const acta = match[1].replace(/[.,]/g, '');
        // Extraer datos del contexto alrededor del acta
        const contexto = text.substring(match.index, match.index + 500);

        const claseMatch = contexto.match(/CLASE\s+(\d{1,2})/i);
        const clase = claseMatch ? parseInt(claseMatch[1]) : 0;

        if (clase > 0 && clase <= 45) {
          marcas.push({
            acta,
            denominacion: extraerDenominacion(contexto) || `MARCA-${acta}`,
            tipoMarca: extraerTipoMarca(contexto) || 'DENOMINATIVA',
            claseNiza: clase,
            titularNombre: extraerTitular(contexto) || 'TITULAR NO IDENTIFICADO',
            titularCuit: extraerCuit(contexto),
            productos: extraerProductos(contexto),
          });
        }
      }
    }

    return marcas;
  } catch (err) {
    logger.warn(`No se pudo parsear PDF automáticamente: ${err}. Se requiere carga manual.`);
    return [];
  }
}

// Funciones auxiliares de parsing del PDF
function extraerDenominacion(texto: string): string {
  const match = texto.match(/["«»"]([^"«»"]+)["«»"]/);
  return match ? match[1].trim() : '';
}

function extraerTipoMarca(texto: string): string {
  const tipos = ['DENOMINATIVA', 'FIGURATIVA', 'MIXTA', 'TRIDIMENSIONAL', 'SONORA', 'OLFATIVA'];
  for (const tipo of tipos) {
    if (texto.toUpperCase().includes(tipo)) return tipo;
  }
  return 'DENOMINATIVA';
}

function extraerTitular(texto: string): string {
  const match = texto.match(/TITULAR[:\s]+([A-ZÁÉÍÓÚÑ\s,.-]+?)(?:CLASE|CUIT|$)/i);
  return match ? match[1].trim().substring(0, 100) : '';
}

function extraerCuit(texto: string): string | undefined {
  const match = texto.match(/CUIT[:\s]+(\d{2}-?\d{8}-?\d)/i);
  return match ? match[1].replace(/\D/g, '') : undefined;
}

function extraerProductos(texto: string): string | undefined {
  const match = texto.match(/PRODUCTOS?[:\s]+(.+?)(?:TITULAR|CLASE|$)/i);
  return match ? match[1].trim().substring(0, 500) : undefined;
}
