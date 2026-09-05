import type { Pedido } from '../types/domain'
import { resolverImagenCatalogo } from '../utils/catalogoImagen'

// Genera una imagen tipo "historia" (9:16, 1080×1920) de un pedido ENTREGADO, lista para
// subir a Instagram/WhatsApp. Muestra prueba social SIN exponer al cliente: foto y nombre
// del producto, "Entregado ✓", ciudad y (opcional) el primer nombre. Nunca apellido,
// teléfono, dirección, código ni montos.
//
// Reusa el enfoque de recibos.service (canvas → JPEG → compartir/descargar).

export type HistoriaOpts = { mostrarNombre: boolean }

const GREEN = '#b7ff00'
const BLACK = '#0b0b0b'
const MUTED = '#8a8a8a'
const FAINT = '#a9a9a9'
const LINE_COL = '#e9e9e9'

// Carga una imagen para dibujarla en el canvas SIN ensuciarlo (CORS). Si el host no manda
// cabeceras CORS, el load falla y devolvemos null → se dibuja un placeholder (la exportación
// nunca se rompe, porque solo dibujamos imágenes que cargaron limpias con crossOrigin).
function cargarImagen(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!url) return resolve(null)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

// Dibuja una imagen "cover" (recortada al centro) dentro de un rectángulo redondeado.
function imagenCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, r: number) {
  const escala = Math.max(w / img.naturalWidth, h / img.naturalHeight)
  const dw = img.naturalWidth * escala
  const dh = img.naturalHeight * escala
  ctx.save()
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.clip()
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
  ctx.restore()
}

// Placeholder cuando no hay foto disponible (o el host no permite CORS). En el diseño
// claro: recuadro gris con la inicial en gris suave.
function placeholderProducto(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, texto: string) {
  ctx.save()
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.clip()
  ctx.fillStyle = '#f2f2f2'; ctx.fillRect(x, y, w, h)
  ctx.fillStyle = '#d6d6d6'
  ctx.font = '800 120px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText((texto || 'H').charAt(0).toUpperCase(), x + w / 2, y + h / 2)
  ctx.restore()
  ctx.textBaseline = 'alphabetic'
}

// Parte un texto en líneas que quepan en `maxW`; devuelve hasta `maxLineas` (la última con …).
function partirTexto(ctx: CanvasRenderingContext2D, texto: string, maxW: number, maxLineas: number): string[] {
  const palabras = String(texto || '').trim().split(/\s+/)
  const lineas: string[] = []
  let actual = ''
  for (const palabra of palabras) {
    const prueba = actual ? `${actual} ${palabra}` : palabra
    if (ctx.measureText(prueba).width > maxW && actual) { lineas.push(actual); actual = palabra }
    else actual = prueba
    if (lineas.length === maxLineas) break
  }
  if (actual && lineas.length < maxLineas) lineas.push(actual)
  if (lineas.length === maxLineas) {
    let ultima = lineas[maxLineas - 1]
    while (ctx.measureText(`${ultima}…`).width > maxW && ultima.length > 1) ultima = ultima.slice(0, -1)
    // Solo agrega … si de verdad se cortó (quedaron palabras fuera).
    const usadas = lineas.join(' ').split(/\s+/).length
    if (usadas < palabras.length) lineas[maxLineas - 1] = `${ultima}…`
  }
  return lineas
}

