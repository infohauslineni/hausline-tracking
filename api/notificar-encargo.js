import { enviarCorreoEncargoAdminGrupo, enviarCorreoEsperandoPago, enviarCorreoEsperandoPagoGrupo } from './_correo.js'
import { obtenerCatalogoMergeado } from './_catalogo.js'

// Damos tiempo a que caiga TODO el carrito (la tienda crea un encargo por producto, en fila)
// antes de reclamar y avisar, para mandar un solo correo por pedido.
export const config = { maxDuration: 30 }
const ESPERA_CARRITO_MS = 8000

// Trae la foto del producto por su código, para el correo. Usa el catálogo UNIDO (tienda +
// feed + panel). Best-effort: si no está o falla la red, devuelve ''.
async function fotoProducto(codigo) {
  if (!codigo) return ''
  try {
    const clave = String(codigo).trim().toUpperCase()
    const catalogo = await obtenerCatalogoMergeado()
    const item = catalogo.find((p) => String(p.codigo || '').trim().toUpperCase() === clave)
    if (!item) return ''
    return item.imagen || (Array.isArray(item.imagenes) && item.imagenes[0]) || ''
  } catch { return '' }
}

// Reclama de forma ATÓMICA (marca aviso_admin_at) los encargos pendientes AÚN SIN AVISAR del
// mismo cliente creados en los últimos minutos, y los devuelve. Como el UPDATE bloquea las
// filas, de todas las invocaciones concurrentes del carrito SOLO UNA se lleva las filas (las
// demás reciben []), así se manda un único correo. Si no hay service role, devuelve null.
async function reclamarEncargos(record) {
  const base = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) return null
  const root = base.replace(/\/$/, '')
  const wa = String(record.cliente_whatsapp || '').trim()
  const desde = new Date(Date.now() - 15 * 60 * 1000).toISOString()
  const filtro = wa
    ? `cliente_whatsapp=eq.${encodeURIComponent(wa)}&estado=eq.pendiente&aviso_admin_at=is.null&created_at=gte.${encodeURIComponent(desde)}`
    : `id=eq.${encodeURIComponent(record.id)}&aviso_admin_at=is.null`
  const res = await fetch(`${root}/rest/v1/solicitudes?${filtro}`, {
    method: 'PATCH',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', prefer: 'return=representation' },
    body: JSON.stringify({ aviso_admin_at: new Date().toISOString() }),
  })
  if (!res.ok) throw new Error(`claim ${res.status}`)
  const rows = await res.json()
  return Array.isArray(rows) ? rows : []
}

// Aviso INTERNO (para ti) cuando cae un ENCARGO WEB nuevo. Lo dispara el Database Webhook de
// Supabase sobre `solicitudes` (INSERT), con el secreto NOTIFY_SECRET. Un carrito crea un
// encargo por producto, así que agrupamos: mandamos UN correo por cliente con todos sus
// productos (y un solo correo al cliente).
export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ ok: false, error: 'Method not allowed' })

  const authorization = request.headers?.authorization ?? request.headers?.get?.('authorization')
  if (!process.env.NOTIFY_SECRET || authorization !== `Bearer ${process.env.NOTIFY_SECRET}`) {
    return response.status(401).json({ ok: false })
  }
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return response.status(500).json({ ok: false, error: 'Missing SMTP configuration' })
  }

  const body = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : (request.body ?? {})
  const record = body.record ?? {}

  if (body.table !== 'solicitudes' || body.type !== 'INSERT') {
    return response.status(200).json({ ok: true, skipped: 'no aplica' })
  }
  if (record.estado && record.estado !== 'pendiente') {
    return response.status(200).json({ ok: true, skipped: 'no pendiente' })
  }
  if (!record.codigo || !record.producto) {
    return response.status(200).json({ ok: true, skipped: 'encargo incompleto' })
  }

  const destino = (process.env.AVISO_ADMIN || process.env.SMTP_USER || '').trim()
  if (!destino) return response.status(200).json({ ok: true, skipped: 'sin destinatario' })

  // Espera a que caiga el resto del carrito y luego reclama todos los del cliente.
  await new Promise((resolve) => setTimeout(resolve, ESPERA_CARRITO_MS))
  let encargos
  try { encargos = await reclamarEncargos(record) }
  catch (claimError) { console.error('notificar-encargo: claim falló', claimError?.message); encargos = null }
  // Sin service role (o falla el claim): comportamiento simple con este único encargo.
  if (encargos === null) encargos = [record]
  if (!encargos.length) return response.status(200).json({ ok: true, skipped: 'ya avisado (agrupado)' })

  encargos.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  for (const s of encargos) { if (!s.imagen) s.imagen = await fotoProducto(s.producto_codigo) }

  try {
    await enviarCorreoEncargoAdminGrupo({ to: destino, solicitudes: encargos })
  } catch (sendError) {
    console.error('notificar-encargo: no se pudo enviar', sendError?.message)
    return response.status(502).json({ ok: false, error: 'No se pudo enviar el correo' })
  }

  // Correo automático AL CLIENTE (uno solo con todos sus códigos). Best-effort.
  let avisoCliente = false
  const correoCliente = String(encargos[0].cliente_correo || '').trim()
  if (correoCliente) {
    try {
      if (encargos.length > 1) {
        await enviarCorreoEsperandoPagoGrupo({ correo: correoCliente, nombre: encargos[0].cliente_nombre, codigos: encargos.map((s) => s.codigo), cantidad: encargos.length })
      } else {
        await enviarCorreoEsperandoPago({ correo: correoCliente, nombre: encargos[0].cliente_nombre, codigo: encargos[0].codigo, producto: encargos[0].producto })
      }
      avisoCliente = true
    } catch (clienteError) {
      console.error('notificar-encargo: no se pudo avisar al cliente', clienteError?.message)
    }
  }

  return response.status(200).json({ ok: true, sent: destino, count: encargos.length, avisoCliente })
}
