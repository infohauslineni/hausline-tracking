import { descargarFacturaPdf, enviarFacturaWhatsApp, type FacturaData } from '../services/factura.service'

// Recibo para una venta de stock inmediato. Reutiliza el generador de facturas del
// tracking: PDF en blanco y negro para imprimir, o imagen a color para WhatsApp.
// Sirve ANTES de marcar vendido (con los datos del formulario) y DESPUÉS (reimpresión).

// Datos mínimos del producto vendido. Una Inversion cumple esta forma tal cual.
export type ProductoRecibo = { producto: string; codigo?: string | null; marca?: string | null; talla_color?: string | null; cantidad: number; imagen?: string | null }
export type VentaRecibo = { cliente?: string | null; precioTotal: number; montoRecibido: number; fecha: string; metodo?: string | null; whatsapp?: string | null }

export function facturaStockData(item: ProductoRecibo, venta: VentaRecibo): FacturaData {
  const cantidad = Math.max(1, Number(item.cantidad) || 1)
  const total = Math.max(0, Number(venta.precioTotal) || 0)
  const abono = Math.min(total, Math.max(0, Number(venta.montoRecibido) || 0))
  const saldo = Math.max(0, total - abono)
  const detalle = [item.marca, item.talla_color].filter(Boolean).join(' · ') || undefined
  return {
    codigo: item.codigo?.trim() || 'STOCK',
    cliente: venta.cliente?.trim() || 'Cliente',
    whatsapp: venta.whatsapp ?? null,
    fecha: venta.fecha,
    items: [{ producto: item.producto, detalle, cantidad, precio: total / cantidad, codigo: item.codigo ?? null, imagen: item.imagen ?? null }],
    total,
    abono,
    saldo,
    // Pagado por completo → comprobante de pago; con saldo → factura de compra.
    variante: saldo <= 0.01 ? 'pago' : 'compra',
    metodoPago: venta.metodo ?? null,
  }
}

// Descarga el recibo en PDF (blanco y negro, hoja completa) listo para imprimir.
export function imprimirReciboStock(item: ProductoRecibo, venta: VentaRecibo) {
  return descargarFacturaPdf(facturaStockData(item, venta))
}

// Envía el recibo por WhatsApp (imagen a color); en escritorio descarga y abre el chat.
export function enviarReciboStockWhatsApp(item: ProductoRecibo, venta: VentaRecibo) {
  return enviarFacturaWhatsApp(facturaStockData(item, venta))
}
