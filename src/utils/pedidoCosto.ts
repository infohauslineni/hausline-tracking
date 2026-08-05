import type { Pedido } from '../types/domain'

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
