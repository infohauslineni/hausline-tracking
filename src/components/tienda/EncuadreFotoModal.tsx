import { Crosshair, LoaderCircle, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { toast } from 'sonner'
import { Modal } from '../ui/Modal'

// ENCUADRAR UNA FOTO: el recuadro es igual a la tarjeta de la tienda (cuadrado). Se arrastra la
// foto para moverla y se agranda/achica con la barra, la rueda o dos dedos. Lo que queda fuera
// de la foto se rellena con el color de su fondo. Al aplicar se crea una foto NUEVA (JPEG
// 1600×1600) que reemplaza a la original al guardar el producto: así sale centrada en todos
// lados (tarjeta, ficha del producto, Instagram, Google).

const LADO = 1600
type Pos = { z: number; cx: number; cy: number }
const INICIO: Pos = { z: 1, cx: 0.5, cy: 0.5 }
const limitar = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n))

async function cargarImagen(src: string): Promise<HTMLImageElement> {
  // Se baja como blob para poder dibujarla en el canvas sin que el navegador la bloquee.
  let url = src
  if (!/^(blob:|data:)/.test(src)) {
    const r = await fetch(src, { mode: 'cors', cache: 'force-cache' })
    if (!r.ok) throw new Error('foto')
    url = URL.createObjectURL(await r.blob())
  }
  return await new Promise((ok, mal) => { const img = new Image(); img.onload = () => ok(img); img.onerror = () => mal(new Error('foto')); img.src = url })
}

// Color del fondo de la foto: promedio de las 4 esquinas.
function colorFondo(img: HTMLImageElement) {
  const c = document.createElement('canvas'); c.width = 40; c.height = 40
  const ctx = c.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(img, 0, 0, 40, 40)
  const px = [[1, 1], [38, 1], [1, 38], [38, 38]].map(([x, y]) => ctx.getImageData(x, y, 1, 1).data)
  const prom = (k: number) => Math.round(px.reduce((s, p) => s + p[k], 0) / px.length)
  const hex = (n: number) => n.toString(16).padStart(2, '0')
  return `#${hex(prom(0))}${hex(prom(1))}${hex(prom(2))}`
}

// Dónde está el producto dentro de la foto (lo que no es fondo), en fracciones de 0 a 1.
function cajaProducto(img: HTMLImageElement, fondo: string) {
  const esc = Math.min(1, 300 / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * esc)), h = Math.max(1, Math.round(img.naturalHeight * esc))
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(img, 0, 0, w, h)
  const d = ctx.getImageData(0, 0, w, h).data
  const fr = parseInt(fondo.slice(1, 3), 16), fg = parseInt(fondo.slice(3, 5), 16), fb = parseInt(fondo.slice(5, 7), 16)
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4
    if (Math.abs(d[i] - fr) + Math.abs(d[i + 1] - fg) + Math.abs(d[i + 2] - fb) > 60) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  }
  if (x1 < 0) return null
  return { x0: x0 / w, y0: y0 / h, x1: (x1 + 1) / w, y1: (y1 + 1) / h }
}

