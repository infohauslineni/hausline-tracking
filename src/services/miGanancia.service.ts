import type { Pedido } from '../types/domain'
import { esGastoDeGanancia } from '../utils/marcaGanancia'
import { repartoPedido } from '../utils/reparto'
import { listarGastos, listarMovimientos, listarVentasStock, obtenerTipoCambio } from './comercial.service'
import { DEFAULT_FINANZAS, obtenerConfiguracionFinanzas } from './finanzas.service'
import { diaEnMes, listarGastosFijos, type GastoFijo } from './gastosFijos.service'
import { listarPedidos } from './pedidos.service'

export { MARCA_GASTO_GANANCIA, esGastoDeGanancia, observacionesConMarca, observacionesSinMarca } from '../utils/marcaGanancia'

// MI GANANCIA: lo que le toca al dueño, contado solo con pedidos FINALIZADOS (entregados) desde
// la fecha de arranque (configuracion finanzas.ganancia_desde). De cada pedido entregado se
// aparta la parte del negocio (porcentaje_reserva_negocio) y el resto es del dueño. De ahí se
// restan los gastos que marcó como "lo tomo de mi ganancia" y los retiros de Mi cuenta.
//
// FONDO DE GASTOS FIJOS: aparte de lo que el negocio se queda para funcionar, se guarda (y no se
// toca) lo necesario para pagar los gastos fijos del mes que todavía no se han pagado. Los fijos
// "del negocio" se apartan de la parte del negocio; los marcados "de mi ganancia", de la del
// dueño. Cuando llega la fecha y el gasto se registra, sale de ese fondo: baja lo apartado y sube
// lo gastado, así lo disponible no cambia de golpe.

// Día en Nicaragua (UTC−6) de una fecha con hora; las fechas sin hora se dejan igual.
const diaNicaragua = (v: string | null | undefined) => {
  const s = String(v ?? '')
  if (s.length <= 10) return s
  const t = new Date(s).getTime()
  return Number.isNaN(t) ? s.slice(0, 10) : new Date(t - 6 * 3_600_000).toISOString().slice(0, 10)
}
const hoyNicaragua = () => new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10)
const r2 = (n: number) => Math.round(n * 100) / 100

// ¿Este pedido ya cuenta para la ganancia? Solo si está ENTREGADO y se entregó desde el arranque.
export function cuentaParaGanancia(pedido: Pick<Pedido, 'estado' | 'fecha_entrega' | 'updated_at'>, desde: string) {
  return pedido.estado === 'entregado' && diaNicaragua(pedido.fecha_entrega ?? pedido.updated_at) >= desde
}

// Lo que se suma y se resta, sin repartir todavía el fondo.
export type BaseGanancia = {
  desde: string
  pct: number // % que se queda el negocio
  pedidos: number // pedidos entregados que ya cuentan
  ganado: number // parte del dueño de esos pedidos (y de las ventas sueltas de stock)
  negocio: number // parte del negocio de esos pedidos
  gastado: number // gastos que el dueño tomó de su ganancia
  retirado: number // retiros registrados en Mi cuenta
  negocioGastado: number // gastos generales que pagó el negocio (ni de un pedido ni de stock ni del dueño)
  mes: string // mes del fondo (AAAA-MM)
  metaMes: number // total de gastos fijos del mes
  pagadoMes: number // fijos del mes ya registrados
  pendienteNegocio: number // fijos del negocio que faltan por pagar este mes
  pendienteDueno: number // fijos "de mi ganancia" que faltan por pagar este mes
}
export type MiGanancia = BaseGanancia & {
  apartadoNegocio: number // guardado de la parte del negocio para los fijos pendientes
  apartadoDueno: number // guardado de la parte del dueño para sus fijos pendientes
  apartado: number // el fondo: lo que hay guardado y no se toca
  faltaApartar: number // lo que todavía no alcanza a cubrirse con lo ganado
  negocioLibre: number // lo que le queda al negocio para funcionar, ya sin el fondo
  disponible: number // lo que le queda al dueño, ya sin el fondo
}

// Reparte el fondo sobre una base (se puede recalcular sumando un pedido recién entregado).
export function resumenGanancia(b: BaseGanancia): MiGanancia {
  const negocioNeto = b.negocio - b.negocioGastado
  const duenoNeto = b.ganado - b.gastado - b.retirado
  const apartadoNegocio = r2(Math.min(Math.max(0, negocioNeto), b.pendienteNegocio))
  const apartadoDueno = r2(Math.min(Math.max(0, duenoNeto), b.pendienteDueno))
  const apartado = r2(apartadoNegocio + apartadoDueno)
  return {
    ...b, apartadoNegocio, apartadoDueno, apartado,
    faltaApartar: r2(Math.max(0, b.pendienteNegocio + b.pendienteDueno - apartado)),
    negocioLibre: r2(negocioNeto - apartadoNegocio), disponible: r2(duenoNeto - apartadoDueno),
  }
}

