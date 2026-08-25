import { enviarCorreoEncargoAdmin } from './_correo.js'

// Catálogo público de la TIENDA (proyecto Supabase distinto al del tracking). Ahí
// vive la foto de cada producto (catalogo_web.datos.imagen) por código. La llave es
// "publishable" (solo lectura pública, la misma que usa el sitio), no un secreto.
const TIENDA_URL = 'https://xgdijumnmaqfirmckugw.supabase.co'
const TIENDA_KEY = 'sb_publishable_NwpQth6G3qhpvtnRan3Xfg_8EqPM4Pw'

// Trae la foto del producto por su código, para mostrarla en el correo. Best-effort:
// si el producto no está en el catálogo del panel o falla la red, devuelve ''.
async function fotoProducto(codigo) {
  if (!codigo) return ''
  try {
    const url = `${TIENDA_URL}/rest/v1/catalogo_web?select=datos&codigo=eq.${encodeURIComponent(codigo)}&limit=1`
    const r = await fetch(url, { headers: { apikey: TIENDA_KEY, authorization: `Bearer ${TIENDA_KEY}` } })
    if (!r.ok) return ''
    const filas = await r.json()
    const datos = Array.isArray(filas) && filas[0] ? filas[0].datos : null
    return (datos && (datos.imagen || (Array.isArray(datos.imagenes) && datos.imagenes[0]))) || ''
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

  return response.status(200).json({ ok: true, sent: destino, codigo: record.codigo })
}
