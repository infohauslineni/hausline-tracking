import type { Pago, Pedido } from '../types/domain'
import { whatsappUrl } from '../utils/whatsapp'

const encoder = new TextEncoder()

function bytes(value: string) { return encoder.encode(value) }
function join(parts: Uint8Array[]) { const size = parts.reduce((sum, part) => sum + part.length, 0); const result = new Uint8Array(size); let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length } return result }

function drawRow(context: CanvasRenderingContext2D, label: string, value: string, y: number, strong = false) {
  context.fillStyle = '#6f756f'; context.font = '500 30px Arial'; context.fillText(label, 100, y)
  context.fillStyle = strong ? '#151815' : '#343934'; context.font = `${strong ? 700 : 600} 32px Arial`; context.textAlign = 'right'; context.fillText(value, 1140, y); context.textAlign = 'left'
}

async function receiptJpeg(pago: Pago, pedido: Pedido) {
  const canvas = document.createElement('canvas'); canvas.width = 1240; canvas.height = 1754
  const context = canvas.getContext('2d'); if (!context) throw new Error('No se pudo crear el comprobante.')
  context.fillStyle = '#f6f7f3'; context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#111411'; context.fillRect(0, 0, canvas.width, 340)
  context.fillStyle = '#b7ff00'; context.font = '800 64px Arial'; context.fillText('HAUSLINE', 90, 125)
  context.fillStyle = '#ffffff'; context.font = '600 28px Arial'; context.fillText('COMPROBANTE DE PAGO', 92, 188)
  context.fillStyle = '#aab0aa'; context.font = '500 24px Arial'; context.fillText('hausline.ni', 92, 235)
  context.textAlign = 'right'; context.fillStyle = '#b7ff00'; context.font = '700 28px Arial'; context.fillText(`#${pago.id.slice(0, 8).toUpperCase()}`, 1145, 130); context.textAlign = 'left'

  context.fillStyle = '#ffffff'; context.beginPath(); context.roundRect(65, 285, 1110, 1320, 34); context.fill()
  context.fillStyle = '#6f756f'; context.font = '600 25px Arial'; context.fillText('MONTO RECIBIDO', 100, 430)
  context.fillStyle = '#151815'; context.font = '800 82px Arial'; context.fillText(`USD ${Number(pago.monto).toFixed(2)}`, 100, 525)
  context.strokeStyle = '#e4e7df'; context.lineWidth = 3; context.beginPath(); context.moveTo(100, 590); context.lineTo(1140, 590); context.stroke()

  drawRow(context, 'Cliente', pedido.clientes?.nombre ?? pago.clientes?.nombre ?? 'Cliente', 690, true)
  drawRow(context, 'Pedido', pedido.codigo, 770)
  drawRow(context, 'Fecha', new Intl.DateTimeFormat('es-NI', { dateStyle: 'long' }).format(new Date(`${pago.fecha}T12:00:00`)), 850)
  drawRow(context, 'Tipo', pago.tipo === 'pago_final' ? 'Pago final' : pago.tipo === 'reembolso' ? 'Reembolso' : 'Abono', 930)
  drawRow(context, 'Metodo', pago.metodo_pago || 'No indicado', 1010)
  if (pago.referencia) drawRow(context, 'Referencia', pago.referencia, 1090)
  context.strokeStyle = '#e4e7df'; context.beginPath(); context.moveTo(100, 1170); context.lineTo(1140, 1170); context.stroke()
  drawRow(context, 'Total del pedido', `USD ${Number(pedido.total).toFixed(2)}`, 1260)
  drawRow(context, 'Total abonado', `USD ${Number(pedido.abono).toFixed(2)}`, 1340)
  drawRow(context, 'Saldo pendiente', `USD ${Math.max(0, Number(pedido.saldo)).toFixed(2)}`, 1420, true)
  context.fillStyle = '#edf6d8'; context.beginPath(); context.roundRect(100, 1490, 1040, 76, 18); context.fill()
  context.fillStyle = '#4c6500'; context.font = '600 23px Arial'; context.textAlign = 'center'; context.fillText('Pago recibido correctamente. Gracias por confiar en Hausline.', 620, 1538); context.textAlign = 'left'
  context.fillStyle = '#7a807a'; context.font = '500 20px Arial'; context.textAlign = 'center'; context.fillText('Comprobante generado por Hausline - Conserva este documento.', 620, 1680); context.textAlign = 'left'
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', .92))
  if (!blob) throw new Error('No se pudo crear el comprobante.')
  return { data: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height }
}

