// Helper de la integración con 17TRACK. El guion bajo evita que Vercel lo publique
// como endpoint (igual que _correo.js). Aquí vive TODO el conocimiento de 17track:
// cómo registrar guías, cómo traducir sus estados al flujo del pedido y cómo
// avanzar el pedido sin romper las reglas del negocio.
//
// La traducción es un ESPEJO de src/services/logistica.service.ts para que el
// camino automático (17track) se comporte igual que el manual. Si algún día
// cambias la lógica allá, cámbiala aquí también.
import crypto from 'node:crypto'

const REGISTER_URL = 'https://api.17track.net/track/v2.4/register'

// 17track solo ve la primera pata (proveedor → Miami). "Delivered" para nosotros
// significa "llegó a Miami", NO entregado al cliente: por eso mapea a 'entregado'
// del TRAYECTO, que inferirEstadoPedido convierte en "En tránsito internacional".
const STATUS_MAP = {
  NotFound: null, // aún sin información del transportista: no tocamos nada
  InfoReceived: 'etiqueta_creada',
  InTransit: 'en_transito',
  AvailableForPickup: 'en_transito',
  OutForDelivery: 'en_transito',
  DeliveryFailure: 'entrega_fallida',
  Delivered: 'entregado',
  Exception: 'incidencia',
  Expired: null, // 17track dejó de rastrear: no cambiamos el pedido
}

// Orden del avance del pedido (espejo de logistica.service.ts). Se usa para nunca
// retroceder el estado por un evento viejo o desordenado.
const PROGRESO = [
  'pedido_confirmado', 'en_preparacion', 'control_calidad', 'etiqueta_creada', 'despachado',
  'transito_internacional', 'recibido_estados_unidos', 'transito_nicaragua',
  'llego_nicaragua', 'disponible_entrega', 'entregado',
]

// Nota pública que ve el cliente (espejo de src/constants/orders.ts notaPublicaEstado).
const NOTA_PUBLICA = {
  pedido_confirmado: 'Recibimos y confirmamos tu orden.',
  en_preparacion: 'Estamos preparando tu pedido.',
  control_calidad: 'Tu pedido está pasando por control de calidad.',
  etiqueta_creada: 'Tu pedido fue despachado y va en camino.',
  despachado: 'Tu pedido fue despachado y va en camino.',
  transito_internacional: 'Tu pedido va en camino a nuestro Warehouse HAUSLINE.',
  recibido_estados_unidos: 'Tu pedido llegó a nuestro Warehouse HAUSLINE.',
  transito_nicaragua: 'Tu pedido va en camino a HAUSLINE Nicaragua.',
  llego_nicaragua: 'Tu pedido llegó al país de destino.',
  disponible_entrega: 'Tu pedido está disponible para entrega.',
  entregado: 'Tu pedido fue entregado.',
  cancelado: 'El pedido fue cancelado.',
  incidencia: 'Estamos gestionando una incidencia con tu pedido.',
}

const DIACRITICOS = new RegExp('[\\u0300-\\u036f]', 'g')
function normalizar(valor) {
  return String(valor ?? '').normalize('NFD').replace(DIACRITICOS, '').toLowerCase()
}

export function mapearEstadoTrayecto(status) {
  return STATUS_MAP[status] ?? null
}

// Espejo de inferirEstadoPedido() en logistica.service.ts: dado el estado del
// trayecto y el texto del último evento, deduce el estado que debe mostrar el
// pedido. Como 17track solo cubre proveedor → Miami, "entregado" del trayecto
// (sin destino Nicaragua) cae en 'recibido_estados_unidos' = "En tránsito
// internacional", nunca en el "Entregado" final al cliente.
export function inferirEstadoPedido(trayecto, estado, descripcion = '', ubicacion = '') {
  const texto = normalizar(`${descripcion} ${ubicacion}`)
  if (estado === 'incidencia' || estado === 'entrega_fallida') return 'incidencia'
  if (estado === 'pendiente') return 'en_preparacion'
  if (estado === 'etiqueta_creada') return 'despachado'
  if (estado === 'cancelado') return null
  if (estado === 'entregado') {
    const dest = normalizar(trayecto?.pais_destino ?? '')
    if (dest.includes('nicaragua') || texto.includes('nicaragua') || texto.includes('managua')) return 'llego_nicaragua'
    return 'recibido_estados_unidos'
  }
  if (estado === 'en_transito' || estado === 'aduana') {
    if (texto.includes('hacia nicaragua') || texto.includes('rumbo a nicaragua') || texto.includes('salio de miami')) return 'transito_nicaragua'
    if (texto.includes('nicaragua') || texto.includes('managua')) return 'llego_nicaragua'
    if (texto.includes('estados unidos') || texto.includes('miami') || texto.includes('florida') || texto.includes('usa')) return 'recibido_estados_unidos'
    return 'transito_internacional'
  }
  return null
}

