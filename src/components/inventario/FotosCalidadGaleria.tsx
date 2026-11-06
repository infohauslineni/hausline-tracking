import { Camera, ChevronLeft, ChevronRight, Download, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { listarFotosInversion, type FotoInversion } from '../../services/archivos.service'

// Fotos de CONTROL DE CALIDAD de una compra libre, a la vista en "Detalles de la compra":
// miniaturas y, al tocar una, se abre en grande para pasar de una a otra. Para subir o borrar
// está "Subir / borrar" (abre la ventana de Control de calidad de siempre).
export function FotosCalidadGaleria({ inversionId, cantidad, onGestionar }: { inversionId: string; cantidad: number; onGestionar: () => void }) {
  const [fotos, setFotos] = useState<FotoInversion[] | null>(null)
  const [abierta, setAbierta] = useState<number | null>(null)

  useEffect(() => {
    if (!cantidad) return
    let vivo = true
    void listarFotosInversion(inversionId).then((f) => { if (vivo) setFotos(f.filter((x) => x.signed_url)) }).catch(() => { if (vivo) setFotos([]) })
    return () => { vivo = false }
  }, [inversionId, cantidad])

  // Teclado en la vista grande: flechas y Escape.
  useEffect(() => {
    if (abierta === null || !fotos?.length) return
    const n = fotos.length
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierta(null)
      if (e.key === 'ArrowRight') setAbierta((i) => (i === null ? i : (i + 1) % n))
      if (e.key === 'ArrowLeft') setAbierta((i) => (i === null ? i : (i - 1 + n) % n))
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [abierta, fotos])

  if (!cantidad) return null
  const actual = abierta !== null && fotos ? fotos[abierta] : null

  return <section className="rounded-xl border border-line bg-white/[.02] p-4">
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold"><Camera size={14} className="text-sky-300" /> Fotos de control de calidad <span className="font-normal text-muted">({cantidad})</span></h3>
      <button type="button" className="text-[12px] font-medium text-muted hover:text-white" onClick={onGestionar}>Subir / borrar</button>
    </div>
    {fotos === null ? <div className="grid grid-cols-4 gap-2">{Array.from({ length: Math.min(4, cantidad) }, (_, i) => <div key={i} className="aspect-square animate-pulse rounded-lg bg-white/[.04]" />)}</div>
      : !fotos.length ? <p className="text-[12px] text-muted">No se pudieron cargar las fotos. Probá de nuevo en un momento.</p>
      : <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
        {fotos.map((f, i) => <button key={f.id} type="button" onClick={() => setAbierta(i)} className="overflow-hidden rounded-lg border border-line bg-white/[.03] hover:border-white/30" aria-label={`Ver foto ${i + 1}`}>
          <img src={f.signed_url} alt={`Control de calidad ${i + 1}`} loading="lazy" className="aspect-square w-full object-cover" />
        </button>)}
      </div>}

    {actual && fotos && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 p-3" role="dialog" aria-modal="true" aria-label="Foto de control de calidad">
      <button className="absolute inset-0" aria-label="Cerrar" onClick={() => setAbierta(null)} />
      <img src={actual.signed_url} alt="Control de calidad" className="relative max-h-[86dvh] max-w-full rounded-lg object-contain" />
      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3 [padding-top:calc(12px+env(safe-area-inset-top,0px))]">
        <span className="rounded-full bg-black/60 px-3 py-1 text-xs text-white">{(abierta ?? 0) + 1} / {fotos.length}</span>
        <div className="flex gap-2">
          <a href={actual.signed_url} target="_blank" rel="noreferrer" className="grid size-10 place-items-center rounded-full bg-black/60 text-white hover:bg-black" aria-label="Abrir la foto original" title="Abrir original"><Download size={17} /></a>
          <button type="button" className="grid size-10 place-items-center rounded-full bg-black/60 text-white hover:bg-black" onClick={() => setAbierta(null)} aria-label="Cerrar"><X size={18} /></button>
        </div>
      </div>
      {fotos.length > 1 && <>
        <button type="button" className="absolute left-2 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white hover:bg-black" onClick={() => setAbierta((i) => ((i ?? 0) - 1 + fotos.length) % fotos.length)} aria-label="Foto anterior"><ChevronLeft size={22} /></button>
        <button type="button" className="absolute right-2 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white hover:bg-black" onClick={() => setAbierta((i) => ((i ?? 0) + 1) % fotos.length)} aria-label="Foto siguiente"><ChevronRight size={22} /></button>
      </>}
    </div>}
  </section>
}
