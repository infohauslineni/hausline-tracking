import { DEMO_PEDIDOS } from '../data/demo'
import { DEMO_TRAYECTOS } from '../data/demoLogistics'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import type { Pedido } from '../types/domain'
import type { PublicImage, PublicOrder } from '../types/publicTracking'
import { estadoLabel } from '../constants/orders'
import { estimateDateForPreview } from '../utils/estimates'

function demoPublicOrder(order: Pedido): PublicOrder {
  const routes = DEMO_TRAYECTOS.filter((route) => route.pedido_id === order.id && route.visible_cliente)
  return {
    codigo: order.codigo, estado: estadoLabel(order.estado), estado_codigo: order.estado,
    fecha_pedido: order.fecha_pedido, fecha_estimada: estimateDateForPreview(order.estado), fecha_entrega: order.estado === 'entregado' ? order.updated_at : null,
    ultima_actualizacion: order.updated_at, imagen_principal: null,
    notas_publicas: order.notas_publicas ?? (order.estado === 'incidencia' ? 'Estamos gestionando una incidencia logística.' : 'Tu pedido avanza según lo previsto.'),
    productos: (order.pedido_items ?? []).map((item) => ({ producto: item.producto, marca: item.marca ?? null, categoria: item.categoria ?? null, talla: item.talla ?? null, color: item.color ?? null, cantidad: item.cantidad, imagen: item.imagen ?? null })),
    historial: [
      { estado: 'Pedido confirmado', nota: 'Recibimos y confirmamos tu pedido.', ubicacion: null, fecha: order.created_at },
      ...(order.estado !== 'pedido_confirmado' ? [{ estado: estadoLabel(order.estado), nota: order.notas_publicas ?? 'Tu pedido fue actualizado.', ubicacion: routes.at(-1)?.ultima_ubicacion ?? null, fecha: order.updated_at }] : []),
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
    return order ? demoPublicOrder(order) : null
  }
  const { data, error } = await supabase.rpc('obtener_pedido_publico', { p_codigo: normalized })
  if (error) throw error
  if (!data) return null
  const order = data as PublicOrder
  const { data: files, error: filesError } = await supabase.rpc('obtener_archivos_pedido_publicos', { p_codigo: normalized })
  const normalizedOrder = {
    ...order,
    estado: estadoLabel(order.estado_codigo),
    historial: order.historial.map((entry) => ({ ...entry, estado: normalizarEstadoHistorial(entry.estado) })),
  }
  if (filesError || !Array.isArray(files) || files.length === 0) return { ...normalizedOrder, imagenes: [] }
  const images = files as PublicImage[]
  const { data: signed } = await supabase.storage.from('pedidos').createSignedUrls(images.map((image) => image.storage_path), 3600)
  return { ...normalizedOrder, imagenes: images.map((image, index) => ({ ...image, url: signed?.[index]?.signedUrl ?? undefined })) }
}

function normalizarEstadoHistorial(label: string) {
  const value = label.toLowerCase()
  if (value.includes('confirm')) return 'Orden confirmada'
  if (value.includes('prepar')) return 'En preparación'
  if (value.includes('calidad')) return 'Control de calidad'
  if (value.includes('disponible')) return 'Disponible para entrega'
  if (value.includes('entregado')) return 'Entregado'
  if (value.includes('país de destino') || value.includes('pais de destino') || (value.includes('nicaragua') && (value.includes('lleg') || value.includes('recibid') && !value.includes('estados unidos')))) return 'País de destino'
  if (value.includes('etiqueta') || value.includes('despach')) return 'Despachado'
  if (value.includes('tránsito') || value.includes('transito') || value.includes('estados unidos')) return 'En tránsito internacional'
  return label
}
