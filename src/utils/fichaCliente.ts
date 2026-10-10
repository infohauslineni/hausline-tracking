// Ficha para el CLIENTE de una compra libre: imagen 1080x1350 con la ESENCIA DE LA TIENDA
// (hauslineshopni.es: fondo crema, tinta negra, Jost + Cormorant Garamond) que muestra que el
// producto está en el sistema esperando ser apartado. Nunca lleva costo ni ganancia: solo lo que
// el cliente necesita (precio de la tienda, abono, llegada y etapa).

import { asegurarFuentesTienda } from './estiloTienda'

export type DatosFicha = {
  codigo: string
  producto: string
  marca: string | null
  talla: string | null
  unidades: number
  precio: number
  enCamino: boolean
  llegada: { desde: string; hasta: string } | null
  imagen: string | null
  fotosCalidad: string[]
  // Tipo de cambio del tracking (Configuración → moneda) para mostrar también en córdobas.
  tipoCambio: number
}

// Paleta y tipografías de la tienda (styles.css de hausline-web).
const FONDO = '#FCFBF9', PANEL = '#FFFFFF', LINEA = '#E7E3DC', LINEA_FUERTE = '#D8D2C8', TEXTO = '#171310', TENUE = '#6B655C', SUAVE = '#9C958A', FOTO = '#F1EFEA'
const SANS = 'Jost, "Segoe UI", Arial, Helvetica, sans-serif', SERIF = '"Cormorant Garamond", Georgia, "Times New Roman", serif'


function cargar(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image(); img.crossOrigin = 'anonymous'; img.decoding = 'async'
    img.onload = () => resolve(img); img.onerror = () => resolve(null); img.src = src
  })
}

function redondo(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
}

// Producto centrado en su cuadro (busca dónde está el producto, como ProductoImg) sobre su color de fondo.
function dibujarProducto(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  let fondo = '#ffffff', sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight
  try {
    const N = 96, k = N / Math.max(sw, sh), cw = Math.max(1, Math.round(sw * k)), chh = Math.max(1, Math.round(sh * k))
    const c = document.createElement('canvas'); c.width = cw; c.height = chh
    const t = c.getContext('2d', { willReadFrequently: true })!
    t.drawImage(img, 0, 0, cw, chh)
    const px = t.getImageData(0, 0, cw, chh).data
    const esq = [[0, 0], [cw - 1, 0], [0, chh - 1], [cw - 1, chh - 1]].map(([a, b]) => (b * cw + a) * 4)
    const f = [0, 1, 2].map((i) => esq.reduce((s, j) => s + px[j + i], 0) / 4)
    fondo = `rgb(${f.map(Math.round).join(',')})`
    let x0 = cw, y0 = chh, x1 = -1, y1 = -1
    for (let yy = 0; yy < chh; yy++) for (let xx = 0; xx < cw; xx++) {
      const i = (yy * cw + xx) * 4
      if (Math.abs(px[i] - f[0]) + Math.abs(px[i + 1] - f[1]) + Math.abs(px[i + 2] - f[2]) > 60) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy }
    }
    if (x1 > x0 && y1 > y0) { sx = x0 / k; sy = y0 / k; sw = (x1 - x0 + 1) / k; sh = (y1 - y0 + 1) / k }
  } catch { /* foto sin permiso de lectura: se muestra completa */ }
  ctx.save(); redondo(ctx, x, y, w, h, 6); ctx.clip()
  ctx.fillStyle = fondo; ctx.fillRect(x, y, w, h)
  const esc = Math.min((w * 0.84) / sw, (h * 0.84) / sh)
  const dw = sw * esc, dh = sh * esc
  ctx.drawImage(img, sx, sy, sw, sh, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
  ctx.restore()
}

function pastilla(ctx: CanvasRenderingContext2D, x: number, y: number, texto: string, llena: boolean) {
  ctx.font = `600 19px ${SANS}`; ctx.letterSpacing = '2.5px'
  const w = ctx.measureText(texto).width + 44, h = 46
  redondo(ctx, x, y, w, h, 4)
  if (llena) { ctx.fillStyle = TEXTO; ctx.fill() } else { ctx.strokeStyle = TEXTO; ctx.lineWidth = 1.5; ctx.stroke() }
  ctx.fillStyle = llena ? FONDO : TEXTO; ctx.textBaseline = 'middle'; ctx.fillText(texto, x + 22, y + h / 2 + 1)
  ctx.textBaseline = 'alphabetic'; ctx.letterSpacing = '0px'
  return w
}