// Wordmark "•HAUSLINE" (punto neón + texto negro) centrado sobre fondo claro.
function marca(ctx: CanvasRenderingContext2D, cx: number, y: number) {
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
  ctx.font = '800 46px Arial'; ctx.letterSpacing = '8px'
  const texto = 'HAUSLINE'
  const wTexto = ctx.measureText(texto).width
  const dotR = 9, gap = 16
  const totalW = dotR * 2 + gap + wTexto
  const startX = cx - totalW / 2
  ctx.fillStyle = GREEN; ctx.beginPath(); ctx.arc(startX + dotR, y - 14, dotR, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = BLACK; ctx.fillText(texto, startX + dotR * 2 + gap, y)
  ctx.letterSpacing = '0px'
}

// Dibuja un check (✓) con líneas, dentro de la caja centrada en (cx,cy).
function check(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string, ancho: number) {
  ctx.save()
  ctx.strokeStyle = color; ctx.lineWidth = ancho; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(cx - size * 0.42, cy + size * 0.04)
  ctx.lineTo(cx - size * 0.1, cy + size * 0.36)
  ctx.lineTo(cx + size * 0.46, cy - size * 0.34)
  ctx.stroke()
  ctx.restore()
}

// Marca de agua "HAUSLINE" repetida, muy suave, en diagonal (para que la referencia
// quede en todos lados sin filtrar el código real ni ensuciar el diseño).
function marcaDeAgua(ctx: CanvasRenderingContext2D, W: number, H: number) {
  ctx.save()
  ctx.translate(W / 2, H / 2); ctx.rotate((-28 * Math.PI) / 180)
  ctx.fillStyle = '#f4f4f4'; ctx.font = '700 24px Arial'; ctx.textAlign = 'left'; ctx.letterSpacing = '4px'
  for (let yy = -H; yy < H; yy += 200) for (let xx = -W; xx < W; xx += 330) ctx.fillText('HAUSLINE', xx, yy)
  ctx.restore(); ctx.letterSpacing = '0px'
}

async function historiaJpeg(pedido: Pedido, opts: HistoriaOpts): Promise<Blob> {
  const W = 1080, H = 1920, CX = W / 2
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('No se pudo generar la historia.')

  // Fondo blanco + marca de agua + filo neón arriba.
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H)
  marcaDeAgua(ctx, W, H)
  ctx.fillStyle = GREEN; ctx.fillRect(0, 0, W, 6)

  // Encabezado de marca.
  marca(ctx, CX, 164)
  ctx.textAlign = 'center'; ctx.fillStyle = FAINT; ctx.font = '600 20px Arial'
  ctx.letterSpacing = '5px'; ctx.fillText('KING OF SHOES', CX, 205); ctx.letterSpacing = '0px'

  // Check de éxito (círculo negro + check neón).
  ctx.fillStyle = BLACK; ctx.beginPath(); ctx.arc(CX, 360, 66, 0, Math.PI * 2); ctx.fill()
  check(ctx, CX, 360, 120, GREEN, 11)

  // Titular + subtítulo.
  ctx.fillStyle = BLACK; ctx.textAlign = 'center'; ctx.font = '800 58px Arial'
  ctx.letterSpacing = '1px'; ctx.fillText('¡PEDIDO ENTREGADO!', CX, 540); ctx.letterSpacing = '0px'
  ctx.fillStyle = '#6b6b6b'; ctx.font = '400 27px Arial'
  ctx.fillText('Tu pedido fue entregado con éxito.', CX, 598)

  // Datos del pedido (anonimizados).
  const items = pedido.pedido_items ?? []
  const item = items.find((i) => i.imagen) ?? items[0]
  const nombreProducto = item?.producto ?? 'Tu pedido'
  const marcaProducto = (item?.marca ?? '').trim()
  const ciudad = (pedido.clientes?.ciudad || pedido.clientes?.departamento || 'Nicaragua').trim()
  const primerNombre = (pedido.clientes?.nombre ?? '').trim().split(/\s+/)[0] ?? ''

  // Tarjeta del producto (blanca con borde) + foto a la izquierda.
  const cardX = 110, cardY = 660, cardW = 860, cardH = 300
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.roundRect(cardX, cardY, cardW, cardH, 24); ctx.fill()
  ctx.strokeStyle = LINE_COL; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(cardX, cardY, cardW, cardH, 24); ctx.stroke()
  const foX = 145, foY = 700, foS = 220
  const img = item?.imagen ? await cargarImagen(resolverImagenCatalogo(item.imagen)) : null
  if (img) imagenCover(ctx, img, foX, foY, foS, foS, 18)
  else placeholderProducto(ctx, foX, foY, foS, foS, 18, marcaProducto || nombreProducto)

  // Texto de la tarjeta: marca (verde) + nombre (hasta 2 líneas) + badge ENTREGADO.
  const tX = 400
  ctx.textAlign = 'left'
  if (marcaProducto) {
    ctx.fillStyle = '#5a7d00'; ctx.font = '800 23px Arial'; ctx.letterSpacing = '3px'
    ctx.fillText(marcaProducto.toUpperCase(), tX, 748); ctx.letterSpacing = '0px'
  }
  ctx.fillStyle = BLACK; ctx.font = '800 34px Arial'
  const lineas = partirTexto(ctx, nombreProducto, cardW - (tX - cardX) - 40, 2)
  let ny = 800
  for (const linea of lineas) { ctx.fillText(linea, tX, ny); ny += 42 }
  const badgeY = 800 + (lineas.length - 1) * 42 + 30
  ctx.font = '800 21px Arial'; ctx.letterSpacing = '2px'
  const bTxt = 'ENTREGADO', bTxtW = ctx.measureText(bTxt).width
  const bw = 60 + bTxtW + 26, bh = 50
  ctx.fillStyle = GREEN; ctx.beginPath(); ctx.roundRect(tX, badgeY, bw, bh, bh / 2); ctx.fill()
  check(ctx, tX + 34, badgeY + bh / 2, 26, BLACK, 4)
  ctx.fillStyle = BLACK; ctx.textBaseline = 'middle'; ctx.fillText(bTxt, tX + 60, badgeY + bh / 2 + 1)
  ctx.textBaseline = 'alphabetic'; ctx.letterSpacing = '0px'

  // Referencia genérica (NUNCA el código real).
  ctx.fillStyle = FAINT; ctx.textAlign = 'center'; ctx.font = '700 19px Arial'
  ctx.letterSpacing = '3px'; ctx.fillText('PEDIDO VERIFICADO · HAUSLINE', CX, 1020); ctx.letterSpacing = '0px'

  // Seguimiento COMPLETO: barra negra + 4 puntos con check neón + etiquetas.
  ctx.fillStyle = FAINT; ctx.font = '700 19px Arial'; ctx.letterSpacing = '5px'
  ctx.fillText('SEGUIMIENTO DEL PEDIDO', CX, 1115); ctx.letterSpacing = '0px'
  const etapas = ['CONFIRMADO', 'EN PREPARACIÓN', 'EN CAMINO', 'ENTREGADO']
  const tL = 150, tR = W - 150, tY = 1210, col = (tR - tL) / (etapas.length - 1)
  ctx.strokeStyle = BLACK; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(tL, tY); ctx.lineTo(tR, tY); ctx.stroke()
  etapas.forEach((et, i) => {
    const x = tL + col * i
    ctx.fillStyle = BLACK; ctx.beginPath(); ctx.arc(x, tY, 15, 0, Math.PI * 2); ctx.fill()
    check(ctx, x, tY, 22, GREEN, 3.6)
    ctx.fillStyle = BLACK; ctx.textAlign = 'center'; ctx.font = '700 17px Arial'
    ctx.letterSpacing = '1px'; ctx.fillText(et, x, tY + 50); ctx.letterSpacing = '0px'
  })

  // Entrega verificada / ubicación (con o sin nombre según la opción).
  const quien = opts.mostrarNombre && primerNombre ? `${primerNombre} · ${ciudad}` : `Entrega verificada en ${ciudad}`
  ctx.fillStyle = BLACK; ctx.textAlign = 'center'; ctx.font = '800 24px Arial'; ctx.fillText(quien, CX, 1350)
  ctx.fillStyle = MUTED; ctx.font = '400 20px Arial'; ctx.fillText('Gracias por confiar en HAUSLINE.', CX, 1388)

  // Cuadro reservado para el sticker del sitio web (se coloca en Instagram).
  ctx.save()
  ctx.strokeStyle = '#d8d8d8'; ctx.lineWidth = 2; ctx.setLineDash([10, 8])
  ctx.fillStyle = '#fafafa'; ctx.beginPath(); ctx.roundRect(150, 1440, 780, 150, 20); ctx.fill(); ctx.stroke()
  ctx.restore()
  ctx.fillStyle = '#b9b9b9'; ctx.textAlign = 'center'; ctx.font = '700 22px Arial'
  ctx.fillText('Coloca aquí el sticker del sitio web', CX, 1508)
  ctx.fillStyle = '#cfcfcf'; ctx.font = '600 19px Arial'; ctx.fillText('hauslineshopni.es', CX, 1542)

  // Pie.
  ctx.strokeStyle = LINE_COL; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(150, 1700); ctx.lineTo(930, 1700); ctx.stroke()
  ctx.fillStyle = BLACK; ctx.font = '800 26px Arial'; ctx.letterSpacing = '7px'
  ctx.fillText('HAUSLINE', CX, 1762); ctx.letterSpacing = '0px'
  ctx.fillStyle = FAINT; ctx.font = '600 17px Arial'; ctx.letterSpacing = '4px'
  ctx.fillText('MODA PREMIUM. SIN LÍMITES.', CX, 1800); ctx.letterSpacing = '0px'
  ctx.textAlign = 'left'

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', .92))
  if (!blob) throw new Error('No se pudo generar la historia.')
  return blob
}

// Blob de la historia (para previsualizar).
export async function crearHistoriaBlob(pedido: Pedido, opts: HistoriaOpts) {
  return historiaJpeg(pedido, opts)
}

function historiaFile(blob: Blob, codigo: string) {
  return new File([blob], `Hausline-historia-${codigo}.jpg`, { type: 'image/jpeg' })
}

export async function descargarHistoria(pedido: Pedido, opts: HistoriaOpts) {
  const file = historiaFile(await historiaJpeg(pedido, opts), pedido.codigo)
  const url = URL.createObjectURL(file); const a = document.createElement('a')
  a.href = url; a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000)
  return 'downloaded' as const
}

// Comparte la historia (en celular abre el menú nativo para subirla directo a stories; en
// escritorio descarga la imagen).
export async function compartirHistoria(pedido: Pedido, opts: HistoriaOpts) {
  const file = historiaFile(await historiaJpeg(pedido, opts), pedido.codigo)
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Pedido entregado · HAUSLINE' }); return 'shared' as const }
    catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled' as const }
  }
  await descargarHistoria(pedido, opts)
  return 'downloaded' as const
}
