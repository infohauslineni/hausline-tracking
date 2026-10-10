import type { Gasto, Pago, Pedido } from '../types/domain'
import { costoRealPedido, envioClientePasaLargo, tieneCostoRegistrado } from './pedidoCosto'

// REPARTO DE LA GANANCIA: de cada pedido, cuánto es ganancia neta, cuánto se queda en el negocio
// (la reserva de Reportes → Cierre: `porcentaje_reserva_negocio`) y cuánto es del dueño.
//
// "Ya es tuyo" va por lo COBRADO, no por lo vendido: el dinero que entra primero repone lo que
// costó el pedido (proveedor, envíos, gastos) y el envío que solo pasa de largo; recién lo que
// sobra es ganancia, y esa se reparte negocio / dueño. Así un pedido con el 50 % abonado que
// todavía no cubre su costo no aparenta una ganancia que aún no existe.

const r2 = (n: number) => Math.round(n * 100) / 100
const entre = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

export type RepartoPedido = {
  /** Sin costo registrado: no se puede calcular con honestidad. */
  pendiente: boolean
  ganancia: number // neta del pedido completo (puede ser negativa)
  negocio: number // parte del negocio cuando se cobre todo
  tuyo: number // parte del dueño cuando se cobre todo
  cobrado: number
  costo: number // lo que hay que reponer antes de hablar de ganancia (costo + envío que pasa de largo)
  faltaCosto: number // cuánto falta cobrar para terminar de reponer el costo
  realizada: number // ganancia que ya entró
  negocioYa: number
  tuyoYa: number
  completo: boolean // ya entró toda la ganancia
}

export function repartoPedido(pedido: Pedido, pctNegocio: number): RepartoPedido {
  const total = Number(pedido.total || 0)
  const costo = r2(costoRealPedido(pedido) + envioClientePasaLargo(pedido))
  const pendiente = !tieneCostoRegistrado(pedido)
  const cancelado = pedido.estado === 'cancelado'
  const ganancia = cancelado ? 0 : r2(total - costo)
  const base = Math.max(0, ganancia)
  const p = entre(pctNegocio, 0, 100) / 100
  const negocio = r2(base * p)
  const cobrado = cancelado ? 0 : entre(Number(pedido.abono || 0), 0, total)
  const realizada = pendiente ? 0 : r2(entre(cobrado - costo, 0, base))
  const negocioYa = r2(realizada * p)
  return {
    pendiente, ganancia, negocio, tuyo: r2(base - negocio), cobrado, costo,
    faltaCosto: r2(Math.max(0, Math.min(costo, total) - cobrado)),
    realizada, negocioYa, tuyoYa: r2(realizada - negocioYa), completo: base > 0 && realizada >= base - 0.01,
  }
}

export type DiaReparto = { dia: string; tuyo: number; negocio: number; gastos: number }
export type RepartoPeriodo = {
  realizada: number // ganancia que entró en el periodo (por fecha de cada pago)
  negocioBruto: number // reserva del negocio sobre esa ganancia
  tuyoBruto: number
  gastos: number // gastos generales del periodo (los que no son de un pedido ni de una compra)
  negocioQueda: number // lo que le queda al negocio después de pagar esos gastos
  deficit: number // gastos que la parte del negocio no alcanzó a cubrir (salen de lo del dueño)
  tuyo: number // lo del dueño, ya descontado el déficit
  porEntrar: { negocio: number; tuyo: number } // ganancia de pedidos activos que entra al cobrar los saldos
  sinCosto: number // pedidos del periodo sin costo registrado (no entran al cálculo)
  serie: DiaReparto[]
}

type VentaSuelta = { fecha: string; monto: number; costo: number }
const dia = (v: string | null | undefined) => String(v ?? '').slice(0, 10)

// Gasto GENERAL del negocio: no está ligado a un pedido (ya cuenta en su costo) ni a una compra
// de stock (es capital que vuelve al venderla). Publicidad, empaque, suscripciones, etc.
export const esGastoGeneral = (g: Pick<Gasto, 'pedido_id' | 'inversion_id'>) => !g.pedido_id && !g.inversion_id

