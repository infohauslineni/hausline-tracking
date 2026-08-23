import { whatsappUrl } from '../utils/whatsapp'

// Factura / comprobante de compra que se genera al registrar un pedido, para enviarla al
// cliente junto con su código de seguimiento. Disponible como imagen (WhatsApp) y como PDF.

export type FacturaLinea = { producto: string; detalle?: string; cantidad: number; precio: number; codigo?: string | null; imagen?: string | null }
export type FacturaData = {
  codigo: string
  cliente: string
  whatsapp?: string | null
  fecha: string
  items: FacturaLinea[]
  total: number
  abono: number
  saldo: number
  // 'compra' = factura al registrar el pedido (con saldo pendiente).
  // 'pago'   = comprobante al entregar y cobrar el saldo (pagado, con agradecimiento).
  variante?: 'compra' | 'pago'
  metodoPago?: string | null
}

const encoder = new TextEncoder()
function bytes(value: string) { return encoder.encode(value) }
function join(parts: Uint8Array[]) { const size = parts.reduce((sum, part) => sum + part.length, 0); const result = new Uint8Array(size); let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length } return result }

function truncar(context: CanvasRenderingContext2D, texto: string, maxAncho: number) {
  if (context.measureText(texto).width <= maxAncho) return texto
  let recorte = texto
  while (recorte.length > 1 && context.measureText(`${recorte}…`).width > maxAncho) recorte = recorte.slice(0, -1)
  return `${recorte}…`
}

// Carga una imagen para dibujarla en el canvas. Pide CORS ('anonymous'): si el
// servidor no lo permite, la carga falla (onerror) en vez de "contaminar" el canvas,
// así que toBlob nunca se rompe. Si falla, devolvemos null y la línea va sin foto.
function cargarImagen(url: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

// Dibuja la imagen recortada tipo "object-fit: cover" dentro del recuadro.
function dibujarCover(context: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const ir = img.width / img.height, r = w / h
  let sw: number, sh: number, sx: number, sy: number
  if (ir > r) { sh = img.height; sw = sh * r; sx = (img.width - sw) / 2; sy = 0 }
  else { sw = img.width; sh = sw / r; sx = 0; sy = (img.height - sh) / 2 }
  context.drawImage(img, sx, sy, sw, sh, x, y, w, h)
}

async function facturaJpeg(data: FacturaData) {
  // Precarga las fotos de los productos (máx. las 12 que caben). Si alguna se
  // "contamina" y toBlob se rompe, reintenta sin fotos.
  const visibles = data.items.slice(0, 12)
  const fotos = await Promise.all(visibles.map((item) => (item.imagen ? cargarImagen(item.imagen) : Promise.resolve(null))))
  try {
    return await renderFactura(data, visibles, fotos)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'SecurityError') return await renderFactura(data, visibles, visibles.map(() => null))
    throw error
  }
}

