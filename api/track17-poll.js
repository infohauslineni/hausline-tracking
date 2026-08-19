import { createClient } from '@supabase/supabase-js'
import { pollGuiasActivas } from './_track17.js'

// Consulta a 17TRACK el estado actual de las guías activas y aplica lo nuevo, para
// ver la ubicación fresca sin esperar al cron diario. Solo hace el poll (no recalcula
// estimaciones ni registra guías nuevas). gettrackinfo lee el dato guardado en
// 17track, así que correrlo seguido no gasta cuota de registro.
//
// Autorización: sirve para dos cosas y acepta ambas —
//   • el botón "Actualizar seguimiento" del panel manda la sesión del admin (JWT), o
//   • un cron externo manda el CRON_SECRET (Vercel Hobby no permite crons sub-diarios).
export default async function handler(request, response) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return response.status(500).json({ ok: false, error: 'Missing server configuration' })
  }
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const authorization = request.headers?.authorization ?? request.headers?.get?.('authorization') ?? ''
  const token = String(authorization).replace(/^Bearer\s+/i, '').trim()
  let autorizado = false
  if (process.env.CRON_SECRET && token && token === process.env.CRON_SECRET) {
    autorizado = true
  } else if (token) {
    // Valida el JWT del admin: si getUser devuelve un usuario, la sesión es real.
    const { data } = await client.auth.getUser(token).catch(() => ({ data: { user: null } }))
    autorizado = !!data?.user
  }
  if (!autorizado) return response.status(401).json({ ok: false })

  if (!process.env.TRACK17_API_KEY) return response.status(200).json({ ok: true, skipped: 'Falta TRACK17_API_KEY' })
  try {
    const { consultadas, avanzados } = await pollGuiasActivas(client)
    return response.status(200).json({ ok: true, consultadas, avanzados })
  } catch (error) {
    console.error('track17-poll: falló', error?.message)
    return response.status(500).json({ ok: false, error: 'Poll failed' })
  }
}
