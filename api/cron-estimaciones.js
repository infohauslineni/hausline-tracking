import { createClient } from '@supabase/supabase-js'

export default async function handler(request, response) {
  const authorization = request.headers?.authorization ?? request.headers?.get?.('authorization')
  if (!process.env.CRON_SECRET || authorization !== `Bearer ${process.env.CRON_SECRET}`) return response.status(401).json({ ok: false })
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return response.status(500).json({ ok: false, error: 'Missing server configuration' })
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await client.rpc('recalcular_fechas_estimadas')
  if (error) return response.status(500).json({ ok: false, error: 'Estimate recalculation failed' })
  return response.status(200).json({ ok: true, updated: Number(data ?? 0) })
}