function imagePdf(image: Uint8Array, width: number, height: number) {
  const content = bytes('q\n595.28 0 0 841.89 0 0 cm\n/Im0 Do\nQ\n')
  const objects: Uint8Array[] = [
    bytes('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'),
    bytes('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'),
    bytes('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>\nendobj\n'),
    join([bytes(`4 0 obj\n<< /Length ${content.length} >>\nstream\n`), content, bytes('endstream\nendobj\n')]),
    join([bytes(`5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`), image, bytes('\nendstream\nendobj\n')]),
  ]
  const header = bytes('%PDF-1.4\n%Hausline\n'); const offsets: number[] = [0]; let position = header.length
  for (const object of objects) { offsets.push(position); position += object.length }
  const xrefOffset = position
  const xref = bytes(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`)
  return new Blob([join([header, ...objects, xref])], { type: 'application/pdf' })
}

export async function crearReciboPdf(pago: Pago, pedido: Pedido) {
  const image = await receiptJpeg(pago, pedido)
  return new File([imagePdf(image.data, image.width, image.height)], `Hausline-${pedido.codigo}-abono-${pago.fecha}.pdf`, { type: 'application/pdf' })
}

export async function crearReciboImagen(pago: Pago, pedido: Pedido) {
  const image = await receiptJpeg(pago, pedido)
  return new Blob([image.data], { type: 'image/jpeg' })
}

// Comprobante como imagen JPEG en un File (ideal para adjuntar/compartir por WhatsApp).
export async function crearReciboImagenFile(pago: Pago, pedido: Pedido) {
  const image = await receiptJpeg(pago, pedido)
  return new File([image.data], `Hausline-${pedido.codigo}-${pago.fecha}.jpg`, { type: 'image/jpeg' })
}

function descargarArchivo(file: File) {
  const url = URL.createObjectURL(file); const link = document.createElement('a'); link.href = url; link.download = file.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 5000)
}

// Descarga el comprobante como imagen. Funciona igual en escritorio y celular.
export async function descargarRecibo(pago: Pago, pedido: Pedido) {
  descargarArchivo(await crearReciboImagenFile(pago, pedido))
  return 'downloaded' as const
}

// Envía el comprobante por WhatsApp. En celular abre el menú de compartir para adjuntar la
// imagen directo al chat; en escritorio (donde no se puede adjuntar por enlace) descarga la
// imagen y abre el chat del cliente con un mensaje listo para que la adjunte a mano.
export async function enviarReciboWhatsApp(pago: Pago, pedido: Pedido) {
  const file = await crearReciboImagenFile(pago, pedido)
  const mensaje = `Hola ${pedido.clientes?.nombre ?? ''}, aquí está tu comprobante de pago del pedido ${pedido.codigo} por USD ${Number(pago.monto).toFixed(2)}. ¡Gracias por confiar en Hausline!`.replace(/\s+/g, ' ').trim()
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `Comprobante ${pedido.codigo}`, text: mensaje })
      return 'shared' as const
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled' as const
      // Compartir rechazado o no soportado: seguimos con la descarga + chat.
    }
  }
  descargarArchivo(file)
  const whatsapp = pedido.clientes?.whatsapp
  if (whatsapp) window.open(whatsappUrl(whatsapp, mensaje), '_blank', 'noopener,noreferrer')
  return whatsapp ? 'downloaded' as const : 'downloaded_no_whatsapp' as const
}
