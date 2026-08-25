import { ArrowUpRight, Ban, Boxes, CalendarDays, CheckCircle2, ChevronDown, Download, Package, Plus, Search, Trash2, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { ESTADOS_PEDIDO, estadoLabel, estadoTone, etapaBase } from '../../constants/orders'
import { DEMO_PEDIDOS } from '../../data/demo'
import { isSupabaseConfigured } from '../../lib/supabase'
import { actualizarEstadoPedido, eliminarPedido, listarPedidos } from '../../services/pedidos.service'
import type { EstadoPedido, Pedido } from '../../types/domain'

export function PedidosPage() {
  const [pedidos, setPedidos] = useState<Pedido[]>(isSupabaseConfigured ? [] : DEMO_PEDIDOS)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [search, setSearch] = useState('')
  const [estado, setEstado] = useState<EstadoPedido | 'todos'>('todos')
  useEffect(() => { if (isSupabaseConfigured) void listarPedidos(setPedidos).then(setPedidos).catch(() => toast.error('No se pudieron cargar los pedidos.')).finally(() => setLoading(false)) }, [])

  const [mes, setMes] = useState(mesActual())
  // Meses que tienen pedidos, del más nuevo al más viejo; siempre incluye el mes actual.
  const meses = useMemo(() => { const s = new Set(pedidos.map(mesDe).filter(Boolean)); s.add(mesActual()); return [...s].sort().reverse() }, [pedidos])
  // Todo lo del mes elegido: los indicadores y las listas se calculan sobre esto.
  const delMes = useMemo(() => pedidos.filter((p) => mesDe(p) === mes), [pedidos, mes])

  // Lista principal: del mes, SIN entregados ni cancelados, aplicando estado y búsqueda.
  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim()
    return delMes.filter((p) => p.estado !== 'entregado' && p.estado !== 'cancelado' && (estado === 'todos' || etapaBase(p.estado) === estado) && coincide(p, term))
  }, [estado, delMes, search])

  // Cancelados del mes: van en su propio apartado, abajo (fuera de la lista principal).
  const cancelados = useMemo(() => {
    const term = search.toLowerCase().trim()
    return delMes.filter((p) => p.estado === 'cancelado' && coincide(p, term))
  }, [delMes, search])

  const remove = async (pedido: Pedido) => {
    if (!window.confirm(`¿Eliminar el pedido ${pedido.codigo}? Se borrarán sus productos, tracking, eventos e imágenes. Esta acción no se puede deshacer.`)) return
    try {
      if (isSupabaseConfigured) await eliminarPedido(pedido.id)
      setPedidos((current) => current.filter((item) => item.id !== pedido.id))
      toast.success('Pedido eliminado.')
    } catch { toast.error('No se pudo eliminar el pedido.') }
  }

  // Cancela el pedido (lo deja en estado "Cancelado", sin borrar nada). No manda
  // correo al cliente (los estados 'cancelado'/'incidencia' están exentos). Se puede
  // revertir moviéndolo de nuevo a una etapa desde el detalle del pedido.
  const cancelar = async (pedido: Pedido) => {
    if (!window.confirm(`¿Cancelar el pedido ${pedido.codigo}? Quedará marcado como "Cancelado". Podrás reactivarlo desde el detalle si lo necesitas.`)) return
    try {
      if (isSupabaseConfigured) await actualizarEstadoPedido(pedido.id, 'cancelado')
      setPedidos((current) => current.map((item) => item.id === pedido.id ? { ...item, estado: 'cancelado', updated_at: new Date().toISOString() } : item))
      toast.success('Pedido cancelado.')
    } catch { toast.error('No se pudo cancelar el pedido.') }
  }

  return <div>
    {!isSupabaseConfigured && <div className="preview-banner"><strong>Vista previa local:</strong> mostrando los pedidos de demostración de Hausline.</div>}
    <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Operaciones</p><h1 className="page-title">Pedidos</h1><p className="page-subtitle">Gestiona todos tus pedidos en un solo lugar.</p></div><div className="flex flex-wrap gap-2"><button type="button" className="subtle-button px-4" onClick={() => exportarCSV(filtered)}><Download size={16} /> Exportar</button><Link to="/pedidos/nuevo" className="primary-button px-5"><Plus size={18} /> Nuevo pedido</Link></div></div>
    <section className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4"><MiniMetric label="Total del mes" value={delMes.length} icon={Boxes} /><MiniMetric label="Activos" value={delMes.filter((p) => !['entregado','cancelado'].includes(p.estado)).length} icon={CalendarDays} tone="blue" /><MiniMetric label="Completados" value={delMes.filter((p) => p.estado === 'entregado').length} icon={CheckCircle2} tone="emerald" /><MiniMetric label="Cancelados" value={delMes.filter((p) => p.estado === 'cancelado').length} icon={XCircle} tone="danger" /></section>
    <div className="mt-6 flex flex-col gap-3 sm:flex-row"><div className="relative max-w-lg flex-1"><Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" size={18} /><input className="search-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Código, cliente, WhatsApp o producto" /></div><select className="select-input sm:w-52" value={mes} onChange={(e) => setMes(e.target.value)} aria-label="Mes">{meses.map((m) => <option key={m} value={m}>{capitalizar(mesLabel(m))}</option>)}</select><select className="select-input sm:w-52" value={estado} onChange={(e) => setEstado(e.target.value as EstadoPedido | 'todos')}><option value="todos">Todos los estados</option>{ESTADOS_PEDIDO.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
    {loading ? <div className="mt-5 h-80 animate-pulse rounded-2xl border border-line bg-panel" /> : <>
      {filtered.length === 0 ? <div className="mt-6 grid min-h-64 place-items-center rounded-2xl border border-dashed border-line text-center"><div><Boxes className="mx-auto text-muted" /><h2 className="mt-3 font-semibold">Sin pedidos activos en {capitalizar(mesLabel(mes))}</h2><p className="mt-1 text-sm text-muted">Prueba otro mes, término o filtro.</p></div></div> : <>
        <div className="mt-5 grid gap-3 md:hidden">{filtered.map((pedido) => <OrderCard pedido={pedido} onDelete={() => void remove(pedido)} onCancel={() => void cancelar(pedido)} key={pedido.id} />)}</div>
        <div className="mt-5 hidden overflow-hidden rounded-2xl border border-line bg-panel md:block"><table className="data-table"><thead><tr><th>Pedido</th><th>Cliente</th><th>Estado</th><th>Total / saldo</th><th>Actualización</th><th>Acciones</th></tr></thead><tbody>{filtered.map((pedido) => <PedidoRow pedido={pedido} onDelete={() => void remove(pedido)} onCancel={() => void cancelar(pedido)} key={pedido.id} />)}</tbody></table></div>
      </>}
      {cancelados.length > 0 && <details className="group mt-6 rounded-2xl border border-line bg-panel/60">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 text-sm font-semibold"><span className="flex items-center gap-2 text-muted"><Ban size={16} className="text-red-300" /> Cancelados de {capitalizar(mesLabel(mes))} <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-xs">{cancelados.length}</span></span><ChevronDown size={16} className="text-muted transition group-open:rotate-180" /></summary>
        <div className="border-t border-line p-3">
          <div className="grid gap-3 md:hidden">{cancelados.map((pedido) => <OrderCard pedido={pedido} onDelete={() => void remove(pedido)} onCancel={() => void cancelar(pedido)} key={pedido.id} />)}</div>
          <div className="hidden overflow-hidden rounded-xl border border-line md:block"><table className="data-table"><tbody>{cancelados.map((pedido) => <PedidoRow pedido={pedido} onDelete={() => void remove(pedido)} onCancel={() => void cancelar(pedido)} key={pedido.id} />)}</tbody></table></div>
        </div>
      </details>}
    </>}
  </div>
}

