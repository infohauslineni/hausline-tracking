import { createClient } from '@supabase/supabase-js'
import { registrarEnTrack17, pollGuiasActivas } from './_track17.js'
import { obtenerCatalogoMergeado, mapearCatalogoAProductos } from './_catalogo.js'
import { enviarCorreoBodega, enviarCorreoAbandono, enviarCorreoRetraso } from './_correo.js'

const GRACIA_BODEGA = 2
const CARGO_BODEGA_DIARIO = 5
// Aviso de retraso: estados que cuentan como "en tránsito internacional" (mismo grupo que
// ve el cliente) y el umbral de días a partir del cual se avisa la demora.
const ESTADOS_TRANSITO = ['etiqueta_creada', 'despachado', 'transito_internacional', 'recibido_estados_unidos', 'transito_nicaragua']
const DIAS_RETRASO = 27

// Recordatorio automático de CARGO POR BODEGA. Busca los pedidos "disponible para
// entrega" que ya pasaron los 2 días de gracia y le manda al cliente (con correo) un
// aviso de cuánto se sumó a su factura. Dedup con `bodega_aviso_at`: máx. 1 correo por
// pedido cada ~20 h, así corre a diario sin repetir. Best-effort por pedido.
async function enviarRecordatoriosBodega(client) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return 0
  const { data: pedidos, error } = await client
    .from('pedidos')
    .select('id, codigo, bodega_aviso_at, clientes(nombre, correo), historial_pedidos(created_at, estado_nuevo)')
    .eq('estado', 'disponible_entrega')
    .limit(300)
  if (error) { console.error('cron: leyendo pedidos bodega', error.message); return 0 }

  // Tipo de cambio para incluir el equivalente en córdobas (redondeado a la decena).
  let tc = 37
  try {
    const { data: cfg } = await client.from('configuracion').select('valor_json').eq('clave', 'moneda').maybeSingle()
    const v = Number(cfg?.valor_json?.tipo_cambio)
    if (v > 0) tc = v
  } catch { /* usa 37 */ }

  const ahora = Date.now()
  let enviados = 0
  for (const p of pedidos ?? []) {
    const correo = String(p.clientes?.correo ?? '').trim()
    if (!correo) continue
    const inicios = (Array.isArray(p.historial_pedidos) ? p.historial_pedidos : [])
      .filter((h) => h.estado_nuevo === 'disponible_entrega')
      .map((h) => new Date(h.created_at).getTime())
      .sort((a, b) => a - b)
    const inicio = inicios[0]
    if (!inicio) continue
    const dias = Math.max(0, Math.floor((ahora - inicio) / 86_400_000))
    const diasCobrados = Math.max(0, dias - GRACIA_BODEGA)
    if (diasCobrados <= 0) continue // aún en gracia
    // No reenviar si ya se avisó en las últimas ~20 h.
    if (p.bodega_aviso_at && (ahora - new Date(p.bodega_aviso_at).getTime()) < 20 * 3_600_000) continue
    const cargo = diasCobrados * CARGO_BODEGA_DIARIO
    const cordobas = Math.round((cargo * tc) / 10) * 10
    try {
      await enviarCorreoBodega({ correo, nombre: p.clientes?.nombre ?? null, codigo: p.codigo, dias, diasCobrados, cargo, cordobas })
      await client.from('pedidos').update({ bodega_aviso_at: new Date().toISOString() }).eq('id', p.id)
      enviados++
    } catch (e) {
      console.error('cron: correo bodega falló', p.codigo, e?.message)
    }
  }
  return enviados
}

// Recordatorio de ABANDONO DE CHECKOUT. Busca los encargos que siguen "pendiente"
// (nunca se confirmó el pago), tienen correo, ya llevan al menos ~3 h creados, aún no
// vencen y no se les mandó recordatorio (recordatorio_at nulo). Envía UN correo con el
// enlace al pago y marca recordatorio_at. Best-effort por encargo.
async function enviarRecordatoriosAbandono(client) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return 0
  const ahora = Date.now()
  const haceTresHoras = new Date(ahora - 3 * 3_600_000).toISOString()
  const { data: solicitudes, error } = await client
    .from('solicitudes')
    .select('id, codigo, cliente_nombre, cliente_correo, producto, created_at, vence_at, recordatorio_at, estado')
    .eq('estado', 'pendiente')
    .is('recordatorio_at', null)
    .not('cliente_correo', 'is', null)
    .lt('created_at', haceTresHoras)
    .gt('vence_at', new Date(ahora).toISOString())
    .limit(200)
  if (error) { console.error('cron: leyendo encargos abandonados', error.message); return 0 }

  let enviados = 0
  for (const s of solicitudes ?? []) {
    const correo = String(s.cliente_correo ?? '').trim()
    if (!correo) continue
    try {
      await enviarCorreoAbandono({ correo, nombre: s.cliente_nombre ?? null, codigo: s.codigo, producto: s.producto ?? null })
      await client.from('solicitudes').update({ recordatorio_at: new Date().toISOString() }).eq('id', s.id)
      enviados++
    } catch (e) {
      console.error('cron: correo abandono falló', s.codigo, e?.message)
    }
  }
  return enviados
}

