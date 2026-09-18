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
  repartirPorcentajes,
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
  const denominacion = String(req.query.denominacion || 'PRUEBA MARCA FACIL WS 002');
  const clase = parseInt(String(req.query.clase || '25'), 10) || 25;
  // Mail del TITULAR. En producción sale de la ficha del cliente.
  const email = String(req.query.email || 'leguizamonpondal@gmail.com');

  // Mail del AGENTE — es el profesional, no el personal, y es distinto del
  // titular. Configurable por entorno para que el día que cambie no haya que
  // tocar código (p. ej. al constituirse la SAS).
  const emailAgente = process.env.INPI_EMAIL_AGENTE || 'estudio@leguizamonpondal.com';

  const domiciliosPrueba = [
    { tipo: 1 as const, idPais: 9, idProvincia: 1, localidad: 'CABA', domicilio: 'Calle de prueba', numero: 100, codPostal: '1000' },
    { tipo: 2 as const, idPais: 9, idProvincia: 1, localidad: 'CABA', domicilio: 'Calle de prueba', numero: 100, codPostal: '1000' },
  ];

  // &tipoTitular=fisica prueba el camino de la persona física, que ejercita los
  // campos que en la jurídica salen vacíos a propósito: Tipo_Dni, Num_Dni,
  // Genero, Estado_Civil y —con estado civil 2 (casado/a)— Conjuge.
  // El manual: "Para persona jurídica no mandar DNI ni estado civil, Genero = 0".
  const titularFisica = String(req.query.tipoTitular || '') === 'fisica';

  // &cotitulares=N prueba el caso de varios titulares. En la app, el primero es
  // el usuario (sus datos ya están del alta) y los demás los carga a mano.
  // CUITs de prueba distintos entre sí: el manual prohíbe repetirlos.
  const cantidadCotitulares = Math.min(Math.max(parseInt(String(req.query.cotitulares || '1'), 10) || 1, 1), 4);
  const CUITS_PRUEBA = ['30500000003', '30546741253', '30500001409', '30707680477'];

  const marca: MarcaNuevaWS = {
    denominacion,
    clase,
    tipoMarca: 1,                    // 1 = Denominativa
    observacionesProteccion: 'Prueba técnica de integración. Vestidos, calzados, sombrerería.',
    titulares: titularFisica
      ? [
          {
            // CUIT de prueba de persona humana publicado por el INPI
            nomApe: 'TITULAR DE PRUEBA PERSONA FISICA',
            porcentaje: 100,
            cuit: String(req.query.cuitTitular || '20458255297').replace(/\D/g, ''),
            email,
            idTitularTipo: 1,        // 1 = Física
            tipoDni: 1,              // 1 = DNI
            numDni: '20458255',
            genero: 1,               // 1 = Masculino
            estadoCivil: 2,          // 2 = Casado/a → exige Conjuge
            conjuge: 'CONYUGE DE PRUEBA',
            domicilios: domiciliosPrueba,
          },
        ]
      : repartirPorcentajes(cantidadCotitulares).map((porcentaje, i) => ({
          nomApe: cantidadCotitulares === 1 ? 'TITULAR DE PRUEBA SA' : `COTITULAR DE PRUEBA ${i + 1} SA`,
          porcentaje,
          cuit: i === 0 ? cuitTitular : CUITS_PRUEBA[i],
          email,
          idTitularTipo: 2 as const,  // 2 = Jurídica
          genero: 0 as const,
          domicilios: domiciliosPrueba,
        })),
    // 🔑 Honorio como agente que presenta, no como titular.
    solicitantes: [
      {
        tipoPersona: 'A',            // A = agente
        nroSolicitante: 1974,        // matrícula de Agente de la Propiedad Industrial
        poderInscriptivo: 'NO',      // el poder especial no está inscripto en el INPI
        aceptaFacultades: true,
        email: emailAgente,
      },
    ],
  };

  // 🔑 EL PUNTO DE LA SEGUNDA PRUEBA (gestión 4107717 del 17/09/2026).
  //
  // Con solo `Solicitantes`, el formulario impreso mostró:
  //     CANTIDAD DE REPRESENTACION: 1
  //     REPRESENTACION → INFO: Sin datos
  //
  // Ese formulario es lo que ve el examinador, así que la condición de apoderado
  // especial tiene que constar ahí. Hipótesis: esa sección se alimenta del nodo
  // `Representantes`, que en la primera prueba no se mandó.
  //
  // Con &representantes=false se puede repetir la prueba anterior para comparar.
  if (String(req.query.representantes || '') !== 'false') {
    // 📅 FECHA DEL PODER
    //
    // En PRODUCCIÓN este valor es **la fecha en que el usuario aceptó los
    // términos y condiciones al darse de alta en la app** — ese es el acto por
    // el cual otorga el poder especial. Sale de `users.createdAt` (o del campo
    // de aceptación de T&C cuando exista); NUNCA es `new Date()` al momento de
    // presentar, porque el poder es anterior a la presentación.
    //
    // 🧪 En la PRUEBA se manda a propósito una fecha **distinta a la de hoy**:
    // si el formulario mostrara la fecha de hoy, no sabríamos si es nuestro dato
    // o un default del INPI. Con una fecha pasada, verla impresa prueba que el
    // campo viajó.
    const fechaPoder = String(req.query.fechaPoder || '2026-09-01');

    marca.representantes = [
      {
        nombre: 'HONORIO MARTINIANO LEGUIZAMON PONDAL',
        idTipoPJuridica: 63,                 // 63 = Apoderado Especial
        cuitGestor: String(process.env.INPI_WS_CUIT || '').replace(/\D/g, ''),
        agenteRepresentante: 1974,
        aceptaFacultades: 1,
        poderInscripto: false,               // el poder especial no se inscribe en el INPI
        lugarDeCelebracion: 'Ciudad Autónoma de Buenos Aires',
        fechaPoderInpi: fechaPoder,
        nombreTitular: marca.titulares[0]?.nomApe,
        email: emailAgente,
      },
    ];
  }

  if (!enviar) {
    return res.json({
      modo: 'dry-run',
      aviso: 'No se envió nada al INPI. Agregá &enviar=true para cargar de verdad.',
      queSeVaAProbar: marca.representantes?.length
        ? 'Si el nodo Representantes (Apoderado Especial, cod. 63 + agente 1974) hace que la sección REPRESENTACION del formulario impreso deje de decir "Sin datos".'
        : 'Titular con CUIT distinto al del usuario del WS + Honorio solo en Solicitantes (repite la prueba 4107717).',
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
        ? `Entrá al portal → "Mis Trámites" → "Trámites para Firmar" → gestión ${r.orden} → botón "Formulario". Mirá la sección REPRESENTACION: si ahora trae tus datos de apoderado especial en vez de "Sin datos", quedó resuelto. Después borrá el trámite.`
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
