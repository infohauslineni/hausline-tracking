import { ESTADO_LABEL, enviarCorreoPedido } from './_correo.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Trae los productos del pedido para armar la factura del correo. Usa la llave de
// servicio (ya configurada en Vercel para el cron) porque pedido_items está
// protegido por RLS.
//
// OJO con la creación: la app inserta primero el pedido (aquí dispara el webhook)
// y JUSTO DESPUÉS los productos, así que al crear puede que los ítems todavía no
// estén y que record.total siga en 0. Por eso: (1) reintentamos unos segundos y
// (2) calculamos el total sumando los subtotales de los ítems (no confiamos en
// record.total). Si aun así no hay ítems, devuelve null y el correo va sin tabla.
async function obtenerFactura(record, esNuevo) {
  const base = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key || !record?.id) return null

  const url = `${base.replace(/\/$/, '')}/rest/v1/pedido_items`
    + `?pedido_id=eq.${record.id}`
    + `&select=producto,codigo_producto,imagen,talla,color,cantidad,precio_unitario,subtotal`
    + `&order=created_at`

  const intentos = esNuevo ? 6 : 1
  let rows = []
  for (let i = 0; i < intentos; i++) {
    try {
      const res = await fetch(url, { headers: { apikey: key, authorization: `Bearer ${key}` } })
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data) && data.length) { rows = data; break }
      }
    } catch { /* reintenta */ }
    if (i < intentos - 1) await sleep(500)
  }
  if (!rows.length) return null

  const items = rows.map((r) => ({
    producto: r.producto,
    codigo: r.codigo_producto || '',
    imagen: r.imagen || '',
    detalle: [r.talla ? `Talla ${r.talla}` : '', r.color || ''].filter(Boolean).join(' · '),
    cantidad: Number(r.cantidad) || 1,
    precioUnitario: Number(r.precio_unitario) || 0,
    subtotal: Number(r.subtotal) || 0,
  }))

  const total = items.reduce((sum, it) => sum + it.subtotal, 0)
  // Al entregar (comprobante) se da por pagado el total; al crear se usa el abono real.
  const abono = esNuevo ? (Number(record.abono) || 0) : total
  return {
    items,
    total,
    abono,
    saldo: Math.max(0, total - abono),
    fecha: record.fecha_pedido || null,
    variante: esNuevo ? 'compra' : 'pago',
  }
}

// Aviso por correo cuando cambia el estado de un pedido. Lo dispara el webhook de
// Supabase (con el secreto compartido). El aviso al CREAR el pedido lo maneja la app
// directamente vía /api/notificar-creacion, así que aquí solo procesamos cambios de estado.
export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ ok: false, error: 'Method not allowed' })

  // Solo Supabase (con el secreto compartido) puede disparar este envío.
  const authorization = request.headers?.authorization ?? request.headers?.get?.('authorization')
  if (!process.env.NOTIFY_SECRET || authorization !== `Bearer ${process.env.NOTIFY_SECRET}`) {
    return response.status(401).json({ ok: false })
  }
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return response.status(500).json({ ok: false, error: 'Missing SMTP configuration' })
  }

  const body = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : (request.body ?? {})
  const record = body.record ?? {}
  const oldRecord = body.old_record ?? {}

  // Notificamos al crear el pedido (INSERT) y cuando cambia su estado (UPDATE).
  const tipo = body.type
  if (body.table !== 'pedidos' || (tipo !== 'UPDATE' && tipo !== 'INSERT')) return response.status(200).json({ ok: true, skipped: 'no aplica' })
  const esNuevo = tipo === 'INSERT'
  const estado = record.estado
  // En INSERT no hay estado anterior: se avisa que el pedido quedó registrado.
  // En UPDATE solo se avisa si el estado realmente cambió.
  if (!estado) return response.status(200).json({ ok: true, skipped: 'sin estado' })
  if (!esNuevo && estado === oldRecord.estado) return response.status(200).json({ ok: true, skipped: 'sin cambio de estado' })
  if (!ESTADO_LABEL[estado]) return response.status(200).json({ ok: true, skipped: 'estado no notificable' })

  // El correo y el nombre del cliente vienen dentro del aviso (los agrega el trigger de Supabase),
  // así no hace falta la llave de servicio de Supabase en el servidor.
  const correo = (body.cliente_correo ?? '').trim()
  const nombre = body.cliente_nombre ?? null
  if (!correo) return response.status(200).json({ ok: true, skipped: 'cliente sin correo' })

  // Factura dentro del correo: al crear el pedido (compra) y al marcarlo entregado (pago).
  const conFactura = esNuevo || estado === 'entregado'
  const factura = conFactura ? await obtenerFactura(record, esNuevo) : null

  try {
    await enviarCorreoPedido({ correo, nombre, codigo: record.codigo, estado, esNuevo, factura })
  } catch (sendError) {
    return response.status(502).json({ ok: false, error: 'No se pudo enviar el correo' })
  }

  return response.status(200).json({ ok: true, sent: correo })
}