// Espejo de sincronizarPedido(): avanza el estado del pedido respetando las reglas
// (no retrocede, no pisa 'entregado' ni 'cancelado'). Al hacer el UPDATE de
// pedidos.estado se dispara SOLO el webhook de correo existente (con tu marca).
// Devuelve el estado nuevo si cambió, o null si no hubo cambio.
export async function sincronizarPedido(client, trayecto, estado, descripcion = '', ubicacion = '') {
  const siguiente = inferirEstadoPedido(trayecto, estado, descripcion, ubicacion)
  if (!siguiente) return null
  const { data: pedido, error } = await client.from('pedidos').select('estado').eq('id', trayecto.pedido_id).single()
  if (error) throw error
  const actual = pedido.estado
  if (actual === 'cancelado' || actual === 'entregado') return null
  if (actual === siguiente) return null
  if (siguiente !== 'incidencia' && actual !== 'incidencia' && PROGRESO.indexOf(siguiente) < PROGRESO.indexOf(actual)) return null
  const { error: upError } = await client.from('pedidos')
    .update({ estado: siguiente, notas_publicas: NOTA_PUBLICA[siguiente] ?? null })
    .eq('id', trayecto.pedido_id)
  if (upError) throw upError
  return siguiente
}

// Registra números de guía en 17track (máx. 40 por llamada). auto_detection deja
// que 17track adivine el transportista por el número, así no hay que mapear carriers.
export async function registrarEnTrack17(numeros) {
  const key = process.env.TRACK17_API_KEY
  if (!key) throw new Error('Falta TRACK17_API_KEY')
  const limpios = [...new Set((numeros ?? []).map((n) => String(n ?? '').trim()).filter(Boolean))].slice(0, 40)
  if (!limpios.length) return { accepted: [], rejected: [] }
  const res = await fetch(REGISTER_URL, {
    method: 'POST',
    headers: { '17token': key, 'content-type': 'application/json' },
    body: JSON.stringify(limpios.map((number) => ({ number, auto_detection: true }))),
  })
  const json = await res.json().catch(() => ({}))
  // code 0 = ok. Un número ya registrado vuelve en "rejected" con su propio código,
  // no es un error fatal: lo tratamos como "ya estaba" más arriba.
  if (!res.ok || json?.code !== 0) {
    throw new Error(`17track register HTTP ${res.status}: ${JSON.stringify(json).slice(0, 300)}`)
  }
  return json.data ?? { accepted: [], rejected: [] }
}

// Verifica la firma del webhook: sign = SHA256(event/data/API_KEY). Es una capa
// EXTRA; el candado principal es el token secreto en la URL del webhook. Se deja
// como comprobación no bloqueante porque la serialización exacta de "data" puede
// variar; devolvemos si coincidió para registrarlo en el log.
export function verificarFirma(eventName, dataRaw, sign) {
  const key = process.env.TRACK17_API_KEY
  if (!key || !sign || dataRaw == null) return false
  try {
    const esperado = crypto.createHash('sha256').update(`${eventName}/${dataRaw}/${key}`, 'utf8').digest('hex')
    return esperado.toLowerCase() === String(sign).toLowerCase()
  } catch {
    return false
  }
}

// 17track puede enviar el evento como un solo objeto en "data" o como un arreglo
// en "data.accepted". Normalizamos ambas formas a un arreglo de trackings.
export function extraerTrackings(body) {
  const data = body?.data
  if (!data) return []
  if (Array.isArray(data.accepted)) return data.accepted
  if (Array.isArray(data)) return data
  if (data.number || data.track_info) return [data]
  return []
}

// Saca de un objeto de tracking de 17track los datos que nos importan.
export function resumirTracking(item) {
  const ti = item?.track_info ?? {}
  const status = ti?.latest_status?.status ?? null
  const subStatus = ti?.latest_status?.sub_status ?? null
  const ev = ti?.latest_event ?? {}
  const ubicacion = ev.location || ev.address?.city || ev.address?.state || ev.address?.country || ''
  return {
    numero: String(item?.number ?? '').trim(),
    status,
    subStatus,
    descripcion: ev.description || subStatus || status || '',
    ubicacion: String(ubicacion || ''),
    fechaEvento: ev.time_iso || ev.time_utc || ev.time_raw || new Date().toISOString(),
    codigoEvento: ev.stage || subStatus || null,
  }
}
