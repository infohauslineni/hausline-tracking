import { supabase } from '../lib/supabase'
import { notaPublicaEstado } from '../constants/orders'
import type { EstadoPedido, EstadoTrayecto, TrackingEvento, Transportista, Trayecto } from '../types/domain'

export type TrayectoInput = Pick<Trayecto, 'pedido_id' | 'transportista_id' | 'tipo_trayecto' | 'pais_origen' | 'pais_destino' | 'tracking' | 'url_tracking' | 'estado' | 'ultima_ubicacion' | 'ultimo_evento' | 'fecha_envio' | 'fecha_estimada' | 'peso' | 'costo_envio' | 'numero_paquete' | 'notas_internas' | 'visible_cliente' | 'orden'>

function requireSupabase() {
  if (!supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

const progresoPedido: EstadoPedido[] = [
  'pedido_confirmado', 'en_preparacion', 'control_calidad', 'etiqueta_creada', 'despachado',
  'transito_internacional', 'recibido_estados_unidos', 'transito_nicaragua',
  'llego_nicaragua', 'disponible_entrega', 'entregado',
]

function normalizar(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function inferirEstadoPedido(trayecto: Trayecto, estado: EstadoTrayecto, descripcion = '', ubicacion = ''): EstadoPedido | null {
  const texto = normalizar(`${descripcion} ${ubicacion}`)
  if (estado === 'incidencia' || estado === 'entrega_fallida') return 'incidencia'
  if (estado === 'pendiente') return 'en_preparacion'
  if (estado === 'etiqueta_creada') return 'despachado'
  if (estado === 'cancelado') return null
  if (estado === 'entregado') {
    if (normalizar(trayecto.pais_destino ?? '').includes('nicaragua') || texto.includes('nicaragua') || texto.includes('managua')) return 'llego_nicaragua'
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

async function sincronizarPedido(trayecto: Trayecto, estado: EstadoTrayecto, descripcion = '', ubicacion = '') {
  const siguiente = inferirEstadoPedido(trayecto, estado, descripcion, ubicacion)
  if (!siguiente) return
  const client = requireSupabase()
  const { data: pedido, error: readError } = await client.from('pedidos').select('estado').eq('id', trayecto.pedido_id).single()
  if (readError) throw readError
  const actual = pedido.estado as EstadoPedido
  if (actual === 'cancelado' || actual === 'entregado') return
  if (siguiente !== 'incidencia' && actual !== 'incidencia' && progresoPedido.indexOf(siguiente) < progresoPedido.indexOf(actual)) return
  const { error } = await client.from('pedidos').update({ estado: siguiente, notas_publicas: notaPublicaEstado(siguiente) }).eq('id', trayecto.pedido_id)
  if (error) throw error
}

export async function listarTrayectos() {
  const { data, error } = await requireSupabase().from('trayectos')
    .select('*, pedidos(codigo, estado, clientes(nombre)), transportistas(*), tracking_eventos(*)')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data as unknown as Trayecto[]
}

export async function listarTrayectosPedido(pedidoId: string) {
  const { data, error } = await requireSupabase().from('trayectos')
    .select('*, transportistas(*), tracking_eventos(*)')
    .eq('pedido_id', pedidoId)
    .order('orden')
  if (error) throw error
  return data as unknown as Trayecto[]
}

export async function listarTransportistas() {
  const { data, error } = await requireSupabase().from('transportistas').select('*').eq('activo', true).order('nombre')
  if (error) throw error
  return data as Transportista[]
}

export async function guardarTrayecto(input: TrayectoInput, id?: string) {
  const client = requireSupabase()
  const query = id ? client.from('trayectos').update(input).eq('id', id) : client.from('trayectos').insert(input)
  const { data, error } = await query.select('*, pedidos(codigo, estado, clientes(nombre)), transportistas(*)').single()
  if (error) throw error
  const trayecto = data as unknown as Trayecto
  await sincronizarPedido(trayecto, trayecto.estado, trayecto.ultimo_evento ?? '', trayecto.ultima_ubicacion ?? '')
  return trayecto
}

export async function eliminarTrayecto(id: string) {
  const { error } = await requireSupabase().from('trayectos').delete().eq('id', id)
  if (error) throw error
}

export async function marcarTrayectoEntregado(id: string) {
  const { data, error } = await requireSupabase().from('trayectos').update({ estado: 'entregado', fecha_entrega: new Date().toISOString(), activo: false }).eq('id', id).select().single()
  if (error) throw error
  return data as Trayecto
}

export async function reabrirTrayecto(id: string) {
  const { data, error } = await requireSupabase().from('trayectos').update({ estado: 'en_transito', fecha_entrega: null, activo: true }).eq('id', id).select().single()
  if (error) throw error
  return data as Trayecto
}

export async function registrarEvento(trayecto: Trayecto, input: { descripcion: string; descripcion_publica: string; ubicacion: string; fecha_evento: string; estado: EstadoTrayecto; visible_cliente: boolean }) {
  const client = requireSupabase()
  const eventPayload = { trayecto_id: trayecto.id, estado_original: input.estado, estado_normalizado: input.estado, descripcion_original: input.descripcion, descripcion_publica: input.descripcion_publica || input.descripcion, ubicacion: input.ubicacion || null, fecha_evento: input.fecha_evento, visible_cliente: input.visible_cliente, fuente: 'manual' }
  const { data: event, error } = await client.from('tracking_eventos').insert(eventPayload).select().single()
  if (error) throw error
  const { error: updateError } = await client.from('trayectos').update({ estado: input.estado, ultima_ubicacion: input.ubicacion || null, ultimo_evento: input.descripcion, fecha_entrega: input.estado === 'entregado' ? input.fecha_evento : null, activo: input.estado !== 'entregado' }).eq('id', trayecto.id)
  if (updateError) throw updateError
  await sincronizarPedido(trayecto, input.estado, input.descripcion_publica || input.descripcion, input.ubicacion)
  return event as TrackingEvento
}
