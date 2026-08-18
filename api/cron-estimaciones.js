import { createClient } from '@supabase/supabase-js'
import { registrarEnTrack17, consultarEnTrack17, aplicarEventoTrayectos } from './_track17.js'

// Registra en 17TRACK las guías que aún no se han registrado (track17_registrado_at
// nulo). Corre una vez al día junto con las estimaciones. Como el envío tarda días,
// registrar en las próximas 24 h no pierde nada: 17track trae el historial completo
// al registrar. Si falta la API key, simplemente no hace nada.
async function registrarGuiasPendientes(client) {
  if (!process.env.TRACK17_API_KEY) return 0
  const { data: pendientes, error } = await client
    .from('trayectos')
    .select('id, tracking')
    .not('tracking', 'is', null)
    .is('track17_registrado_at', null)
    .eq('activo', true)
    .limit(40)
  if (error) { console.error('cron: error leyendo guías pendientes', error.message); return 0 }
  const numeros = [...new Set((pendientes ?? []).map((t) => String(t.tracking ?? '').trim()).filter(Boolean))]
  if (!numeros.length) return 0

  const { accepted } = await registrarEnTrack17(numeros)
  const aceptados = new Set((accepted ?? []).map((a) => String(a.number ?? '').trim()))
  // Marcamos como registrados los aceptados. Los rechazados (guía inválida o ya
  // registrada) se reintentan otro día; el registro no consume cuota extra.
  const marcar = numeros.filter((n) => aceptados.has(n))
  if (marcar.length) {
    const { error: upError } = await client.from('trayectos')
      .update({ track17_registrado_at: new Date().toISOString() })
      .in('tracking', marcar)
    if (upError) console.error('cron: error marcando guías registradas', upError.message)
  }
  return marcar.length
}

// Red de seguridad diaria: en vez de esperar a que 17TRACK empuje, consultamos el
// estado ACTUAL de las guías ya registradas y aplicamos lo que haya cambiado. Así
// se ponen al día aunque un push se pierda o la guía se registrara cuando el
// paquete ya venía en movimiento (17track no reenvía lo viejo). Es idempotente: el
// anti-duplicado por fecha del evento evita reinsertar y re-enviar correos.
async function consultarGuiasRegistradas(client) {
  if (!process.env.TRACK17_API_KEY) return { consultadas: 0, avanzados: 0 }
  // Solo guías activas ya registradas. Límite acotado (120 = 3 lotes de 40) para no
  // pasarnos del tiempo de la función; a este volumen cubre las que van en camino.
  const { data: activos, error } = await client
    .from('trayectos')
    .select('tracking')
    .not('tracking', 'is', null)
    .not('track17_registrado_at', 'is', null)
    .eq('activo', true)
    .order('track17_registrado_at', { ascending: true })
    .limit(120)
  if (error) { console.error('cron: error leyendo guías a consultar', error.message); return { consultadas: 0, avanzados: 0 } }
  const numeros = [...new Set((activos ?? []).map((t) => String(t.tracking ?? '').trim()).filter(Boolean))]
  if (!numeros.length) return { consultadas: 0, avanzados: 0 }

  let consultadas = 0
  let avanzados = 0
  for (let i = 0; i < numeros.length; i += 40) {
    const lote = numeros.slice(i, i + 40)
    const trackings = await consultarEnTrack17(lote)
    for (const item of trackings) {
      const r = await aplicarEventoTrayectos(client, item)
      avanzados += r.avanzados
    }
    consultadas += lote.length
  }
  return { consultadas, avanzados }
}

export default async function handler(request, response) {
  const authorization = request.headers?.authorization ?? request.headers?.get?.('authorization')
  if (!process.env.CRON_SECRET || authorization !== `Bearer ${process.env.CRON_SECRET}`) return response.status(401).json({ ok: false })
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return response.status(500).json({ ok: false, error: 'Missing server configuration' })
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await client.rpc('recalcular_fechas_estimadas')
  if (error) return response.status(500).json({ ok: false, error: 'Estimate recalculation failed' })

  // Auto-avance: pedidos con 8+ días en "Despachado" pasan a "En tránsito internacional".
  const { data: avanzados, error: avanzarError } = await client.rpc('avanzar_transito_internacional')
  if (avanzarError) return response.status(500).json({ ok: false, error: 'Auto-advance failed' })

  // Registro automático de guías nuevas en 17TRACK. Va aislado en try/catch para que
  // un fallo de 17track nunca tumbe el recálculo de estimaciones (el trabajo principal).
  let registrados = 0
  try {
    registrados = await registrarGuiasPendientes(client)
  } catch (track17Error) {
    console.error('cron: registro 17track falló', track17Error?.message)
  }

  // Consulta (poll) del estado actual de las guías ya registradas: red de seguridad
  // por si el push de 17track se pierde. Aislado también para no tumbar lo principal.
  let track17 = { consultadas: 0, avanzados: 0 }
  try {
    track17 = await consultarGuiasRegistradas(client)
  } catch (pollError) {
    console.error('cron: poll 17track falló', pollError?.message)
  }

  return response.status(200).json({
    ok: true,
    updated: Number(data ?? 0),
    avanzados: Number(avanzados ?? 0),
    registrados,
    consultadas: track17.consultadas,
    avanzados_track17: track17.avanzados,
  })
}
