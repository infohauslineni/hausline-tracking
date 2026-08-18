import { createClient } from '@supabase/supabase-js'
import { mapearEstadoTrayecto, sincronizarPedido, verificarFirma, extraerTrackings, resumirTracking } from './_track17.js'

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

  for (const item of trackings) {
    const info = resumirTracking(item)
    if (!info.numero) continue
    const estadoTrayecto = mapearEstadoTrayecto(info.status)
    if (!estadoTrayecto) continue // NotFound / Expired: nada que hacer todavía

    // Un mismo número puede estar en varios pedidos: procesamos todos los trayectos activos.
    const { data: trayectos, error: trayError } = await client
      .from('trayectos')
      .select('id, pedido_id, pais_destino, estado, tracking, activo')
      .eq('tracking', info.numero)
    if (trayError) { console.error('track17-webhook: error buscando trayecto', trayError.message); continue }
    if (!trayectos?.length) continue

    for (const trayecto of trayectos) {
      // Anti-duplicado: si ya guardamos este mismo evento (misma guía + misma fecha),
      // no reinsertamos ni reavanzamos → no se repite el correo al cliente.
      const { data: previos } = await client
        .from('tracking_eventos')
        .select('id')
        .eq('trayecto_id', trayecto.id)
        .eq('fuente', 'track17')
        .eq('fecha_evento', info.fechaEvento)
        .limit(1)
      if (previos?.length) continue

      const { error: evError } = await client.from('tracking_eventos').insert({
        trayecto_id: trayecto.id,
        codigo_evento: info.codigoEvento,
        estado_original: info.status,
        estado_normalizado: estadoTrayecto,
        descripcion_original: info.descripcion,
        descripcion_publica: info.descripcion,
        ubicacion: info.ubicacion || null,
        fecha_evento: info.fechaEvento,
        // Oculto para el cliente a propósito: el texto crudo del transportista puede
        // revelar el origen (China/Guangzhou). El cliente ve solo la línea de tiempo
        // limpia que genera el estado del pedido; tú ves estos eventos en Logística.
        visible_cliente: false,
        fuente: 'track17',
        data_original_json: item,
      })
      if (evError) { console.error('track17-webhook: error insertando evento', evError.message); continue }

      // 17TRACK solo cubre proveedor → Miami. Su "Entregado" = llegó a Miami, NO es la
      // entrega final al cliente (esa la marca el admin con el botón "Entregado"). Por eso
      // NUNCA finalizamos el trayecto desde 17track: lo dejamos activo para el tramo a
      // Nicaragua. El estado del pedido sí avanza (a "Warehouse HAUSLINE") vía sincronizarPedido.
      const estadoTrayectoGuardar = estadoTrayecto === 'entregado' ? 'en_transito' : estadoTrayecto
      const { error: upError } = await client.from('trayectos').update({
        estado: estadoTrayectoGuardar,
        ultima_ubicacion: info.ubicacion || null,
        ultimo_evento: info.descripcion,
      }).eq('id', trayecto.id)
      if (upError) { console.error('track17-webhook: error actualizando trayecto', upError.message); continue }

      procesados++
      try {
        const nuevo = await sincronizarPedido(client, trayecto, estadoTrayecto, info.descripcion, info.ubicacion)
        if (nuevo) avanzados++
      } catch (syncError) {
        console.error('track17-webhook: error sincronizando pedido', syncError?.message)
      }
    }
  }

  return response.status(200).json({ ok: true, procesados, avanzados })
}
