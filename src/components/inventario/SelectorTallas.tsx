import { Minus, Plus } from 'lucide-react'
import { useState } from 'react'
import { tallasDeTexto } from '../../utils/compraPago'
import type { TipoProducto } from '../../utils/repartoCompra'

// Tallas para elegir tocando (EUR en zapatos). El valor sigue siendo el texto "39, 40, 40"
// (una entrada por par), así todo lo demás (cantidad, reparto, tienda) funciona igual.
const TALLAS: Partial<Record<TipoProducto, string[]>> = {
  zapatos: ['35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46'],
  ropa: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
}

const orden = (a: string, b: string) => {
  const na = Number(a), nb = Number(b)
  return Number.isFinite(na) && Number.isFinite(nb) ? na - nb : a.localeCompare(b)
}

export function SelectorTallas({ valor, tipo, onChange, className = '' }: { valor: string; tipo: TipoProducto; onChange: (v: string) => void; className?: string }) {
  const [otra, setOtra] = useState('')
  const lista = tallasDeTexto(valor)
  const cuenta = new Map<string, number>()
  lista.forEach((t) => cuenta.set(t, (cuenta.get(t) ?? 0) + 1))
  const base = TALLAS[tipo] ?? []
  const todas = [...base, ...[...cuenta.keys()].filter((t) => !base.includes(t)).sort(orden)]
  const guardar = (m: Map<string, number>) => onChange([...m.keys()].sort(orden).flatMap((t) => Array(m.get(t) ?? 0).fill(t)).join(', '))
  const cambiar = (t: string, d: number) => { const m = new Map(cuenta); const n = Math.max(0, (m.get(t) ?? 0) + d); if (n) m.set(t, n); else m.delete(t); guardar(m) }
  const agregarOtra = () => { const t = otra.trim().toUpperCase(); if (!t) return; cambiar(t, 1); setOtra('') }

  return <div className={`form-field ${className}`}>
    <span className="flex! items-center justify-between gap-2">Tallas <span className="font-normal text-muted">{lista.length ? `${lista.length} ${lista.length === 1 ? 'par' : 'pares'} · tocá para sumar` : 'Tocá cada talla que compraste'}</span></span>
    {todas.length > 0 && <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-12">
      {todas.map((t) => {
        const n = cuenta.get(t) ?? 0
        return <div key={t} className={`relative flex h-11 items-stretch overflow-hidden rounded-xl border text-sm font-semibold transition ${n ? 'border-accent bg-accent/15 text-white' : 'border-line bg-panel text-muted'}`}>
          <button type="button" className="flex flex-1 items-center justify-center gap-1" onClick={() => cambiar(t, 1)} aria-label={`Sumar talla ${t}`}>
            {t}{n > 0 && <span className="rounded-full bg-accent px-1.5 text-[11px] leading-4 text-app">{n}</span>}
          </button>
          {n > 0 && <button type="button" className="grid w-7 place-items-center border-l border-accent/40 text-white/80" onClick={() => cambiar(t, -1)} aria-label={`Quitar un par talla ${t}`}><Minus size={13} /></button>}
        </div>
      })}
    </div>}
    <div className="mt-1.5 flex gap-1.5">
      <input className="min-w-0 flex-1" value={otra} onChange={(e) => setOtra(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); agregarOtra() } }} placeholder={todas.length ? 'Otra talla (ej. 40.5)' : 'Talla o color (opcional)'} />
      <button type="button" className="subtle-button shrink-0" disabled={!otra.trim()} onClick={agregarOtra}><Plus size={14} /> Agregar</button>
    </div>
  </div>
}
