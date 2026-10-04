import { useEffect, useState } from 'react'

// Foto de producto CENTRADA: muchas fotos de catálogo traen el producto corrido a un lado o
// abajo (p. ej. los Golden Goose). Se analiza la foto en un canvas chiquito, se busca dónde
// está el producto (lo que no es el color de fondo) y se acomoda al centro del cuadro con un
// margen. El fondo del cuadro toma el color del fondo de la foto. Si no se puede analizar
// (foto de otro dominio sin permiso), se muestra completa (contain), que también queda centrada.

type Encuadre = { w: number; h: number; l: number; t: number; fondo: string }
const cache = new Map<string, Encuadre | null>()

function analizar(img: HTMLImageElement): Encuadre | null {
  const N = 72
  const W = img.naturalWidth, H = img.naturalHeight
  if (!W || !H) return null
  const k = N / Math.max(W, H)
  const cw = Math.max(1, Math.round(W * k)), ch = Math.max(1, Math.round(H * k))
  const canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, cw, ch)
  const px = ctx.getImageData(0, 0, cw, ch).data // lanza si la foto no permite leerse
  // Color de fondo = promedio de las 4 esquinas.
  const esquinas = [[0, 0], [cw - 1, 0], [0, ch - 1], [cw - 1, ch - 1]].map(([x, y]) => (y * cw + x) * 4)
  const fr = esquinas.reduce((a, i) => a + px[i], 0) / 4, fg = esquinas.reduce((a, i) => a + px[i + 1], 0) / 4, fb = esquinas.reduce((a, i) => a + px[i + 2], 0) / 4
  let x0 = cw, y0 = ch, x1 = -1, y1 = -1
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const i = (y * cw + x) * 4
    if (px[i + 3] < 30) continue
    const d = Math.abs(px[i] - fr) + Math.abs(px[i + 1] - fg) + Math.abs(px[i + 2] - fb)
    if (d > 60) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  }
  if (x1 < 0) return null
  const bw = (x1 - x0 + 1) / cw, bh = (y1 - y0 + 1) / ch
  // Si el producto ya llena casi toda la foto, no hace falta mover nada.
  if (bw > 0.92 && bh > 0.92) return null
  const cx = (x0 + x1 + 1) / 2 / cw, cy = (y0 + y1 + 1) / 2 / ch
  const m = Math.max(bw * W, bh * H)            // lado mayor del producto (px reales)
  const w = 84 * W / m, h = 84 * H / m          // tamaño de la foto en % del cuadro (producto al 84%)
  return { w, h, l: 50 - cx * w, t: 50 - cy * h, fondo: `rgb(${Math.round(fr)},${Math.round(fg)},${Math.round(fb)})` }
}

export function ProductoImg({ src, alt = '', className = '' }: { src: string; alt?: string; className?: string }) {
  const [enc, setEnc] = useState<Encuadre | null | undefined>(() => cache.has(src) ? cache.get(src) : undefined)
  useEffect(() => {
    if (!src || cache.has(src)) return
    let vivo = true
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.onload = () => { let e: Encuadre | null; try { e = analizar(img) } catch { e = null } cache.set(src, e); if (vivo) setEnc(e) }
    img.onerror = () => { cache.set(src, null); if (vivo) setEnc(null) }
    img.src = src
    return () => { vivo = false }
  }, [src])

  if (enc) return <span className={`relative block overflow-hidden ${className}`} style={{ background: enc.fondo }}>
    <img src={src} alt={alt} loading="lazy" crossOrigin="anonymous" className="absolute max-w-none" style={{ width: `${enc.w}%`, height: `${enc.h}%`, left: `${enc.l}%`, top: `${enc.t}%` }} />
  </span>
  return <span className={`relative block overflow-hidden bg-white ${className}`}>
    <img src={src} alt={alt} loading="lazy" crossOrigin="anonymous" className="size-full object-contain" />
  </span>
}
