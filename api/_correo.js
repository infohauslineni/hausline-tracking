import nodemailer from 'nodemailer'

// Lógica de correo compartida por las funciones /api (aviso al crear el pedido y al
// cambiar de estado). Vercel no convierte los archivos con "_" en endpoints, pero sí
// permite importarlos. Es JavaScript independiente del build de la app.

// Etiqueta pública de cada estado (espejo de src/constants/orders.ts).
export const ESTADO_LABEL = {
  pedido_confirmado: 'Orden confirmada',
  en_preparacion: 'En preparación',
  control_calidad: 'Control de calidad',
  etiqueta_creada: 'Despachado',
  despachado: 'Despachado',
  transito_internacional: 'En tránsito internacional',
  recibido_estados_unidos: 'En tránsito internacional',
  transito_nicaragua: 'En tránsito internacional',
  llego_nicaragua: 'País de destino',
  disponible_entrega: 'Disponible para entrega',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
  incidencia: 'Requiere atención',
}

export const ESTADO_NOTA = {
  pedido_confirmado: 'Gracias por tu compra. Confirmamos tu pedido y ya comenzamos a prepararlo. Te avisaremos en cada etapa.',
  en_preparacion: 'Estamos preparando tu pedido con la fábrica antes de enviarlo.',
  control_calidad: 'Tu pedido está pasando por control de calidad. Ya puedes ver las fotos de tu producto en el seguimiento.',
  etiqueta_creada: 'Tu pedido fue despachado y ya va en camino.',
  despachado: 'Tu pedido fue despachado y ya va en camino.',
  transito_internacional: 'Tu pedido va en tránsito internacional rumbo a Nicaragua.',
  recibido_estados_unidos: 'Tu pedido va en tránsito internacional rumbo a Nicaragua.',
  transito_nicaragua: 'Tu pedido va en tránsito internacional rumbo a Nicaragua.',
  llego_nicaragua: 'Tu pedido llegó a Nicaragua. Pronto estará disponible para entrega.',
  disponible_entrega: 'Tu pedido ya está disponible para entrega. Escríbenos para coordinar el envío o retiro.',
  entregado: 'Tu pedido fue entregado. Gracias por confiar en Hausline.',
  cancelado: 'Tu pedido fue cancelado. Si tienes dudas, escríbenos.',
  incidencia: 'Tenemos una novedad con tu pedido y ya la estamos gestionando. Te contactaremos pronto.',
}

export function plantillaCorreo({ nombre, codigo, estadoLabel, nota, urlSeguimiento, esNuevo }) {
  const saludo = nombre ? `Hola, ${nombre}` : 'Hola'
  // En la creación del pedido el texto confirma el registro; en los cambios de estado, la actualización.
  const intro = esNuevo
    ? `Gracias por tu compra. Recibimos tu pedido y ya comenzamos a gestionarlo.`
    : `Tu pedido tiene una nueva actualización.`
  // Texto de previsualización (lo que se ve en la bandeja antes de abrir el correo).
  const preheader = esNuevo
    ? `Registramos tu pedido ${codigo}. Sigue cada etapa desde aquí.`
    : `${codigo}: ${estadoLabel}. Revisa el detalle del seguimiento.`
  const anio = new Date().getFullYear()
  return `<!doctype html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>Pedido ${codigo}</title>
  <!--[if mso]><style>body,table,td,a{font-family:Arial,Helvetica,sans-serif !important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#ececed;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:#ececed;">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ececed;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(17,24,39,.08);">

        <!-- Encabezado -->
        <tr><td style="background-color:#0b0f19;padding:34px 24px;text-align:center;">
          <div style="color:#ffffff;font-size:26px;font-weight:800;letter-spacing:5px;line-height:1;">HAUSLINE</div>
          <div style="color:#8b93a7;font-size:10px;font-weight:600;letter-spacing:4px;text-transform:uppercase;margin-top:8px;">King of Shoes</div>
        </td></tr>

        <!-- Barra de acento -->
        <tr><td style="height:4px;background-color:#c8a24b;font-size:0;line-height:0;">&nbsp;</td></tr>

        <!-- Cuerpo -->
        <tr><td style="padding:38px 36px 12px;">
          <p style="margin:0 0 6px;font-size:18px;font-weight:700;color:#0b0f19;">${saludo}</p>
          <p style="margin:0 0 26px;font-size:15px;line-height:1.6;color:#4b5563;">${intro}</p>

          <!-- Número de pedido -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;">
            <tr><td style="background-color:#f6f7f9;border:1px solid #e6e8ec;border-radius:10px;padding:16px 20px;">
              <span style="font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#8b93a7;">Número de pedido</span><br>
              <span style="font-size:19px;font-weight:800;color:#0b0f19;letter-spacing:1px;">${codigo}</span>
            </td></tr>
          </table>

          <!-- Estado actual -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 30px;">
            <tr><td style="border:1px solid #e6e8ec;border-radius:12px;padding:24px 22px;text-align:center;">
              <div style="font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#8b93a7;margin-bottom:10px;">Estado actual</div>
              <div style="display:inline-block;background-color:#0b0f19;color:#ffffff;font-size:15px;font-weight:700;letter-spacing:.3px;padding:9px 22px;border-radius:999px;">${estadoLabel}</div>
              <div style="font-size:14px;line-height:1.6;color:#4b5563;margin-top:16px;">${nota}</div>
            </td></tr>
          </table>

          <!-- Botón -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
            <a href="${urlSeguimiento}" target="_blank" style="display:inline-block;background-color:#c8a24b;color:#0b0f19;text-decoration:none;font-weight:700;font-size:15px;letter-spacing:.3px;padding:15px 38px;border-radius:10px;">Ver seguimiento del pedido</a>
          </td></tr></table>
          <p style="margin:16px 0 0;font-size:12px;line-height:1.5;text-align:center;color:#9aa0ab;">O copia este enlace:<br><a href="${urlSeguimiento}" target="_blank" style="color:#6b7280;text-decoration:underline;word-break:break-all;">${urlSeguimiento}</a></p>
        </td></tr>

        <!-- Pie -->
        <tr><td style="padding:28px 36px 34px;border-top:1px solid #eef0f2;text-align:center;">
          <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#0b0f19;letter-spacing:2px;">HAUSLINE</p>
          <p style="margin:0 0 14px;font-size:12px;line-height:1.6;color:#9aa0ab;">Este es un aviso automático de tu pedido.<br>¿Tienes dudas? Responde a este mismo correo y te ayudamos.</p>
          <p style="margin:0;font-size:11px;color:#b7bcc5;">© ${anio} Hausline · King of Shoes</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`
}

// Envía el correo del pedido (creación o cambio de estado). Lanza si el SMTP falla.
export async function enviarCorreoPedido({ correo, nombre, codigo, estado, esNuevo }) {
  const estadoLabel = ESTADO_LABEL[estado]
  const nota = ESTADO_NOTA[estado] ?? 'Tu pedido fue actualizado.'
  const appUrl = (process.env.APP_URL ?? process.env.VITE_PUBLIC_APP_URL ?? 'https://hausline-tracking.vercel.app').replace(/\/$/, '')
  const urlSeguimiento = `${appUrl}/tracking/${codigo}`

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })

  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? `HAUSLINE <${process.env.SMTP_USER}>`,
    to: correo,
    subject: esNuevo ? `Pedido ${codigo} registrado en Hausline` : `Pedido ${codigo}: ${estadoLabel}`,
    html: plantillaCorreo({ nombre, codigo, estadoLabel, nota, urlSeguimiento, esNuevo }),
  })
}
