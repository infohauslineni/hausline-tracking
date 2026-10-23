import { ArrowRight, Boxes, CornerDownLeft, HandCoins, PackageSearch, Search, Users, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { estadoLabel } from '../../constants/orders'
import { fijarEstadoVista } from '../../hooks/useEstadoVista'
import { isSupabaseConfigured } from '../../lib/supabase'
import type { Cliente, Inversion, Pedido, Producto } from '../../types/domain'

// BUSCADOR GLOBAL del panel (Ctrl+K o "/"): pedidos, clientes, compras libres, productos y
// pantallas desde un solo lugar, con teclado (↑ ↓ Enter). Los datos salen del caché de cada
// servicio, así que abre al instante.

type Resultado = { id: string; grupo: 'Pedidos' | 'Clientes' | 'Compras libres' | 'Productos' | 'Ir a'; titulo: string; detalle: string; ir: () => void }
type Datos = { pedidos: Pedido[]; clientes: Cliente[]; compras: Inversion[]; productos: Producto[] }
const ICONO = { 'Pedidos': Boxes, 'Clientes': Users, 'Compras libres': HandCoins, 'Productos': PackageSearch, 'Ir a': ArrowRight } as const
const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const digitos = (s: unknown) => String(s ?? '').replace(/\D/g, '')

export function BuscadorGlobal({ esAdmin, pantallas }: { esAdmin: boolean; pantallas: { to: string; label: string }[] }) {
  const [abierto, setAbierto] = useState(false)
  const [q, setQ] = useState('')
  const [activo, setActivo] = useState(0)
  const [datos, setDatos] = useState<Datos>({ pedidos: [], clientes: [], compras: [], productos: [] })
  const input = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  // Atajos: Ctrl/⌘+K en cualquier lado; "/" cuando no se está escribiendo en un campo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const escribiendo = /^(input|textarea|select)$/i.test((e.target as HTMLElement)?.tagName ?? '') || (e.target as HTMLElement)?.isContentEditable
      if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setQ(''); setAbierto((v) => !v) }
      else if (e.key === '/' && !escribiendo) { e.preventDefault(); setQ(''); setAbierto(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Carga (del caché) al abrir. Cada fuente por separado: si una falla (p. ej. permisos), las demás siguen.
  useEffect(() => {
    if (!abierto) return
    if (!isSupabaseConfigured) { void import('../../data/demo').then((m) => setDatos((d) => ({ ...d, pedidos: m.DEMO_PEDIDOS }))); return }
    void import('../../services/pedidos.service').then((m) => m.listarPedidos()).then((pedidos) => setDatos((d) => ({ ...d, pedidos }))).catch(() => undefined)
    if (!esAdmin) return
    void import('../../services/clientes.service').then((m) => m.listarClientes()).then((clientes) => setDatos((d) => ({ ...d, clientes }))).catch(() => undefined)
    void import('../../services/comercial.service').then((m) => Promise.all([m.listarInversiones(), m.listarProductos()])).then(([compras, productos]) => setDatos((d) => ({ ...d, compras, productos: productos.filter((p) => p.activo) }))).catch(() => undefined)
  }, [abierto, esAdmin])

  const resultados = useMemo<Resultado[]>(() => {
    const t = norm(q.trim())
    const tel = digitos(q)
    const cerrar = (fn: () => void) => () => { setAbierto(false); fn() }
    const irA = pantallas.filter((p) => !t || norm(p.label).includes(t)).slice(0, t ? 4 : 8)
      .map((p) => ({ id: `p-${p.to}`, grupo: 'Ir a' as const, titulo: p.label, detalle: p.to, ir: cerrar(() => navigate(p.to)) }))
    if (!t) return irA
    const pedidos = datos.pedidos.filter((p) => [p.codigo, p.clientes?.nombre, ...(p.pedido_items ?? []).flatMap((i) => [i.producto, i.codigo_producto, i.marca])].some((v) => norm(v).includes(t)) || (tel.length >= 4 && digitos(p.clientes?.whatsapp).includes(tel)))
      // Lo activo primero, después lo más nuevo.
      .sort((a, b) => Number(['entregado', 'cancelado'].includes(a.estado)) - Number(['entregado', 'cancelado'].includes(b.estado)) || String(b.fecha_pedido).localeCompare(String(a.fecha_pedido)))
      .slice(0, 7).map((p) => ({ id: `o-${p.id}`, grupo: 'Pedidos' as const, titulo: `${p.codigo} · ${p.clientes?.nombre ?? 'Sin cliente'}`, detalle: `${estadoLabel(p.estado)} · ${(p.pedido_items ?? [])[0]?.producto ?? ''}${Number(p.saldo) > 0.01 ? ` · saldo $${Number(p.saldo).toFixed(2)}` : ''}`, ir: cerrar(() => navigate(`/pedidos/${p.id}`)) }))
    const clientes = datos.clientes.filter((c) => norm(c.nombre).includes(t) || norm(c.correo).includes(t) || (tel.length >= 4 && digitos(c.whatsapp).includes(tel)))
      .slice(0, 5).map((c) => ({ id: `c-${c.id}`, grupo: 'Clientes' as const, titulo: c.nombre, detalle: [c.whatsapp, c.ciudad || c.departamento].filter(Boolean).join(' · '), ir: cerrar(() => navigate(`/clientes/${c.id}`)) }))
    const compras = datos.compras.filter((i) => [i.producto, i.codigo, i.marca, i.talla_color, i.tracking].some((v) => norm(v).includes(t)))
      .slice(0, 5).map((i) => ({ id: `i-${i.id}`, grupo: 'Compras libres' as const, titulo: `${i.codigo ? `${i.codigo} · ` : ''}${i.producto}`, detalle: [i.talla_color && `Talla ${i.talla_color}`, { en_transito: 'En camino', en_inventario: 'Disponible', reservado: 'Apartado', vendido: 'Vendido', descartado: 'Descartado' }[i.estado]].filter(Boolean).join(' · '), ir: cerrar(() => { fijarEstadoVista('stock.busqueda', i.codigo || i.producto); fijarEstadoVista('stock.filtro', 'todos'); navigate('/stock') }) }))
    const productos = datos.productos.filter((p) => [p.nombre, p.codigo, p.marca].some((v) => norm(v).includes(t)))
      .slice(0, 5).map((p) => ({ id: `r-${p.id}`, grupo: 'Productos' as const, titulo: `${p.codigo} · ${p.nombre}`, detalle: [p.marca, `venta $${Number(p.precio_venta || 0).toFixed(2)}`].filter(Boolean).join(' · '), ir: cerrar(() => navigate('/productos')) }))
    return [...pedidos, ...clientes, ...compras, ...productos, ...irA]
  }, [q, datos, pantallas, navigate])

  useEffect(() => { setActivo(0) }, [q])
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setAbierto(false)
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActivo((a) => Math.min(resultados.length - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActivo((a) => Math.max(0, a - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); resultados[activo]?.ir() }
  }
  useEffect(() => { document.getElementById(`bg-${activo}`)?.scrollIntoView({ block: 'nearest' }) }, [activo])

  return <>
    <button type="button" onClick={() => { setQ(''); setAbierto(true) }} className="topbar-field flex h-9 w-full min-w-0 max-w-[560px] items-center gap-2 rounded-lg px-3 text-[13px] transition" aria-label="Buscar en el panel">
      <Search size={16} className="shrink-0" /><span className="truncate">Buscar pedidos, clientes, productos…</span>
      <kbd className="ml-auto hidden shrink-0 rounded border border-[#4a4a4a] px-1.5 py-0.5 font-mono text-[10px] text-[#a3a3a3] sm:inline">Ctrl K</kbd>
    </button>
    {abierto && <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/70 p-3 pt-[10vh] backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Buscar en el panel">
      <button className="absolute inset-0 cursor-default" aria-label="Cerrar búsqueda" onClick={() => setAbierto(false)} />
      <div className="relative w-full max-w-2xl overflow-hidden rounded-xl border border-line bg-panel text-white shadow-2xl">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search size={18} className="shrink-0 text-accent" />
          <input ref={input} autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown} placeholder="Código, cliente, WhatsApp, producto, talla o tracking…" className="h-14 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-muted" aria-label="Buscar" />
          <button className="icon-button shrink-0" onClick={() => setAbierto(false)} aria-label="Cerrar"><X size={16} /></button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {!resultados.length && <p className="px-3 py-10 text-center text-sm text-muted">Nada coincide con “{q}”.</p>}
          {resultados.map((r, i) => {
            const Icono = ICONO[r.grupo]
            const titulo = i === 0 || resultados[i - 1].grupo !== r.grupo
            return <div key={r.id}>
              {titulo && <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">{r.grupo}</p>}
              <button id={`bg-${i}`} type="button" onMouseEnter={() => setActivo(i)} onClick={r.ir} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${i === activo ? 'bg-accent/[.1] text-white' : 'text-white/85'}`}>
                <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${i === activo ? 'bg-accent/20 text-accent' : 'bg-white/[.04] text-muted'}`}><Icono size={15} /></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{r.titulo}</span>{r.detalle && <span className="block truncate text-[11px] text-muted">{r.detalle}</span>}</span>
                {i === activo && <CornerDownLeft size={14} className="shrink-0 text-muted" />}
              </button>
            </div>
          })}
        </div>
        <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-[10px] text-muted"><span>↑ ↓ moverse</span><span>Enter abrir</span><span>Esc cerrar</span></div>
      </div>
    </div>}
  </>
}
