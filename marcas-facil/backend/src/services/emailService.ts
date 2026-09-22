/**
 * Servicio de correo — Nodemailer
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Destraba tres cosas que estaban bloqueadas por no poder mandar un mail:
 *   · el volante con el QR al cliente, después de generar el VEP
 *   · la invitación a los cotitulares para que acepten su poder
 *   · los avisos de pago pendiente y de pago acreditado
 *
 * ── Decisiones de diseño ───────────────────────────────────────────────────
 *
 * 1. **Ni un dato de identidad acá dentro.** Todo sale de `utils/identidad`.
 *    Ver la explicación en ese archivo: la app va a mudarse al dominio de una
 *    SAS y eso tiene que ser cambiar variables, no editar plantillas.
 *
 * 2. **Enviar un mail NUNCA rompe el flujo que lo disparó.** Si falla el SMTP
 *    después de haber firmado un trámite y emitido un VEP ante el INPI, el
 *    trámite sigue estando bien hecho. Las funciones devuelven un resultado
 *    con `ok: false` en vez de lanzar excepción, y el llamador decide.
 *
 * 3. **Sin SMTP configurado, no falla: registra.** En desarrollo escribe el
 *    mail en el log y sigue. Así se puede trabajar en todo el circuito sin
 *    tener credenciales de correo a mano.
 *
 * 4. **HTML de correo, no HTML de web.** Tablas, estilos en línea, ancho fijo
 *    de 600px. Outlook sigue usando el motor de Word para renderizar: flexbox,
 *    grid y hojas de estilo externas no funcionan.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { logger } from '../utils/logger';
import { marca, agente, correo, correoConfigurado, pieLegal } from './../utils/identidad';

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface AdjuntoMail {
  nombre: string;
  contenido: Buffer;
  tipo?: string;
}

export interface ResultadoEnvio {
  ok: boolean;
  messageId?: string;
  /** true cuando no había SMTP configurado y solo se registró en el log. */
  simulado?: boolean;
  error?: string;
}

// ── Transporte ───────────────────────────────────────────────────────────────

let transporter: Transporter | null = null;

function obtenerTransporter(): Transporter | null {
  if (!correoConfigurado()) return null;
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: correo.smtp.host,
    port: correo.smtp.puerto,
    secure: correo.smtp.seguro,
    auth: { user: correo.smtp.usuario, pass: correo.smtp.clave },
    // Los servidores de hosting compartido suelen tardar en el saludo inicial.
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
  });

  return transporter;
}

/**
 * Prueba la conexión SMTP sin mandar nada. Es lo primero que hay que correr
 * después de cargar las credenciales: distingue un problema de configuración
 * de un problema de contenido, que si no se confunden.
 */
export async function verificarConexion(): Promise<ResultadoEnvio> {
  const t = obtenerTransporter();
  if (!t) {
    return {
      ok: false,
      error:
        'Faltan credenciales SMTP. Definir SMTP_HOST, SMTP_USER y SMTP_PASS en el entorno.',
    };
  }
  try {
    await t.verify();
    logger.info(`[Mail] Conexión SMTP verificada contra ${correo.smtp.host}`);
    return { ok: true };
  } catch (err: any) {
    logger.error(`[Mail] Falló la verificación SMTP: ${err?.message}`);
    return { ok: false, error: err?.message || 'error desconocido' };
  }
}

// ── Envío ────────────────────────────────────────────────────────────────────

export async function enviarMail(opts: {
  para: string | string[];
  asunto: string;
  html: string;
  texto?: string;
  adjuntos?: AdjuntoMail[];
}): Promise<ResultadoEnvio> {
  const destinatarios = Array.isArray(opts.para) ? opts.para.join(', ') : opts.para;
  const t = obtenerTransporter();

  // Sin SMTP: se registra y se sigue. No es un error.
  if (!t) {
    logger.warn(
      `[Mail] SIN ENVIAR (falta configuración SMTP) → para: ${destinatarios} · asunto: "${opts.asunto}"` +
        (opts.adjuntos?.length ? ` · adjuntos: ${opts.adjuntos.map((a) => a.nombre).join(', ')}` : '')
    );
    return { ok: true, simulado: true };
  }

  try {
    const info = await t.sendMail({
      from: `"${correo.remitenteNombre}" <${correo.remitenteEmail}>`,
      replyTo: correo.responderA,
      bcc: correo.copiaOculta || undefined,
      to: destinatarios,
      subject: opts.asunto,
      html: opts.html,
      // Los clientes que no renderizan HTML muestran esto. Además, un mail sin
      // versión de texto plano puntúa peor en los filtros de spam.
      text: opts.texto || textoDesdeHtml(opts.html),
      attachments: opts.adjuntos?.map((a) => ({
        filename: a.nombre,
        content: a.contenido,
        contentType: a.tipo || 'application/octet-stream',
      })),
    });

    logger.info(`[Mail] Enviado a ${destinatarios}: "${opts.asunto}" (${info.messageId})`);
    return { ok: true, messageId: info.messageId };
  } catch (err: any) {
    // A propósito no se relanza: ver la decisión 2 en el encabezado.
    logger.error(`[Mail] Falló el envío a ${destinatarios}: ${err?.message}`);
    return { ok: false, error: err?.message || 'error desconocido' };
  }
}

