import type { Gasto, Pedido } from '../types/domain'
import { repartoPedido } from '../utils/reparto'
import { listarGastos, listarMovimientos, listarVentasStock } from './comercial.service'
import { DEFAULT_FINANZAS, obtenerConfiguracionFinanzas } from './finanzas.service'
import { listarPedidos } from './pedidos.service'

// MI GANANCIA: lo que le toca al dueño, contado solo con pedidos FINALIZADOS (entregados) desde
// la fecha de arranque (configuracion finanzas.ganancia_desde). De cada pedido entregado se
// aparta la parte del negocio (porcentaje_reserva_negocio) y el resto es del dueño. De ahí se
// restan los gastos que marcó como "lo tomo de mi ganancia" y los retiros de Mi cuenta.

// Gasto que el dueño tomó de SU ganancia (se le resta de lo que le toca). Va como marca en
// `observaciones` para no depender de una migración.
export const MARCA_GASTO_GANANCIA = '[DE_MI_GANANCIA]'
export const esGastoDeGanancia = (g: Pick<Gasto, 'observaciones'>) => (g.observaciones ?? '').includes(MARCA_GASTO_GANANCIA)
export const observacionesSinMarca = (v: string | null | undefined) => (v ?? '').split(MARCA_GASTO_GANANCIA).join('').trim()
export const observacionesConMarca = (texto: string | null | undefined, deGanancia: boolean) => {
  const limpio = observacionesSinMarca(texto)
  return deGanancia ? `${MARCA_GASTO_GANANCIA} ${limpio}`.trim() : (limpio || null)
}

// Día en Nicaragua (UTC−6) de una fecha con hora; las fechas sin hora se dejan igual.
const diaNicaragua = (v: string | null | undefined) => {
  const s = String(v ?? '')
  if (s.length <= 10) return s
  const t = new Date(s).getTime()
  return Number.isNaN(t) ? s.slice(0, 10) : new Date(t - 6 * 3_600_000).toISOString().slice(0, 10)
}

// ¿Este pedido ya cuenta para la ganancia? Solo si está ENTREGADO y se entregó desde el arranque.
export function cuentaParaGanancia(pedido: Pick<Pedido, 'estado' | 'fecha_entrega' | 'updated_at'>, desde: string) {
  return pedido.estado === 'entregado' && diaNicaragua(pedido.fecha_entrega ?? pedido.updated_at) >= desde
}

export type MiGanancia = {
  desde: string
  pct: number // % que se queda el negocio
  pedidos: number // pedidos entregados que ya cuentan
  ganado: number // parte del dueño de esos pedidos (y de las ventas sueltas de stock)
  negocio: number // parte del negocio de esos pedidos
  gastado: number // gastos que tomó de su ganancia
  retirado: number // retiros registrados en Mi cuenta
  disponible: number
}

const r2 = (n: number) => Math.round(n * 100) / 100

// `excluirPedidoId`: para sumar aparte el pedido que se acaba de entregar con sus datos frescos.
export async function obtenerMiGanancia(excluirPedidoId?: string): Promise<MiGanancia> {
  const config = await obtenerConfiguracionFinanzas().catch(() => DEFAULT_FINANZAS)
  const desde = config.ganancia_desde || DEFAULT_FINANZAS.ganancia_desde
  const pct = config.porcentaje_reserva_negocio
  const [pedidos, gastos, movimientos, ventas] = await Promise.all([
    listarPedidos().catch(() => []), listarGastos().catch(() => []), listarMovimientos().catch(() => []), listarVentasStock().catch(() => []),
  ])
  let ganado = 0, negocio = 0, cuenta = 0
  for (const pedido of pedidos) {
    if (pedido.id === excluirPedidoId || !cuentaParaGanancia(pedido, desde)) continue
    const r = repartoPedido(pedido, pct)
    if (r.pendiente) continue
    ganado += r.tuyoYa; negocio += r.negocioYa; cuenta++
  }
  // Ventas sueltas de stock (entrega inmediata sin pedido): la ganancia es real el día de la venta.
  for (const v of ventas) {
    if (diaNicaragua(v.fecha) < desde) continue
    const g = Math.max(0, Number(v.monto || 0) - Number(v.costo || 0))
    const parteNegocio = r2((g * pct) / 100)
    ganado += g - parteNegocio; negocio += parteNegocio
  }
  const gastado = gastos.filter((g) => esGastoDeGanancia(g) && diaNicaragua(g.fecha) >= desde).reduce((s, g) => s + Number(g.monto || 0), 0)
  const retirado = movimientos.filter((m) => m.tipo === 'retiro' && diaNicaragua(m.fecha) >= desde).reduce((s, m) => s + Number(m.monto || 0), 0)
  return { desde, pct, pedidos: cuenta, ganado: r2(ganado), negocio: r2(negocio), gastado: r2(gastado), retirado: r2(retirado), disponible: r2(ganado - gastado - retirado) }
}
