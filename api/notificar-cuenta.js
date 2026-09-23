import { enviarCorreoBienvenida } from './_correo.js'
import { cerrarEmail, reservarEmail } from './_email-eventos.js'

// Correo de bienvenida a "Mi cuenta". Lo dispara Supabase (trigger notificar_cuenta_verificada,
// migración 202609240001) cuando el cliente verifica su correo, con el mismo secreto
// compartido que el aviso de estados. Un solo correo por cuenta (candado en email_eventos).
export const config = { maxDuration: 30 }

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ ok: false, error: 'Method not allowed' })
  const authorization = request.headers?.authorization ?? request.headers?.get?.('authorization') ?? ''
  if (!process.env.NOTIFY_SECRET || authorization !== `Bearer ${process.env.NOTIFY_SECRET}`) {
    return response.status(401).json({ ok: false })
  }
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return response.status(500).json({ ok: false, error: 'Missing SMTP configuration' })
  }
  const body = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : (request.body ?? {})
  const record = body.record ?? {}
  if (body.table !== 'cuentas_cliente' || !record.verificada_at) return response.status(200).json({ ok: true, skipped: 'no aplica' })
  const correo = String(record.correo ?? '').trim()
  if (!correo) return response.status(200).json({ ok: true, skipped: 'sin correo' })

  const reserva = await reservarEmail({ clave: `bienvenida:${record.user_id}`, tipo: 'bienvenida', destinatario: correo, userId: record.user_id ?? null })
  if (reserva.duplicado) return response.status(200).json({ ok: true, skipped: 'ya enviado' })
  try {
    await enviarCorreoBienvenida({ correo, nombre: record.nombre })
  } catch (error) {
    await cerrarEmail(reserva.id, error?.message || 'error de envío')
    return response.status(502).json({ ok: false, error: 'No se pudo enviar el correo' })
  }
  await cerrarEmail(reserva.id)
  return response.status(200).json({ ok: true, sent: correo })
}
