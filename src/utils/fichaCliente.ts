// Ficha para el CLIENTE de una compra libre: imagen 1080x1350 con el look del panel (fondo oscuro,
// acento lima) que muestra que el producto está en el sistema esperando ser apartado. Nunca lleva
// costo ni ganancia: solo lo que el cliente necesita (precio de la tienda, abono, llegada y etapa).

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
}

const FONDO = '#080a09', PANEL = '#0f1311', LINEA = 'rgba(255,255,255,.09)', TEXTO = '#ffffff', TENUE = '#8c948f', LIMA = '#b7ff00', AMBAR = '#fcd34d'
const SANS = '"Segoe UI", Arial, Helvetica, sans-serif', MONO = 'Consolas, "Courier New", monospace'

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
  ctx.save(); redondo(ctx, x, y, w, h, 26); ctx.clip()
  ctx.fillStyle = fondo; ctx.fillRect(x, y, w, h)
  const esc = Math.min((w * 0.84) / sw, (h * 0.84) / sh)
  const dw = sw * esc, dh = sh * esc
  ctx.drawImage(img, sx, sy, sw, sh, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
  ctx.restore()
}

function pastilla(ctx: CanvasRenderingContext2D, x: number, y: number, texto: string, color: string, punto = false) {
  ctx.font = `700 22px ${SANS}`
  const w = ctx.measureText(texto).width + (punto ? 62 : 40), h = 46
  ctx.fillStyle = color + '1f'; redondo(ctx, x, y, w, h, h / 2); ctx.fill()
  ctx.strokeStyle = color + '66'; ctx.lineWidth = 2; ctx.stroke()
  if (punto) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x + 24, y + h / 2, 7, 0, Math.PI * 2); ctx.fill() }
  ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.fillText(texto, x + (punto ? 42 : 20), y + h / 2 + 1)
  ctx.textBaseline = 'alphabetic'
  return w
}

function recortar(ctx: CanvasRenderingContext2D, t: string, max: number) {
  if (ctx.measureText(t).width <= max) return t
  while (t.length > 3 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1)
  return t.trimEnd() + '…'
}

