import { createClient } from '@supabase/supabase-js'
import { registrarEnTrack17, pollGuiasActivas } from './_track17.js'
import { obtenerCatalogoMergeado, mapearCatalogoAProductos } from './_catalogo.js'

// Sincroniza el catálogo web (tienda + feed + panel) → tabla `productos` del tracking.
// Corre una vez al día para que los cambios de precio/foto de la web lleguen solos, sin
// que nadie toque "Sincronizar catálogo". Mismo mapeo que la sincronización manual.
async function sincronizarCatalogoServidor(client) {
  const merged = await obtenerCatalogoMergeado()
  const records = mapearCatalogoAProductos(merged)
  if (!records.length) return 0
  for (let i = 0; i < records.length; i += 100) {
    const { error } = await client.from('productos').upsert(records.slice(i, i + 100), { onConflict: 'codigo', ignoreDuplicates: false })
    if (error) throw new Error(error.message)
  }
  return records.length
}

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
    track17 = await pollGuiasActivas(client)
  } catch (pollError) {
    console.error('cron: poll 17track falló', pollError?.message)
  }

  // Sincronización diaria del catálogo web → productos. Aislada para no tumbar lo principal.
  let catalogo = 0
  try {
    catalogo = await sincronizarCatalogoServidor(client)
  } catch (catalogoError) {
    console.error('cron: sync catálogo falló', catalogoError?.message)
  }

  // Vence los encargos web que pasaron de 24 h sin confirmarse: los saca de la bandeja
  // "por confirmar" (pendiente → vencida). Aislado para no tumbar lo principal.
  let vencidas = 0
  try {
    const { data: nVencidas, error: vencerError } = await client.rpc('vencer_solicitudes')
    if (vencerError) console.error('cron: vencer encargos falló', vencerError.message)
    else vencidas = Number(nVencidas ?? 0)
  } catch (vencerError) {
    console.error('cron: vencer encargos falló', vencerError?.message)
  }

  return response.status(200).json({
    ok: true,
    updated: Number(data ?? 0),
    avanzados: Number(avanzados ?? 0),
    registrados,
    consultadas: track17.consultadas,
    avanzados_track17: track17.avanzados,
    catalogo,
    vencidas,
  })
}
