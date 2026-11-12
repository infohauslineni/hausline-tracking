import { resolverImagenCatalogo } from '../utils/catalogoImagen'

// COTIZACIÓN PARA EL CLIENTE (imagen PNG): la vista limpia del Carrito privado, lista para mandar
// por WhatsApp. Solo lleva lo que el cliente debe ver: foto, nombre, tallas con cantidades, precio
// unitario, subtotales, total, fecha, n.º de cotización y notas. NUNCA el costo, la ganancia, el
// código interno ni si el precio es "mayorista" o "de tienda".
// Se dibuja a mano en un canvas (como la factura): es lo más fiable en iPhone y Android.

export type CotizacionLinea = { nombre: string; imagen: string | null; tallas: { talla: string; cantidad: number }[]; cantidad: number; precio: number; subtotal: number }
export type CotizacionData = {
  numero: string
  fecha: Date
  cliente: string | null
  lineas: CotizacionLinea[]
  total: number
  totalCs: string
  pago: '50' | 'total'
  aPagar: number
  aPagarCs: string
  entrega: string
}

export const NEON = '#36FBA1'
const FONDO = '#0A0A0A', TARJETA = '#141414', LINEA = '#262626', TEXTO = '#FFFFFF', SUAVE = '#A3A09A', TENUE = '#6E6B66'
const DISPLAY = '"Bricolage Grotesque", "Hanken Grotesk", Arial, sans-serif'
const CUERPO = '"Hanken Grotesk", Arial, sans-serif'
export const SITIO = 'hauslineshopni.es'

