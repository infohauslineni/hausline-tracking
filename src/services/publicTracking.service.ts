import { DEMO_PEDIDOS } from '../data/demo'
import { DEMO_TRAYECTOS } from '../data/demoLogistics'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import type { EstadoPedido, Pedido } from '../types/domain'
import type { PublicImage, PublicOrder } from '../types/publicTracking'
import { estadoLabelPublico } from '../constants/orders'
import { estimateDateForPreview } from '../utils/estimates'

// Cancelado / incidencia NO se le muestran al cliente: el seguimiento se queda en el
// último estado "normal" (sin estado especial, sin nota, sin entrada en el historial).
// Así, si un pedido se cancela o tiene una novedad, el cliente no ve ningún cambio.
const CODIGO_POR_ETIQUETA: Record<string, EstadoPedido> = {
  'Orden confirmada': 'pedido_confirmado', 'En preparación': 'en_preparacion',
  'En tránsito': 'transito_internacional', 'País de destino': 'llego_nicaragua',
  'Disponible para entrega': 'disponible_entrega', 'Pagado': 'pagado',
  'Empaquetado, listo para envío': 'empaquetado', 'Entregado': 'entregado',
}
const esEstadoOculto = (label: string) => { const v = label.toLowerCase(); return v.includes('cancel') || v.includes('incidencia') || v.includes('requiere') || v.includes('atenci') }
function ocultarEstadoInterno(order: PublicOrder): PublicOrder {
  const historial = order.historial.map((entry) => ({ ...entry, estado: normalizarEstadoHistorial(entry.estado) }))
  if (order.estado_codigo !== 'cancelado' && order.estado_codigo !== 'incidencia') {
    return { ...order, estado: estadoLabelPublico(order.estado_codigo), historial }
  }
  const visibles = historial.filter((entry) => !esEstadoOculto(entry.estado)) // más antiguo → más reciente
  const ultimo = visibles[visibles.length - 1]
  const estadoCodigo: EstadoPedido = ultimo ? (CODIGO_POR_ETIQUETA[ultimo.estado] ?? 'pedido_confirmado') : 'pedido_confirmado'
  return {
    ...order,
    estado_codigo: estadoCodigo,
    estado: estadoLabelPublico(estadoCodigo),
    notas_publicas: null,
    ultima_actualizacion: ultimo?.fecha ?? order.ultima_actualizacion,
    historial: visibles,
  }
}

function demoPublicOrder(order: Pedido): PublicOrder {
  const routes = DEMO_TRAYECTOS.filter((route) => route.pedido_id === order.id && route.visible_cliente)
  return {
    codigo: order.codigo, estado: estadoLabelPublico(order.estado), estado_codigo: order.estado,
    fecha_pedido: order.fecha_pedido, fecha_estimada: estimateDateForPreview(order.estado), fecha_entrega: order.estado === 'entregado' ? order.updated_at : null,
    ultima_actualizacion: order.updated_at, imagen_principal: null,
    notas_publicas: order.notas_publicas ?? (order.estado === 'incidencia' ? 'Estamos gestionando una incidencia logística.' : 'Tu pedido avanza según lo previsto.'),
    productos: (order.pedido_items ?? []).map((item) => ({ producto: item.producto, codigo: item.codigo_producto ?? null, marca: item.marca ?? null, categoria: item.categoria ?? null, talla: item.talla ?? null, color: item.color ?? null, cantidad: item.cantidad, imagen: item.imagen ?? null })),
    historial: [
      { estado: 'Pedido confirmado', nota: 'Recibimos y confirmamos tu pedido.', ubicacion: null, fecha: order.created_at },
      ...(order.estado !== 'pedido_confirmado' ? [{ estado: estadoLabelPublico(order.estado), nota: order.notas_publicas ?? 'Tu pedido fue actualizado.', ubicacion: routes.at(-1)?.ultima_ubicacion ?? null, fecha: order.updated_at }] : []),
    ],
    trayectos: routes.map((route) => ({ tipo: route.tipo_trayecto, origen: route.pais_origen, destino: route.pais_destino, transportista: route.transportistas?.nombre ?? null, tracking: route.tracking, url_tracking: route.url_tracking, estado: route.estado, ultima_ubicacion: route.ultima_ubicacion, ultimo_evento: route.ultimo_evento, fecha_estimada: route.fecha_estimada, eventos: (route.tracking_eventos ?? []).filter((event) => event.visible_cliente).map((event) => ({ descripcion: event.descripcion_publica ?? 'Actualización logística', ubicacion: event.ubicacion, fecha: event.fecha_evento })) })),
    imagenes: [],
  }
}

export async function buscarPedidoPublico(code: string): Promise<PublicOrder | null> {
  const normalized = code.trim().toUpperCase()
  if (!/^HS\d{6}$/.test(normalized)) return null
  if (!isSupabaseConfigured || !supabase) {
    const order = DEMO_PEDIDOS.find((item) => item.codigo === normalized)
    return order ? ocultarEstadoInterno(demoPublicOrder(order)) : null
  }
  // Ambas consultas son independientes (solo necesitan el código): las lanzamos EN
  // PARALELO para que el seguimiento cargue más rápido al abrir la página.
  const [pedidoRes, archivosRes] = await Promise.all([
    supabase.rpc('obtener_pedido_publico', { p_codigo: normalized }),
    supabase.rpc('obtener_archivos_pedido_publicos', { p_codigo: normalized }),
  ])
  const { data, error } = pedidoRes
  if (error) throw error
  if (!data) return null
  const order = data as PublicOrder
  const { data: files, error: filesError } = archivosRes
  const normalizedOrder = ocultarEstadoInterno(order)
  if (filesError || !Array.isArray(files) || files.length === 0) return { ...normalizedOrder, imagenes: [] }
  const images = files as PublicImage[]
  const { data: signed } = await supabase.storage.from('pedidos').createSignedUrls(images.map((image) => image.storage_path), 3600)
  return { ...normalizedOrder, imagenes: images.map((image, index) => ({ ...image, url: signed?.[index]?.signedUrl ?? undefined })) }
}

function normalizarEstadoHistorial(label: string) {
  const value = label.toLowerCase()
  if (value.includes('confirm')) return 'Orden confirmada'
  // Control de calidad se agrupa dentro de "En preparación".
  if (value.includes('prepar') || value.includes('calidad')) return 'En preparación'
  // "Pagado" no es un paso visible para el cliente: se muestra como "Disponible para entrega".
  if (value.includes('disponible') || value.includes('pagad')) return 'Disponible para entrega'
  if (value.includes('empaque')) return 'Empaquetado, listo para envío'
  if (value.includes('entregado')) return 'Entregado'
  if (value.includes('país de destino') || value.includes('pais de destino') || (value.includes('nicaragua') && (value.includes('lleg') || value.includes('recibid') && !value.includes('estados unidos')))) return 'País de destino'
  // Despacho + bodega internacional (Warehouse, enviando, tránsito, Miami/EE.UU.) → "En tránsito".
  if (value.includes('warehouse') || value.includes('enviando') || value.includes('tránsito') || value.includes('transito') || value.includes('estados unidos') || value.includes('etiqueta') || value.includes('despach')) return 'En tránsito'
  return label
}