export function EncuadreFotoModal({ src, onClose, onListo }: { src: string | null; onClose: () => void; onListo: (file: File) => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [error, setError] = useState(false)
  const [pos, setPos] = useState<Pos>(INICIO)
  const [fondoFoto, setFondoFoto] = useState('#ffffff')
  const [fondo, setFondo] = useState('#ffffff')
  const [aplicando, setAplicando] = useState(false)
  const escenario = useRef<HTMLDivElement>(null)
  const punteros = useRef(new Map<number, { x: number; y: number }>())
  const pellizco = useRef<{ dist: number; z: number } | null>(null)

  useEffect(() => {
    if (!src) return
    setImg(null); setError(false); setPos(INICIO)
    let vivo = true
    cargarImagen(src).then((i) => { if (!vivo) return; let f = '#ffffff'; try { f = colorFondo(i) } catch { /* sin acceso a los píxeles */ } setFondoFoto(f); setFondo(f); setImg(i) }).catch(() => { if (vivo) setError(true) })
    return () => { vivo = false }
  }, [src])

  // Rueda del mouse = agrandar/achicar (sin mover la página).
  useEffect(() => {
    const el = escenario.current
    if (!el) return
    const rueda = (e: WheelEvent) => { e.preventDefault(); setPos((p) => ({ ...p, z: limitar(p.z * Math.exp(-e.deltaY * 0.0015), 0.4, 4) })) }
    el.addEventListener('wheel', rueda, { passive: false })
    return () => el.removeEventListener('wheel', rueda)
  }, [img])

  if (!src) return null

  // Tamaño de la foto "completa" dentro del cuadrado (fracciones del lado).
  const ar = img ? img.naturalWidth / img.naturalHeight : 1
  const bw = ar >= 1 ? 1 : ar, bh = ar >= 1 ? 1 / ar : 1
  const W = bw * pos.z, H = bh * pos.z
  const left = pos.cx - W / 2, top = pos.cy - H / 2

  const abajo = (e: RPointerEvent<HTMLDivElement>) => {
    if (!img) return
    e.currentTarget.setPointerCapture(e.pointerId)
    punteros.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (punteros.current.size === 2) { const [a, b] = [...punteros.current.values()]; pellizco.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), z: pos.z } }
  }
  const mover = (e: RPointerEvent<HTMLDivElement>) => {
    const antes = punteros.current.get(e.pointerId)
    if (!antes || !escenario.current) return
    const r = escenario.current.getBoundingClientRect()
    punteros.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (punteros.current.size === 2 && pellizco.current) {
      const [a, b] = [...punteros.current.values()]
      const z = limitar(pellizco.current.z * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pellizco.current.dist), 0.4, 4)
      setPos((p) => ({ ...p, z })); return
    }
    const dx = (e.clientX - antes.x) / r.width, dy = (e.clientY - antes.y) / r.height
    setPos((p) => ({ ...p, cx: limitar(p.cx + dx, -1, 2), cy: limitar(p.cy + dy, -1, 2) }))
  }
  const arriba = (e: RPointerEvent<HTMLDivElement>) => { punteros.current.delete(e.pointerId); if (punteros.current.size < 2) pellizco.current = null }

  const centrarProducto = () => {
    if (!img) return
    let caja: ReturnType<typeof cajaProducto> = null
    try { caja = cajaProducto(img, fondoFoto) } catch { /* sin acceso a los píxeles */ }
    if (!caja) { setPos(INICIO); return }
    // El producto ocupa el 82 % del cuadrado y queda justo en el centro.
    const z = limitar(0.82 / Math.max((caja.x1 - caja.x0) * bw, (caja.y1 - caja.y0) * bh), 0.4, 4)
    const mx = (caja.x0 + caja.x1) / 2, my = (caja.y0 + caja.y1) / 2
    setPos({ z, cx: 0.5 + (0.5 - mx) * bw * z, cy: 0.5 + (0.5 - my) * bh * z })
  }

  const aplicar = async () => {
    if (!img) return
    setAplicando(true)
    try {
      const c = document.createElement('canvas'); c.width = LADO; c.height = LADO
      const ctx = c.getContext('2d')!
      ctx.fillStyle = fondo; ctx.fillRect(0, 0, LADO, LADO)
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, left * LADO, top * LADO, W * LADO, H * LADO)
      const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/jpeg', 0.9))
      if (!blob) throw new Error('foto')
      onListo(new File([blob], `encuadre-${Date.now()}.jpg`, { type: 'image/jpeg' }))
    } catch {
      toast.error('No se pudo crear la foto. Probá de nuevo.')
    } finally { setAplicando(false) }
  }

  const boton = 'inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-medium hover:border-accent hover:text-accent'
  return <Modal open onClose={onClose} title="Encuadrar foto" description="Arrastrá la foto para moverla. Agrandala con la barra, la rueda del mouse o dos dedos. El cuadro es igual a la tarjeta de la tienda.">
    <div className="space-y-4">
      <div ref={escenario} onPointerDown={abajo} onPointerMove={mover} onPointerUp={arriba} onPointerCancel={arriba}
        className="relative mx-auto aspect-square w-full max-w-[420px] cursor-grab touch-none select-none overflow-hidden rounded-2xl border border-line active:cursor-grabbing" style={{ background: fondo }}>
        {img && <img src={img.src} alt="" draggable={false} className="pointer-events-none absolute max-w-none" style={{ left: `${left * 100}%`, top: `${top * 100}%`, width: `${W * 100}%`, height: `${H * 100}%` }} />}
        {!img && !error && <div className="absolute inset-0 grid place-items-center text-[#6B655C]"><LoaderCircle className="animate-spin" /></div>}
        {error && <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-[#6B655C]">No se pudo abrir esta foto para editarla.</div>}
        {/* Guías: centro del cuadro */}
        <div className="pointer-events-none absolute inset-y-0 left-1/2 border-l border-dashed border-[#171310]/20" />
        <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-[#171310]/20" />
      </div>

      <label className="mx-auto flex max-w-[420px] items-center gap-3 text-sm"><span className="w-16 shrink-0 text-muted">Tamaño</span>
        <input type="range" min="0.4" max="4" step="0.01" value={pos.z} onChange={(e) => setPos((p) => ({ ...p, z: Number(e.target.value) }))} className="min-w-0 flex-1 accent-[var(--color-accent,#4f8cff)]" aria-label="Tamaño de la foto" />
        <span className="w-12 shrink-0 text-right font-mono text-xs text-muted">{Math.round(pos.z * 100)}%</span>
      </label>

      <div className="mx-auto flex max-w-[420px] flex-wrap items-center gap-2">
        <button type="button" className={boton} onClick={centrarProducto} disabled={!img}><Crosshair size={15} /> Centrar producto</button>
        <button type="button" className={boton} onClick={() => setPos(INICIO)} disabled={!img}><RotateCcw size={15} /> Como estaba</button>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted">Fondo
          {[...new Set([fondoFoto, '#ffffff'])].map((c) => <button key={c} type="button" onClick={() => setFondo(c)} aria-label={c === '#ffffff' ? 'Fondo blanco' : 'Fondo como la foto'} title={c === '#ffffff' ? 'Blanco' : 'Como la foto'}
            className={`size-7 rounded-full border ${fondo === c ? 'ring-2 ring-accent ring-offset-1 ring-offset-transparent' : 'border-line'}`} style={{ background: c }} />)}
        </span>
      </div>

      <div className="flex justify-end gap-2 border-t border-line pt-3">
        <button type="button" className="subtle-button" onClick={onClose}>Cancelar</button>
        <button type="button" className="primary-button px-5" disabled={!img || aplicando} onClick={() => void aplicar()}>{aplicando ? 'Creando…' : 'Usar esta foto'}</button>
      </div>
    </div>
  </Modal>
}
