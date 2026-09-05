import type { Pedido } from '../types/domain'

// Líneas de envío/delivery que el cliente paga pero que NO se queda el negocio: se le
// entregan al mensajero/agencia (el dinero pasa de largo). No son ganancia. Se cobran al
// cliente como una línea del pedido (así el total y la factura las incluyen), pero al
// calcular la ganancia se descuentan para que no la inflen.
const ENVIO_CLIENTE_LABELS = ['Envío / delivery', 'Delivery cobrado al cliente']
export function envioClientePasaLargo(pedido: Pedido): number {
  return (pedido.pedido_items ?? [])
    .filter((item) => ENVIO_CLIENTE_LABELS.includes((item.producto ?? '').trim()))
    .reduce((sum, item) => sum + Number(item.cantidad || 1) * Number(item.precio_unitario || 0), 0)
}

// Costo real de un pedido = costo del/los productos + todos los gastos asociados
// (envío internacional, delivery, etc. que agregues después y asocies al pedido).
//
// Ojo con no duplicar: al crear un pedido en la app se genera un gasto automático
// "Pago a proveedor" igual al costo de compra de los ítems. Si ese gasto existe, el costo
// real ya está representado por los gastos (proveedor + envío + otros) y NO se vuelven a
// sumar los ítems. Para pedidos antiguos/importados que no tienen ese gasto automático,
// se suma el costo de los ítems + los gastos que agregues (así el envío se suma encima).
export function costoRealPedido(pedido: Pedido): number {
  const gastos = pedido.gastos ?? []
  const gastosTotal = gastos.reduce((sum, gasto) => sum + Number(gasto.monto || 0), 0)
  const itemsTotal = (pedido.pedido_items ?? []).reduce((sum, item) => sum + Number(item.cantidad || 1) * (Number(item.precio_compra || 0) + Number(item.envio_internacional || 0) + Number(item.costo_delivery || 0) + Number(item.otros_gastos || 0)), 0)
  const tieneGastoProveedor = gastos.some((gasto) => (gasto.categoria ?? '').toLowerCase().includes('proveedor'))
  return tieneGastoProveedor ? gastosTotal : itemsTotal + gastosTotal
}

// Costo DIRECTO del pedido: producto + envíos ligados a la venta (internacional, delivery
// nacional, otros costos del ítem). Es la base de la GANANCIA BRUTA. Los demás gastos del
// pedido (publicidad, empaque, comisiones sueltas, etc.) son "adicionales" y solo pesan en
// la ganancia NETA. Respeta el mismo anti-doble-conteo que costoRealPedido.
export function costoDirectoPedido(pedido: Pedido): number {
  const gastos = pedido.gastos ?? []
  const esDirecto = (categoria?: string | null) => { const c = (categoria ?? '').toLowerCase(); return c.includes('proveedor') || c.includes('envío') || c.includes('envio') || c.includes('delivery') }
  if (gastos.some((gasto) => (gasto.categoria ?? '').toLowerCase().includes('proveedor'))) {
    return gastos.filter((gasto) => esDirecto(gasto.categoria)).reduce((sum, gasto) => sum + Number(gasto.monto || 0), 0)
  }
  return (pedido.pedido_items ?? []).reduce((sum, item) => sum + Number(item.cantidad || 1) * (Number(item.precio_compra || 0) + Number(item.envio_internacional || 0) + Number(item.costo_delivery || 0) + Number(item.otros_gastos || 0)), 0)
}

// ¿Hay algún costo registrado para poder calcular ganancia? Si no, la UI muestra
// "Pendiente de calcular" en vez de inventar una ganancia igual a la venta completa.
export function tieneCostoRegistrado(pedido: Pedido): boolean {
  if ((pedido.gastos ?? []).some((gasto) => Number(gasto.monto || 0) > 0)) return true
  return (pedido.pedido_items ?? []).some((item) => Number(item.precio_compra || 0) > 0 || Number(item.envio_internacional || 0) > 0 || Number(item.costo_delivery || 0) > 0 || Number(item.otros_gastos || 0) > 0)
}

// Estado de cobro de un pedido:
//   pagado    = saldo saldado.
//   vencido   = queda saldo Y (ya se entregó  o  lleva +30 días desde el pedido).
//   pendiente = queda saldo pero todavía en tiempo.
export type EstadoPago = 'pagado' | 'pendiente' | 'vencido'
export function estadoPago(pedido: Pedido): EstadoPago {
  if (Number(pedido.saldo || 0) <= 0.01) return 'pagado'
  const raw = pedido.fecha_pedido || ''
  const dias = Math.floor((Date.now() - new Date(raw.includes('T') ? raw : `${raw}T12:00:00`).getTime()) / 86_400_000)
  return pedido.estado === 'entregado' || dias > 30 ? 'vencido' : 'pendiente'
}

// Desglose financiero de un pedido para la vista de Ventas. `pendiente` = no hay costo
// registrado todavía (no se puede calcular ganancia con honestidad).
export function desglosePedido(pedido: Pedido) {
  const venta = Number(pedido.total || 0)
  const costoTotal = costoRealPedido(pedido)
  const costoDirecto = costoDirectoPedido(pedido)
  const gastosAdicionales = Math.max(0, costoTotal - costoDirecto)
  // El envío que paga el cliente pasa de largo (no es ingreso del negocio): se descuenta
  // de la venta para la ganancia, así no aparece como si fuera utilidad.
  const ventaNeta = venta - envioClientePasaLargo(pedido)
  const gananciaBruta = ventaNeta - costoDirecto
  const gananciaNeta = ventaNeta - costoTotal
  const margen = ventaNeta > 0 ? (gananciaNeta / ventaNeta) * 100 : 0
  // La ganancia SOLO se realiza cuando el pedido está entregado. Antes de eso es una
  // estimación (el cliente puede haber abonado el 50%, pero todavía no hay ganancia).
  return { venta, costoTotal, costoDirecto, gastosAdicionales, gananciaBruta, gananciaNeta, margen, pendiente: !tieneCostoRegistrado(pedido), entregado: pedido.estado === 'entregado' }
}