/** Versión de texto plano a partir del HTML, para el cuerpo alternativo. */
function textoDesdeHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|tr|h1|h2|h3|div|td)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .trim();
}

// ── Plantilla base ───────────────────────────────────────────────────────────

/**
 * Envuelve el contenido en el marco de la marca.
 *
 * Todo el CSS va en línea y la estructura es de tablas. No es descuido: es la
 * única forma de que un mail se vea igual en Gmail, Outlook de escritorio y el
 * cliente de un iPhone.
 */
function plantilla(contenido: string, titulo: string): string {
  const c = marca.colorPrincipal;
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapar(titulo)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

    <tr><td style="background-color:${c};padding:24px 32px;">
      <div style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:0.3px;">${escapar(marca.nombre)}</div>
    </td></tr>

    <tr><td style="padding:32px;color:#2a2a2a;font-size:15px;line-height:1.6;">
      ${contenido}
    </td></tr>

    <tr><td style="background-color:#fafafa;padding:20px 32px;border-top:1px solid #eeeeee;">
      <div style="color:#777777;font-size:12px;line-height:1.6;">
        ${escapar(pieLegal())}
      </div>
      <div style="color:#999999;font-size:11px;line-height:1.6;margin-top:8px;">
        Este mensaje se envió automáticamente desde ${escapar(marca.nombre)}.
        Para consultas, respondé a este correo y te contesta ${escapar(agente.nombre)}.
      </div>
    </td></tr>

  </table>
</td></tr>
</table>
</body>
</html>`;
}

/** Escapa el texto que viene de la base o del usuario antes de meterlo en HTML. */
function escapar(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function boton(texto: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
<tr><td style="background-color:${marca.colorPrincipal};border-radius:6px;">
  <a href="${escapar(url)}" style="display:inline-block;padding:13px 28px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">${escapar(texto)}</a>
</td></tr></table>`;
}

function aviso(contenido: string, color = '#b45309', fondo = '#fffbeb'): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
<tr><td style="background-color:${fondo};border-left:4px solid ${color};padding:14px 18px;border-radius:0 4px 4px 0;">
  <div style="color:#3a3a3a;font-size:14px;line-height:1.6;">${contenido}</div>
</td></tr></table>`;
}

function pesos(monto: number): string {
  return '$' + monto.toLocaleString('es-AR');
}

/** Tabla de datos clave (importe, comprobante, vencimiento). */
function tarjetaDatos(filas: Array<[string, string, string?]>): string {
  const celdas = filas
    .map(([etiqueta, valor, estilo]) => {
      const v =
        estilo === 'destacado'
          ? `font-weight:700;font-size:17px;color:#1a1a1a;`
          : estilo === 'mono'
          ? `font-family:monospace;color:#1a1a1a;`
          : estilo === 'alerta'
          ? `font-weight:600;color:#b45309;`
          : `color:#1a1a1a;`;
      return `<tr>
        <td style="padding:5px 0;color:#666;">${escapar(etiqueta)}</td>
        <td style="padding:5px 0;text-align:right;${v}">${escapar(valor)}</td>
      </tr>`;
    })
    .join('');

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border:1px solid #e5e5e5;border-radius:6px;">
<tr><td style="padding:16px 20px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">${celdas}</table>
</td></tr></table>`;
}

// ═════════════════════════════════════════════════════════════════════════════
// PLANTILLAS
// ═════════════════════════════════════════════════════════════════════════════
//
// Cada mail se parte en dos: `armar*` construye el asunto y el HTML, y `mail*`
// lo envía. La separación no es ceremonia — permite previsualizar los textos en
// el navegador sin mandarle nada a nadie.
//
// Eso importa acá más que en otros proyectos: estos mails explican plazos de
// caducidad y efectos de una presentación ante el INPI. Son textos que el
// matriculado tiene que poder leer y corregir antes de que salgan, no después.

export interface MailArmado {
  asunto: string;
  html: string;
  adjuntos?: AdjuntoMail[];
}

// ── Volante de pago ──────────────────────────────────────────────────────────

/**
 * El mail más importante del circuito: de que el cliente lo entienda y pague
 * depende que la solicitud entre.
 *
 * Tres cosas que el texto tiene que resolver sí o sí:
 *
 * 1. **El vencimiento.** El VEP caduca el primer día hábil siguiente. Si no se
 *    paga hay que volver a cargar el trámite y se pierde la fecha de
 *    presentación. La fecha viene impresa en el propio PDF, así que se pasa
 *    como dato en vez de calcularla con lógica de días hábiles y feriados.
 *
 * 2. **El nombre del deudor.** El volante del INPI imprime el CUIT del cliente
 *    pero el NOMBRE del usuario que lo generó — el del agente. Está verificado
 *    que es comportamiento del portal y no de esta app (ver
 *    `validacion-circuito-completo.md`). Si no se explica, el cliente cree que
 *    hay un error y llama.
 *
 * 3. **Quién puede pagarlo.** El QR lo escanea cualquiera desde cualquier
 *    billetera; no hace falta que sea el titular.
 */
export function armarVolantePago(datos: {
  nombreCliente: string;
  denominacion: string;
  clase: number;
  montoPesos: number;
  nroERecauda: string;
  venceEl?: string;
  volantePdf?: Buffer;
}): MailArmado {
  const contenido = `
