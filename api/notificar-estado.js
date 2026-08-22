import { ESTADO_LABEL, enviarCorreoPedido } from './_correo.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Trae el pedido + sus productos para armar la factura del correo. Usa la llave de
// servicio (ya configurada en Vercel para el cron) porque las tablas están con RLS.
//
// Se busca por CÓDIGO (siempre viene en el payload del webhook), no por id: el
// trigger que dispara el aviso manda un record reducido que puede no traer el id.
//
// OJO con la creación: la app inserta primero el pedido (aquí dispara el webhook)
// y JUSTO DESPUÉS los productos, así que al crear puede que los ítems todavía no
// estén. Por eso reintentamos unos segundos. El total se calcula sumando los
// subtotales de los ítems. Si aun así no hay ítems, devuelve null y va sin tabla.
async function obtenerFactura(codigo, esNuevo) {
  const base = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key || !codigo) return null

  const url = `${base.replace(/\/$/, '')}/rest/v1/pedidos`
    + `?codigo=eq.${encodeURIComponent(codigo)}`
    + `&select=abono,fecha_pedido,pedido_items(producto,codigo_producto,imagen,talla,color,cantidad,precio_unitario,subtotal)`
    + `&limit=1`

  const intentos = esNuevo ? 6 : 1
  let pedido = null
  for (let i = 0; i < intentos; i++) {
    try {
      const res = await fetch(url, { headers: { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' } })
      if (res.ok) {
        const data = await res.json()
        const p = Array.isArray(data) ? data[0] : null
        if (p && Array.isArray(p.pedido_items) && p.pedido_items.length) { pedido = p; break }
      } else {
        console.error('obtenerFactura: fetch no ok', res.status)
      }
    } catch (error) {
      console.error('obtenerFactura: error', error?.message)
    }
    if (i < intentos - 1) await sleep(500)
  }
  if (!pedido) { console.error('obtenerFactura: sin items para', codigo); return null }

  const items = pedido.pedido_items.map((r) => ({
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
  const abono = esNuevo ? (Number(pedido.abono) || 0) : total
  return {
    items,
    total,
    abono,
    saldo: Math.max(0, total - abono),
    fecha: pedido.fecha_pedido || null,
    variante: esNuevo ? 'compra' : 'pago',
  }
}

// Aviso por correo del pedido. Lo dispara SIEMPRE el webhook de Supabase (con el
// secreto compartido). Al CREAR el pedido (INSERT) —sea manual o al confirmar un
// encargo web— el pedido nace en 'pedido_confirmado', así que el cliente recibe el
// correo de "Orden confirmada" CON la factura (producto, precio, abono, saldo + PDF),
// ya NO uno titulado "pedido registrado". Al cambiar de estado (UPDATE) se envía el
// aviso de esa etapa, y el comprobante PAGADO al entregar.
// La app NO envía correos por su cuenta, así que no hay envíos duplicados.
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
  // Estados que se manejan a mano: NO se envía correo automático al cliente.
  const SIN_CORREO = new Set(['cancelado', 'incidencia'])
  if (SIN_CORREO.has(estado)) return response.status(200).json({ ok: true, skipped: 'estado sin correo' })
  // Evita correos repetidos cuando el cliente ve la MISMA etiqueta pública: las etapas de
  // bodega (recibido_estados_unidos / transito_nicaragua) se muestran como "En tránsito
  // internacional", igual que transito_internacional → así manda UN solo correo de tránsito.
  if (!esNuevo && ESTADO_LABEL[estado] === ESTADO_LABEL[oldRecord.estado]) return response.status(200).json({ ok: true, skipped: 'misma etiqueta pública' })

  // El correo y el nombre del cliente vienen dentro del aviso (los agrega el trigger de Supabase),
  // así no hace falta la llave de servicio de Supabase en el servidor.
  const correo = (body.cliente_correo ?? '').trim()
  const nombre = body.cliente_nombre ?? null
  if (!correo) return response.status(200).json({ ok: true, skipped: 'cliente sin correo' })

  // Factura dentro del correo: al confirmar el pedido (INSERT → tabla de compra con
  // producto, precio, abono y saldo) y al marcarlo entregado (comprobante PAGADO).
  const conFactura = esNuevo || estado === 'entregado'
  const factura = conFactura ? await obtenerFactura(record.codigo, esNuevo) : null

  try {
    await enviarCorreoPedido({ correo, nombre, codigo: record.codigo, estado, esNuevo, factura })
  } catch (sendError) {
    return response.status(502).json({ ok: false, error: 'No se pudo enviar el correo' })
  }

  return response.status(200).json({ ok: true, sent: correo })
}
