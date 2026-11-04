import type { EstadoPedido, Pedido } from '../types/domain'
import { resolverImagenCatalogo } from '../utils/catalogoImagen'
import { asegurarFuentesTienda } from '../utils/estiloTienda'
import { BLACK, CREMA, FAINT, LINE_COL, MUTED, TINTA, cargarImagen, check, marca, marcaDeAgua, partirTexto, placeholderProducto } from './historia.service'
import { esLineaEnvio } from './pedidos.service'

// HISTORIA "TUS PRODUCTOS" (9:16, 1080×1920): como el comprobante de compra de una tienda, con
// los productos de un pedido web que se le encargó al proveedor, para subir a Instagram como
// prueba de que se está vendiendo. Muestra solo foto, marca, nombre, talla y cantidad, y una
// frase de estado ("Pedido en camino ✓"). NUNCA lleva cliente, ciudad, teléfono, código de
// pedido ni de producto, ni precios.
export type ProductoHistoria = { producto: string; marca?: string | null; talla?: string | null; cantidad: number; imagen?: string | null }

export type FraseOrden = 'confirmada' | 'preparacion' | 'camino' | 'nicaragua' | 'entregado'
export const FRASES_ORDEN: Record<FraseOrden, string> = {
  confirmada: 'Orden confirmada',
  preparacion: 'Pedido en preparación',
  camino: 'Pedido en camino',
  nicaragua: 'Ya llegó a Nicaragua',
  entregado: 'Pedido entregado',
}

// La frase que va por defecto según en qué etapa está el pedido.
export function fraseSegunEstado(estado: EstadoPedido): FraseOrden {
  if (estado === 'pedido_confirmado') return 'confirmada'
  if (estado === 'en_preparacion' || estado === 'control_calidad' || estado === 'etiqueta_creada') return 'preparacion'
  if (estado === 'despachado' || estado === 'transito_internacional' || estado === 'recibido_estados_unidos' || estado === 'transito_nicaragua') return 'camino'
  if (estado === 'entregado') return 'entregado'
  return 'nicaragua'
}

const MAX_FILAS = 3 // más filas achican mucho la foto; el resto va como "+ N productos más"

// Productos de un pedido (sin las líneas de envío).
export function productosDeOrden(pedido: Pedido): ProductoHistoria[] {
  return (pedido.pedido_items ?? []).filter((it) => !esLineaEnvio(it) && it.producto?.trim())
    .map((it) => ({ producto: it.producto, marca: it.marca, talla: it.talla, cantidad: Number(it.cantidad) || 1, imagen: it.imagen }))
}