const MINI_TONE = { blue: 'text-sky-300', emerald: 'text-emerald-300', danger: 'text-red-300' } as const
function MiniMetric({ label, value, icon: Icon, tone }: { label: string; value: number; icon: typeof Boxes; tone?: keyof typeof MINI_TONE }) { return <div className="flex items-center gap-3 rounded-xl border border-line bg-panel p-3 sm:p-4"><span className={`grid size-9 shrink-0 place-items-center rounded-lg bg-white/[0.04] ${tone ? MINI_TONE[tone] : 'text-muted'}`}><Icon size={18} /></span><div><strong className="block text-xl">{value}</strong><span className="text-[11px] text-muted">{label}</span></div></div> }

// Primer producto del pedido y su nombre para la lista (con "+N" si hay varios).
const primerItem = (p: Pedido) => p.pedido_items?.[0]
const nombreProducto = (p: Pedido) => { const items = p.pedido_items ?? []; if (!items.length) return 'Sin productos'; return items.length > 1 ? `${items[0].producto} +${items.length - 1}` : items[0].producto }

// Mes (YYYY-MM) al que pertenece el pedido (por fecha del pedido) y utilidades para el selector.
const mesDe = (p: Pedido) => String(p.fecha_pedido || p.created_at || '').slice(0, 7)
const mesActual = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const mesLabel = (ym: string) => { const [y, m] = ym.split('-').map(Number); if (!y || !m) return ym; return new Intl.DateTimeFormat('es-NI', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1)) }
const capitalizar = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
// ¿El pedido coincide con el término de búsqueda? (código, cliente, WhatsApp o producto)
const coincide = (p: Pedido, term: string) => !term || [p.codigo, p.clientes?.nombre, p.clientes?.whatsapp, ...(p.pedido_items?.map((i) => i.producto) ?? [])].some((v) => v?.toLowerCase().includes(term))

