import PDFDocument from 'pdfkit'

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
  return `USD ${(Number(valor) || 0).toFixed(2)}`
}

// Descarga una imagen y la devuelve como Buffer (pdfkit acepta JPEG/PNG). Si falla, null.
async function traerImagen(url) {
  if (!url) return null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return Buffer.from(await res.arrayBuffer())
  } catch {
    return null
  }
}

export async function facturaPdfBuffer({ codigo, nombre, fecha, factura }) {
  const esPago = factura?.variante === 'pago'
  const items = Array.isArray(factura?.items) ? factura.items : []

  // Pre-descarga las fotos (pdfkit dibuja de forma síncrona).
  const imagenes = await Promise.all(items.map((it) => traerImagen(it.imagen)))

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

  // Líneas
  items.forEach((item, i) => {
    const rowTop = y
    const img = imagenes[i]
    const textX = img ? M + 52 : M
    if (img) {
      try { doc.image(img, M, rowTop, { fit: [42, 42] }) } catch { /* imagen inválida: se omite */ }
    }
    doc.fillColor(TEXTO).font('Helvetica-Bold').fontSize(11).text(item.producto || 'Producto', textX, rowTop, { width: colCant - textX - 24 })
    let sub = rowTop + 15
    if (item.codigo) { doc.fillColor(GRIS).font('Helvetica').fontSize(8.5).text(`Código: ${item.codigo}`, textX, sub, { width: colCant - textX - 24 }); sub += 12 }
    if (item.detalle) { doc.fillColor('#8a8f89').font('Helvetica').fontSize(8.5).text(item.detalle, textX, sub, { width: colCant - textX - 24 }); sub += 12 }

    doc.fillColor(TEXTO).font('Helvetica').fontSize(11)
    doc.text(String(Number(item.cantidad) || 1), colCant - 20, rowTop + 2, { width: 40, align: 'center' })
    doc.text(usd(item.precioUnitario), colPrecio - 60, rowTop + 2, { width: 60, align: 'right' })
    doc.font('Helvetica-Bold').text(usd(item.subtotal), colSub - 80, rowTop + 2, { width: 80, align: 'right' })

    y = Math.max(sub, rowTop + 46)
    doc.moveTo(M, y - 6).lineTo(W - M, y - 6).strokeColor(LINEA).lineWidth(0.5).stroke()
  })

  // Totales
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