<p style="margin:0 0 16px;">Hola ${escapar(datos.nombreCliente)},</p>

<p style="margin:0 0 16px;">
  Ya presentamos ante el INPI la solicitud de registro de tu marca
  <strong>${escapar(datos.denominacion)}</strong> en la clase ${datos.clase}.
</p>

<p style="margin:0 0 16px;">
  Para que el trámite quede efectivamente ingresado <strong>falta abonar el arancel oficial</strong>.
  Te adjuntamos el volante de pago.
</p>

${tarjetaDatos([
  ['Importe a pagar', pesos(datos.montoPesos), 'destacado'],
  ['Comprobante N°', datos.nroERecauda, 'mono'],
  ...(datos.venceEl ? [['Vence el', datos.venceEl, 'alerta'] as [string, string, string]] : []),
])}

<p style="margin:0 0 8px;font-weight:600;">Cómo pagarlo</p>
<p style="margin:0 0 16px;">
  Abrí el PDF adjunto y <strong>escaneá el código QR</strong> desde Mercado Pago,
  Cuenta DNI o cualquier billetera electrónica. Lo puede pagar cualquier persona,
  no hace falta que seas vos.
</p>

${aviso(
  `<strong>El volante vence ${datos.venceEl ? `el ${escapar(datos.venceEl)}` : 'el primer día hábil siguiente a su emisión'}.</strong>
   Si vence sin pagarse hay que volver a cargar el trámite desde el principio, y la
   solicitud toma la fecha de la nueva presentación.`
)}

${aviso(
  `<strong>Un detalle del formulario del INPI.</strong> En el volante vas a ver tu CUIT como
   contribuyente, pero el nombre impreso es el de ${escapar(agente.nombre)}, que es quien
   generó el comprobante. Es así como lo emite el sistema del INPI y no afecta el pago:
   el arancel se imputa a tu CUIT y al número de comprobante.`,
  '#2563eb',
  '#eff6ff'
)}

<p style="margin:16px 0 0;">
  Apenas se acredite el pago te avisamos y te pasamos el número de acta.
  Normalmente impacta al día siguiente.
