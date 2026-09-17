/**
 * Presentación de trámites ante el INPI
 * ------------------------------------------------------------------
 * Por ahora contiene UN endpoint de prueba, cuyo único objetivo es responder
 * la pregunta de la que cuelga toda la arquitectura de MARCA FÁCIL:
 *
 *   ¿Un trámite cargado por Web Service con las credenciales de Honorio,
 *   con el CLIENTE como titular y Honorio declarado en `Solicitantes` como
 *   agente (TipoPersona="A", NroSolicitante=1974), es aceptado por el INPI
 *   y queda en el panel de Honorio para que él lo firme?
 *
 * Por qué hace falta probarlo y no alcanza con leer el manual:
 *   · El manual dice que `Solicitantes` se valida "cuando el CUIT del titular
 *     difiere del usuario" — nuestro caso exacto.
 *   · Pero el ejemplo oficial del INPI **esquiva ese caso a propósito**: "el
 *     usuario que ingresa coincide con el primer titular para no requerir
 *     Solicitantes en marcas". No hay ejemplo de esta combinación.
 *   · Y el INPI aclaró que "transmitir y firmar son roles distintos", sin
 *     precisar si un agente declarado en `Solicitantes` queda habilitado.
 *
 * Por qué la prueba es segura (confirmado por el INPI, 15/09/2026):
 *   · Un trámite cargado y no firmado NO tiene validez legal.
 *   · NO genera arancel.
 *   · Se elimina desde el portal sin problema.
 */
import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger';
import {
  ingresarMarcaNuevaWS,
  parsearRespuestaIngreso,
  type MarcaNuevaWS,
} from '../../services/inpiWsService';

const router = Router();

// ── GET /api/presentacion/prueba-carga ───────────────────────────────────────
//
// ⚠️ ENDPOINT TEMPORAL DE DIAGNÓSTICO. Borrar una vez respondida la pregunta.
//
// Doble traba para que no se dispare por accidente ni lo encuentre un tercero:
//   1. Requiere `INPI_TEST_TOKEN` seteada en Railway y pasada como ?token=
//   2. Por defecto NO envía nada: devuelve el XML para revisarlo (dry run).
//      Para enviar de verdad hay que agregar &enviar=true explícitamente.
//
// Uso:
//   .../api/presentacion/prueba-carga?token=XXX                  → ver el XML
//   .../api/presentacion/prueba-carga?token=XXX&enviar=true      → cargar
//
// Parámetros opcionales: &denominacion= &clase= &cuitTitular= &email=
router.get('/prueba-carga', async (req: Request, res: Response) => {
  const tokenEsperado = process.env.INPI_TEST_TOKEN || '';
  const token = String(req.query.token || '');

  if (!tokenEsperado) {
    return res.status(503).json({
      error: 'Prueba deshabilitada',
      detalle: 'Falta la variable INPI_TEST_TOKEN en el entorno.',
    });
  }
  if (token !== tokenEsperado) {
    return res.status(403).json({ error: 'Token inválido' });
  }

  const enviar = String(req.query.enviar || '') === 'true';

  // CUIT de prueba publicado por el INPI en sus ejemplos oficiales
  // (persona jurídica). Distinto del CUIT de Honorio a propósito: es lo que
  // fuerza la validación del nodo Solicitantes.
  const cuitTitular = String(req.query.cuitTitular || '30500000003').replace(/\D/g, '');
  const denominacion = String(req.query.denominacion || 'PRUEBA MARCA FACIL WS 001');
  const clase = parseInt(String(req.query.clase || '25'), 10) || 25;
  const email = String(req.query.email || 'leguizamonpondal@gmail.com');

  const marca: MarcaNuevaWS = {
    denominacion,
    clase,
    tipoMarca: 1,                    // 1 = Denominativa
    observacionesProteccion: 'Prueba técnica de integración. Vestidos, calzados, sombrerería.',
    titulares: [
      {
        nomApe: 'TITULAR DE PRUEBA SA',
        porcentaje: 100,
        cuit: cuitTitular,
        email,
        idTitularTipo: 2,            // 2 = Jurídica
        genero: 0,
        domicilios: [
          { tipo: 1, idPais: 9, idProvincia: 1, localidad: 'CABA', domicilio: 'Calle de prueba', numero: 100, codPostal: '1000' },
          { tipo: 2, idPais: 9, idProvincia: 1, localidad: 'CABA', domicilio: 'Calle de prueba', numero: 100, codPostal: '1000' },
        ],
      },
    ],
    // 🔑 EL PUNTO DE LA PRUEBA: Honorio como agente, no como titular.
    solicitantes: [
      {
        tipoPersona: 'A',            // A = agente
        nroSolicitante: 1974,        // matrícula de Agente de la Propiedad Industrial
        poderInscriptivo: 'NO',      // el poder especial no está inscripto en el INPI
        aceptaFacultades: true,
        email,
      },
    ],
  };

  if (!enviar) {
    return res.json({
      modo: 'dry-run',
      aviso: 'No se envió nada al INPI. Agregá &enviar=true para cargar de verdad.',
      queSeVaAProbar:
        'Titular con CUIT distinto al del usuario del WS + Honorio declarado en Solicitantes como agente (TipoPersona="A", NroSolicitante=1974).',
      credenciales: {
        INPI_WS_CUIT: process.env.INPI_WS_CUIT ? 'seteada' : '❌ FALTA',
        INPI_WS_CLAVE: process.env.INPI_WS_CLAVE ? 'seteada' : '❌ FALTA',
      },
      marca,
    });
  }

  logger.warn(`[Presentación] ⚠️ PRUEBA REAL: cargando "${denominacion}" clase ${clase} en el INPI`);
  const inicio = Date.now();

  try {
    const r = await ingresarMarcaNuevaWS(marca);
    return res.json({
      modo: 'envío real',
      latenciaMs: Date.now() - inicio,
      ok: r.ok,
      ordenGestion: r.orden,
      mensaje: r.mensaje,
      respuestaCruda: r.crudo,
      siguientePaso: r.ok
        ? `Entrá al portal del INPI con tu Clave Fiscal → "Mis Trámites" y buscá la gestión ${r.orden}. Si aparece y podés firmarla, la arquitectura queda confirmada. Después borrala.`
        : 'El INPI rechazó la carga. El mensaje de arriba dice por qué — son descripciones de reglas de validación, no códigos.',
    });
  } catch (err: any) {
    logger.error(`[Presentación] Falló la prueba de carga: ${err?.message}`);
    return res.status(502).json({
      modo: 'envío real',
      latenciaMs: Date.now() - inicio,
      error: err?.message || 'error desconocido',
      operacion: err?.operacion,
    });
  }
});

// ── GET /api/presentacion/parsear?texto=... ──────────────────────────────────
// Verifica el parser de respuestas sin tocar el INPI. Útil para probar los
// formatos "OK, orden:N" y "<errores>, orden:-1".
router.get('/parsear', (req: Request, res: Response) => {
  const texto = String(req.query.texto || '');
  if (!texto) return res.status(400).json({ error: 'Falta el parámetro ?texto=' });
  return res.json(parsearRespuestaIngreso(texto));
});

export default router;
