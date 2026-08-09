import nodemailer from 'nodemailer'

// Etiqueta pública de cada estado (espejo de src/constants/orders.ts). Se copia aquí
// porque las funciones de /api son JavaScript independiente y no comparten build con la app.
const ESTADO_LABEL = {
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

const ESTADO_NOTA = {
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

function plantillaCorreo({ nombre, codigo, estadoLabel, nota, urlSeguimiento, esNuevo }) {
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

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ ok: false, error: 'Method not allowed' })

  // Solo Supabase (con el secreto compartido) puede disparar este envío.
  const authorization = request.headers?.authorization ?? request.headers?.get?.('authorization')
  if (!process.env.NOTIFY_SECRET || authorization !== `Bearer ${process.env.NOTIFY_SECRET}`) {
    return response.status(401).json({ ok: false })
  }
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return response.status(500).json({ ok: false, error: 'Missing SMTP configuration' })
  }

  const body = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : (request.body ?? {})
  const record = body.record ?? {}
  const oldRecord = body.old_record ?? {}

  // Notificamos al crear el pedido (INSERT) y cuando cambia su estado (UPDATE).
  const tipo = body.type
  if (body.table !== 'pedidos' || (tipo !== 'UPDATE' && tipo !== 'INSERT')) return response.status(200).json({ ok: true, skipped: 'no aplica' })
  const esNuevo = tipo === 'INSERT'
  const estado = record.estado
  // En INSERT no hay estado anterior: se avisa que el pedido quedó registrado.
  // En UPDATE solo se avisa si el estado realmente cambió.
  if (!estado) return response.status(200).json({ ok: true, skipped: 'sin estado' })
  if (!esNuevo && estado === oldRecord.estado) return response.status(200).json({ ok: true, skipped: 'sin cambio de estado' })
  if (!ESTADO_LABEL[estado]) return response.status(200).json({ ok: true, skipped: 'estado no notificable' })

  // El correo y el nombre del cliente vienen dentro del aviso (los agrega el trigger de Supabase),
  // así no hace falta la llave de servicio de Supabase en el servidor.
  const correo = (body.cliente_correo ?? '').trim()
  const nombre = body.cliente_nombre ?? null
  if (!correo) return response.status(200).json({ ok: true, skipped: 'cliente sin correo' })

  const appUrl = (process.env.APP_URL ?? 'https://hausline-tracking.vercel.app').replace(/\/$/, '')
  const urlSeguimiento = `${appUrl}/tracking/${record.codigo}`
  const estadoLabel = ESTADO_LABEL[estado]
  const nota = ESTADO_NOTA[estado] ?? 'Tu pedido fue actualizado.'

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM ?? `HAUSLINE <${process.env.SMTP_USER}>`,
      to: correo,
      subject: esNuevo ? `Pedido ${record.codigo} registrado en Hausline` : `Pedido ${record.codigo}: ${estadoLabel}`,
      html: plantillaCorreo({ nombre, codigo: record.codigo, estadoLabel, nota, urlSeguimiento, esNuevo }),
    })
  } catch (sendError) {
    return response.status(502).json({ ok: false, error: 'No se pudo enviar el correo' })
  }

  return response.status(200).json({ ok: true, sent: correo })
}
