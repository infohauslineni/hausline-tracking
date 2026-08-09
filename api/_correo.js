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
    ? `¡Gracias por tu compra! Registramos tu pedido <strong>${codigo}</strong> y ya comenzamos a gestionarlo:`
    : `Tu pedido <strong>${codigo}</strong> tiene una nueva actualización:`
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);">
        <tr><td style="background:#111827;padding:24px;text-align:center;">
          <div style="color:#ffffff;font-size:22px;font-weight:800;letter-spacing:2px;">HAUSLINE</div>
          <div style="color:#9ca3af;font-size:11px;letter-spacing:3px;text-transform:uppercase;margin-top:4px;">King of Shoes</div>
        </td></tr>
        <tr><td style="padding:32px 28px 8px;">
          <p style="margin:0 0 16px;font-size:16px;">${saludo},</p>
          <p style="margin:0 0 20px;font-size:15px;color:#374151;">${intro}</p>
          <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:20px;text-align:center;margin-bottom:20px;">
            <div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;margin-bottom:6px;">Estado actual</div>
            <div style="font-size:20px;font-weight:700;color:#111827;">${estadoLabel}</div>
            <div style="font-size:14px;color:#4b5563;margin-top:8px;">${nota}</div>
          </div>
          <div style="text-align:center;margin:24px 0 8px;">
            <a href="${urlSeguimiento}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 28px;border-radius:10px;">Ver seguimiento completo</a>
          </div>
        </td></tr>
        <tr><td style="padding:20px 28px 28px;text-align:center;border-top:1px solid #f3f4f6;">
          <p style="margin:0;font-size:12px;color:#9ca3af;">Este es un aviso automático de tu pedido en Hausline.<br>Si tienes dudas, responde a este correo.</p>
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
