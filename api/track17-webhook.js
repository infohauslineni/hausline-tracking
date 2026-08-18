import { createClient } from '@supabase/supabase-js'
import { verificarFirma, extraerTrackings, aplicarEventoTrayectos } from './_track17.js'

// Recibe los avisos de 17TRACK (proveedor → Miami) y los mete en la tubería que ya
// existe: inserta el evento en tracking_eventos (fuente 'track17'), actualiza el
// trayecto y avanza el estado del pedido. Ese cambio de estado dispara SOLO el
// correo con tu marca (webhook de Supabase → api/notificar-estado).
//
// Seguridad: candado principal = token secreto en la URL (?token=...), que solo
// 17track conoce porque lo configuras en su panel. La firma SHA256 se comprueba
// como capa extra (no bloqueante) y se registra en el log.
export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ ok: false, error: 'Method not allowed' })

  const secret = process.env.TRACK17_WEBHOOK_SECRET
  const token = request.query?.token ?? new URL(request.url, 'http://x').searchParams.get('token')
  if (!secret || token !== secret) return response.status(401).json({ ok: false })

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return response.status(500).json({ ok: false, error: 'Missing server configuration' })
  }

  const raw = typeof request.body === 'string' ? request.body : JSON.stringify(request.body ?? {})
  const body = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : (request.body ?? {})

  // Firma extra (no bloqueante): dejamos rastro si no coincide para poder afinarla.
  const sign = request.headers?.sign ?? request.headers?.get?.('sign')
  if (sign) {
    const dataRaw = (() => { const m = raw.match(/"data"\s*:\s*([\s\S]*)}\s*$/); return m ? m[1].replace(/}\s*$/, '') : null })()
    if (!verificarFirma(body?.event, dataRaw, sign)) console.warn('track17-webhook: firma no coincide (se continúa por token de URL)')
  }

  const evento = body?.event
  if (evento !== 'TRACKING_UPDATED' && evento !== 'TRACKING_STOPPED') {
    return response.status(200).json({ ok: true, skipped: 'evento no aplica' })
  }

  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const trackings = extraerTrackings(body)
  let procesados = 0
  let avanzados = 0

  // Todo el trabajo (buscar trayectos, anti-duplicado, insertar evento, avanzar el
  // pedido) vive en aplicarEventoTrayectos() para que el push (aquí) y el poll del
  // cron se comporten EXACTAMENTE igual.
  for (const item of trackings) {
    const r = await aplicarEventoTrayectos(client, item)
    procesados += r.procesados
    avanzados += r.avanzados
  }

  return response.status(200).json({ ok: true, procesados, avanzados })
}
