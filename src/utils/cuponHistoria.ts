import type { Cupon } from '../types/domain'

// Genera una imagen 9:16 (1080×1920, formato historia de Instagram) con el cupón, lista para
// compartir. En móvil usa el menú nativo de compartir (para subirla a IG Stories); en
// escritorio la descarga como PNG.

const ACCENT = '#b7ff00'

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radio = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radio, y)
  ctx.arcTo(x + w, y, x + w, y + h, radio)
  ctx.arcTo(x + w, y + h, x, y + h, radio)
  ctx.arcTo(x, y + h, x, y, radio)
  ctx.arcTo(x, y, x + w, y, radio)
  ctx.closePath()
}

// Dibuja texto centrado reduciendo el tamaño de fuente hasta que quepa en maxWidth.
function textoAjustado(ctx: CanvasRenderingContext2D, texto: string, x: number, y: number, maxWidth: number, pesoTamano: (px: number) => string, pxInicial: number) {
  let px = pxInicial
  ctx.font = pesoTamano(px)
  while (ctx.measureText(texto).width > maxWidth && px > 24) { px -= 4; ctx.font = pesoTamano(px) }
  ctx.fillText(texto, x, y)
  return px
}

const fmtFecha = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}` }

export function generarHistoriaCupon(cupon: Cupon): Promise<Blob> {
  const W = 1080, H = 1920
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')!
  const cx = W / 2

  // Fondo oscuro con un leve degradado y un resplandor verde arriba.
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, '#0e120b'); g.addColorStop(0.5, '#070807'); g.addColorStop(1, '#050505')
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  const glow = ctx.createRadialGradient(cx, 620, 40, cx, 620, 720)
  glow.addColorStop(0, 'rgba(183,255,0,0.16)'); glow.addColorStop(1, 'rgba(183,255,0,0)')
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H)

  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'

  // Marca: HAUS (blanco) + LINE (verde).
  ctx.font = '800 104px "Helvetica Neue", Arial, sans-serif'
  const p1 = 'HAUS', p2 = 'LINE'
  const w1 = ctx.measureText(p1).width, w2 = ctx.measureText(p2).width
  const startX = cx - (w1 + w2) / 2
  ctx.textAlign = 'left'
  ctx.fillStyle = '#f3f6f3'; ctx.fillText(p1, startX, 250)
  ctx.fillStyle = ACCENT; ctx.fillText(p2, startX + w1, 250)
  ctx.textAlign = 'center'
  try { ctx.letterSpacing = '10px' } catch { /* navegador viejo */ }
  ctx.font = '700 30px "Helvetica Neue", Arial, sans-serif'
  ctx.fillStyle = '#8a938d'; ctx.fillText('KING OF SHOES', cx, 305)
  try { ctx.letterSpacing = '0px' } catch { /* noop */ }

  // Tarjeta central.
  const cardX = 80, cardY = 470, cardW = W - 160, cardH = 1060
  ctx.fillStyle = 'rgba(255,255,255,0.03)'
  roundRect(ctx, cardX, cardY, cardW, cardH, 48); ctx.fill()
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(183,255,0,0.35)'
  roundRect(ctx, cardX, cardY, cardW, cardH, 48); ctx.stroke()

  // Etiqueta.
  try { ctx.letterSpacing = '8px' } catch { /* noop */ }
  ctx.font = '700 34px "Helvetica Neue", Arial, sans-serif'
  ctx.fillStyle = ACCENT; ctx.fillText('CÓDIGO DE DESCUENTO', cx, cardY + 120)
  try { ctx.letterSpacing = '0px' } catch { /* noop */ }

  // Titular del descuento (grande).
  const headline = cupon.tipo === 'porcentaje' ? `${Number(cupon.valor)}%` : `US$ ${Number(cupon.valor).toFixed(2)}`
  ctx.fillStyle = '#ffffff'
  textoAjustado(ctx, headline, cx, cardY + 330, cardW - 120, (px) => `800 ${px}px "Helvetica Neue", Arial, sans-serif`, 220)
  ctx.font = '600 46px "Helvetica Neue", Arial, sans-serif'
  ctx.fillStyle = '#b9c2ba'
  ctx.fillText(cupon.tipo === 'porcentaje' ? 'de descuento en tu pedido' : 'de descuento', cx, cardY + 400)

  // Pastilla con el código.
  const pillW = cardW - 120, pillX = cardX + 60, pillY = cardY + 470, pillH = 150
  ctx.fillStyle = ACCENT
  roundRect(ctx, pillX, pillY, pillW, pillH, 28); ctx.fill()
  ctx.fillStyle = '#0a0b0a'
  textoAjustado(ctx, cupon.codigo, cx, pillY + pillH / 2 + 30, pillW - 60, (px) => `800 ${px}px "SF Mono", Menlo, Consolas, monospace`, 92)

  // Instrucciones.
  ctx.font = '500 40px "Helvetica Neue", Arial, sans-serif'
  ctx.fillStyle = '#b9c2ba'
  ctx.fillText('Escribí este código al encargar en', cx, pillY + pillH + 130)
  ctx.font = '800 56px "Helvetica Neue", Arial, sans-serif'
  ctx.fillStyle = ACCENT
  ctx.fillText('hauslineshopni.es', cx, pillY + pillH + 200)

  // Detalles opcionales (vencimiento).
  let detalleY = cardY + cardH - 60
  if (cupon.vence_el) {
    ctx.font = '600 34px "Helvetica Neue", Arial, sans-serif'
    ctx.fillStyle = '#8a938d'
    ctx.fillText(`Válido hasta ${fmtFecha(cupon.vence_el)}`, cx, detalleY)
    detalleY -= 46
  }
  if (cupon.usos_max === 1) {
    ctx.font = '600 34px "Helvetica Neue", Arial, sans-serif'
    ctx.fillStyle = '#8a938d'
    ctx.fillText('Cupón de un solo uso', cx, detalleY)
  }

  // Pie.
  ctx.font = '600 36px "Helvetica Neue", Arial, sans-serif'
  ctx.fillStyle = '#6b746d'
  ctx.fillText('@hausline.ni  ·  Envíos a toda Nicaragua', cx, H - 120)

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('No se pudo generar la imagen.')), 'image/png')
  })
}

// Comparte (móvil) o descarga (escritorio) la historia del cupón. Devuelve qué hizo.
export async function compartirHistoriaCupon(cupon: Cupon): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const blob = await generarHistoriaCupon(cupon)
  const file = new File([blob], `cupon-${cupon.codigo}.png`, { type: 'image/png' })
  const nav = navigator as Navigator & { canShare?: (data?: ShareData) => boolean }
  if (nav.canShare && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: `Cupón ${cupon.codigo}`, text: `Usá el código ${cupon.codigo} en hauslineshopni.es` } as ShareData)
      return 'shared'
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return 'cancelled'
      // Si compartir falla por otra razón, caemos a la descarga.
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = file.name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return 'downloaded'
}
