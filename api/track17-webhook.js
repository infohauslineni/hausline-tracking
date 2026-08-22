import { createClient } from '@supabase/supabase-js'
import { verificarFirma, extraerTrackings, aplicarEventoTrayectos } from './_track17.js'

// Recibe los avisos de 17TRACK (proveedor → Miami) y SOLO refresca la ubicación del
// trayecto en el panel de Logística (un único UPDATE, ruta rápida). NO avanza el estado
// del pedido ni dispara correos: esas etapas se cambian a mano desde Pedidos. La respuesta
// tiene que ser veloz o 17TRACK marca el push como fallido (504) y reintenta en bucle.
//
// Seguridad: candado principal = token secreto en la URL (?token=...), que solo
// 17track conoce porque lo configuras en su panel. La firma SHA256 se comprueba
// como capa extra (no bloqueante) y se registra en el log.
export const config = { maxDuration: 20 }

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

  // Ruta rápida (soloUbicacion): un UPDATE por guía, sin selects ni inserts de historial,
  // para responder al instante. El historial completo lo arma el poll del cron.
  for (const item of trackings) {
    const r = await aplicarEventoTrayectos(client, item, { soloUbicacion: true })
    procesados += r.procesados
    avanzados += r.avanzados
  }

  return response.status(200).json({ ok: true, procesados, avanzados })
}
