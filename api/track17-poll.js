import { createClient } from '@supabase/supabase-js'
import { pollGuiasActivas } from './_track17.js'

// Cron FRECUENTE (cada pocas horas): consulta a 17TRACK el estado actual de las
// guías activas y aplica lo nuevo, para que en el panel se vea la ubicación fresca
// sin esperar al cron diario. Solo hace el poll (no recalcula estimaciones ni
// registra guías nuevas; de eso se encarga cron-estimaciones una vez al día).
// gettrackinfo lee el dato guardado en 17track, así que correrlo seguido no gasta
// cuota de registro. Protegido por CRON_SECRET igual que el cron diario.
export default async function handler(request, response) {
  const authorization = request.headers?.authorization ?? request.headers?.get?.('authorization')
  if (!process.env.CRON_SECRET || authorization !== `Bearer ${process.env.CRON_SECRET}`) return response.status(401).json({ ok: false })
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return response.status(500).json({ ok: false, error: 'Missing server configuration' })
  if (!process.env.TRACK17_API_KEY) return response.status(200).json({ ok: true, skipped: 'Falta TRACK17_API_KEY' })

  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    const { consultadas, avanzados } = await pollGuiasActivas(client)
    return response.status(200).json({ ok: true, consultadas, avanzados })
  } catch (error) {
    console.error('track17-poll: falló', error?.message)
    return response.status(500).json({ ok: false, error: 'Poll failed' })
  }
}
