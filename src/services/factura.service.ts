import { whatsappUrl } from '../utils/whatsapp'
import { resolverImagenCatalogo } from '../utils/catalogoImagen'
import { nombreCorto } from '../utils/nombreCorto'
import { supabase } from '../lib/supabase'

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

// Foto actual del catálogo (tabla productos) por código, para cuando la foto guardada en el
// pedido ya no carga (ruta vieja, archivo movido) o el ítem no traía foto. Espejo de
// fotoCatalogo en api/_factura-pdf.js.
async function fotoCatalogo(codigo: string | null | undefined) {
  const c = String(codigo ?? '').trim().toUpperCase()
  if (!c || !supabase) return null
  const { data } = await supabase.from('productos').select('imagen').eq('codigo', c).limit(1).maybeSingle()
  return (data?.imagen as string | null | undefined) || null
}

// Foto de un ítem: la guardada en el pedido y, si no carga, la del catálogo por código.
async function fotoItem(item: FacturaLinea) {
  const propia = resolverImagenCatalogo(item.imagen)
  const img = propia ? await cargarImagen(propia) : null
  if (img) return img
  const alterna = resolverImagenCatalogo(await fotoCatalogo(item.codigo).catch(() => null))
  return alterna && alterna !== propia ? cargarImagen(alterna) : null
}

// Dibuja la imagen recortada tipo "object-fit: cover" dentro del recuadro.
function dibujarCover(context: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const ir = img.width / img.height, r = w / h
  let sw: number, sh: number, sx: number, sy: number
  if (ir > r) { sh = img.height; sw = sh * r; sx = (img.width - sw) / 2; sy = 0 }
  else { sw = img.width; sh = sw / r; sx = 0; sy = (img.height - sh) / 2 }
  context.drawImage(img, sx, sy, sw, sh, x, y, w, h)
}

type PaginaImagen = { data: Uint8Array<ArrayBuffer>; width: number; height: number }
type PaginaInfo = { pagina: number; paginas: number; ultima: boolean }
// Cuántos productos por factura/página. Un pedido con más productos genera varias facturas
// (páginas), todas con el detalle y la talla; los totales van solo en la última.
const POR_PAGINA = 10

// Genera TODAS las páginas de la factura (una por cada ~10 productos). Cada página precarga
// las fotos de sus productos; si el canvas se "contamina" y toBlob falla, reintenta sin fotos.
async function facturaPaginas(data: FacturaData, impresion = false): Promise<PaginaImagen[]> {
  const grupos: FacturaLinea[][] = []
  for (let i = 0; i < data.items.length; i += POR_PAGINA) grupos.push(data.items.slice(i, i + POR_PAGINA))
  if (grupos.length === 0) grupos.push([])
  const paginas: PaginaImagen[] = []
  for (let p = 0; p < grupos.length; p++) {
    const items = grupos[p]
    const info: PaginaInfo = { pagina: p + 1, paginas: grupos.length, ultima: p === grupos.length - 1 }
    const fotos = await Promise.all(items.map(fotoItem))
    try {
      paginas.push(await renderFactura(data, items, fotos, info, impresion))
    } catch (error) {
      if (error instanceof DOMException && error.name === 'SecurityError') paginas.push(await renderFactura(data, items, items.map(() => null), info, impresion))
      else throw error
    }
  }
  return paginas
}