</p>`;

  return {
    asunto: `Falta abonar el arancel — marca ${datos.denominacion} (clase ${datos.clase})`,
    html: plantilla(contenido, 'Volante de pago'),
    adjuntos: datos.volantePdf
      ? [{ nombre: `Volante-${datos.nroERecauda}.pdf`, contenido: datos.volantePdf, tipo: 'application/pdf' }]
      : undefined,
  };
}

export async function mailVolantePago(
  datos: Parameters<typeof armarVolantePago>[0] & { para: string }
): Promise<ResultadoEnvio> {
  const { asunto, html, adjuntos } = armarVolantePago(datos);
  return enviarMail({ para: datos.para, asunto, html, adjuntos });
}

// ── Invitación a cotitular ───────────────────────────────────────────────────

/**
 * Invitación para que un cotitular se dé de alta.
 *
 * ⚠️ ENCUADRE — corregido el 21/09/2026 después de rediseñar el circuito.
 *
 * El borrador anterior planteaba la aceptación como un **requisito previo a
 * presentar**, y eso era falso: el INPI no exige el poder al presentar (la
 * gestión 4107717 entró sin acompañar ninguno). Lo único que bloquea son los
 * datos del titular, y esos pueden cargarse por la otra vía.
 *
 * Decir lo contrario sería apurar a alguien que no pidió nada, con un plazo
 * inventado. Mal como texto legal y peor como primera impresión de un servicio.
 *
 * El encuadre correcto tiene tres patas:
 *
 * 1. **La marca se presenta igual.** No estás frenando a nadie.
 * 2. **Importa por la renovación.** A los diez años la renovación la tienen que
 *    pedir TODOS los titulares — no así la declaración jurada del quinto año ni
 *    una oposición, que puede presentar cualquiera. Ese es el único momento en
 *    que un cotitular ausente se vuelve un problema, y con plazo perentorio.
 * 3. **Es tu marca, no un trámite ajeno.** Se le ofrece acceso, no se le impone
 *    una obligación.
 *
 * ⚠️ **NO ENUMERAR FACULTADES DE LA APP EN ESTE MAIL.**
 *
 * Ser cotitular de la marca y tener funciones habilitadas en la app son cosas
 * distintas. Jurídicamente el cotitular tiene las mismas facultades que el otro
 * titular; en la app, depende del plan que tenga.
 *
 * El borrador del 21/09 prometía "presentar oposiciones y hacer las
 * presentaciones que correspondan" — y el plan gratuito del cotitular podría no
 * incluir eso (decisión de planes pendiente, ver `cotitulares-y-poder.md`).
 * Sería el primer mail que esa persona recibe, prometiéndole algo que después
 * choca contra un muro de pago.
 *
 * El texto hace dos cosas, y las dos importan (criterio del usuario, 21/09):
 *
 *   · menciona SOLO lo que es cierto con cualquier plan — ver el estado y
 *     recibir los avisos
 *   · y **dice explícitamente que el resto depende del plan**, en vez de
 *     callarlo. Omitirlo sería prolijo pero deshonesto: el cotitular se entera
 *     igual, solo que más tarde y peor.
 */
export function armarInvitacionCotitular(datos: {
  nombreInvitado: string;
  nombreQuienInvita: string;
  denominacion: string;
  clase: number;
  porcentaje: number;
  urlAceptacion: string;
  /** true cuando la solicitud ya entró al INPI y el alta es solo a futuro. */
  yaPresentada?: boolean;
}): MailArmado {
  const contenido = `
<p style="margin:0 0 16px;">Hola ${escapar(datos.nombreInvitado)},</p>

<p style="margin:0 0 16px;">
  <strong>${escapar(datos.nombreQuienInvita)}</strong> solicitó el registro de la marca
  <strong>${escapar(datos.denominacion)}</strong> en la clase ${datos.clase}, y te incluyó
  como cotitular.
</p>

${tarjetaDatos([
  ['Marca', datos.denominacion, 'destacado'],
  ['Clase', String(datos.clase)],
  ['Tu participación', `${datos.porcentaje}%`, 'destacado'],
])}

<p style="margin:0 0 16px;">
  ${datos.yaPresentada
    ? 'La solicitud ya fue presentada, así que no tenés que hacer nada con urgencia.'
    : 'La solicitud sigue su curso normalmente; esto no la demora.'}
  Te escribimos para que tengas <strong>tu propio acceso a la marca</strong>.
</p>

<p style="margin:0 0 8px;font-weight:600;">Qué incluye tu cuenta</p>
<p style="margin:0 0 16px;">
  <strong>Sin costo</strong> vas a poder seguir el estado del trámite y recibir los
  avisos de cada movimiento del expediente. Y quedás registrado como titular, que es
  lo que hace falta para las presentaciones que se hagan a lo largo de la vida de la
  marca.
</p>

<p style="margin:0 0 16px;">
  El resto de las funciones —entre ellas registrar marcas propias— depende del plan
  que elijas. Los vas a ver dentro de la app, con el precio de cada uno.
</p>

${aviso(
  `<strong>Y hay un motivo concreto para hacerlo ahora.</strong> A los diez años la marca
   se renueva, y la renovación tienen que pedirla <strong>todos los titulares</strong>.
   Si para ese momento no estás en el sistema, hay que salir a buscarte con el plazo
   corriendo. Resolverlo hoy toma dos minutos.`,
  '#2563eb',
  '#eff6ff'
)}

${boton('Acceder a mi marca', datos.urlAceptacion)}

<p style="margin:0 0 16px;color:#666;font-size:13px;">
  Si el botón no funciona, copiá y pegá esta dirección en tu navegador:<br>
  <span style="font-family:monospace;font-size:12px;word-break:break-all;">${escapar(datos.urlAceptacion)}</span>
</p>

<p style="margin:16px 0 0;font-size:14px;color:#555;">
  Darte de alta no tiene costo. Vas a completar tus datos y autorizar a
  ${escapar(agente.nombre)} a representarte en el trámite, igual que hizo
  ${escapar(datos.nombreQuienInvita)}.
</p>

<p style="margin:16px 0 0;font-size:13px;color:#777;">
  Si no conocés a ${escapar(datos.nombreQuienInvita)} o creés que esto es un error,
  respondé este mail y lo revisamos.
