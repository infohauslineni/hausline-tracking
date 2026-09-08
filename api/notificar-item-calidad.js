import { enviarCorreoItemEstado } from './_correo.js'

// Envía al cliente las fotos de CONTROL DE CALIDAD de UN producto. Lo dispara el trigger de
// Supabase cuando el admin toca el botón "Enviar fotos de control de calidad" del producto
// (que marca pedido_items.qc_enviado_at). Reusa el secreto NOTIFY_SECRET.
function extPorMime(mime) { return mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp' }

async function obtenerContexto(pedidoId) {
  const base = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key || !pedidoId) return null
  const root = base.replace(/\/$/, '')
  const url = `${root}/rest/v1/pedidos?id=eq.${encodeURIComponent(pedidoId)}&select=codigo,clientes(nombre,correo)&limit=1`
  try {
    const res = await fetch(url, { headers: { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' } })
    if (!res.ok) return null
    const data = await res.json()
    const p = Array.isArray(data) ? data[0] : null
    if (!p) return null
    return { codigo: p.codigo, correo: (p.clientes?.correo || '').trim(), nombre: p.clientes?.nombre || null }
  } catch { return null }
}

async function fotosCalidadItem(codigo, pedidoItemId) {
  const base = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key || !pedidoItemId) return []
  const root = base.replace(/\/$/, '')
  const url = `${root}/rest/v1/archivos_pedido?pedido_item_id=eq.${encodeURIComponent(pedidoItemId)}&tipo=eq.control_calidad&visible_cliente=eq.true&select=storage_path,nombre,mime_type,orden&order=orden`
  let archivos = []
  try {
    const res = await fetch(url, { headers: { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' } })
    if (res.ok) archivos = await res.json()
  } catch { return [] }
  const fotos = []
  for (let i = 0; i < archivos.length; i++) {
    const a = archivos[i]
    try {
      const objUrl = `${root}/storage/v1/object/pedidos/${a.storage_path.split('/').map(encodeURIComponent).join('/')}`
      const res = await fetch(objUrl, { headers: { apikey: key, authorization: `Bearer ${key}` } })
      if (!res.ok) continue
      const content = Buffer.from(await res.arrayBuffer())
      fotos.push({ cid: `calidad-${i + 1}@hausline`, filename: `${codigo} - Control de calidad ${i + 1}.${extPorMime(a.mime_type)}`, content, contentType: a.mime_type || 'image/webp' })
    } catch { /* omitir */ }
  }
  return fotos
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ ok: false, error: 'Method not allowed' })
  const authorization = request.headers?.authorization ?? request.headers?.get?.('authorization')
  if (!process.env.NOTIFY_SECRET || authorization !== `Bearer ${process.env.NOTIFY_SECRET}`) return response.status(401).json({ ok: false })
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return response.status(500).json({ ok: false, error: 'Missing SMTP configuration' })

  const body = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : (request.body ?? {})
  const record = body.record ?? {}
  if (body.table !== 'pedido_items' || body.type !== 'UPDATE') return response.status(200).json({ ok: true, skipped: 'no aplica' })
  if (!record.qc_enviado_at) return response.status(200).json({ ok: true, skipped: 'sin marca de envío' })

  const ctx = await obtenerContexto(record.pedido_id)
  if (!ctx || !ctx.correo) return response.status(200).json({ ok: true, skipped: 'sin contexto o correo' })

  const fotos = await fotosCalidadItem(ctx.codigo, record.id)
  if (!fotos.length) return response.status(200).json({ ok: true, skipped: 'producto sin fotos de calidad' })

  try {
    await enviarCorreoItemEstado({ correo: ctx.correo, nombre: ctx.nombre, codigo: ctx.codigo, producto: record.producto || 'Tu producto', estadoItem: 'control_calidad', fotos })
  } catch (sendError) {
    console.error('notificar-item-calidad: no se pudo enviar', sendError?.message)
    return response.status(502).json({ ok: false, error: 'No se pudo enviar el correo' })
  }
  return response.status(200).json({ ok: true, sent: ctx.correo, producto: record.producto, fotos: fotos.length })
}
