import type { Resena } from './resenas.service'
import { resolverImagenCatalogo } from '../utils/catalogoImagen'
import { asegurarFuentesTienda } from '../utils/estiloTienda'
import { BLACK, CREMA, FAINT, LINE_COL, MUTED, TINTA, cargarImagen, check, imagenCover, marca, marcaDeAgua, partirTexto, placeholderProducto } from './historia.service'

// Historia (9:16, 1080×1920) de una RESEÑA para subir a Instagram/WhatsApp, con el mismo estilo
// de la de "Pedido entregado": estrellas, la opinión entre comillas, el nombre del cliente
// (o anónimo) y la foto (la que subió el cliente o la del producto). Nunca teléfono ni montos.

export type HistoriaResenaOpts = { mostrarNombre: boolean; conFoto: boolean }
export type ProductoResena = { nombre: string; marca: string | null; imagen: string | null } | null

// "Ana María López" → "Ana L."
export const nombreCorto = (n: string) => {
  const p = String(n || '').trim().split(/\s+/).filter(Boolean)
  return p.length ? `${p[0]}${p.length > 1 ? ` ${p[p.length - 1].charAt(0).toUpperCase()}.` : ''}` : 'Cliente'
}

function estrella(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, llena: boolean) {
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5, rad = i % 2 === 0 ? r : r * 0.45
    ctx.lineTo(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad)
  }
  ctx.closePath()
  if (llena) { ctx.fillStyle = TINTA; ctx.fill() } else { ctx.strokeStyle = '#C9C2B6'; ctx.lineWidth = 3; ctx.stroke() }
}