export function repartoPeriodo(input: { pedidos: Pedido[]; pagos: Pago[]; gastos: Gasto[]; ventasStock?: VentaSuelta[]; desde: string; hasta: string; pctNegocio: number }): RepartoPeriodo {
  const { desde, hasta } = input
  const p = entre(input.pctNegocio, 0, 100) / 100
  const enRango = (d: string) => d >= desde && d <= hasta
  const porDia = new Map<string, { ganancia: number; gastos: number }>()
  const sumar = (d: string, campo: 'ganancia' | 'gastos', monto: number) => {
    if (!enRango(d) || Math.abs(monto) < 0.005) return
    const actual = porDia.get(d) ?? { ganancia: 0, gastos: 0 }
    actual[campo] += monto
    porDia.set(d, actual)
  }

  const pagosPorPedido = new Map<string, Pago[]>()
  for (const pago of input.pagos) pagosPorPedido.set(pago.pedido_id, [...(pagosPorPedido.get(pago.pedido_id) ?? []), pago])

  let sinCosto = 0
  let porEntrar = 0
  for (const pedido of input.pedidos) {
    if (pedido.estado === 'cancelado') continue
    const r = repartoPedido(pedido, input.pctNegocio)
    if (r.pendiente) { if (enRango(dia(pedido.fecha_pedido))) sinCosto++; continue }
    const base = Math.max(0, r.ganancia)
    if (base <= 0) continue
    porEntrar += Math.max(0, base - r.realizada)
    // Línea de tiempo de lo cobrado: cada pago mueve la ganancia realizada del pedido.
    const eventos = (pagosPorPedido.get(pedido.id) ?? [])
      .map((pago) => ({ d: dia(pago.fecha), monto: pago.tipo === 'reembolso' ? -Number(pago.monto || 0) : Number(pago.monto || 0) }))
      .sort((a, b) => a.d.localeCompare(b.d))
    // Abono que no tiene su pago registrado (pedidos viejos/importados): cuenta en la fecha del pedido.
    const registrado = eventos.reduce((s, e) => s + e.monto, 0)
    if (r.cobrado - registrado > 0.01) eventos.unshift({ d: dia(pedido.fecha_pedido), monto: r.cobrado - registrado })
    const total = Number(pedido.total || 0)
    let acumulado = 0
    let antes = 0
    for (const e of eventos) {
      acumulado += e.monto
      const ahora = entre(Math.min(acumulado, total) - r.costo, 0, base)
      sumar(e.d, 'ganancia', ahora - antes)
      antes = ahora
    }
  }
  // Ventas sueltas de stock (entrega inmediata sin pedido): la ganancia entra el día de la venta.
  for (const v of input.ventasStock ?? []) sumar(dia(v.fecha), 'ganancia', Number(v.monto || 0) - Number(v.costo || 0))
  for (const g of input.gastos) if (esGastoGeneral(g)) sumar(dia(g.fecha), 'gastos', Number(g.monto || 0))

  const serie = [...porDia.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, v]) => {
    const negocio = r2(Math.max(0, v.ganancia) * p)
    return { dia: d, negocio, tuyo: r2(v.ganancia - negocio), gastos: r2(v.gastos) }
  })
  const realizada = r2(serie.reduce((s, x) => s + x.negocio + x.tuyo, 0))
  const gastos = r2(serie.reduce((s, x) => s + x.gastos, 0))
  const negocioBruto = r2(Math.max(0, realizada) * p)
  const tuyoBruto = r2(realizada - negocioBruto)
  const deficit = r2(Math.max(0, gastos - negocioBruto))
  const negocioPorEntrar = r2(porEntrar * p)
  return {
    realizada, negocioBruto, tuyoBruto, gastos,
    negocioQueda: r2(Math.max(0, negocioBruto - gastos)), deficit, tuyo: r2(tuyoBruto - deficit),
    porEntrar: { negocio: negocioPorEntrar, tuyo: r2(porEntrar - negocioPorEntrar) }, sinCosto, serie,
  }
}