// Fila de la tabla de pedidos (se reutiliza en la lista principal y en el apartado de cancelados).
function PedidoRow({ pedido, onDelete, onCancel }: { pedido: Pedido; onDelete: () => void; onCancel: () => void }) {
  return <tr><td><div className="flex items-center gap-3"><ProductThumb pedido={pedido} /><div className="min-w-0"><strong>{pedido.codigo}</strong><span>{nombreProducto(pedido)}</span>{primerItem(pedido)?.talla && <span>Talla: {primerItem(pedido)?.talla}</span>}</div></div></td><td><strong>{pedido.clientes?.nombre ?? 'Sin cliente'}</strong><span>{pedido.clientes?.whatsapp}</span></td><td><Status estado={pedido.estado} /></td><td><strong>${Number(pedido.total).toFixed(2)}</strong><span className={pedido.saldo > 0 ? 'text-amber-300!' : 'text-[#62eaa0]!'}>{pedido.saldo > 0 ? `Saldo $${Number(pedido.saldo).toFixed(2)}` : 'Pagado'}</span></td><td><span>{new Intl.DateTimeFormat('es-NI').format(new Date(pedido.updated_at))}</span></td><td><div className="flex justify-end gap-1.5"><Link to={`/pedidos/${pedido.id}`} className="table-action table-action-open" aria-label="Abrir pedido"><ArrowUpRight size={17} /></Link>{pedido.estado !== 'cancelado' && <button className="table-action" onClick={onCancel} aria-label="Cancelar pedido" title="Cancelar pedido"><Ban size={17} /></button>}<button className="table-action table-action-danger" onClick={onDelete} aria-label="Eliminar pedido"><Trash2 size={17} /></button></div></td></tr>
}

// Exporta los pedidos que se están viendo (ya filtrados) a un CSV descargable.
function exportarCSV(pedidos: Pedido[]) {
  if (!pedidos.length) return
  const filas = [['Codigo', 'Cliente', 'WhatsApp', 'Estado', 'Total', 'Saldo', 'Actualizado'],
    ...pedidos.map((p) => [p.codigo, p.clientes?.nombre ?? '', p.clientes?.whatsapp ?? '', estadoLabel(p.estado), Number(p.total).toFixed(2), Number(p.saldo).toFixed(2), new Date(p.updated_at).toISOString().slice(0, 10)])]
  const csv = filas.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url; a.download = `pedidos-${new Date().toISOString().slice(0, 10)}.csv`; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function Status({ estado }: { estado: EstadoPedido }) { return <span className={`status-badge status-${estadoTone(estado)}`}>{estadoLabel(estado)}</span> }
// Miniatura del primer producto con foto (del catálogo); si no hay, muestra un ícono.
function ProductThumb({ pedido, size = 44 }: { pedido: Pedido; size?: number }) {
  const item = pedido.pedido_items?.find((i) => i.imagen) ?? pedido.pedido_items?.[0]
  const cantidad = pedido.pedido_items?.reduce((sum, i) => sum + Number(i.cantidad || 1), 0) ?? 0
  const style = { width: size, height: size }
  if (item?.imagen) return <div className="relative shrink-0 overflow-hidden rounded-xl bg-white/[0.04]" style={style}><img src={item.imagen} alt="" loading="lazy" className="size-full object-cover" />{cantidad > 1 && <span className="absolute bottom-0 right-0 rounded-tl-md bg-app/85 px-1 text-[10px] font-semibold leading-tight text-white">{cantidad}</span>}</div>
  return <div className="grid shrink-0 place-items-center rounded-xl bg-white/[0.04] text-muted" style={style}><Package size={Math.round(size * 0.42)} /></div>
}
function OrderCard({ pedido, onDelete, onCancel }: { pedido: Pedido; onDelete: () => void; onCancel: () => void }) { return <article className="rounded-2xl border border-line bg-panel p-4"><div className="flex items-start justify-between gap-3"><Link to={`/pedidos/${pedido.id}`} className="flex min-w-0 flex-1 items-center gap-3"><ProductThumb pedido={pedido} size={40} /><div className="min-w-0"><strong className="text-sm tracking-wide">{pedido.codigo}</strong><p className="mt-1 truncate text-xs text-muted">{pedido.clientes?.nombre}</p></div></Link><div className="flex gap-1.5"><Link to={`/pedidos/${pedido.id}`} className="table-action table-action-open" aria-label="Abrir pedido"><ArrowUpRight size={17} /></Link>{pedido.estado !== 'cancelado' && <button className="table-action" onClick={onCancel} aria-label="Cancelar pedido" title="Cancelar pedido"><Ban size={17} /></button>}<button className="table-action table-action-danger" onClick={onDelete} aria-label="Eliminar pedido"><Trash2 size={17} /></button></div></div><Link to={`/pedidos/${pedido.id}`} className="block"><div className="mt-4"><Status estado={pedido.estado} /></div><div className="mt-4"><p className="truncate text-xs text-white/90">{nombreProducto(pedido)}</p>{primerItem(pedido)?.talla && <p className="mt-0.5 text-[11px] text-muted">Talla: {primerItem(pedido)?.talla}</p>}</div><div className="mt-3 flex items-end justify-between border-t border-line pt-3"><div><span className="block text-[10px] uppercase tracking-wider text-muted">Total</span><strong>${Number(pedido.total).toFixed(2)}</strong></div><div className="text-right"><span className="block text-[10px] uppercase tracking-wider text-muted">Saldo</span><strong className={pedido.saldo > 0 ? 'text-amber-300' : 'text-[#62eaa0]'}>${Number(pedido.saldo).toFixed(2)}</strong></div></div></Link></article> }