async function historiaOrdenJpeg(productos: ProductoHistoria[], frase: FraseOrden): Promise<Blob> {
  const W = 1080, H = 1920, CX = W / 2
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('No se pudo generar la historia.')

  await asegurarFuentesTienda()
  ctx.fillStyle = '#FCFBF9'; ctx.fillRect(0, 0, W, H)
  marcaDeAgua(ctx, W, H)
  ctx.fillStyle = TINTA; ctx.fillRect(0, 0, W, 6)

  // Encabezado de marca, como el de un correo de la tienda.
  marca(ctx, CX, 190)
  ctx.textAlign = 'center'; ctx.fillStyle = FAINT; ctx.font = '600 20px Jost, Arial'
  ctx.letterSpacing = '5px'; ctx.fillText('KING OF SHOES', CX, 232); ctx.letterSpacing = '0px'
  ctx.strokeStyle = LINE_COL; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(CX - 300, 290); ctx.lineTo(CX + 300, 290); ctx.stroke()

  // Titular.
  ctx.fillStyle = BLACK; ctx.textAlign = 'center'; ctx.font = '600 70px "Cormorant Garamond", Georgia, serif'
  ctx.fillText('Tus productos', CX, 400)
  ctx.fillStyle = '#6b6b6b'; ctx.font = '400 30px Jost, Arial'
  ctx.fillText('Todos los productos comprados en la orden', CX, 456)

  // Productos: con uno solo la foto va grande; con varios se achica para que quepan.
  const filas = productos.slice(0, MAX_FILAS)
  const sobran = productos.length - filas.length
  // Productos + frase quedan centrados entre el titular y el pie.
  const gap = 34, extraH = sobran > 0 ? 80 : 0, fraseH = 150
  const zonaY = 520, zonaH = 1640 - zonaY
  const filaH = Math.min(filas.length === 1 ? 520 : 400, (zonaH - fraseH - extraH - gap * (filas.length - 1)) / Math.max(1, filas.length))
  const foto = Math.round(filaH)
  const bloqueH = filaH * filas.length + gap * (filas.length - 1)
  const inicioY = zonaY + (zonaH - (bloqueH + extraH + fraseH)) / 2
  let y = inicioY
  const fotoX = filas.length === 1 ? 100 : 150
  const tX = fotoX + foto + 56, tW = W - tX - 110
  const imagenes = await Promise.all(filas.map((it) => it.imagen ? cargarImagen(resolverImagenCatalogo(it.imagen)) : Promise.resolve(null)))
  filas.forEach((it, i) => {
    // Foto entera (sin recortar) sobre un fondo gris claro, como en las tiendas.
    ctx.save(); ctx.beginPath(); ctx.roundRect(fotoX, y, foto, foto, 18); ctx.clip()
    ctx.fillStyle = '#efeeeb'; ctx.fillRect(fotoX, y, foto, foto)
    const img = imagenes[i]
    if (img) {
      const pad = foto * 0.06
      const esc = Math.min((foto - pad * 2) / img.naturalWidth, (foto - pad * 2) / img.naturalHeight)
      const dw = img.naturalWidth * esc, dh = img.naturalHeight * esc
      ctx.drawImage(img, fotoX + (foto - dw) / 2, y + (foto - dh) / 2, dw, dh)
    }
    ctx.restore()
    if (!img) placeholderProducto(ctx, fotoX, y, foto, foto, 18, it.marca || it.producto)

    // Texto a la derecha, centrado en alto con la foto.
    const grande = filas.length <= 2
    const fNombre = grande ? 44 : 36, fDato = grande ? 32 : 27, lh = fNombre + 8
    ctx.textAlign = 'left'
    ctx.font = `700 ${fNombre}px Jost, Arial`
    const lineas = partirTexto(ctx, it.producto, tW, grande ? 3 : 2)
    const marcaTxt = (it.marca ?? '').trim()
    const datos = [it.talla ? `Talla: ${it.talla}` : '', `Cantidad: ${Number(it.cantidad) || 1}`].filter(Boolean)
    const altoTexto = (marcaTxt ? 40 : 0) + lineas.length * lh + 18 + datos.length * (fDato + 14)
    let ty = y + Math.max(fNombre, (foto - altoTexto) / 2 + fNombre)
    if (marcaTxt) {
      ctx.fillStyle = '#9C958A'; ctx.font = '600 22px Jost, Arial'; ctx.letterSpacing = '3px'
      ctx.fillText(marcaTxt.toUpperCase(), tX, ty - fNombre + 22); ctx.letterSpacing = '0px'
      ty += 40
    }
    ctx.fillStyle = BLACK; ctx.font = `700 ${fNombre}px Jost, Arial`
    for (const l of lineas) { ctx.fillText(l, tX, ty); ty += lh }
    ty += 18 - 8
    ctx.fillStyle = '#3a3a3a'; ctx.font = `400 ${fDato}px Jost, Arial`
    for (const d of datos) { ctx.fillText(d, tX, ty); ty += fDato + 14 }
    y += filaH + gap
  })
  if (sobran > 0) {
    ctx.fillStyle = MUTED; ctx.textAlign = 'center'; ctx.font = '600 28px Jost, Arial'
    ctx.fillText(`+ ${sobran} ${sobran === 1 ? 'producto más' : 'productos más'}`, CX, inicioY + bloqueH + 60)
  }

  // Frase de estado en cursiva + check de tinta.
  const fy = inicioY + bloqueH + extraH + 125
  ctx.font = 'italic 600 78px "Cormorant Garamond", Georgia, serif'
  const texto = FRASES_ORDEN[frase]
  const tw = ctx.measureText(texto).width, cajaS = 66, sep = 22
  const x0 = CX - (tw + sep + cajaS) / 2
  ctx.fillStyle = BLACK; ctx.textAlign = 'left'; ctx.fillText(texto, x0, fy)
  ctx.fillStyle = TINTA; ctx.beginPath(); ctx.roundRect(x0 + tw + sep, fy - cajaS + 8, cajaS, cajaS, 12); ctx.fill()
  check(ctx, x0 + tw + sep + cajaS / 2, fy - cajaS / 2 + 8, 40, CREMA, 6)

  // Pie.
  ctx.textAlign = 'center'
  ctx.strokeStyle = LINE_COL; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(150, 1690); ctx.lineTo(930, 1690); ctx.stroke()
  ctx.fillStyle = BLACK; ctx.font = '700 26px Jost, Arial'; ctx.letterSpacing = '7px'
  ctx.fillText('HAUSLINE', CX, 1752); ctx.letterSpacing = '0px'
  ctx.fillStyle = FAINT; ctx.font = '600 19px Jost, Arial'; ctx.letterSpacing = '3px'
  ctx.fillText('HAUSLINESHOPNI.ES', CX, 1792); ctx.letterSpacing = '0px'
  ctx.textAlign = 'left'

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', .92))
  if (!blob) throw new Error('No se pudo generar la historia.')
  return blob
}

export function crearHistoriaOrdenBlob(productos: ProductoHistoria[], frase: FraseOrden) { return historiaOrdenJpeg(productos, frase) }

// El nombre del archivo tampoco lleva el código del pedido.
const archivo = (blob: Blob) => new File([blob], `Hausline-orden-${Date.now().toString(36)}.jpg`, { type: 'image/jpeg' })

export async function descargarHistoriaOrden(productos: ProductoHistoria[], frase: FraseOrden) {
  const file = archivo(await historiaOrdenJpeg(productos, frase))
  const url = URL.createObjectURL(file); const a = document.createElement('a')
  a.href = url; a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000)
  return 'downloaded' as const
}

// En el teléfono abre el menú de compartir (para subirla directo a historias); en la PC la descarga.
export async function compartirHistoriaOrden(productos: ProductoHistoria[], frase: FraseOrden) {
  const file = archivo(await historiaOrdenJpeg(productos, frase))
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Tus productos · HAUSLINE' }); return 'shared' as const }
    catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled' as const }
  }
  await descargarHistoriaOrden(productos, frase)
  return 'downloaded' as const
}