async function resenaJpeg(r: Resena, producto: ProductoResena, opts: HistoriaResenaOpts): Promise<Blob> {
  const W = 1080, H = 1920, CX = W / 2
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('No se pudo generar la historia.')
  await asegurarFuentesTienda()
  ctx.fillStyle = '#FCFBF9'; ctx.fillRect(0, 0, W, H)
  marcaDeAgua(ctx, W, H)
  ctx.fillStyle = TINTA; ctx.fillRect(0, 0, W, 6)

  marca(ctx, CX, 164)
  ctx.textAlign = 'center'; ctx.fillStyle = FAINT; ctx.font = '600 20px Jost, Arial'
  ctx.letterSpacing = '5px'; ctx.fillText('KING OF SHOES', CX, 205); ctx.letterSpacing = '0px'

  ctx.fillStyle = MUTED; ctx.font = '700 22px Jost, Arial'; ctx.letterSpacing = '6px'
  ctx.fillText('LO QUE DICEN NUESTROS CLIENTES', CX, 300); ctx.letterSpacing = '0px'

  // Estrellas.
  const n = Math.max(1, Math.min(5, Math.round(Number(r.estrellas) || 5)))
  for (let i = 0; i < 5; i++) estrella(ctx, CX - 2 * 92 + i * 92, 380, 36, i < n)

  // Opinión en una tarjeta blanca.
  const comentario = (r.comentario ?? '').trim() || `Calificó su compra con ${n} ${n === 1 ? 'estrella' : 'estrellas'}.`
  let size = comentario.length > 180 ? 40 : comentario.length > 110 ? 46 : 54
  ctx.font = `italic 500 ${size}px "Cormorant Garamond", Georgia, serif`
  let lineas = partirTexto(ctx, comentario, 760, 7)
  if (lineas.length >= 7 && size > 40) { size = 40; ctx.font = `italic 500 ${size}px "Cormorant Garamond", Georgia, serif`; lineas = partirTexto(ctx, comentario, 760, 8) }
  const alto = size * 1.28
  const cardX = 110, cardY = 450, cardW = 860
  const verificada = !!r.pedido_codigo
  const cardH = 110 + lineas.length * alto + 70 + (verificada ? 70 : 0) + 40
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.roundRect(cardX, cardY, cardW, cardH, 26); ctx.fill()
  ctx.strokeStyle = LINE_COL; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(cardX, cardY, cardW, cardH, 26); ctx.stroke()
  ctx.fillStyle = '#E2DCD1'; ctx.font = '700 150px "Cormorant Garamond", Georgia, serif'; ctx.textAlign = 'left'
  ctx.fillText('“', cardX + 40, cardY + 130)
  ctx.textAlign = 'center'; ctx.fillStyle = BLACK; ctx.font = `italic 500 ${size}px "Cormorant Garamond", Georgia, serif`
  let y = cardY + 110 + size * 0.2
  for (const l of lineas) { ctx.fillText(l, CX, y); y += alto }
  y += 30
  const quien = opts.mostrarNombre ? `— ${nombreCorto(r.cliente_nombre)}` : '— Cliente HAUSLINE'
  ctx.font = '700 28px Jost, Arial'; ctx.letterSpacing = '2px'; ctx.fillText(quien.toUpperCase(), CX, y); ctx.letterSpacing = '0px'
  if (verificada) {
    y += 40
    ctx.font = '800 19px Jost, Arial'; ctx.letterSpacing = '3px'
    const t = 'COMPRA VERIFICADA', tw = ctx.measureText(t).width, bw = tw + 82, bh = 46
    ctx.fillStyle = TINTA; ctx.beginPath(); ctx.roundRect(CX - bw / 2, y, bw, bh, 6); ctx.fill()
    check(ctx, CX - bw / 2 + 30, y + bh / 2, 22, CREMA, 4)
    ctx.fillStyle = CREMA; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(t, CX - bw / 2 + 54, y + bh / 2 + 1)
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'center'; ctx.letterSpacing = '0px'
  }
  const finTarjeta = cardY + cardH

  // Foto: la que subió el cliente; si no, la del producto.
  const src = opts.conFoto ? (r.foto_url || (producto?.imagen ? resolverImagenCatalogo(producto.imagen) : '')) : ''
  const espacio = 1630 - (finTarjeta + 50) - (producto ? 70 : 0)
  if (src && espacio > 260) {
    const lado = Math.min(560, espacio)
    const fx = CX - lado / 2, fy = finTarjeta + 50
    const img = await cargarImagen(src)
    if (img) imagenCover(ctx, img, fx, fy, lado, lado, 24)
    else placeholderProducto(ctx, fx, fy, lado, lado, 24, producto?.marca || producto?.nombre || 'H')
    if (producto) {
      ctx.fillStyle = '#9C958A'; ctx.font = '600 22px Jost, Arial'; ctx.letterSpacing = '3px'
      ctx.fillText([producto.marca, producto.nombre].filter(Boolean).join(' · ').toUpperCase().slice(0, 60), CX, fy + lado + 50); ctx.letterSpacing = '0px'
    }
  }

  // Web + pie.
  ctx.fillStyle = TINTA; ctx.beginPath(); ctx.roundRect(CX - 250, 1680, 500, 84, 42); ctx.fill()
  ctx.fillStyle = '#fff'; ctx.font = '700 30px Jost, Arial'; ctx.letterSpacing = '1px'; ctx.fillText('hauslineshopni.es', CX, 1733); ctx.letterSpacing = '0px'
  ctx.fillStyle = FAINT; ctx.font = '600 17px Jost, Arial'; ctx.letterSpacing = '4px'
  ctx.fillText('MODA PREMIUM. SIN LÍMITES.', CX, 1830); ctx.letterSpacing = '0px'
  ctx.textAlign = 'left'

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
  if (!blob) throw new Error('No se pudo generar la historia.')
  return blob
}

export const crearHistoriaResenaBlob = resenaJpeg

const archivo = (blob: Blob, r: Resena) => new File([blob], `Hausline-resena-${(r.cliente_nombre || 'cliente').split(/\s+/)[0]}-${r.id.slice(0, 6)}.jpg`, { type: 'image/jpeg' })

export async function descargarHistoriaResena(r: Resena, producto: ProductoResena, opts: HistoriaResenaOpts) {
  const file = archivo(await resenaJpeg(r, producto, opts), r)
  const url = URL.createObjectURL(file); const a = document.createElement('a')
  a.href = url; a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000)
  return 'downloaded' as const
}

// En el teléfono abre el menú nativo (subir directo a historias); en la compu descarga la imagen.
export async function compartirHistoriaResena(r: Resena, producto: ProductoResena, opts: HistoriaResenaOpts) {
  const file = archivo(await resenaJpeg(r, producto, opts), r)
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Reseña · HAUSLINE' }); return 'shared' as const }
    catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled' as const }
  }
  await descargarHistoriaResena(r, producto, opts)
  return 'downloaded' as const
}