</p>`;

  return {
    asunto: `Sos cotitular de la marca ${datos.denominacion} — accedé a tu cuenta`,
    html: plantilla(contenido, 'Invitación a cotitular'),
  };
}

export async function mailInvitacionCotitular(
  datos: Parameters<typeof armarInvitacionCotitular>[0] & { para: string }
): Promise<ResultadoEnvio> {
  const { asunto, html } = armarInvitacionCotitular(datos);
  return enviarMail({ para: datos.para, asunto, html });
}

// ── Recordatorio al cotitular (24 h) ─────────────────────────────────────────

/**
 * Segundo intento con el cotitular, a las 24 horas corridas.
 *
 * Existe por una razón poco glamorosa y muy cierta: **la mitad de las veces el
 * primer mail quedó sin leer**. Es el recordatorio más barato del sistema.
 *
 * Tono: bajo. Esta persona no pidió nada, no está frenando nada, y no le debe
 * nada a nadie. Un empujón, no un reclamo.
 */
export function armarRecordatorioCotitular(datos: {
  nombreInvitado: string;
  nombreQuienInvita: string;
  denominacion: string;
  urlAceptacion: string;
}): MailArmado {
  const contenido = `
<p style="margin:0 0 16px;">Hola ${escapar(datos.nombreInvitado)},</p>

<p style="margin:0 0 16px;">
  Te escribimos ayer porque ${escapar(datos.nombreQuienInvita)} te incluyó como
  cotitular de la marca <strong>${escapar(datos.denominacion)}</strong>, y todavía no
  activaste tu acceso.
</p>

<p style="margin:0 0 16px;">
  No corre ningún plazo y la marca sigue su curso igual. Pero cuando llegue el
  momento de renovarla —a los diez años— la renovación tienen que pedirla
  <strong>todos los titulares</strong>, así que conviene tenerlo resuelto.
</p>

${boton('Activar mi acceso', datos.urlAceptacion)}

<p style="margin:0 0 16px;color:#666;font-size:13px;">
  Si el botón no funciona:<br>
  <span style="font-family:monospace;font-size:12px;word-break:break-all;">${escapar(datos.urlAceptacion)}</span>
</p>

<p style="margin:16px 0 0;font-size:13px;color:#777;">
  Si preferís no hacerlo, respondé este mail y lo resolvemos de otra forma.
</p>`;

  return {
    asunto: `Recordatorio: tu acceso a la marca ${datos.denominacion}`,
    html: plantilla(contenido, 'Recordatorio al cotitular'),
  };
}

export async function mailRecordatorioCotitular(
  datos: Parameters<typeof armarRecordatorioCotitular>[0] & { para: string }
): Promise<ResultadoEnvio> {
  const { asunto, html } = armarRecordatorioCotitular(datos);
  return enviarMail({ para: datos.para, asunto, html });
}

// ── Aviso al usuario: podés avanzar solo (24 h) ──────────────────────────────

/**
 * El otro mensaje de las 24 horas, al que inició la solicitud.
 *
 * El criterio del plazo es comercial y es del usuario: *"para apurar a presentar
 * la solicitud y que no se enfríe el deseo de registrar la marca"*. La ventana
 * de entusiasmo de un cliente es corta.
 *
 * ⚠️ Pero el mail **no puede vender la carga manual como si fuera gratis**. Deja
 * una deuda concreta: a los diez años la renovación la tienen que pedir todos
 * los titulares, y si el cotitular nunca se dio de alta hay que salir a buscarlo
 * con el plazo corriendo. Ofrecer el atajo sin decir su precio sería venderle un
 * problema futuro a alguien que confía en nosotros.
 */
export function armarAvisoPuedeAvanzar(datos: {
  nombreCliente: string;
  nombreCotitular: string;
  denominacion: string;
  urlSolicitud: string;
}): MailArmado {
  const contenido = `
<p style="margin:0 0 16px;">Hola ${escapar(datos.nombreCliente)},</p>

<p style="margin:0 0 16px;">
  <strong>${escapar(datos.nombreCotitular)}</strong> todavía no completó sus datos para
  la solicitud de <strong>${escapar(datos.denominacion)}</strong>.
</p>

<p style="margin:0 0 8px;font-weight:600;">Podés avanzar sin esperarlo</p>
<p style="margin:0 0 16px;">
  Si tenés a mano sus datos —documento, estado civil y domicilio— podés cargarlos
  vos y presentar la solicitud hoy mismo. No hace falta su intervención para que
  la marca entre.
</p>

${boton('Cargar sus datos y presentar', datos.urlSolicitud)}