async function renderFactura(data: FacturaData, visibles: FacturaLinea[], fotos: (HTMLImageElement | null)[]) {
  const esPago = data.variante === 'pago'
  const hayFotos = fotos.some(Boolean)
  const canvas = document.createElement('canvas'); canvas.width = 1240; canvas.height = 1754
  const context = canvas.getContext('2d'); if (!context) throw new Error('No se pudo crear la factura.')
  context.fillStyle = '#f6f7f3'; context.fillRect(0, 0, canvas.width, canvas.height)

  // Encabezado
  context.fillStyle = '#111411'; context.fillRect(0, 0, canvas.width, 300)
  context.fillStyle = '#b7ff00'; context.font = '800 62px Arial'; context.fillText('HAUSLINE', 90, 120)
  context.fillStyle = '#ffffff'; context.font = '600 27px Arial'; context.fillText(esPago ? 'COMPROBANTE DE PAGO' : 'FACTURA DE COMPRA', 92, 180)
  context.fillStyle = '#b7ff00'; context.font = '600 23px Arial'; context.fillText('King of Shoes', 92, 224); context.fillStyle = '#aab0aa'; context.font = '500 23px Arial'; context.fillText('· hausline.ni', 92 + context.measureText('King of Shoes ').width + 34, 224)
  context.textAlign = 'right'; context.fillStyle = '#b7ff00'; context.font = '700 30px Arial'; context.fillText(data.codigo, 1150, 120)
  context.fillStyle = '#aab0aa'; context.font = '500 22px Arial'; context.fillText('Código de seguimiento', 1150, 158); context.textAlign = 'left'

  // Tarjeta
  context.fillStyle = '#ffffff'; context.beginPath(); context.roundRect(65, 245, 1110, 1400, 34); context.fill()

  // Datos del cliente
  context.fillStyle = '#6f756f'; context.font = '600 24px Arial'; context.fillText('CLIENTE', 100, 340)
  context.fillStyle = '#151815'; context.font = '700 40px Arial'; context.fillText(truncar(context, data.cliente || 'Cliente', 980), 100, 392)
  context.fillStyle = '#6f756f'; context.font = '500 26px Arial'; context.fillText(new Intl.DateTimeFormat('es-NI', { dateStyle: 'long' }).format(new Date(`${data.fecha}T12:00:00`)), 100, 438)

  context.strokeStyle = '#e4e7df'; context.lineWidth = 3; context.beginPath(); context.moveTo(100, 480); context.lineTo(1140, 480); context.stroke()

  // Cabecera de la tabla
  context.fillStyle = '#6f756f'; context.font = '700 22px Arial'; context.fillText('PRODUCTO', 100, 535)
  context.textAlign = 'center'; context.fillText('CANT.', 860, 535)
  context.textAlign = 'right'; context.fillText('SUBTOTAL', 1140, 535); context.textAlign = 'left'

  // Líneas (máx. 12 para que quepan). Si hay fotos, se reserva una columna con la
  // miniatura del producto; el texto se corre a la derecha.
  const textX = hayFotos ? 195 : 100
  const anchoNombre = hayFotos ? 610 : 700
  let y = 590
  visibles.forEach((item, i) => {
    const codigo = (item.codigo ?? '').trim()
    const sub = [codigo ? `Cód. ${codigo}` : '', item.detalle].filter(Boolean).join('   ·   ')
    if (hayFotos) {
      const foto = fotos[i]
      const top = y - 38
      context.save(); context.beginPath(); context.roundRect(100, top, 74, 74, 14)
      if (foto) { context.clip(); dibujarCover(context, foto, 100, top, 74, 74) }
      else { context.fillStyle = '#eef0ea'; context.fill(); context.fillStyle = '#9aa093'; context.font = '600 22px Arial'; context.textAlign = 'center'; context.fillText(`${item.cantidad}×`, 137, top + 46); context.textAlign = 'left' }
      context.restore()
    }
    context.fillStyle = '#151815'; context.font = '600 30px Arial'; context.fillText(truncar(context, item.producto || 'Producto', anchoNombre), textX, y)
    if (sub) { context.fillStyle = '#8a8f89'; context.font = '500 22px Arial'; context.fillText(truncar(context, sub, anchoNombre), textX, y + 32) }
    context.fillStyle = '#343934'; context.font = '600 30px Arial'; context.textAlign = 'center'; context.fillText(`${item.cantidad}`, 860, y)
    context.textAlign = 'right'; context.fillText(`USD ${(item.cantidad * item.precio).toFixed(2)}`, 1140, y); context.textAlign = 'left'
    y += hayFotos ? 100 : sub ? 86 : 64
  })
  if (data.items.length > 12) { context.fillStyle = '#8a8f89'; context.font = '500 24px Arial'; context.fillText(`+ ${data.items.length - 12} producto(s) más`, textX, y); y += 50 }

  // Totales
  const totalsY = Math.max(y + 40, 1220)
  context.strokeStyle = '#e4e7df'; context.beginPath(); context.moveTo(100, totalsY - 40); context.lineTo(1140, totalsY - 40); context.stroke()
  const drawTotal = (label: string, value: string, yy: number, strong = false, color = '#343934') => {
    context.fillStyle = '#6f756f'; context.font = '500 30px Arial'; context.fillText(label, 100, yy)
    context.fillStyle = strong ? color : '#343934'; context.font = `${strong ? 800 : 600} ${strong ? 38 : 32}px Arial`; context.textAlign = 'right'; context.fillText(value, 1140, yy); context.textAlign = 'left'
  }
  drawTotal('Total del pedido', `USD ${data.total.toFixed(2)}`, totalsY)
  drawTotal(esPago ? 'Pago recibido' : 'Abono recibido', `USD ${data.abono.toFixed(2)}`, totalsY + 66)
  if (esPago) {
    if (data.metodoPago) drawTotal('Método de pago', data.metodoPago, totalsY + 132)
    drawTotal('Saldo pendiente', 'PAGADO', totalsY + (data.metodoPago ? 214 : 148), true, '#3f8600')
  } else {
    drawTotal('Saldo pendiente', `USD ${Math.max(0, data.saldo).toFixed(2)}`, totalsY + 148, true, data.saldo > 0.01 ? '#b26a00' : '#3f8600')
  }

  // Pie
  const pieY = totalsY + (esPago && data.metodoPago ? 266 : 200)
  context.fillStyle = '#edf6d8'; context.beginPath(); context.roundRect(100, pieY, 1040, 90, 18); context.fill()
  context.fillStyle = '#4c6500'; context.font = '600 24px Arial'; context.textAlign = 'center'
  context.fillText(esPago ? `Pago recibido · Pedido ${data.codigo} entregado` : `Rastrea tu pedido con el código ${data.codigo}`, 620, pieY + 46)
  context.fillStyle = '#7a807a'; context.font = '500 20px Arial'
  context.fillText(esPago ? '¡Muchas gracias por tu compra en Hausline! Esperamos verte pronto.' : 'Gracias por comprar en Hausline · Los tiempos pueden variar por logística internacional.', 620, pieY + 140)
  context.textAlign = 'left'

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', .92))
  if (!blob) throw new Error('No se pudo crear la factura.')
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

function nombreArchivo(data: FacturaData, extension: string) {
  return `Hausline-${data.codigo}-${data.variante === 'pago' ? 'comprobante' : 'factura'}.${extension}`
}

export async function crearFacturaImagenFile(data: FacturaData) {
  const image = await facturaJpeg(data)
  return new File([image.data], nombreArchivo(data, 'jpg'), { type: 'image/jpeg' })
}
export async function crearFacturaPdf(data: FacturaData) {
  const image = await facturaJpeg(data)
  return new File([imagePdf(image.data, image.width, image.height)], nombreArchivo(data, 'pdf'), { type: 'application/pdf' })
}

function descargarArchivo(file: File) {
  const url = URL.createObjectURL(file); const link = document.createElement('a'); link.href = url; link.download = file.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export async function descargarFacturaPdf(data: FacturaData) {
  descargarArchivo(await crearFacturaPdf(data))
  return 'downloaded' as const
}

// Envía la factura por WhatsApp: en celular abre el menú de compartir con la imagen adjunta;
// en escritorio descarga la imagen y abre el chat del cliente con el mensaje y el código listos.
export async function enviarFacturaWhatsApp(data: FacturaData) {
  const file = await crearFacturaImagenFile(data)
  const mensaje = (data.variante === 'pago'
    ? `Hola ${data.cliente}, confirmamos que recibimos el pago de tu pedido ${data.codigo} en Hausline. Aquí tienes tu comprobante. ¡Muchas gracias por tu compra!`
    : `Hola ${data.cliente}, ¡tu pedido quedó registrado en Hausline! Aquí tienes tu factura. Tu código de seguimiento es ${data.codigo}; puedes rastrearlo cuando quieras. ¡Gracias por tu compra!`
  ).replace(/\s+/g, ' ').trim()
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `${data.variante === 'pago' ? 'Comprobante' : 'Factura'} ${data.codigo}`, text: mensaje })
      return 'shared' as const
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled' as const
    }
  }
  descargarArchivo(file)
  if (data.whatsapp) window.open(whatsappUrl(data.whatsapp, mensaje), '_blank', 'noopener,noreferrer')
  return data.whatsapp ? 'downloaded' as const : 'downloaded_no_whatsapp' as const
}
