import type { Pedido } from '../types/domain'
import { costoRealPedido, envioClientePasaLargo, tieneCostoRegistrado } from './pedidoCosto'

// REPARTO DE LA GANANCIA de un pedido: cuánto es ganancia neta, cuánto se queda en el negocio
// (la reserva de Reportes → Cierre: `porcentaje_reserva_negocio`) y cuánto es del dueño.
//
// Lo "ya entrado" va por lo COBRADO: el dinero que entra primero repone lo que costó el pedido
// (proveedor, envíos, gastos) y el envío que solo pasa de largo; lo que sobra es ganancia y esa
// se reparte negocio / dueño. Un pedido pagado completo deja su ganancia entera.

const r2 = (n: number) => Math.round(n * 100) / 100
const entre = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

export type RepartoPedido = {
  /** Sin costo registrado: no se puede calcular con honestidad. */
  pendiente: boolean
  venta: number // lo que deja la venta sin el envío que paga el cliente (pasa de largo)
  costo: number // costo real del pedido (producto + envíos + gastos asociados)
  ganancia: number // neta del pedido completo (puede ser negativa)
  negocio: number // parte del negocio cuando se cobre todo
  tuyo: number // parte del dueño cuando se cobre todo
  cobrado: number
  realizada: number // ganancia que ya entró
  negocioYa: number
  tuyoYa: number
  completo: boolean // ya entró toda la ganancia
}

export function repartoPedido(pedido: Pedido, pctNegocio: number): RepartoPedido {
  const total = Number(pedido.total || 0)
  const envio = envioClientePasaLargo(pedido)
  const costo = r2(costoRealPedido(pedido))
  const pendiente = !tieneCostoRegistrado(pedido)
  const cancelado = pedido.estado === 'cancelado'
  const ganancia = cancelado ? 0 : r2(total - envio - costo)
  const base = Math.max(0, ganancia)
  const p = entre(pctNegocio, 0, 100) / 100
  const negocio = r2(base * p)
  const cobrado = cancelado ? 0 : entre(Number(pedido.abono || 0), 0, total)
  const realizada = pendiente ? 0 : r2(entre(cobrado - costo - envio, 0, base))
  const negocioYa = r2(realizada * p)
  return {
    pendiente, venta: r2(total - envio), costo, ganancia, negocio, tuyo: r2(base - negocio), cobrado,
    realizada, negocioYa, tuyoYa: r2(realizada - negocioYa), completo: base > 0 && realizada >= base - 0.01,
  }
}