const usd = (n: number) => '$' + (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const fechaCorta = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('es-NI', { day: 'numeric', month: 'short' }).replace('.', '')

export function textoLlegada(l: DatosFicha['llegada']) {
  if (!l) return 'Por confirmar'
  return l.desde === l.hasta ? fechaCorta(l.desde) : `${fechaCorta(l.desde)} – ${fechaCorta(l.hasta)}`
}

export async function generarFichaCliente(d: DatosFicha): Promise<Blob> {
  const W = 1080, H = 1350, M = 56
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H
  const ctx = cv.getContext('2d')!
  ctx.fillStyle = FONDO; ctx.fillRect(0, 0, W, H)
  // Halo lima muy suave arriba a la derecha (como el panel).
  const g = ctx.createRadialGradient(W * 0.85, 60, 10, W * 0.85, 60, 520); g.addColorStop(0, 'rgba(183,255,0,.10)'); g.addColorStop(1, 'rgba(183,255,0,0)')
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)

  // Barra superior: marca + sistema operativo + hora de la consulta.
  ctx.fillStyle = TEXTO; ctx.font = `800 34px ${SANS}`
  ctx.letterSpacing = '10px'; ctx.fillText('HAUSLINE', M, 92); ctx.letterSpacing = '0px'
  ctx.font = `600 22px ${SANS}`; ctx.fillStyle = TENUE; ctx.textAlign = 'right'
  ctx.fillText('Inventario en tiempo real', W - M, 78)
  const ahora = new Date().toLocaleString('es-NI', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  ctx.font = `500 20px ${SANS}`; ctx.fillText('Consultado: ' + ahora, W - M, 108)
  ctx.textAlign = 'left'
  ctx.fillStyle = LIMA; ctx.beginPath(); ctx.arc(M + 4, 132, 6, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = TENUE; ctx.font = `600 20px ${SANS}`; ctx.fillText('Sistema operativo', M + 20, 139)

  // Tarjeta principal.
  const cx = M, cy = 172, cw = W - 2 * M, ch = H - cy - 124
  ctx.fillStyle = PANEL; redondo(ctx, cx, cy, cw, ch, 34); ctx.fill(); ctx.strokeStyle = LINEA; ctx.lineWidth = 2; ctx.stroke()
  const px = cx + 32, pw = cw - 64
  const img = d.imagen ? await cargar(d.imagen) : null
  if (img) dibujarProducto(ctx, img, px, cy + 32, pw, 420)
  else { ctx.fillStyle = '#1a1f1c'; redondo(ctx, px, cy + 32, pw, 420, 26); ctx.fill() }

  let y = cy + 32 + 420 + 52
  ctx.font = `700 24px ${MONO}`; ctx.fillStyle = LIMA; ctx.fillText(d.codigo || 'HAUSLINE', px, y)
  y += 52; ctx.font = `700 42px ${SANS}`; ctx.fillStyle = TEXTO; ctx.fillText(recortar(ctx, d.producto, pw), px, y)
  y += 40; ctx.font = `500 25px ${SANS}`; ctx.fillStyle = TENUE
  ctx.fillText([d.marca, d.talla ? `Talla ${d.talla}` : null, `${d.unidades} ${d.unidades === 1 ? 'unidad' : 'unidades'}`].filter(Boolean).join(' · '), px, y)

  y += 34
  let x = px
  x += pastilla(ctx, x, y, 'DISPONIBLE PARA APARTAR', LIMA, true) + 12
  if (d.enCamino) pastilla(ctx, x, y, 'EN CAMINO', AMBAR)

  // Números: precio · abono · llegada.
  y += 80
  const col = pw / 3
  const datos: [string, string, string][] = [['Precio', usd(d.precio), TEXTO], ['Aparta con el 50%', usd(Math.ceil(d.precio / 2)), LIMA], [d.enCamino ? 'Llega aprox.' : 'Entrega', d.enCamino ? textoLlegada(d.llegada) : 'Inmediata', d.enCamino ? AMBAR : TEXTO]]
  ctx.strokeStyle = LINEA; ctx.lineWidth = 2
  redondo(ctx, px, y, pw, 122, 20); ctx.stroke()
  datos.forEach(([et, val, color], i) => {
    const xx = px + i * col
    if (i) { ctx.beginPath(); ctx.moveTo(xx, y + 18); ctx.lineTo(xx, y + 104); ctx.stroke() }
    ctx.textAlign = 'center'; ctx.font = `600 19px ${SANS}`; ctx.fillStyle = TENUE; ctx.fillText(et.toUpperCase(), xx + col / 2, y + 44)
    ctx.font = `800 36px ${SANS}`; ctx.fillStyle = color; ctx.fillText(val, xx + col / 2, y + 92); ctx.textAlign = 'left'
  })

  // Etapas: comprado → preparación → control de calidad → en camino/Nicaragua.
  y += 170
  const hayQC = d.fotosCalidad.length > 0
  const etapas: [string, 'ok' | 'actual' | 'no'][] = d.enCamino
    ? [['Comprado', 'ok'], ['Preparación', hayQC ? 'ok' : 'actual'], ['Control de calidad', hayQC ? 'ok' : 'no'], ['En camino', hayQC ? 'actual' : 'no']]
    : [['Comprado', 'ok'], ['Control de calidad', 'ok'], ['En Nicaragua', 'ok'], ['Listo para entregar', 'actual']]
  const paso = pw / etapas.length
  ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 4
  ctx.beginPath(); ctx.moveTo(px + paso / 2, y); ctx.lineTo(px + pw - paso / 2, y); ctx.stroke()
  etapas.forEach(([nombre, est], i) => {
    const xx = px + paso * i + paso / 2
    if (est !== 'no' && i > 0) { ctx.strokeStyle = LIMA; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(xx - paso, y); ctx.lineTo(xx, y); ctx.stroke() }
    ctx.beginPath(); ctx.arc(xx, y, est === 'actual' ? 15 : 12, 0, Math.PI * 2)
    ctx.fillStyle = est === 'ok' ? LIMA : est === 'actual' ? AMBAR : '#2a302c'; ctx.fill()
    if (est === 'actual') { ctx.strokeStyle = AMBAR + '55'; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(xx, y, 22, 0, Math.PI * 2); ctx.stroke() }
    ctx.textAlign = 'center'; ctx.font = `${est === 'actual' ? 700 : 500} 20px ${SANS}`; ctx.fillStyle = est === 'no' ? TENUE : TEXTO
    ctx.fillText(nombre, xx, y + 50); ctx.textAlign = 'left'
  })
  // Estado en el sistema (lo que el cliente tiene que entender de un vistazo).
  ctx.textAlign = 'center'; ctx.font = `600 21px ${SANS}`; ctx.fillStyle = TENUE
  ctx.fillText('ESTADO EN EL SISTEMA', W / 2, y + 98)
  ctx.font = `800 30px ${SANS}`; ctx.fillStyle = LIMA
  ctx.fillText('Esperando ser apartado', W / 2, y + 134); ctx.textAlign = 'left'

  // Pie: control de calidad + cómo apartar.
  ctx.textAlign = 'center'
  ctx.font = `500 23px ${SANS}`; ctx.fillStyle = TENUE
  ctx.fillText(hayQC ? 'Las fotos de control de calidad ya están listas: se las compartimos.' : 'Le compartimos las fotos de control de calidad apenas el proveedor las envíe.', W / 2, H - 70)
  ctx.font = `700 25px ${SANS}`; ctx.fillStyle = TEXTO
  ctx.fillText('Se reserva con el primer abono confirmado · hauslineshopni.es', W / 2, H - 32)
  ctx.textAlign = 'left'

  return new Promise((resolve, reject) => cv.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen'))), 'image/png'))
}
