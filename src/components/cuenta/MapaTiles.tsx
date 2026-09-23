import { LocateFixed, Minus, Plus } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

// Mapa liviano con tiles de OpenStreetMap (sin librería ni API key). Dos modos:
//   · mini (solo lectura): vista previa con el pin en la dirección guardada.
//   · interactivo: el cliente arrastra el mapa y el pin fijo del centro marca la ubicación
//     (como Uber); + / − para zoom y "Usar mi ubicación" (GPS del teléfono).
// Tiles en gris (filtro CSS) para que combine con la estética blanco/negro del portal.
const CENTRO_MANAGUA = { lat: 12.1364, lng: -86.2514 }
const TILE = 256

const lngAX = (lng: number, z: number) => ((lng + 180) / 360) * TILE * 2 ** z
const latAY = (lat: number, z: number) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * TILE * 2 ** z }
const xALng = (x: number, z: number) => (x / (TILE * 2 ** z)) * 360 - 180
const yALat = (y: number, z: number) => { const n = Math.PI - (2 * Math.PI * y) / (TILE * 2 ** z); return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))) }

type Props = {
  lat: number | null
  lng: number | null
  zoom?: number
  interactivo?: boolean
  alto?: number
  onChange?: (pos: { lat: number; lng: number }) => void
}

export function MapaTiles({ lat, lng, zoom: zoomInicial = 15, interactivo = false, alto = 132, onChange }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [ancho, setAncho] = useState(320)
  const [zoom, setZoom] = useState(zoomInicial)
  const centro = { lat: lat ?? CENTRO_MANAGUA.lat, lng: lng ?? CENTRO_MANAGUA.lng }
  const [arrastre, setArrastre] = useState<{ dx: number; dy: number } | null>(null)
  const inicio = useRef<{ x: number; y: number } | null>(null)
  const [gps, setGps] = useState<'idle' | 'buscando' | 'error'>('idle')

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new ResizeObserver(([entry]) => setAncho(Math.round(entry.contentRect.width)))
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const dx = arrastre?.dx ?? 0
  const dy = arrastre?.dy ?? 0
  const cx = lngAX(centro.lng, zoom) - dx
  const cy = latAY(centro.lat, zoom) - dy
  const x0 = cx - ancho / 2
  const y0 = cy - alto / 2
  const n = 2 ** zoom
  const tiles: { key: string; src: string; left: number; top: number }[] = []
  for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x0 + ancho) / TILE); tx++) {
    for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y0 + alto) / TILE); ty++) {
      if (ty < 0 || ty >= n) continue
      const wx = ((tx % n) + n) % n
      tiles.push({ key: `${zoom}-${tx}-${ty}`, src: `https://tile.openstreetmap.org/${zoom}/${wx}/${ty}.png`, left: tx * TILE - x0, top: ty * TILE - y0 })
    }
  }

  const soltar = () => {
    if (!inicio.current) return
    inicio.current = null
    if (arrastre && (Math.abs(arrastre.dx) > 1 || Math.abs(arrastre.dy) > 1)) onChange?.({ lat: yALat(cy, zoom), lng: xALng(cx, zoom) })
    setArrastre(null)
  }
  const handlers = interactivo ? {
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => { if ((e.target as HTMLElement).closest('button')) return; inicio.current = { x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId) },
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => { if (inicio.current) setArrastre({ dx: e.clientX - inicio.current.x, dy: e.clientY - inicio.current.y }) },
    onPointerUp: soltar,
    onPointerCancel: soltar,
  } : {}

  const usarGps = () => {
    if (!navigator.geolocation) { setGps('error'); return }
    setGps('buscando')
    navigator.geolocation.getCurrentPosition(
      (pos) => { setGps('idle'); setZoom(17); onChange?.({ lat: pos.coords.latitude, lng: pos.coords.longitude }) },
      () => setGps('error'),
      { enableHighAccuracy: true, timeout: 12_000 },
    )
  }

  const sinUbicacion = lat == null || lng == null
  return <div>
    <div ref={ref} className={`hsc-map${interactivo ? ' is-interactive' : ''}${arrastre ? ' is-dragging' : ''}`} style={{ height: alto }} {...handlers}>
      <div className="hsc-map__tiles" aria-hidden>
        {tiles.map((t) => <img key={t.key} src={t.src} alt="" draggable={false} loading="lazy" style={{ left: t.left, top: t.top }} />)}
      </div>
      {(!sinUbicacion || interactivo) && <svg className="hsc-map__pin" viewBox="0 0 24 32" width="26" height="34" aria-hidden><path d="M12 0C5.4 0 0 5.3 0 11.9 0 20.8 12 32 12 32s12-11.2 12-20.1C24 5.3 18.6 0 12 0Z" fill="#111" /><circle cx="12" cy="11.8" r="4.4" fill="#fff" /></svg>}
      {sinUbicacion && !interactivo && <span className="hsc-map__empty">Sin ubicación en el mapa</span>}
      {interactivo && <div className="hsc-map__ctrls">
        <button type="button" onClick={() => setZoom((z) => Math.min(19, z + 1))} aria-label="Acercar"><Plus size={15} /></button>
        <button type="button" onClick={() => setZoom((z) => Math.max(5, z - 1))} aria-label="Alejar"><Minus size={15} /></button>
      </div>}
      <span className="hsc-map__attr">© OpenStreetMap</span>
    </div>
    {interactivo && <div className="mt-2 flex items-center justify-between gap-2">
      <span className="hsp-faint text-[11px]">{sinUbicacion ? 'Arrastrá el mapa hasta tu casa o usá tu ubicación.' : 'Arrastrá el mapa para ajustar el pin.'}</span>
      <button type="button" onClick={usarGps} className="hsc-link inline-flex shrink-0 items-center gap-1.5"><LocateFixed size={14} />{gps === 'buscando' ? 'Buscando…' : 'Usar mi ubicación'}</button>
    </div>}
    {gps === 'error' && <p className="mt-1 text-[11px]" style={{ color: '#b91c1c' }}>No pudimos obtener tu ubicación. Revisá el permiso de ubicación o mové el mapa a mano.</p>}
  </div>
}
