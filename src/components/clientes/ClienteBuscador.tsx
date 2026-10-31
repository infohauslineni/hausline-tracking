import { Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Cliente } from '../../types/domain'

// Elegir cliente escribiendo: a medida que se teclea el nombre, el WhatsApp o el correo, van
// saliendo los clientes que coinciden (sin importar tildes ni mayúsculas). Flechas + Enter también.
const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const MAX = 8

export function ClienteBuscador({ clientes, valor, onElegir }: { clientes: Cliente[]; valor: string; onElegir: (id: string) => void }) {
  const elegido = clientes.find((c) => c.id === valor) ?? null
  const [texto, setTexto] = useState('')
  const [abierto, setAbierto] = useState(false)
  const [activo, setActivo] = useState(0)
  const caja = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  const resultados = useMemo(() => {
    const t = normal(texto.trim())
    const digitos = texto.replace(/\D/g, '')
    if (!t) return clientes.slice(0, MAX)
    return clientes.filter((c) => {
      const nombre = normal(c.nombre ?? '')
      return nombre.includes(t) || nombre.split(/\s+/).some((p) => p.startsWith(t)) || (digitos.length >= 3 && String(c.whatsapp ?? '').replace(/\D/g, '').includes(digitos)) || normal(String(c.correo ?? '')).includes(t)
    }).sort((a, b) => Number(!normal(a.nombre ?? '').startsWith(t)) - Number(!normal(b.nombre ?? '').startsWith(t))).slice(0, MAX)
  }, [clientes, texto])

  useEffect(() => { setActivo(0) }, [texto])
  useEffect(() => {
    const fuera = (e: MouseEvent) => { if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false) }
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [])

  const elegir = (c: Cliente) => { onElegir(c.id); setTexto(''); setAbierto(false) }

  if (elegido && !abierto) {
    return <div className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-panel px-3 py-1.5">
      <div className="min-w-0 flex-1"><b className="block truncate text-sm">{elegido.nombre}</b><span className="block truncate text-xs text-muted">{[elegido.whatsapp, elegido.correo].filter(Boolean).join(' · ')}</span></div>
      <button type="button" className="shrink-0 text-xs font-semibold text-accent" onClick={() => { setAbierto(true); setTimeout(() => input.current?.focus(), 0) }}>Cambiar</button>
    </div>
  }

  return <div ref={caja} className="relative min-w-0 flex-1">
    <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
    <input ref={input} value={texto} autoComplete="off" placeholder="Escribí el nombre, WhatsApp o correo…" className="w-full" style={{ paddingLeft: 36, paddingRight: 36 }}
      onChange={(e) => { setTexto(e.target.value); setAbierto(true) }} onFocus={() => setAbierto(true)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setAbierto(true); setActivo((i) => Math.min(i + 1, resultados.length - 1)) }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActivo((i) => Math.max(i - 1, 0)) }
        else if (e.key === 'Enter') { if (abierto && resultados[activo]) { e.preventDefault(); elegir(resultados[activo]) } }
        else if (e.key === 'Escape') setAbierto(false)
      }} role="combobox" aria-expanded={abierto} aria-autocomplete="list" aria-label="Buscar cliente" />
    {texto && <button type="button" aria-label="Borrar" className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded text-muted" onClick={() => { setTexto(''); input.current?.focus() }}><X size={14} /></button>}
    {abierto && <ul role="listbox" className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-line bg-panel py-1 shadow-xl">
      {resultados.length ? resultados.map((c, i) => <li key={c.id} role="option" aria-selected={i === activo}>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => elegir(c)} onMouseEnter={() => setActivo(i)} className={`flex w-full min-h-11 flex-col items-start px-3 py-2 text-left ${i === activo ? 'bg-white/[0.06]' : ''}`}>
          <b className="text-sm">{c.nombre}</b><span className="text-xs text-muted">{[c.whatsapp, c.correo].filter(Boolean).join(' · ') || 'Sin datos de contacto'}</span>
        </button>
      </li>) : <li className="px-3 py-3 text-sm text-muted">No hay clientes con "{texto}". Usá <b>Nuevo</b> para crearlo.</li>}
    </ul>}
  </div>
}
