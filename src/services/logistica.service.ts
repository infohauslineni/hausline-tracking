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

// El costo de envío del tracking se registra como un GASTO "Envío internacional" del
// pedido, para que entre al COSTO real y baje la GANANCIA (y el saldo de caja), igual que
// cualquier otro gasto. Se mantiene UNO solo por pedido (marcado con `__envio_tracking__`):
// al editar se actualiza, y si el costo queda en 0 o se borra el tracking, se elimina.
const MARCA_ENVIO = '__envio_tracking__'
async function sincronizarGastoEnvio(pedidoId: string | null | undefined, monto: number | null | undefined, fecha: string) {
  if (!pedidoId) return
  const client = requireSupabase()
  const total = Number(monto || 0)
  const { data: existente } = await client.from('gastos').select('id').eq('pedido_id', pedidoId).eq('observaciones', MARCA_ENVIO).limit(1).maybeSingle()
  if (!(total > 0)) {
    if (existente) { await client.from('movimientos_cuenta').delete().eq('gasto_id', existente.id); await client.from('gastos').delete().eq('id', existente.id) }
    return
  }
  if (existente) {
    await client.from('gastos').update({ monto: total, monto_original: total, fecha }).eq('id', existente.id)
    await client.from('movimientos_cuenta').update({ monto: total, monto_original: total, fecha: `${fecha}T12:00:00` }).eq('gasto_id', existente.id)
  } else {
    const { data: g } = await client.from('gastos').insert({ fecha, categoria: 'Envío internacional', descripcion: 'Envío internacional (tracking)', monto: total, moneda: 'USD', monto_original: total, pedido_id: pedidoId, metodo_pago: null, observaciones: MARCA_ENVIO }).select('id').single()
    if (g) await client.from('movimientos_cuenta').insert({ fecha: `${fecha}T12:00:00`, tipo: 'gasto', descripcion: 'Envío internacional', monto: total, moneda: 'USD', monto_original: total, pedido_id: pedidoId, gasto_id: g.id, observaciones: MARCA_ENVIO })
  }
}

export async function guardarTrayecto(input: TrayectoInput, id?: string) {
  const client = requireSupabase()
  const query = id ? client.from('trayectos').update(input).eq('id', id) : client.from('trayectos').insert(input)
  const { data, error } = await query.select('*, pedidos(codigo, estado, clientes(nombre)), transportistas(*)').single()
  if (error) throw error
  const trayecto = data as unknown as Trayecto
  await sincronizarPedido(trayecto, trayecto.estado, trayecto.ultimo_evento ?? '', trayecto.ultima_ubicacion ?? '')
  // Refleja el costo de envío en el costo/ganancia del pedido (best-effort).
  try { await sincronizarGastoEnvio(trayecto.pedido_id, trayecto.costo_envio, (trayecto.fecha_envio ?? new Date().toISOString()).slice(0, 10)) } catch { /* no crítico */ }
  return trayecto
}

export async function eliminarTrayecto(id: string) {
  const client = requireSupabase()
  // Antes de borrar, quita el gasto de envío asociado (si lo hubiera).
  const { data: t } = await client.from('trayectos').select('pedido_id').eq('id', id).maybeSingle()
  const { error } = await client.from('trayectos').delete().eq('id', id)
  if (error) throw error
  if (t?.pedido_id) { try { await sincronizarGastoEnvio(t.pedido_id, 0, new Date().toISOString().slice(0, 10)) } catch { /* no crítico */ } }
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