function recortar(ctx: CanvasRenderingContext2D, t: string, max: number) {
  if (ctx.measureText(t).width <= max) return t
  while (t.length > 3 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1)
  return t.trimEnd() + '…'
}

const usd = (n: number) => '$' + (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const fechaCorta = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('es-NI', { day: 'numeric', month: 'short' }).replace('.', '')

// Córdobas como en el resto del sistema: se redondea hacia arriba al múltiplo de 10.
export const cordobas = (usdMonto: number, tc: number) => 'C$' + (Math.ceil((usdMonto * tc) / 10) * 10).toLocaleString('en-US')

export function textoLlegada(l: DatosFicha['llegada']) {
  if (!l) return 'Por confirmar'
  return l.desde === l.hasta ? fechaCorta(l.desde) : `${fechaCorta(l.desde)} – ${fechaCorta(l.hasta)}`
}

export async function generarFichaCliente(d: DatosFicha): Promise<Blob> {
  const W = 1080, H = 1350, M = 56
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H
  const ctx = cv.getContext('2d')!
  await asegurarFuentesTienda()
  ctx.fillStyle = FONDO; ctx.fillRect(0, 0, W, H)

  // Cabecera como la de la tienda: la marca centrada y espaciada, y debajo la consulta.
  ctx.textAlign = 'center'; ctx.fillStyle = TEXTO; ctx.font = `600 40px ${SANS}`
  ctx.letterSpacing = '17px'; ctx.fillText('HAUSLINE', W / 2 + 8, 92); ctx.letterSpacing = '0px'
  const ahora = new Date().toLocaleString('es-NI', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  ctx.font = `500 19px ${SANS}`; ctx.fillStyle = SUAVE; ctx.letterSpacing = '3px'
  ctx.fillText(`INVENTARIO EN TIEMPO REAL · ${ahora.toUpperCase()}`, W / 2, 132); ctx.letterSpacing = '0px'
  ctx.textAlign = 'left'
  ctx.strokeStyle = LINEA; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(M, 158); ctx.lineTo(W - M, 158); ctx.stroke()

  // Tarjeta principal.
  const cx = M, cy = 184, cw = W - 2 * M, ch = H - cy - 124
  ctx.fillStyle = PANEL; redondo(ctx, cx, cy, cw, ch, 10); ctx.fill(); ctx.strokeStyle = LINEA; ctx.lineWidth = 2; ctx.stroke()
  const px = cx + 32, pw = cw - 64
  const img = d.imagen ? await cargar(d.imagen) : null
  if (img) dibujarProducto(ctx, img, px, cy + 32, pw, 420)
  else { ctx.fillStyle = FOTO; redondo(ctx, px, cy + 32, pw, 420, 6); ctx.fill() }

  let y = cy + 32 + 420 + 52
  ctx.font = `500 20px ${SANS}`; ctx.fillStyle = SUAVE; ctx.letterSpacing = '4px'; ctx.fillText((d.codigo || 'HAUSLINE').toUpperCase(), px, y); ctx.letterSpacing = '0px'
  y += 56; ctx.font = `600 52px ${SERIF}`; ctx.fillStyle = TEXTO; ctx.fillText(recortar(ctx, d.producto, pw), px, y)
  y += 40; ctx.font = `400 25px ${SANS}`; ctx.fillStyle = TENUE
  ctx.fillText([d.marca, d.talla ? `Talla ${d.talla}` : null, `${d.unidades} ${d.unidades === 1 ? 'unidad' : 'unidades'}`].filter(Boolean).join(' · '), px, y)

  y += 34
  let x = px
  // Ya en Nicaragua = compra inmediata: se paga completo, sin apartado del 50%.
  x += pastilla(ctx, x, y, d.enCamino ? 'DISPONIBLE PARA APARTAR' : 'DISPONIBLE · COMPRA INMEDIATA', true) + 12
  if (d.enCamino) pastilla(ctx, x, y, 'EN CAMINO', false)

  // Números: precio · abono · llegada.
  y += 80
  const col = pw / 3
  // [etiqueta, valor, valor en córdobas (opcional)]
  const datos: [string, string, string?][] = d.enCamino
    ? [['Precio', usd(d.precio), cordobas(d.precio, d.tipoCambio)], ['Aparta con el 50%', usd(Math.ceil(d.precio / 2)), cordobas(Math.ceil(d.precio / 2), d.tipoCambio)], ['Llega aprox.', textoLlegada(d.llegada)]]
    : [['Precio', usd(d.precio), cordobas(d.precio, d.tipoCambio)], ['Pago', 'Completo'], ['Entrega', 'Inmediata']]
  ctx.fillStyle = FONDO; redondo(ctx, px, y, pw, 132, 6); ctx.fill()
  ctx.strokeStyle = LINEA; ctx.lineWidth = 2; ctx.stroke()
  datos.forEach(([et, val, cs], i) => {
    const xx = px + i * col
    if (i) { ctx.beginPath(); ctx.moveTo(xx, y + 18); ctx.lineTo(xx, y + 114); ctx.stroke() }
    ctx.textAlign = 'center'; ctx.font = `500 17px ${SANS}`; ctx.fillStyle = SUAVE; ctx.letterSpacing = '2.5px'; ctx.fillText(et.toUpperCase(), xx + col / 2, y + 38); ctx.letterSpacing = '0px'
    ctx.font = `600 37px ${SANS}`; ctx.fillStyle = TEXTO; ctx.fillText(val, xx + col / 2, cs ? y + 84 : y + 94)
    if (cs) { ctx.font = `400 21px ${SANS}`; ctx.fillStyle = TENUE; ctx.fillText(cs, xx + col / 2, y + 114) }
    ctx.textAlign = 'left'
  })

  // Etapas: comprado → preparación → control de calidad → en camino/Nicaragua.
  y += 170
  const hayQC = d.fotosCalidad.length > 0
  const etapas: [string, 'ok' | 'actual' | 'no'][] = d.enCamino
    ? [['Comprado', 'ok'], ['Preparación', hayQC ? 'ok' : 'actual'], ['Control de calidad', hayQC ? 'ok' : 'no'], ['En camino', hayQC ? 'actual' : 'no']]
    : [['Comprado', 'ok'], ['Control de calidad', 'ok'], ['En Nicaragua', 'ok'], ['Listo para entregar', 'actual']]
  const paso = pw / etapas.length
  ctx.strokeStyle = LINEA_FUERTE; ctx.lineWidth = 3
  ctx.beginPath(); ctx.moveTo(px + paso / 2, y); ctx.lineTo(px + pw - paso / 2, y); ctx.stroke()
  etapas.forEach(([nombre, est], i) => {
    const xx = px + paso * i + paso / 2
    if (est !== 'no' && i > 0) { ctx.strokeStyle = TEXTO; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(xx - paso, y); ctx.lineTo(xx, y); ctx.stroke() }
    // Hecha = punto negro; actual = punto negro con aro; pendiente = aro vacío.
    ctx.beginPath(); ctx.arc(xx, y, 11, 0, Math.PI * 2)
    if (est === 'no') { ctx.fillStyle = PANEL; ctx.fill(); ctx.strokeStyle = LINEA_FUERTE; ctx.lineWidth = 3; ctx.stroke() } else { ctx.fillStyle = TEXTO; ctx.fill() }
    if (est === 'actual') { ctx.strokeStyle = TEXTO; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(xx, y, 19, 0, Math.PI * 2); ctx.stroke() }
    ctx.textAlign = 'center'; ctx.font = `${est === 'actual' ? 600 : 400} 20px ${SANS}`; ctx.fillStyle = est === 'no' ? SUAVE : TEXTO
    ctx.fillText(nombre, xx, y + 50); ctx.textAlign = 'left'
  })
  // Estado en el sistema (lo que el cliente tiene que entender de un vistazo).
  ctx.textAlign = 'center'; ctx.font = `500 17px ${SANS}`; ctx.fillStyle = SUAVE; ctx.letterSpacing = '3px'
  ctx.fillText('ESTADO EN EL SISTEMA', W / 2, y + 96); ctx.letterSpacing = '0px'
  ctx.font = `600 38px ${SERIF}`; ctx.fillStyle = TEXTO
  ctx.fillText(d.enCamino ? 'Esperando ser apartado' : 'Listo para entregar', W / 2, y + 134); ctx.textAlign = 'left'

  // Pie: el aviso de las fotos de calidad solo mientras todavía no hay (con fotos, la etapa ya sale hecha).
  ctx.textAlign = 'center'
  if (d.enCamino && !hayQC) { ctx.font = `400 22px ${SANS}`; ctx.fillStyle = TENUE; ctx.fillText('Le compartimos las fotos de control de calidad apenas el proveedor las envíe.', W / 2, H - 70) }
  ctx.font = `500 24px ${SANS}`; ctx.fillStyle = TEXTO
  ctx.fillText(d.enCamino ? 'Se reserva con el primer abono confirmado · hauslineshopni.es' : 'Compra inmediata: ya está en Nicaragua · hauslineshopni.es', W / 2, d.enCamino && !hayQC ? H - 32 : H - 50)
  ctx.textAlign = 'left'

  return new Promise((resolve, reject) => cv.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen'))), 'image/png'))
}
