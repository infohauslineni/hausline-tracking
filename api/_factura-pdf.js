import PDFDocument from 'pdfkit'
import sharp from 'sharp'
import { absolutizarImagen } from './_correo.js'

// Genera la factura/comprobante en PDF desde el servidor (sin navegador), para
// adjuntarla al correo. Reusa los mismos datos que la tabla del correo.
//   variante 'compra' -> FACTURA DE COMPRA (con saldo pendiente)
//   variante 'pago'   -> COMPROBANTE DE PAGO (marcado PAGADO)

const VERDE = '#111411'
const ACENTO = '#8a6d1f'
const GRIS = '#6f756f'
const TEXTO = '#151815'
const LINEA = '#e4e7df'

function usd(valor) {
  const n = Number(valor) || 0
  return n < 0 ? `-USD ${Math.abs(n).toFixed(2)}` : `USD ${n.toFixed(2)}`
}

// pdfkit SOLO dibuja JPEG y PNG. El catálogo web trae también webp, avif, heic, etc.,
// que pdfkit rechaza con "Unknown image format" y la foto saldría en blanco. Normalizamos
// cualquier formato no soportado a JPEG con sharp. Los JPEG/PNG válidos pasan tal cual.
async function aFormatoPdf(buffer) {
  if (!buffer || buffer.length < 4) return null
  const esJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  const esPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
  if (esJpeg || esPng) return buffer
  try {
    return await sharp(buffer).rotate().resize({ width: 256, height: 256, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer()
  } catch (error) {
    console.error('aFormatoPdf: no se pudo convertir la imagen a JPEG', error?.message)
    return null
  }
}

// Descarga una imagen y la devuelve como Buffer listo para pdfkit (JPEG/PNG). Si falla, null.
async function traerImagen(url) {
  if (!url) return null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return await aFormatoPdf(Buffer.from(await res.arrayBuffer()))
  } catch {
    return null
  }
}

export async function facturaPdfBuffer({ codigo, nombre, fecha, factura }) {
  const esPago = factura?.variante === 'pago'
  const items = Array.isArray(factura?.items) ? factura.items : []

  // Pre-descarga las fotos (pdfkit dibuja de forma síncrona).
  const imagenes = await Promise.all(items.map((it) => traerImagen(absolutizarImagen(it.imagen))))

  const doc = new PDFDocument({ size: 'A4', margin: 0 })
  const chunks = []
  doc.on('data', (c) => chunks.push(c))
  const listo = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))))

  const W = doc.page.width // 595.28
  const M = 44
  const contentW = W - M * 2

  // Encabezado
  doc.rect(0, 0, W, 120).fill(VERDE)
  doc.fillColor('#b7ff00').font('Helvetica-Bold').fontSize(26).text('HAUSLINE', M, 34)
  doc.fillColor('#ffffff').font('Helvetica').fontSize(11).text(esPago ? 'COMPROBANTE DE PAGO' : 'FACTURA DE COMPRA', M, 68)
  doc.fillColor('#9aa79a').fontSize(9).text('King of Shoes · hausline.ni', M, 86)
  doc.fillColor('#b7ff00').font('Helvetica-Bold').fontSize(15).text(codigo || '', W - M - 200, 40, { width: 200, align: 'right' })
  doc.fillColor('#9aa79a').font('Helvetica').fontSize(9).text('Código de seguimiento', W - M - 200, 62, { width: 200, align: 'right' })

  // Datos del cliente
  let y = 150
  doc.fillColor(GRIS).font('Helvetica-Bold').fontSize(9).text('CLIENTE', M, y)
  doc.fillColor(TEXTO).font('Helvetica-Bold').fontSize(16).text(nombre || 'Cliente', M, y + 14)
  if (fecha) {
    const f = new Date(`${fecha}T12:00:00`)
    const fechaTxt = isNaN(f.getTime()) ? String(fecha) : new Intl.DateTimeFormat('es-NI', { dateStyle: 'long' }).format(f)
    doc.fillColor(GRIS).font('Helvetica').fontSize(10).text(fechaTxt, M, y + 36)
  }

  // Cabecera de tabla
  y += 74
  const colCant = W - M - 190
  const colPrecio = W - M - 110
  const colSub = W - M
  doc.fillColor(GRIS).font('Helvetica-Bold').fontSize(9)
  doc.text('PRODUCTO', M, y)
  doc.text('CANT.', colCant - 20, y, { width: 40, align: 'center' })
  doc.text('PRECIO', colPrecio - 60, y, { width: 60, align: 'right' })
  doc.text('SUBTOTAL', colSub - 80, y, { width: 80, align: 'right' })
  y += 14
  doc.moveTo(M, y).lineTo(W - M, y).strokeColor(LINEA).lineWidth(1).stroke()
  y += 12

  const dibujarCabeceraTabla = (yy) => {
    doc.fillColor(GRIS).font('Helvetica-Bold').fontSize(9)
    doc.text('PRODUCTO', M, yy)
    doc.text('CANT.', colCant - 20, yy, { width: 40, align: 'center' })
    doc.text('PRECIO', colPrecio - 60, yy, { width: 60, align: 'right' })
    doc.text('SUBTOTAL', colSub - 80, yy, { width: 80, align: 'right' })
    doc.moveTo(M, yy + 14).lineTo(W - M, yy + 14).strokeColor(LINEA).lineWidth(1).stroke()
    return yy + 26
  }
  // Si el pedido tiene muchos productos, la tabla continúa en más páginas (cada una con su
  // cabecera) en vez de desbordarse encima de los totales.
  const nuevaPagina = () => {
    doc.addPage()
    doc.fillColor(GRIS).font('Helvetica').fontSize(9).text(`Factura ${codigo || ''} · continuación`, M, 40)
    return dibujarCabeceraTabla(60)
  }

  // Líneas
  items.forEach((item, i) => {
    if (y > 730) y = nuevaPagina()
    const rowTop = y
    const img = imagenes[i]
    const textX = img ? M + 52 : M
    if (img) {
      try { doc.image(img, M, rowTop, { fit: [42, 42] }) } catch { /* imagen inválida: se omite */ }
    }
    // El nombre puede ocupar varias líneas (pdfkit lo envuelve al ancho dado). Medimos su
    // alto real para colocar el código y el detalle DEBAJO y no encimados sobre la 2a línea.
    const nombreTexto = item.producto || 'Producto'
    const nombreAncho = colCant - textX - 24
    doc.fillColor(TEXTO).font('Helvetica-Bold').fontSize(11)
    const nombreAlto = doc.heightOfString(nombreTexto, { width: nombreAncho })
    doc.text(nombreTexto, textX, rowTop, { width: nombreAncho })
    let sub = rowTop + Math.max(15, nombreAlto + 2)
    if (item.codigo) { doc.fillColor(GRIS).font('Helvetica').fontSize(8.5).text(`Código: ${item.codigo}`, textX, sub, { width: nombreAncho }); sub += 12 }
    if (item.detalle) { doc.fillColor('#8a8f89').font('Helvetica').fontSize(8.5).text(item.detalle, textX, sub, { width: nombreAncho }); sub += 12 }

    doc.fillColor(TEXTO).font('Helvetica').fontSize(11)
    doc.text(String(Number(item.cantidad) || 1), colCant - 20, rowTop + 2, { width: 40, align: 'center' })
    doc.text(usd(item.precioUnitario), colPrecio - 60, rowTop + 2, { width: 60, align: 'right' })
    doc.font('Helvetica-Bold').text(usd(item.subtotal), colSub - 80, rowTop + 2, { width: 80, align: 'right' })

    y = Math.max(sub, rowTop + 46)
    doc.moveTo(M, y - 6).lineTo(W - M, y - 6).strokeColor(LINEA).lineWidth(0.5).stroke()
  })

  // Totales (si no caben tras la última fila, van en una página nueva).
  if (y > 630) y = nuevaPagina()
  y += 12
  const totalLabelX = W - M - 300
  const drawTotal = (label, valor, strong = false, color = TEXTO) => {
    doc.fillColor(GRIS).font('Helvetica').fontSize(11).text(label, totalLabelX, y, { width: 180, align: 'right' })
    doc.fillColor(color).font(strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(strong ? 15 : 12).text(valor, W - M - 110, y - (strong ? 2 : 0), { width: 110, align: 'right' })
    y += strong ? 26 : 20
  }
  drawTotal('Total del pedido', usd(factura.total))
  drawTotal(esPago ? 'Pago recibido' : 'Abono recibido', usd(factura.abono))
  if (esPago) drawTotal('Saldo pendiente', 'PAGADO', true, '#2f8f2f')
  else drawTotal('Saldo pendiente', usd(factura.saldo), true, (Number(factura.saldo) || 0) > 0.01 ? '#b26a00' : '#2f8f2f')

  // Pie
  y += 24
  doc.rect(M, y, contentW, 60).fill('#f2f6e6')
  doc.fillColor('#4c6500').font('Helvetica-Bold').fontSize(11).text(
    esPago ? `Pago recibido · Pedido ${codigo} entregado` : `Rastrea tu pedido con el código ${codigo}`,
    M, y + 16, { width: contentW, align: 'center' },
  )
  doc.fillColor(GRIS).font('Helvetica').fontSize(9).text(
    esPago ? '¡Muchas gracias por tu compra en Hausline!' : 'Gracias por comprar en Hausline · Los tiempos pueden variar por logística internacional.',
    M, y + 36, { width: contentW, align: 'center' },
  )

  doc.end()
  return listo
}

void ACENTO
