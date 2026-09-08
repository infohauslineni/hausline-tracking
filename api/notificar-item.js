import { enviarCorreoItemEstado } from './_correo.js'

// Aviso por correo POR PRODUCTO. Lo dispara el trigger de Supabase sobre pedido_items cuando
// cambia `estado_item` (con el secreto NOTIFY_SECRET). Envía al cliente un correo sobre ESE
// producto; el de "recibido" adjunta su foto de control de calidad.
const ESTADOS_NOTIFICABLES = new Set(['recibido', 'enviado', 'entregado'])

function extPorMime(mime) { return mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp' }

// Trae el pedido (código, correo y nombre del cliente) del ítem.
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

// Trae y descarga las fotos de control de calidad visibles de UN producto (por pedido_item_id).
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
    } catch { /* omitir foto */ }
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
  const old = body.old_record ?? {}

  if (body.table !== 'pedido_items' || body.type !== 'UPDATE') return response.status(200).json({ ok: true, skipped: 'no aplica' })
  const estado = record.estado_item
  if (!ESTADOS_NOTIFICABLES.has(estado)) return response.status(200).json({ ok: true, skipped: 'estado no notificable' })
  if (old.estado_item === estado) return response.status(200).json({ ok: true, skipped: 'sin cambio' })

  const ctx = await obtenerContexto(record.pedido_id)
  if (!ctx || !ctx.correo) return response.status(200).json({ ok: true, skipped: 'sin contexto o correo' })

  const fotos = estado === 'recibido' ? await fotosCalidadItem(ctx.codigo, record.id) : []

  try {
    await enviarCorreoItemEstado({ correo: ctx.correo, nombre: ctx.nombre, codigo: ctx.codigo, producto: record.producto || 'Tu producto', estadoItem: estado, fotos })
  } catch (sendError) {
    console.error('notificar-item: no se pudo enviar', sendError?.message)
    return response.status(502).json({ ok: false, error: 'No se pudo enviar el correo' })
  }
  return response.status(200).json({ ok: true, sent: ctx.correo, producto: record.producto, estado, fotos: fotos.length })
}
