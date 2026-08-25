import { etapaBase } from '../constants/orders'
import type { Pedido, Trayecto } from '../types/domain'

// Un tracking está "sin novedad" (posible estancamiento) si 17TRACK lo alimenta
// automáticamente pero no registra un evento nuevo hace 7+ días y aún no fue recibido.
const DIAS_ESTANCADO = 7
export function trayectoEstancado(t: Trayecto): boolean {
  if (t.estado === 'entregado' || t.estado === 'cancelado') return false
  const auto = (t.tracking_eventos ?? []).some((e) => e.fuente === 'track17')
  if (!auto) return false
  return dias(t.updated_at) >= DIAS_ESTANCADO
}

// Centro de alertas: deriva avisos accionables de los pedidos reales (sin tablas nuevas).
// Cada alerta se recalcula en cada carga, así que desaparece sola cuando el problema se
// resuelve (se cobra, se entrega, etc.). No hay duplicados porque cada tipo es una fila.
export type PrioridadAlerta = 'alta' | 'media' | 'info'
export type Alerta = { id: string; prioridad: PrioridadAlerta; icono: string; titulo: string; descripcion: string; to: string }

const dias = (fecha?: string | null) => { const raw = fecha || ''; return Math.floor((Date.now() - new Date(raw.includes('T') ? raw : `${raw}T12:00:00`).getTime()) / 86_400_000) }
const money = (n: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0)

export function calcularAlertas(pedidos: Pedido[], trayectos: Trayecto[] = []): Alerta[] {
  const activos = pedidos.filter((p) => !['entregado', 'cancelado'].includes(p.estado))
  const alertas: Alerta[] = []

  // 🚚 Trackings sin novedad (posible estancamiento).
  const estancados = trayectos.filter(trayectoEstancado)
  if (estancados.length) alertas.push({ id: 'tracking_estancado', prioridad: 'media', icono: '🚚', titulo: `${estancados.length} ${estancados.length === 1 ? 'tracking sin novedad' : 'trackings sin novedad'}`, descripcion: `Sin movimiento de 17TRACK hace ${DIAS_ESTANCADO}+ días. Revisá el envío.`, to: '/logistica' })

  // 🔴 Cobros vencidos: saldo pendiente en pedidos ya entregados o de +30 días.
  const vencidos = pedidos.filter((p) => p.estado !== 'cancelado' && Number(p.saldo) > 0.01 && (p.estado === 'entregado' || dias(p.fecha_pedido) > 30))
  if (vencidos.length) alertas.push({ id: 'vencidos', prioridad: 'alta', icono: '💰', titulo: `${vencidos.length} ${vencidos.length === 1 ? 'cobro vencido' : 'cobros vencidos'}`, descripcion: `USD ${money(vencidos.reduce((s, p) => s + Number(p.saldo), 0))} por cobrar de pedidos vencidos.`, to: '/pedidos' })

  // 🔴 Pedidos atrasados: activos con +35 días sin entregar.
  const atrasados = activos.filter((p) => dias(p.fecha_pedido) > 35)
  if (atrasados.length) alertas.push({ id: 'atrasados', prioridad: 'alta', icono: '📦', titulo: `${atrasados.length} ${atrasados.length === 1 ? 'pedido atrasado' : 'pedidos atrasados'}`, descripcion: 'Llevan más de 35 días sin entregarse.', to: '/pedidos' })

  // 🟡 Listos para entregar: hay que coordinar la entrega.
  const listos = activos.filter((p) => etapaBase(p.estado) === 'disponible_entrega')
  if (listos.length) alertas.push({ id: 'listos', prioridad: 'media', icono: '🚚', titulo: `${listos.length} ${listos.length === 1 ? 'pedido listo para entregar' : 'pedidos listos para entregar'}`, descripcion: 'Coordina la entrega con el cliente.', to: '/pedidos' })

  // 🔵 Llegaron al país de destino.
  const enPais = activos.filter((p) => etapaBase(p.estado) === 'llego_nicaragua')
  if (enPais.length) alertas.push({ id: 'en_pais', prioridad: 'info', icono: '🛬', titulo: `${enPais.length} ${enPais.length === 1 ? 'pedido llegó al país' : 'pedidos llegaron al país'}`, descripcion: 'Ya están en destino, listos para el último tramo.', to: '/pedidos' })

  // 🟡 Sin anticipo: pedidos activos sin ningún abono.
  const sinAnticipo = activos.filter((p) => Number(p.abono) <= 0.01 && Number(p.total) > 0)
  if (sinAnticipo.length) alertas.push({ id: 'sin_anticipo', prioridad: 'media', icono: '🟡', titulo: `${sinAnticipo.length} ${sinAnticipo.length === 1 ? 'pedido sin anticipo' : 'pedidos sin anticipo'}`, descripcion: 'Todavía no registran ningún abono.', to: '/pedidos' })

  // Orden: alta → media → info.
  const peso: Record<PrioridadAlerta, number> = { alta: 0, media: 1, info: 2 }
  return alertas.sort((a, b) => peso[a.prioridad] - peso[b.prioridad])
}

// Cuántas alertas realmente "urgentes" (alta + media) hay, para el punto rojo de la campana.
export const contarUrgentes = (alertas: Alerta[]) => alertas.filter((a) => a.prioridad !== 'info').length
