import type { Pedido } from '../types/domain'
import { listarProductos } from './comercial.service'
import { guardarConfiguracionFinanzas, obtenerConfiguracionFinanzas } from './finanzas.service'
import { listarPedidos } from './pedidos.service'

// ALERTA DE GANANCIA BAJA: antes de confirmar un encargo se calcula cuánto deja (venta − costo
// del producto − envío internacional aprox.) y se avisa si queda debajo del mínimo (por defecto
// 25 %) o si al producto le falta el costo. El mínimo vive en configuracion.finanzas.margen_minimo.
export const MARGEN_MINIMO_DEFECTO = 25
const r2 = (n: number) => Math.round(n * 100) / 100

// Envío internacional aprox.: promedio de los últimos 20 registrados (sin datos: US$ 18).
export function promedioEnvioInternacional(pedidos: Pedido[]) {
  const montos = pedidos.flatMap((p) => (p.gastos ?? []).filter((g) => /internacional/i.test(String(g.categoria ?? ''))).map((g) => Number(g.monto || 0))).filter((m) => m > 0).slice(0, 20)
  return montos.length ? r2(montos.reduce((s, m) => s + m, 0) / montos.length) : 18
}

export type DatosMargen = { costos: Map<string, number>; envio: number; minimo: number }
export async function obtenerDatosMargen(): Promise<DatosMargen> {
  const [productos, pedidos, config] = await Promise.all([listarProductos().catch(() => []), listarPedidos().catch(() => [] as Pedido[]), obtenerConfiguracionFinanzas().catch(() => null)])
  const costos = new Map<string, number>()
  for (const p of productos) { const c = Number(p.precio_compra || 0); if (p.codigo && c > 0) costos.set(p.codigo.trim().toUpperCase(), c) }
  const minimo = Number(config?.margen_minimo)
  return { costos, envio: promedioEnvioInternacional(pedidos), minimo: minimo > 0 ? minimo : MARGEN_MINIMO_DEFECTO }
}

export async function guardarMargenMinimo(minimo: number) {
  const actual = await obtenerConfiguracionFinanzas()
  await guardarConfiguracionFinanzas({ ...actual, margen_minimo: Math.min(90, Math.max(1, Math.round(minimo))) })
}

export type LineaMargen = { codigo: string; producto: string; cantidad: number; costo: number | null }
export function calcularMargen(venta: number, lineas: LineaMargen[], envio: number) {
  const sinCosto = lineas.filter((l) => l.costo == null)
  const costo = r2(lineas.reduce((s, l) => s + (l.costo ?? 0) * l.cantidad, 0))
  const ganancia = r2(venta - costo - envio)
  return { costo, envio, ganancia, porcentaje: venta > 0 ? Math.round((ganancia / venta) * 1000) / 10 : 0, sinCosto }
}