// Aviso automático de RETRASO. Busca pedidos que SIGUEN en tránsito internacional y que
// entraron a esa etapa hace más de 27 días, y le manda al cliente (con correo) un aviso
// suave de demora. Dedup con `retraso_aviso_at`: se envía UNA sola vez por pedido (columna
// nula = aún no avisado). El inicio del tránsito se toma del historial. Best-effort por pedido.
async function enviarAvisosRetraso(client) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return 0
  const { data: pedidos, error } = await client
    .from('pedidos')
    .select('id, codigo, estado, retraso_aviso_at, clientes(nombre, correo), historial_pedidos(created_at, estado_nuevo)')
    .in('estado', ESTADOS_TRANSITO)
    .is('retraso_aviso_at', null)
    .limit(300)
  if (error) { console.error('cron: leyendo pedidos en tránsito', error.message); return 0 }

  const ahora = Date.now()
  let enviados = 0
  for (const p of pedidos ?? []) {
    const correo = String(p.clientes?.correo ?? '').trim()
    if (!correo) continue
    // Cuándo ENTRÓ por primera vez a la etapa de tránsito (el más antiguo del historial).
    const inicios = (Array.isArray(p.historial_pedidos) ? p.historial_pedidos : [])
      .filter((h) => ESTADOS_TRANSITO.includes(h.estado_nuevo))
      .map((h) => new Date(h.created_at).getTime())
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => a - b)
    const inicio = inicios[0]
    if (!inicio) continue
    const dias = Math.floor((ahora - inicio) / 86_400_000)
    if (dias <= DIAS_RETRASO) continue
    try {
      await enviarCorreoRetraso({ correo, nombre: p.clientes?.nombre ?? null, codigo: p.codigo, estado: p.estado })
      await client.from('pedidos').update({ retraso_aviso_at: new Date().toISOString() }).eq('id', p.id)
      enviados++
    } catch (e) {
      console.error('cron: correo retraso falló', p.codigo, e?.message)
    }
  }
  return enviados
}

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

  // Auto-avances de etapa. Van AISLADOS en try/catch: si una función todavía no existe
  // (migración pendiente) o falla puntualmente, NO debe tumbar el resto del cron (17track,
  // catálogo, bodega…). Antes un RPC faltante devolvía 500 y abortaba todo el trabajo diario.
  let avanzados = 0
  try {
    // Pedidos con 8+ días en "Despachado" pasan a "En tránsito internacional".
    const { data: n, error: e } = await client.rpc('avanzar_transito_internacional')
    if (e) throw new Error(e.message)
    avanzados = Number(n ?? 0)
  } catch (avanzarError) {
    console.error('cron: avanzar tránsito internacional falló', avanzarError?.message)
  }

  let avanzadosCalidad = 0
  try {
    // Pedidos con 1+ día en "Control de calidad" pasan a "En tránsito".
    const { data: n, error: e } = await client.rpc('avanzar_control_calidad')
    if (e) throw new Error(e.message)
    avanzadosCalidad = Number(n ?? 0)
  } catch (avanzarCalidadError) {
    console.error('cron: avanzar control de calidad falló (¿migración 202608280001 sin aplicar?)', avanzarCalidadError?.message)
  }

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

  // Recordatorio automático de cargo por bodega al cliente. Aislado para no tumbar lo principal.
  let bodega = 0
  try {
    bodega = await enviarRecordatoriosBodega(client)
  } catch (bodegaError) {
    console.error('cron: recordatorio bodega falló', bodegaError?.message)
  }

  // Recordatorio de abandono de checkout (encargo pendiente sin pago). Aislado también.
  let abandonos = 0
  try {
    abandonos = await enviarRecordatoriosAbandono(client)
  } catch (abandonoError) {
    console.error('cron: recordatorio abandono falló (¿migración 202608290003 sin aplicar?)', abandonoError?.message)
  }

  // Aviso automático de retraso (>27 días en tránsito). Aislado para no tumbar lo principal.
  let retrasos = 0
  try {
    retrasos = await enviarAvisosRetraso(client)
  } catch (retrasoError) {
    console.error('cron: aviso de retraso falló (¿migración 202609020001 sin aplicar?)', retrasoError?.message)
  }

  return response.status(200).json({
    ok: true,
    updated: Number(data ?? 0),
    avanzados: Number(avanzados ?? 0),
    avanzados_calidad: Number(avanzadosCalidad ?? 0),
    registrados,
    consultadas: track17.consultadas,
    avanzados_track17: track17.avanzados,
    catalogo,
    vencidas,
    bodega,
    abandonos,
    retrasos,
  })
}
