/**
 * Identidad de la marca y del agente — TODO configurable por entorno
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Este archivo existe por una decisión explícita del 21/09/2026: hoy el
 * proyecto usa el dominio y la casilla del estudio, pero cuando la app esté
 * probada se va a constituir una SAS con su propio dominio `.com` y sus propias
 * cuentas de correo.
 *
 * Para que esa migración sea **cambiar variables en Railway y nada más**, acá
 * no hay un solo dato escrito a mano. Ni el nombre de la marca, ni el
 * remitente, ni la matrícula del agente, ni la dirección del estudio.
 *
 * ⚠️ REGLA: si escribís "MARCA FÁCIL", un mail, un teléfono o un número de
 *    matrícula en cualquier archivo del proyecto, está mal. Va acá.
 *
 * Los valores por defecto son los actuales del estudio, para que el sistema
 * arranque sin configurar nada. Cada uno se pisa con su variable de entorno.
 *
 * ── Por qué vive en `utils/` y no en un `config/` propio ───────────────────
 *
 * Razón práctica, no de diseño: la entrega de archivos a este repositorio se
 * hace subiéndolos a mano desde la interfaz de GitHub, y esa pantalla **no
 * permite crear una carpeta nueva** al subir un archivo. Poner este archivo en
 * un `config/` propio obligaba a un paso distinto al de los demás, con el
 * riesgo de dejarlo mal ubicado y romper el build.
 *
 * `utils/` ya existe y ya aloja configuración transversal (`logger`), así que
 * es un lugar defendible. Si algún día la entrega pasa a ser por `git push`,
 * mover esto a `config/` es un cambio de una línea por import.
 */

// ── La marca ─────────────────────────────────────────────────────────────────

export const marca = {
  /** Nombre comercial. Aparece en asuntos, encabezados y firmas. */
  nombre: process.env.MARCA_NOMBRE || 'MARCA FÁCIL',

  /** Nombre legal de quien presta el servicio. Hoy el estudio, mañana la SAS. */
  razonSocial:
    process.env.MARCA_RAZON_SOCIAL || 'Estudio Jurídico Leguizamón Pondal & Asoc.',

  /** Sitio público. Se usa en los enlaces del pie de los mails. */
  sitioWeb: process.env.MARCA_SITIO_WEB || 'https://marca-facil-smoky.vercel.app',

  /** URL base de la app, para armar los enlaces de invitación y de pago. */
  urlApp: process.env.MARCA_URL_APP || 'https://marca-facil-smoky.vercel.app',

  /** Color de los encabezados y botones. Un solo lugar para el día del rebrand. */
  colorPrincipal: process.env.MARCA_COLOR || '#1a3a6b',
};

// ── El agente que firma ──────────────────────────────────────────────────────

/**
 * Datos profesionales que van al pie de los mails y de los documentos.
 *
 * ⚠️ Decisión del usuario (21/09/2026): **solo la matrícula de Agente de la
 * Propiedad Industrial.** Nada de tomo y folio del CPACF ni de domicilio del
 * estudio.
 *
 * El criterio es correcto: ante el INPI lo que habilita a presentar es la
 * matrícula de Agente, no la de abogado. Exhibir la del CPACF en un trámite
 * marcario no agrega nada y ata el sistema a una identidad personal que, el día
 * que la gestión pase a la SAS, deja de ser la que corresponde.
 */
export const agente = {
  nombre: process.env.AGENTE_NOMBRE || 'Honorio M. Leguizamón Pondal',

  /**
   * Número de matrícula, como número. Es el dato que viaja al INPI en cada
   * presentación por Web Service (`nroSolicitante` y `agenteRepresentante`).
   *
   * Vive acá y no escrito en el código de la presentación porque el día que la
   * matrícula que presenta sea la de la SAS, cambia el número y no puede quedar
   * uno viejo enterrado en un archivo.
   */
  numero: Number(process.env.AGENTE_NUMERO || 1974),

  /** Cómo se lee la matrícula en un texto para humanos. */
  get matriculaApi(): string {
    return (
      process.env.AGENTE_MATRICULA_API ||
      `Agente de la Propiedad Industrial N° ${this.numero}`
    );
  },

  /** Mail de contacto profesional. Distinto del remitente técnico. */
  email: process.env.INPI_EMAIL_AGENTE || 'estudio@leguizamonpondal.com',
};

// ── El correo ────────────────────────────────────────────────────────────────

/**
 * Configuración del remitente y del servidor SMTP.
 *
 * `from` es desde dónde SALE el mail — lo que mira el servidor del destinatario
 * para juzgar la reputación. `replyTo` es a dónde CONTESTA el cliente cuando
 * aprieta responder.
 *
 * Separarlos es lo que permite, más adelante, enviar desde el dominio de la
 * empresa nueva sin que las respuestas dejen de llegar a donde tienen que
 * llegar.
 */
export const correo = {
  remitenteNombre: process.env.MAIL_FROM_NOMBRE || marca.nombre,
  remitenteEmail: process.env.MAIL_FROM_EMAIL || 'estudio@leguizamonpondal.com',
  responderA: process.env.MAIL_REPLY_TO || 'estudio@leguizamonpondal.com',

  /** Copia oculta de cada envío, para tener registro de lo que salió. */
  copiaOculta: process.env.MAIL_BCC || '',

  smtp: {
    host: process.env.SMTP_HOST || '',
    puerto: Number(process.env.SMTP_PORT || 587),
    /**
     * true para el puerto 465 (SSL desde el primer byte), false para 587
     * (STARTTLS, que empieza en claro y sube a cifrado). Es la confusión más
     * común al configurar correo de hosting: poner 465 con secure=false, o 587
     * con secure=true, falla de formas poco informativas.
     */
    seguro: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    usuario: process.env.SMTP_USER || '',
    clave: process.env.SMTP_PASS || '',
  },
};

/** ¿Hay configuración suficiente para enviar de verdad? */
export function correoConfigurado(): boolean {
  return Boolean(correo.smtp.host && correo.smtp.usuario && correo.smtp.clave);
}

// ── Textos que cambian con la identidad ──────────────────────────────────────

/**
 * El pie legal de todos los mails. Se arma acá y no en cada plantilla para que
 * el día del cambio de identidad haya un solo lugar que tocar.
 */
export function pieLegal(): string {
  return `${agente.nombre} — ${agente.matriculaApi}`;
}