${aviso(
  `<strong>Pero conviene que igual se dé de alta más adelante.</strong> A los diez años
   la renovación de la marca tienen que pedirla <strong>todos los titulares</strong>.
   Si para ese entonces ${escapar(datos.nombreCotitular)} no está en el sistema, hay que
   salir a buscarlo con el plazo corriendo. Te lo vamos a recordar más adelante,
   sin apuro.`
)}

<p style="margin:16px 0 0;font-size:14px;color:#555;">
  También podés esperar un poco más, o reenviarle la invitación desde la pantalla
  de la solicitud.
</p>`;

  return {
    asunto: `Podés presentar ${datos.denominacion} sin esperar a ${datos.nombreCotitular}`,
    html: plantilla(contenido, 'Podés avanzar'),
  };
}

export async function mailAvisoPuedeAvanzar(
  datos: Parameters<typeof armarAvisoPuedeAvanzar>[0] & { para: string }
): Promise<ResultadoEnvio> {
  const { asunto, html } = armarAvisoPuedeAvanzar(datos);
  return enviarMail({ para: datos.para, asunto, html });
}

// ── Documentación incompleta (reclamo periódico) ─────────────────────────────

/**
 * Para las marcas que se presentaron con los datos de algún cotitular cargados a
 * mano: ese cotitular nunca se dio de alta ni otorgó su poder.
 *
 * **Diez años es tiempo de sobra para olvidarse.** Por eso el reclamo no se
 * apaga a las 24 horas: vuelve cada tanto, con tono bajo, hasta que se salde o
 * hasta que el usuario diga que no va a pasar.
 *
 * El mejor momento para mandarlo es **junto con la declaración jurada de uso del
 * quinto año**: es un contacto que igual va a existir, y aprovecharlo rinde mucho
 * más que un mail suelto que nadie esperaba.
 */
export function armarDocumentacionIncompleta(datos: {
  nombreCliente: string;
  denominacion: string;
  faltantes: string[];
  urlGestion: string;
  /** Años que faltan para la renovación, si se conocen. */
  anosParaRenovar?: number;
}): MailArmado {
  const lista = datos.faltantes
    .map((n) => `<li style="margin:4px 0;">${escapar(n)}</li>`)
    .join('');

  const cuantos = datos.faltantes.length;

  const contenido = `
<p style="margin:0 0 16px;">Hola ${escapar(datos.nombreCliente)},</p>

<p style="margin:0 0 16px;">
  Tu marca <strong>${escapar(datos.denominacion)}</strong> está en regla ante el INPI, pero
  nos queda un tema administrativo pendiente:
  ${cuantos === 1 ? 'un cotitular nunca' : `${cuantos} cotitulares nunca`}
  completó su alta ni otorgó el poder.
</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border:1px solid #e5e5e5;border-radius:6px;">
  <tr><td style="padding:16px 20px;">
    <div style="color:#666;font-size:13px;margin-bottom:8px;">Falta el alta de:</div>
    <ul style="margin:0;padding-left:20px;font-size:14px;color:#1a1a1a;">${lista}</ul>
  </td></tr>
</table>

<p style="margin:0 0 16px;">
  Hoy no afecta nada: la marca está protegida y nosotros seguimos el expediente
  igual. <strong>El problema aparece en la renovación</strong>${
    datos.anosParaRenovar !== undefined
      ? `, dentro de ${datos.anosParaRenovar} ${datos.anosParaRenovar === 1 ? 'año' : 'años'}`
      : ', a los diez años'
  }: ahí la tienen que pedir todos los titulares, y con el plazo corriendo es tarde
  para salir a buscar a alguien.
</p>

${boton('Enviar la invitación', datos.urlGestion)}

<p style="margin:16px 0 0;font-size:14px;color:#555;">
  Es un trámite de dos minutos para cada uno. Si preferís que no te lo recordemos
  más, avisanos y lo dejamos anotado.
</p>`;

  return {
    asunto: `Pendiente en tu marca ${datos.denominacion}: falta el alta de ${cuantos === 1 ? 'un cotitular' : 'los cotitulares'}`,
    html: plantilla(contenido, 'Documentación pendiente'),
  };
}

export async function mailDocumentacionIncompleta(
  datos: Parameters<typeof armarDocumentacionIncompleta>[0] & { para: string }
): Promise<ResultadoEnvio> {
  const { asunto, html } = armarDocumentacionIncompleta(datos);
  return enviarMail({ para: datos.para, asunto, html });
}

// ── Recordatorio de pago ─────────────────────────────────────────────────────

/**
 * Aviso de que el VEP sigue impago. Lo dispara la rutina diaria de conciliación
 * al ver un comprobante en estado GENERADO.
 *
 * El tono importa: es el aviso de una fecha que corre, no un reclamo de deuda.
 * El cliente ya paga la suscripción; el arancel es del Estado, no nuestro.
 */
export function armarRecordatorioPago(datos: {
  nombreCliente: string;
  denominacion: string;
  montoPesos: number;
  nroERecauda: string;
  venceEl?: string;
  volantePdf?: Buffer;
}): MailArmado {
  const contenido = `