async function renderFactura(data: FacturaData, visibles: FacturaLinea[], fotos: (HTMLImageElement | null)[], info: PaginaInfo, impresion = false): Promise<PaginaImagen> {
  const esPago = data.variante === 'pago'
  const hayFotos = fotos.some(Boolean)
  // Paleta: a COLOR para el cliente (WhatsApp); en BLANCO Y NEGRO para la copia impresa (PDF).
  const bw = impresion
  const acento = bw ? '#ffffff' : '#b7ff00'
  const pagadoColor = bw ? '#151815' : '#3f8600'
  const pieBg = bw ? '#f1f1ef' : '#edf6d8'
  const pieTxt = bw ? '#333333' : '#4c6500'
  const W = 1240
  const ITEMS_TOP = 590
  const subDe = (item: FacturaLinea) => { const c = (item.codigo ?? '').trim(); return [c ? `Cód. ${c}` : '', item.detalle].filter(Boolean).join('   ·   ') }
  const altoFila = (item: FacturaLinea) => hayFotos ? 100 : subDe(item) ? 86 : 64
  const itemsAlto = visibles.reduce((sum, item) => sum + altoFila(item), 0)
  const bodyBottom = ITEMS_TOP + itemsAlto
  // El alto del canvas es dinámico: crece con los productos de esta página. Los totales y el
  // pie solo van en la última página; las intermedias llevan una nota de "continúa".
  const ty = bodyBottom + 40
  const pieYNatural = ty + (esPago && data.metodoPago ? 266 : 200)
  const naturalCardBottom = info.ultima ? pieYNatural + 160 : bodyBottom + 120
  // Al IMPRIMIR forzamos hoja completa (proporción carta vertical) y el pie ("¡Muchas gracias!")
  // baja hasta el fondo. En la versión a color / WhatsApp el alto queda ajustado al contenido.
  const minH = Math.round(W * 11 / 8.5)
  const H = impresion && info.ultima ? Math.max(naturalCardBottom + 40, minH) : naturalCardBottom + 40
  const cardBottom = impresion && info.ultima ? H - 40 : naturalCardBottom
  const pieY = impresion && info.ultima ? cardBottom - 170 : pieYNatural

  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H
  const context = canvas.getContext('2d'); if (!context) throw new Error('No se pudo crear la factura.')
  context.fillStyle = '#f6f7f3'; context.fillRect(0, 0, W, H)

  // Encabezado
  context.fillStyle = '#111411'; context.fillRect(0, 0, W, 300)
  context.fillStyle = acento; context.font = '800 62px Arial'; context.fillText('HAUSLINE', 90, 120)
  context.fillStyle = '#ffffff'; context.font = '600 27px Arial'; context.fillText(esPago ? 'COMPROBANTE DE PAGO' : 'FACTURA DE COMPRA', 92, 180)
  context.fillStyle = acento; context.font = '600 23px Arial'; context.fillText('King of Shoes', 92, 224); context.fillStyle = '#aab0aa'; context.font = '500 23px Arial'; context.fillText('· hausline.ni', 92 + context.measureText('King of Shoes ').width + 34, 224)
  context.textAlign = 'right'; context.fillStyle = acento; context.font = '700 30px Arial'; context.fillText(data.codigo, 1150, 120)
  context.fillStyle = '#aab0aa'; context.font = '500 22px Arial'; context.fillText('Código de seguimiento', 1150, 158)
  if (info.paginas > 1) { context.fillStyle = '#ffffff'; context.font = '700 24px Arial'; context.fillText(`Factura ${info.pagina} de ${info.paginas}`, 1150, 202) }
  context.textAlign = 'left'

  // Tarjeta
  context.fillStyle = '#ffffff'; context.beginPath(); context.roundRect(65, 245, 1110, cardBottom - 245, 34); context.fill()

  // Datos del cliente
  context.fillStyle = '#6f756f'; context.font = '600 24px Arial'; context.fillText('CLIENTE', 100, 340)
  context.fillStyle = '#151815'; context.font = '700 40px Arial'; context.fillText(truncar(context, data.cliente || 'Cliente', 980), 100, 392)
  context.fillStyle = '#6f756f'; context.font = '500 26px Arial'; context.fillText(new Intl.DateTimeFormat('es-NI', { dateStyle: 'long' }).format(new Date(`${data.fecha}T12:00:00`)), 100, 438)

  context.strokeStyle = '#e4e7df'; context.lineWidth = 3; context.beginPath(); context.moveTo(100, 480); context.lineTo(1140, 480); context.stroke()

  // Cabecera de la tabla
  context.fillStyle = '#6f756f'; context.font = '700 22px Arial'; context.fillText('PRODUCTO', 100, 535)
  context.textAlign = 'center'; context.fillText('CANT.', 860, 535)
  context.textAlign = 'right'; context.fillText('SUBTOTAL', 1140, 535); context.textAlign = 'left'

  // Líneas. Si hay fotos, se reserva una columna con la miniatura del producto.
  const textX = hayFotos ? 195 : 100
  const anchoNombre = hayFotos ? 610 : 700
  let y = ITEMS_TOP
  visibles.forEach((item, i) => {
    const sub = subDe(item)
    if (hayFotos) {
      const foto = fotos[i]
      const top = y - 38
      context.save(); context.beginPath(); context.roundRect(100, top, 74, 74, 14)
      if (foto) { context.clip(); dibujarCover(context, foto, 100, top, 74, 74) }
      else { context.fillStyle = '#eef0ea'; context.fill(); context.fillStyle = '#9aa093'; context.font = '600 22px Arial'; context.textAlign = 'center'; context.fillText(`${item.cantidad}×`, 137, top + 46); context.textAlign = 'left' }
      context.restore()
    }
    context.fillStyle = '#151815'; context.font = '600 30px Arial'; context.fillText(truncar(context, nombreCorto(item.producto) || 'Producto', anchoNombre), textX, y)
    if (sub) { context.fillStyle = '#8a8f89'; context.font = '500 22px Arial'; context.fillText(truncar(context, sub, anchoNombre), textX, y + 32) }
    context.fillStyle = '#343934'; context.font = '600 30px Arial'; context.textAlign = 'center'; context.fillText(`${item.cantidad}`, 860, y)
    context.textAlign = 'right'; context.fillText(`USD ${(item.cantidad * item.precio).toFixed(2)}`, 1140, y); context.textAlign = 'left'
    y += altoFila(item)
  })

  if (!info.ultima) {
    // Página intermedia: nota de continuación en vez de totales.
    context.fillStyle = '#8a8f89'; context.font = '500 24px Arial'; context.textAlign = 'center'
    context.fillText(`Continúa en la factura ${info.pagina + 1} de ${info.paginas} — los totales van en la última.`, 620, bodyBottom + 50)
    context.textAlign = 'left'
  } else {
    // Última página: totales + pie.
    context.strokeStyle = '#e4e7df'; context.beginPath(); context.moveTo(100, ty - 40); context.lineTo(1140, ty - 40); context.stroke()
    const drawTotal = (label: string, value: string, yy: number, strong = false, color = '#343934') => {
      context.fillStyle = '#6f756f'; context.font = '500 30px Arial'; context.fillText(label, 100, yy)
      context.fillStyle = strong ? color : '#343934'; context.font = `${strong ? 800 : 600} ${strong ? 38 : 32}px Arial`; context.textAlign = 'right'; context.fillText(value, 1140, yy); context.textAlign = 'left'
    }
    drawTotal('Total del pedido', `USD ${data.total.toFixed(2)}`, ty)
    drawTotal(esPago ? 'Pago recibido' : 'Abono recibido', `USD ${data.abono.toFixed(2)}`, ty + 66)
    if (esPago) {
      if (data.metodoPago) drawTotal('Método de pago', data.metodoPago, ty + 132)
      drawTotal('Saldo pendiente', 'PAGADO', ty + (data.metodoPago ? 214 : 148), true, pagadoColor)
    } else {
      drawTotal('Saldo pendiente', `USD ${Math.max(0, data.saldo).toFixed(2)}`, ty + 148, true, bw ? '#151815' : (data.saldo > 0.01 ? '#b26a00' : '#3f8600'))
    }
    context.fillStyle = pieBg; context.beginPath(); context.roundRect(100, pieY, 1040, 90, 18); context.fill()
    context.fillStyle = pieTxt; context.font = '600 24px Arial'; context.textAlign = 'center'
    context.fillText(esPago ? `Pago recibido · Pedido ${data.codigo} entregado` : `Rastrea tu pedido con el código ${data.codigo}`, 620, pieY + 46)
    context.fillStyle = '#7a807a'; context.font = '500 20px Arial'
    context.fillText(esPago ? '¡Muchas gracias por tu compra en Hausline! Esperamos verte pronto.' : 'Gracias por comprar en Hausline · Los tiempos pueden variar por logística internacional.', 620, pieY + 140)
    context.textAlign = 'left'
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', .92))
  if (!blob) throw new Error('No se pudo crear la factura.')
  return { data: new Uint8Array(await blob.arrayBuffer()), width: W, height: H }
}

// Arma un PDF de VARIAS páginas (una por cada imagen de factura). Cada página conserva la
// proporción de su imagen (el alto es dinámico), así ninguna se deforma ni se corta.
function imagenesPdf(paginas: PaginaImagen[]): Blob {
  const header = bytes('%PDF-1.4\n%Hausline\n')
  const catalogo = bytes('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  const refsPagina: number[] = []
  const cuerpos: Uint8Array[] = []
  let n = 3
  for (const pg of paginas) {
    const nPage = n, nContent = n + 1, nImg = n + 2; n += 3
    refsPagina.push(nPage)
    const anchoPt = 595.28
    const altoPt = +(anchoPt * (pg.height / pg.width)).toFixed(2)
    const content = bytes(`q\n${anchoPt} 0 0 ${altoPt} 0 0 cm\n/Im0 Do\nQ\n`)
    cuerpos.push(bytes(`${nPage} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${anchoPt} ${altoPt}] /Resources << /XObject << /Im0 ${nImg} 0 R >> >> /Contents ${nContent} 0 R >>\nendobj\n`))
    cuerpos.push(join([bytes(`${nContent} 0 obj\n<< /Length ${content.length} >>\nstream\n`), content, bytes('endstream\nendobj\n')]))
    cuerpos.push(join([bytes(`${nImg} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pg.width} /Height ${pg.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.data.length} >>\nstream\n`), pg.data, bytes('\nendstream\nendobj\n')]))
  }
  const pagesObj = bytes(`2 0 obj\n<< /Type /Pages /Kids [${refsPagina.map((r) => `${r} 0 R`).join(' ')}] /Count ${paginas.length} >>\nendobj\n`)
  const objetos: Uint8Array[] = [catalogo, pagesObj, ...cuerpos]
  const offsets: number[] = [0]; let position = header.length
  for (const obj of objetos) { offsets.push(position); position += obj.length }
  const size = objetos.length + 1
  const xrefOffset = position
  const xref = bytes(`xref\n0 ${size}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`)
  return new Blob([join([header, ...objetos, xref])], { type: 'application/pdf' })
}

function nombreArchivo(data: FacturaData, extension: string) {
  return `Hausline-${data.codigo}-${data.variante === 'pago' ? 'comprobante' : 'factura'}.${extension}`
}

// Una imagen (File) por cada página de la factura. Pedidos cortos → 1 archivo; largos → varios.
export async function crearFacturaImagenFiles(data: FacturaData) {
  const paginas = await facturaPaginas(data)
  const base = nombreArchivo(data, 'jpg').replace(/\.jpg$/, '')
  return paginas.map((pg, i) => new File([pg.data], paginas.length > 1 ? `${base}-${i + 1}.jpg` : `${base}.jpg`, { type: 'image/jpeg' }))
}
// El PDF es la copia para IMPRIMIR: blanco y negro y en hoja completa (tamaño carta).
export async function crearFacturaPdf(data: FacturaData) {
  const paginas = await facturaPaginas(data, true)
  return new File([imagenesPdf(paginas)], nombreArchivo(data, 'pdf'), { type: 'application/pdf' })
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
  const files = await crearFacturaImagenFiles(data)
  const mensaje = (data.variante === 'pago'
    ? `Hola ${data.cliente}, confirmamos que recibimos el pago de tu pedido ${data.codigo} en Hausline. Aquí tienes tu comprobante. ¡Muchas gracias por tu compra!`
    : `Hola ${data.cliente}, ¡tu pedido quedó registrado en Hausline! Aquí tienes tu factura${files.length > 1 ? ` (${files.length} páginas)` : ''}. Tu código de seguimiento es ${data.codigo}; puedes rastrearlo cuando quieras. ¡Gracias por tu compra!`
  ).replace(/\s+/g, ' ').trim()
  if (navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files, title: `${data.variante === 'pago' ? 'Comprobante' : 'Factura'} ${data.codigo}`, text: mensaje })
      return 'shared' as const
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled' as const
    }
  }
  files.forEach(descargarArchivo)
  if (data.whatsapp) window.open(whatsappUrl(data.whatsapp, mensaje), '_blank', 'noopener,noreferrer')
  return data.whatsapp ? 'downloaded' as const : 'downloaded_no_whatsapp' as const
}