export const usdCot = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`
export const fechaCot = (d: Date) => new Intl.DateTimeFormat('es-NI', { day: 'numeric', month: 'long', year: 'numeric' }).format(d)
export const tallasTexto = (l: CotizacionLinea) => l.tallas.map((t) => `${t.talla} × ${t.cantidad}`).join('  ·  ')

// Notas al cliente (de "usted"), compartidas por la vista en pantalla y la imagen.
export function notasCotizacion(d: CotizacionData) {
  return [
    `Entrega estimada: ${d.entrega}.`,
    d.pago === '50'
      ? `Para confirmar su pedido se paga el 50 % de anticipo (${usdCot(d.aPagar)} · ${d.aPagarCs}); el resto lo paga al recibir.`
      : `Para confirmar su pedido se paga el total (${usdCot(d.aPagar)} · ${d.aPagarCs}).`,
    'Precios válidos por 48 horas. Con gusto le atendemos cualquier consulta por WhatsApp.',
  ]
}

function cargarImagen(url: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    if (!url) { resolve(null); return }
    const img = new Image()
    img.crossOrigin = 'anonymous' // si el servidor no da permiso, falla en vez de "contaminar" el canvas
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

function dibujarCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const ir = img.width / img.height, r = w / h
  let sw: number, sh: number, sx: number, sy: number
  if (ir > r) { sh = img.height; sw = sh * r; sx = (img.width - sw) / 2; sy = 0 } else { sw = img.width; sh = sw / r; sx = 0; sy = (img.height - sh) / 2 }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h)
}

// Parte un texto en renglones que entren en `ancho` (máximo `max` renglones, el último con "…").
function renglones(ctx: CanvasRenderingContext2D, texto: string, ancho: number, max: number) {
  const palabras = texto.split(/\s+/).filter(Boolean)
  const out: string[] = []
  let actual = ''
  for (const p of palabras) {
    const prueba = actual ? `${actual} ${p}` : p
    if (ctx.measureText(prueba).width <= ancho) { actual = prueba; continue }
    if (actual) out.push(actual)
    actual = p
    if (out.length === max) break
  }
  if (out.length < max && actual) out.push(actual)
  if (out.length > max) out.length = max
  const usadas = out.join(' ').split(/\s+/).length
  if (usadas < palabras.length && out.length) {
    let u = out[out.length - 1]
    while (u.length > 1 && ctx.measureText(`${u}…`).width > ancho) u = u.slice(0, -1)
    out[out.length - 1] = `${u}…`
  }
  return out
}

// Logo HAUSLINE: la "H" con el punto de rastreo (igual al del panel).
function dibujarLogo(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  const k = s / 48
  ctx.fillStyle = NEON; ctx.beginPath(); ctx.roundRect(x, y, s, s, 13 * k); ctx.fill()
  ctx.fillStyle = FONDO
  ctx.beginPath(); ctx.roundRect(x + 12.6 * k, y + 11.5 * k, 5.4 * k, 25 * k, 2.7 * k); ctx.fill()
  ctx.beginPath(); ctx.roundRect(x + 30 * k, y + 11.5 * k, 5.4 * k, 25 * k, 2.7 * k); ctx.fill()
  ctx.beginPath(); ctx.roundRect(x + 15.5 * k, y + 21.3 * k, 17 * k, 5.4 * k, 2.7 * k); ctx.fill()
  ctx.beginPath(); ctx.arc(x + 24 * k, y + 24 * k, 4.9 * k, 0, Math.PI * 2); ctx.fillStyle = '#FFFFFF'; ctx.fill()
  ctx.lineWidth = 2.6 * k; ctx.strokeStyle = FONDO; ctx.stroke()
}

export async function crearCotizacionPng(d: CotizacionData): Promise<File> {
  try { await Promise.all([document.fonts.load(`700 40px ${DISPLAY}`), document.fonts.load(`500 24px ${CUERPO}`), document.fonts.load(`700 24px ${CUERPO}`)]) } catch { /* sigue con la letra de respaldo */ }
  const fotos = await Promise.all(d.lineas.map((l) => cargarImagen(resolverImagenCatalogo(l.imagen))))

  const W = 1080, PAD = 64, FOTO = 150
  const medir = document.createElement('canvas').getContext('2d')!
  // Alto de cada producto: nombre (hasta 2 renglones) + tallas (hasta 3 renglones).
  const altos = d.lineas.map((l) => {
    medir.font = `700 34px ${CUERPO}`
    const n = renglones(medir, l.nombre, W - PAD * 2 - FOTO - 60 - 230, 2).length
    medir.font = `500 26px ${CUERPO}`
    const t = l.tallas.length ? renglones(medir, tallasTexto(l), W - PAD * 2 - FOTO - 60 - 230, 3).length : 0
    return Math.max(FOTO + 48, 40 + n * 42 + (t ? 12 + t * 34 : 0) + 56)
  })
  medir.font = `500 26px ${CUERPO}`
  const notas = notasCotizacion(d).map((n) => renglones(medir, n, W - PAD * 2 - 60, 4))
  const altoNotas = notas.reduce((s, r) => s + r.length * 38 + 14, 0)
  const H = 330 + (d.cliente ? 70 : 0) + 70 + altos.reduce((s, a) => s + a, 0) + 40 + 190 + 60 + altoNotas + 60 + 140

  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = FONDO; ctx.fillRect(0, 0, W, H)
  // Brillo verde sutil arriba a la derecha.
  const brillo = ctx.createRadialGradient(W - 120, 60, 10, W - 120, 60, 520)
  brillo.addColorStop(0, 'rgba(54,251,161,0.16)'); brillo.addColorStop(1, 'rgba(54,251,161,0)')
  ctx.fillStyle = brillo; ctx.fillRect(0, 0, W, 620)

  // Encabezado: logo + HAUSLINE + cotización.
  let y = PAD
  dibujarLogo(ctx, PAD, y, 84)
  ctx.fillStyle = TEXTO; ctx.font = `800 46px ${DISPLAY}`; ctx.textBaseline = 'alphabetic'
  ctx.fillText('HAUSLINE', PAD + 108, y + 52)
  ctx.fillStyle = SUAVE; ctx.font = `500 24px ${CUERPO}`; ctx.fillText('King of Shoes', PAD + 110, y + 84)
  ctx.textAlign = 'right'
  ctx.fillStyle = NEON; ctx.font = `700 24px ${CUERPO}`; ctx.fillText('COTIZACIÓN', W - PAD, y + 30)
  ctx.fillStyle = TEXTO; ctx.font = `700 34px ${DISPLAY}`; ctx.fillText(`N.º ${d.numero}`, W - PAD, y + 70)
  ctx.fillStyle = SUAVE; ctx.font = `500 24px ${CUERPO}`; ctx.fillText(fechaCot(d.fecha), W - PAD, y + 104)
  ctx.textAlign = 'left'
  y += 150
  ctx.fillStyle = NEON; ctx.fillRect(PAD, y, W - PAD * 2, 3)
  y += 60
  if (d.cliente) {
    ctx.fillStyle = SUAVE; ctx.font = `600 22px ${CUERPO}`; ctx.fillText('PREPARADA PARA', PAD, y)
    ctx.fillStyle = TEXTO; ctx.font = `700 34px ${CUERPO}`; ctx.fillText(d.cliente, PAD, y + 44)
    y += 100
  }
  ctx.fillStyle = TENUE; ctx.font = `700 21px ${CUERPO}`
  ctx.fillText('PRODUCTO', PAD, y); ctx.textAlign = 'right'; ctx.fillText('SUBTOTAL', W - PAD, y); ctx.textAlign = 'left'
  y += 28

  // Productos.
  d.lineas.forEach((l, i) => {
    const alto = altos[i]
    ctx.fillStyle = TARJETA; ctx.beginPath(); ctx.roundRect(PAD, y, W - PAD * 2, alto - 18, 26); ctx.fill()
    const fx = PAD + 24, fy = y + 24
    ctx.save(); ctx.beginPath(); ctx.roundRect(fx, fy, FOTO, FOTO, 18); ctx.clip()
    if (fotos[i]) { ctx.fillStyle = '#FFFFFF'; ctx.fillRect(fx, fy, FOTO, FOTO); dibujarCover(ctx, fotos[i]!, fx, fy, FOTO, FOTO) } else { ctx.fillStyle = '#1F1F1F'; ctx.fillRect(fx, fy, FOTO, FOTO) }
    ctx.restore()
    const tx = fx + FOTO + 30, ancho = W - PAD * 2 - FOTO - 60 - 230
    let ty = y + 62
    ctx.fillStyle = TEXTO; ctx.font = `700 34px ${CUERPO}`
    for (const r of renglones(ctx, l.nombre, ancho, 2)) { ctx.fillText(r, tx, ty); ty += 42 }
    if (l.tallas.length) {
      ty += 6
      ctx.fillStyle = NEON; ctx.font = `600 26px ${CUERPO}`
      for (const r of renglones(ctx, tallasTexto(l), ancho, 3)) { ctx.fillText(r, tx, ty); ty += 34 }
    }
    ctx.fillStyle = SUAVE; ctx.font = `500 25px ${CUERPO}`
    ctx.fillText(`${l.cantidad} ${l.cantidad === 1 ? 'unidad' : 'unidades'} × ${usdCot(l.precio)}`, tx, Math.max(ty + 10, y + alto - 50))
    ctx.textAlign = 'right'
    ctx.fillStyle = TEXTO; ctx.font = `800 38px ${DISPLAY}`; ctx.fillText(usdCot(l.subtotal), W - PAD - 28, y + 66)
    ctx.textAlign = 'left'
    y += alto
  })

  // Total.
  y += 22
  ctx.fillStyle = NEON; ctx.beginPath(); ctx.roundRect(PAD, y, W - PAD * 2, 170, 28); ctx.fill()
  ctx.fillStyle = FONDO; ctx.font = `700 26px ${CUERPO}`
  const unidades = d.lineas.reduce((s, l) => s + l.cantidad, 0)
  ctx.fillText(`TOTAL · ${unidades} ${unidades === 1 ? 'unidad' : 'unidades'}`, PAD + 36, y + 64)
  ctx.font = `500 26px ${CUERPO}`; ctx.fillText(d.totalCs, PAD + 36, y + 112)
  ctx.textAlign = 'right'; ctx.font = `800 76px ${DISPLAY}`; ctx.fillText(usdCot(d.total), W - PAD - 36, y + 112); ctx.textAlign = 'left'
  y += 230

  // Notas.
  ctx.fillStyle = SUAVE; ctx.font = `700 22px ${CUERPO}`; ctx.fillText('NOTAS', PAD, y)
  y += 44
  ctx.font = `500 26px ${CUERPO}`
  for (const n of notas) {
    ctx.fillStyle = NEON; ctx.beginPath(); ctx.arc(PAD + 10, y - 9, 6, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = TEXTO
    for (const r of n) { ctx.fillText(r, PAD + 36, y); y += 38 }
    y += 14
  }

  // Pie.
  const pieY = H - 110
  ctx.fillStyle = LINEA; ctx.fillRect(PAD, pieY - 30, W - PAD * 2, 2)
  ctx.textAlign = 'center'
  ctx.fillStyle = NEON; ctx.font = `800 34px ${DISPLAY}`; ctx.fillText(SITIO, W / 2, pieY + 22)
  ctx.fillStyle = TENUE; ctx.font = `500 22px ${CUERPO}`; ctx.fillText('Gracias por preferir HAUSLINE', W / 2, pieY + 60)
  ctx.textAlign = 'left'

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('No se pudo crear la imagen.')
  return new File([blob], `Cotizacion-HAUSLINE-${d.numero}.png`, { type: 'image/png' })
}

// En el celular abre el menú de compartir (WhatsApp) con la imagen; en la computadora la descarga.
export async function descargarOCompartirCotizacion(d: CotizacionData): Promise<'compartida' | 'descargada' | 'cancelada'> {
  const file = await crearCotizacionPng(d)
  const movil = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  if (movil && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `Cotización HAUSLINE ${d.numero}`, text: d.cliente ? `Hola ${d.cliente.split(/\s+/)[0]}, le compartimos su cotización de HAUSLINE.` : 'Le compartimos su cotización de HAUSLINE.' })
      return 'compartida'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelada'
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a'); a.href = url; a.download = file.name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  return 'descargada'
}
