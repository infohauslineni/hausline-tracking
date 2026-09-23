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
// Reclama de forma ATÓMICA (marca la columna `campo`) los encargos del mismo cliente que
// cumplen `extra` (aún sin marcar), y los devuelve. Como el UPDATE bloquea las filas, de
// todas las invocaciones concurrentes SOLO UNA se lleva las filas (las demás reciben []),
// así se manda un único correo. Si no hay service role, devuelve null.
async function reclamar(record, campo, extra) {
  const base = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) return null
  const root = base.replace(/\/$/, '')
  const wa = String(record.cliente_whatsapp || '').trim()
  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const base_filtro = wa
    ? `cliente_whatsapp=eq.${encodeURIComponent(wa)}&estado=eq.pendiente&created_at=gte.${encodeURIComponent(desde)}`
    : `id=eq.${encodeURIComponent(record.id)}`
  const filtro = `${base_filtro}&${campo}=is.null${extra ? `&${extra}` : ''}`
  const res = await fetch(`${root}/rest/v1/solicitudes?${filtro}`, {
    method: 'PATCH',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', prefer: 'return=representation' },
    body: JSON.stringify({ [campo]: new Date().toISOString() }),
  })
  if (!res.ok) throw new Error(`claim ${res.status}`)
  const rows = await res.json()
  return Array.isArray(rows) ? rows : []
}

// Correos del encargo web. Lo dispara el Database Webhook de Supabase sobre `solicitudes`
// (INSERT y UPDATE), con el secreto NOTIFY_SECRET. Regla nueva para NO llenar el buzón del
// admin de encargos que nadie paga:
//   • INSERT (se crea el encargo)               → correo SOLO al CLIENTE ("esperamos tu pago").
//   • UPDATE con pago_reportado_at recién puesto → correo SOLO al ADMIN ("cliente reportó pago").
// Un carrito comparte grupo, así que agrupamos y mandamos UN correo por cliente.
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
  const old = body.old_record ?? body.old ?? {}
  if (body.table !== 'solicitudes') {
    return response.status(200).json({ ok: true, skipped: 'no aplica' })
  }
  if (!record.codigo || !record.producto) {
    return response.status(200).json({ ok: true, skipped: 'encargo incompleto' })
  }

  // ── UPDATE: el cliente REPORTÓ el pago → avisamos al ADMIN (una vez por grupo) ──
  if (body.type === 'UPDATE') {
    if (!record.pago_reportado_at || old.pago_reportado_at) {
      return response.status(200).json({ ok: true, skipped: 'sin pago reportado nuevo' })
    }
    const destino = (process.env.AVISO_ADMIN || process.env.SMTP_USER || '').trim()
    if (!destino) return response.status(200).json({ ok: true, skipped: 'sin destinatario' })
    let encargos
    try { encargos = await reclamar(record, 'aviso_pago_at', 'pago_reportado_at=not.is.null') }
    catch (e) { console.error('notificar-encargo: claim pago falló', e?.message); encargos = null }
    if (encargos === null) encargos = [record]
    if (!encargos.length) return response.status(200).json({ ok: true, skipped: 'pago ya avisado' })
    encargos.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    for (const s of encargos) { if (!s.imagen) s.imagen = await fotoProducto(s.producto_codigo) }
    try {
      await enviarCorreoEncargoAdminGrupo({ to: destino, solicitudes: encargos, pagoReportado: true })
    } catch (e) {
      console.error('notificar-encargo: no se pudo enviar al admin', e?.message)
      return response.status(502).json({ ok: false, error: 'No se pudo enviar el correo' })
    }
    return response.status(200).json({ ok: true, admin: destino, count: encargos.length })
  }

  // ── INSERT: nuevo encargo → avisa al ADMIN (cada encargo web) y al CLIENTE ("esperamos tu pago") ──
  if (body.type !== 'INSERT') {
    return response.status(200).json({ ok: true, skipped: 'evento no aplica' })
  }
  if (record.estado && record.estado !== 'pendiente') {
    return response.status(200).json({ ok: true, skipped: 'no pendiente' })
  }
  // Espera a que caiga el resto del carrito y luego reclama para avisar UNA vez.
  await new Promise((resolve) => setTimeout(resolve, ESPERA_CARRITO_MS))
  let encargos
  try { encargos = await reclamar(record, 'aviso_admin_at') }
  catch (claimError) { console.error('notificar-encargo: claim falló', claimError?.message); encargos = null }
  if (encargos === null) encargos = [record]
  if (!encargos.length) return response.status(200).json({ ok: true, skipped: 'ya avisado (agrupado)' })
  encargos.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))

  // Aviso interno AL ADMIN por cada encargo web nuevo (uno solo por carrito). Best-effort:
  // si falla, igual sigue el correo al cliente. El aviso "fuerte" de pago reportado (UPDATE)
  // sigue vivo aparte, para cuando el cliente suba el comprobante.
  let avisoAdmin = false
  const destinoAdmin = (process.env.AVISO_ADMIN || process.env.SMTP_USER || '').trim()
  if (destinoAdmin) {
    try {
      for (const s of encargos) { if (!s.imagen) s.imagen = await fotoProducto(s.producto_codigo) }
      await enviarCorreoEncargoAdminGrupo({ to: destinoAdmin, solicitudes: encargos, pagoReportado: false })
      avisoAdmin = true
    } catch (adminError) {
      console.error('notificar-encargo: no se pudo avisar al admin', adminError?.message)
    }
  }
  console.log('notificar-encargo INSERT →', JSON.stringify({ avisoAdmin, destinoAdmin: destinoAdmin ? destinoAdmin.replace(/(.{2}).*(@.*)/, '$1***$2') : '(vacío)', count: encargos.length }))

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

  return response.status(200).json({ ok: true, avisoAdmin, avisoCliente, count: encargos.length })
}