// Gastos fijos del mes: cuánto suman, cuánto ya se pagó y cuánto falta (del negocio / del dueño).
export function fijosDelMes(fijos: GastoFijo[], mes: string, tipoCambio: number) {
  const tc = tipoCambio > 0 ? tipoCambio : 37
  let metaMes = 0, pagadoMes = 0, pendienteNegocio = 0, pendienteDueno = 0
  for (const g of fijos) {
    if (!g.activo || g.desde > mes) continue
    const usd = g.moneda === 'NIO' ? g.monto / tc : g.monto
    metaMes += usd
    if (g.ultimo && g.ultimo >= mes) pagadoMes += usd
    else if (g.deGanancia) pendienteDueno += usd
    else pendienteNegocio += usd
  }
  return { metaMes: r2(metaMes), pagadoMes: r2(pagadoMes), pendienteNegocio: r2(pendienteNegocio), pendienteDueno: r2(pendienteDueno) }
}

// `excluirPedidoId`: para sumar aparte el pedido que se acaba de entregar con sus datos frescos.
export async function obtenerBaseGanancia(excluirPedidoId?: string): Promise<BaseGanancia> {
  const config = await obtenerConfiguracionFinanzas().catch(() => DEFAULT_FINANZAS)
  const desde = config.ganancia_desde || DEFAULT_FINANZAS.ganancia_desde
  const pct = config.porcentaje_reserva_negocio
  const [pedidos, gastos, movimientos, ventas, fijos, tipoCambio] = await Promise.all([
    listarPedidos().catch(() => []), listarGastos().catch(() => []), listarMovimientos().catch(() => []), listarVentasStock().catch(() => []),
    listarGastosFijos().catch(() => []), obtenerTipoCambio().catch(() => 37),
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
  const desdeCorte = gastos.filter((g) => diaNicaragua(g.fecha) >= desde)
  const gastado = desdeCorte.filter(esGastoDeGanancia).reduce((s, g) => s + Number(g.monto || 0), 0)
  const negocioGastado = desdeCorte.filter((g) => !g.pedido_id && !g.inversion_id && !esGastoDeGanancia(g)).reduce((s, g) => s + Number(g.monto || 0), 0)
  const retirado = movimientos.filter((m) => m.tipo === 'retiro' && diaNicaragua(m.fecha) >= desde).reduce((s, m) => s + Number(m.monto || 0), 0)
  const mes = hoyNicaragua().slice(0, 7)
  return {
    desde, pct, pedidos: cuenta, ganado: r2(ganado), negocio: r2(negocio), gastado: r2(gastado), retirado: r2(retirado), negocioGastado: r2(negocioGastado),
    mes, ...fijosDelMes(fijos, mes, tipoCambio),
  }
}

// Gasto por gasto: cuánto de cada fijo pendiente del mes ya está guardado. El dinero de cada
// bolsa (negocio / dueño) se reparte entre sus fijos en orden de fecha. Espejo: api/_fondo.js.
export type CoberturaFijo = { id: string; descripcion: string; deGanancia: boolean; usd: number; fecha: string; cubierto: number; falta: number }
export function coberturaFijos(fijos: GastoFijo[], b: BaseGanancia, tipoCambio: number): CoberturaFijo[] {
  const tc = tipoCambio > 0 ? tipoCambio : 37
  let bolsaNegocio = Math.max(0, b.negocio - b.negocioGastado)
  let bolsaDueno = Math.max(0, b.ganado - b.gastado - b.retirado)
  return fijos
    .filter((g) => g.activo && g.desde <= b.mes && !(g.ultimo && g.ultimo >= b.mes))
    .map((g) => ({ g, dia: diaEnMes(g.dia, b.mes), usd: r2(g.moneda === 'NIO' ? g.monto / tc : g.monto) }))
    .sort((x, y) => x.dia - y.dia)
    .map(({ g, dia, usd }) => {
      const cubierto = r2(Math.min(usd, g.deGanancia ? bolsaDueno : bolsaNegocio))
      if (g.deGanancia) bolsaDueno -= cubierto; else bolsaNegocio -= cubierto
      return { id: g.id, descripcion: g.descripcion, deGanancia: g.deGanancia, usd, fecha: `${b.mes}-${String(dia).padStart(2, '0')}`, cubierto, falta: r2(usd - cubierto) }
    })
}

// El fondo completo: el resumen y, por cada gasto fijo pendiente del mes, si ya está guardado.
export async function obtenerFondoDetalle(): Promise<{ resumen: MiGanancia; pendientes: CoberturaFijo[] }> {
  const [base, fijos, tipoCambio] = await Promise.all([obtenerBaseGanancia(), listarGastosFijos().catch(() => []), obtenerTipoCambio().catch(() => 37)])
  return { resumen: resumenGanancia(base), pendientes: coberturaFijos(fijos, base, tipoCambio) }
}

export async function obtenerMiGanancia(excluirPedidoId?: string): Promise<MiGanancia> {
  return resumenGanancia(await obtenerBaseGanancia(excluirPedidoId))
}