<p style="margin:0 0 16px;">Hola ${escapar(datos.nombreCliente)},</p>

<p style="margin:0 0 16px;">
  Te recordamos que el arancel de la solicitud de tu marca
  <strong>${escapar(datos.denominacion)}</strong> todavía figura como impago en el sistema del INPI.
</p>

${tarjetaDatos([
  ['Importe', pesos(datos.montoPesos), 'destacado'],
  ['Comprobante N°', datos.nroERecauda, 'mono'],
  ...(datos.venceEl ? [['Vence el', datos.venceEl, 'alerta'] as [string, string, string]] : []),
])}

${aviso(
  `<strong>Si el volante vence, el trámite hay que cargarlo de nuevo</strong> y la solicitud
   toma la fecha de la nueva presentación. En materia de marcas la fecha importa:
   define la prioridad frente a quien pida un signo parecido después.`
)}

${datos.volantePdf
  ? `<p style="margin:16px 0 0;">Te reenviamos el volante adjunto para que puedas escanear el QR.</p>`
  : `<p style="margin:16px 0 0;">Si no encontrás el volante, respondé este mail y te lo reenviamos.</p>`}

<p style="margin:16px 0 0;font-size:14px;color:#555;">
  Si ya lo pagaste en las últimas horas es probable que todavía no haya impactado.
  En ese caso ignorá este aviso.
</p>`;

  return {
    asunto: `Recordatorio: arancel pendiente — marca ${datos.denominacion}`,
    html: plantilla(contenido, 'Arancel pendiente'),
    adjuntos: datos.volantePdf
      ? [{ nombre: `Volante-${datos.nroERecauda}.pdf`, contenido: datos.volantePdf, tipo: 'application/pdf' }]
      : undefined,
  };
}

export async function mailRecordatorioPago(
  datos: Parameters<typeof armarRecordatorioPago>[0] & { para: string }
): Promise<ResultadoEnvio> {
  const { asunto, html, adjuntos } = armarRecordatorioPago(datos);
  return enviarMail({ para: datos.para, asunto, html, adjuntos });
}

// ── Pago acreditado ──────────────────────────────────────────────────────────

/**
 * Cierra el circuito de registro y le da al cliente lo único que de verdad le
 * importa: **el número de acta**.
 */
export function armarPagoAcreditado(datos: {
  nombreCliente: string;
  denominacion: string;
  clase: number;
  acta?: string;
  urlSeguimiento?: string;
}): MailArmado {
  const contenido = `
<p style="margin:0 0 16px;">Hola ${escapar(datos.nombreCliente)},</p>

<p style="margin:0 0 16px;">
  El pago se acreditó y <strong>tu solicitud quedó ingresada en el INPI</strong>.
</p>

${datos.acta
  ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
  <tr><td style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:20px;text-align:center;">
    <div style="color:#15803d;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Número de acta</div>
    <div style="color:#14532d;font-size:26px;font-weight:700;font-family:monospace;">${escapar(datos.acta)}</div>
    <div style="color:#166534;font-size:13px;margin-top:8px;">${escapar(datos.denominacion)} — clase ${datos.clase}</div>
  </td></tr>
</table>`
  : `<p style="margin:0 0 16px;">
  En las próximas horas el INPI le asigna el número de acta definitivo y te lo hacemos llegar.
</p>`}

<p style="margin:0 0 8px;font-weight:600;">Qué sigue ahora</p>
<p style="margin:0 0 16px;">
  El INPI publica la solicitud en el Boletín de Marcas. A partir de esa publicación
  corre un plazo durante el cual terceros pueden oponerse. Después viene el examen
  de fondo, donde el INPI evalúa si el signo es registrable.
</p>

<p style="margin:0 0 16px;">
  <strong>Nosotros seguimos el expediente</strong> y te avisamos ante cualquier
  movimiento: oposiciones, observaciones o la concesión. No tenés que estar
  pendiente de nada.
</p>

${datos.urlSeguimiento ? boton('Ver el estado de mi marca', datos.urlSeguimiento) : ''}`;

  return {
    asunto: datos.acta
      ? `Tu marca ${datos.denominacion} quedó presentada — acta ${datos.acta}`
      : `Tu marca ${datos.denominacion} quedó presentada`,
    html: plantilla(contenido, 'Solicitud ingresada'),
  };
}

