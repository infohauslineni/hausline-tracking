import { enviarCorreoEncargoAdmin, enviarCorreoEsperandoPago } from './_correo.js'
import { obtenerCatalogoMergeado } from './_catalogo.js'

// Trae la foto del producto por su código, para mostrarla en el correo. Usa el catálogo
// UNIDO (tienda productos.js + feed + panel), no solo catalogo_web, para que también
// encuentre la foto de los códigos viejos (p.ej. CL0007) que solo viven en la tienda.
// Best-effort: si no está o falla la red, devuelve ''.
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

// Aviso INTERNO (para ti) cuando cae un ENCARGO WEB nuevo desde el catálogo.
//
// Lo dispara el webhook de Supabase (Database Webhook) sobre la tabla `solicitudes`
// en el evento INSERT, con el mismo secreto compartido (NOTIFY_SECRET) que
// notificar-estado. El `record` del webhook ya trae TODO lo del encargo
// (cliente, producto, montos, envío), así que no hace falta consultar la base.
//
// Destinatario: AVISO_ADMIN (una o varias direcciones separadas por coma). Si no
// está configurado, usa SMTP_USER (tu propio correo del dominio), así funciona
// de una vez sin variables extra.
//
// Configuración del webhook en Supabase (una sola vez):
//   Database → Webhooks → Create → tabla public.solicitudes, evento Insert →
//   HTTP POST a  https://TU-APP/api/notificar-encargo  con la cabecera
//   Authorization: Bearer <NOTIFY_SECRET>.
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

  // Solo al CREAR el encargo (INSERT) en la tabla solicitudes.
  if (body.table !== 'solicitudes' || body.type !== 'INSERT') {
    return response.status(200).json({ ok: true, skipped: 'no aplica' })
  }
  // El encargo nace 'pendiente'; solo avisamos de ese.
  if (record.estado && record.estado !== 'pendiente') {
    return response.status(200).json({ ok: true, skipped: 'no pendiente' })
  }
  if (!record.codigo || !record.producto) {
    return response.status(200).json({ ok: true, skipped: 'encargo incompleto' })
  }

  const destino = (process.env.AVISO_ADMIN || process.env.SMTP_USER || '').trim()
  if (!destino) return response.status(200).json({ ok: true, skipped: 'sin destinatario' })

  // Foto del producto para el correo. Preferimos la que el cliente guardó con el encargo
  // (viaja en el record del webhook); si no trae, la buscamos por código en el catálogo.
  if (!record.imagen) record.imagen = await fotoProducto(record.producto_codigo)

  try {
    await enviarCorreoEncargoAdmin({ to: destino, solicitud: record })
  } catch (sendError) {
    console.error('notificar-encargo: no se pudo enviar', sendError?.message)
    return response.status(502).json({ ok: false, error: 'No se pudo enviar el correo' })
  }

  // Correo automático AL CLIENTE: "recibimos tu pedido, esperamos tu pago" + botón para
  // pagar/enviar comprobante. Best-effort: si el cliente no dejó correo o el envío falla,
  // no rompemos el aviso interno (que es lo crítico) — solo lo registramos.
  let avisoCliente = false
  const correoCliente = String(record.cliente_correo || '').trim()
  if (correoCliente) {
    try {
      await enviarCorreoEsperandoPago({
        correo: correoCliente,
        nombre: record.cliente_nombre,
        codigo: record.codigo,
        producto: record.producto,
      })
      avisoCliente = true
    } catch (clienteError) {
      console.error('notificar-encargo: no se pudo avisar al cliente', clienteError?.message)
    }
  }

  return response.status(200).json({ ok: true, sent: destino, codigo: record.codigo, avisoCliente })
}