export async function mailPagoAcreditado(
  datos: Parameters<typeof armarPagoAcreditado>[0] & { para: string }
): Promise<ResultadoEnvio> {
  const { asunto, html } = armarPagoAcreditado(datos);
  return enviarMail({ para: datos.para, asunto, html });
}

// ── Prueba ───────────────────────────────────────────────────────────────────

/**
 * Verifica toda la cadena —credenciales, entrega, render— con un contenido
 * inofensivo, antes de que un cliente real reciba algo mal armado.
 */
export function armarPrueba(): MailArmado {
  const contenido = `
<p style="margin:0 0 16px;">Este es un mensaje de prueba del servicio de correo.</p>
<p style="margin:0 0 16px;">Si lo estás leyendo, funcionan las credenciales SMTP, el envío y el diseño.</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border:1px solid #e5e5e5;border-radius:6px;">
  <tr><td style="padding:16px 20px;font-size:13px;font-family:monospace;color:#444;line-height:1.8;">
    Remitente: ${escapar(correo.remitenteEmail)}<br>
    Responder a: ${escapar(correo.responderA)}<br>
    Servidor: ${escapar(correo.smtp.host || '(sin configurar)')}:${correo.smtp.puerto}${correo.smtp.seguro ? ' (SSL)' : ' (STARTTLS)'}<br>
    Marca: ${escapar(marca.nombre)}
  </td></tr>
</table>

${aviso('Revisá que este mail no haya caído en correo no deseado. Si cayó, hay que ajustar los registros SPF y DKIM del dominio.')}`;

  return { asunto: `Prueba de correo — ${marca.nombre}`, html: plantilla(contenido, 'Prueba de correo') };
}

export async function mailDePrueba(para: string): Promise<ResultadoEnvio> {
  const { asunto, html } = armarPrueba();
  return enviarMail({ para, asunto, html });
}

// ── Previsualización ─────────────────────────────────────────────────────────

/** Las plantillas disponibles para previsualizar, con datos de ejemplo. */
export const PLANTILLAS = [
  'volante',
  'invitacion',
  'recordatorio-cotitular',
  'puede-avanzar',
  'documentacion-incompleta',
  'recordatorio',
  'acreditado',
  'prueba',
] as const;
export type NombrePlantilla = (typeof PLANTILLAS)[number];

/**
 * Devuelve el mail armado con datos de ejemplo, sin enviar nada. Sirve para
 * revisar los textos en el navegador — que es donde hay que corregirlos, no
 * después de que salieron.
 */
export function previsualizar(nombre: NombrePlantilla): MailArmado {
  switch (nombre) {
    case 'volante':
      return armarVolantePago({
        nombreCliente: 'María Fernández',
        denominacion: 'EJEMPLO',
        clase: 25,
        montoPesos: 40569,
        nroERecauda: '202600138588',
        venceEl: '22/09/2026',
      });
    case 'invitacion':
      return armarInvitacionCotitular({
        nombreInvitado: 'Juan Pérez',
        nombreQuienInvita: 'María Fernández',
        denominacion: 'EJEMPLO',
        clase: 25,
        porcentaje: 50,
        urlAceptacion: `${marca.urlApp}/invitacion/ejemplo-de-token`,
        yaPresentada: false,
      });
    case 'recordatorio-cotitular':
      return armarRecordatorioCotitular({
        nombreInvitado: 'Juan Pérez',
        nombreQuienInvita: 'María Fernández',
        denominacion: 'EJEMPLO',
        urlAceptacion: `${marca.urlApp}/invitacion/ejemplo-de-token`,
      });
    case 'puede-avanzar':
      return armarAvisoPuedeAvanzar({
        nombreCliente: 'María Fernández',
        nombreCotitular: 'Juan Pérez',
        denominacion: 'EJEMPLO',
        urlSolicitud: `${marca.urlApp}/solicitudes/ejemplo`,
      });
    case 'documentacion-incompleta':
      return armarDocumentacionIncompleta({
        nombreCliente: 'María Fernández',
        denominacion: 'EJEMPLO',
        faltantes: ['Juan Pérez'],
        urlGestion: `${marca.urlApp}/marcas/ejemplo/titulares`,
        anosParaRenovar: 5,
      });
    case 'recordatorio':
      return armarRecordatorioPago({
        nombreCliente: 'María Fernández',
        denominacion: 'EJEMPLO',
        montoPesos: 40569,
        nroERecauda: '202600138588',
        venceEl: '22/09/2026',
      });
    case 'acreditado':
      return armarPagoAcreditado({
        nombreCliente: 'María Fernández',
        denominacion: 'EJEMPLO',
        clase: 25,
        acta: '4109907',
        urlSeguimiento: `${marca.urlApp}/marcas/ejemplo`,
      });
    case 'prueba':
      return armarPrueba();
  }
}
