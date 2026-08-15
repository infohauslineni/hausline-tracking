import { ArrowUpRight, Boxes, CalendarDays, CircleDollarSign, Package, Plus, Search, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { ESTADOS_PEDIDO, estadoLabel, estadoTone } from '../../constants/orders'
import { DEMO_PEDIDOS } from '../../data/demo'
import { isSupabaseConfigured } from '../../lib/supabase'
import { eliminarPedido, listarPedidos } from '../../services/pedidos.service'
import type { EstadoPedido, Pedido } from '../../types/domain'

export function PedidosPage() {
  const [pedidos, setPedidos] = useState<Pedido[]>(isSupabaseConfigured ? [] : DEMO_PEDIDOS)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [search, setSearch] = useState('')
  const [estado, setEstado] = useState<EstadoPedido | 'todos'>('todos')
  useEffect(() => { if (isSupabaseConfigured) void listarPedidos(setPedidos).then(setPedidos).catch(() => toast.error('No se pudieron cargar los pedidos.')).finally(() => setLoading(false)) }, [])

  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim()
    return pedidos.filter((pedido) => pedido.estado !== 'entregado' && (estado === 'todos' || pedido.estado === estado) && [pedido.codigo, pedido.clientes?.nombre, pedido.clientes?.whatsapp, ...(pedido.pedido_items?.map((item) => item.producto) ?? [])].some((value) => value?.toLowerCase().includes(term)))
  }, [estado, pedidos, search])

  const remove = async (pedido: Pedido) => {
    if (!window.confirm(`¿Eliminar el pedido ${pedido.codigo}? Se borrarán sus productos, tracking, eventos e imágenes. Esta acción no se puede deshacer.`)) return
    try {
      if (isSupabaseConfigured) await eliminarPedido(pedido.id)
      setPedidos((current) => current.filter((item) => item.id !== pedido.id))
      toast.success('Pedido eliminado.')
    } catch { toast.error('No se pudo eliminar el pedido.') }
  }

  return <div>
    {!isSupabaseConfigured && <div className="preview-banner"><strong>Vista previa local:</strong> mostrando los pedidos de demostración de Hausline.</div>}
    <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Operaciones</p><h1 className="page-title">Pedidos</h1><p className="page-subtitle">Controla productos, pagos y estado general.</p></div><Link to="/pedidos/nuevo" className="primary-button px-5"><Plus size={18} /> Nuevo pedido</Link></div>
    <section className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-3"><MiniMetric label="Total" value={pedidos.length} icon={Boxes} /><MiniMetric label="Activos" value={pedidos.filter((p) => !['entregado','cancelado'].includes(p.estado)).length} icon={CalendarDays} /><MiniMetric label="Con saldo" value={pedidos.filter((p) => p.saldo > 0).length} icon={CircleDollarSign} /></section>
    <div className="mt-6 flex flex-col gap-3 sm:flex-row"><div className="relative max-w-lg flex-1"><Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" size={18} /><input className="search-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Código, cliente, WhatsApp o producto" /></div><select className="select-input sm:w-64" value={estado} onChange={(e) => setEstado(e.target.value as EstadoPedido | 'todos')}><option value="todos">Todos los estados</option>{ESTADOS_PEDIDO.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
    {loading ? <div className="mt-5 h-80 animate-pulse rounded-2xl border border-line bg-panel" /> : filtered.length === 0 ? <div className="mt-6 grid min-h-64 place-items-center rounded-2xl border border-dashed border-line text-center"><div><Boxes className="mx-auto text-muted" /><h2 className="mt-3 font-semibold">No encontramos pedidos</h2><p className="mt-1 text-sm text-muted">Prueba otro término o filtro.</p></div></div> : <>
      <div className="mt-5 grid gap-3 md:hidden">{filtered.map((pedido) => <OrderCard pedido={pedido} onDelete={() => void remove(pedido)} key={pedido.id} />)}</div>
      <div className="mt-5 hidden overflow-hidden rounded-2xl border border-line bg-panel md:block"><table className="data-table"><thead><tr><th>Pedido</th><th>Cliente</th><th>Estado</th><th>Total / saldo</th><th>Actualización</th><th>Acciones</th></tr></thead><tbody>{filtered.map((pedido) => <tr key={pedido.id}><td><div className="flex items-center gap-3"><ProductThumb pedido={pedido} /><div className="min-w-0"><strong>{pedido.codigo}</strong><span>{pedido.pedido_items?.map((item) => item.producto).join(', ') || 'Sin productos'}</span></div></div></td><td><strong>{pedido.clientes?.nombre ?? 'Sin cliente'}</strong><span>{pedido.clientes?.whatsapp}</span></td><td><Status estado={pedido.estado} /></td><td><strong>${Number(pedido.total).toFixed(2)}</strong><span className={pedido.saldo > 0 ? 'text-amber-300!' : 'text-[#62eaa0]!'}>{pedido.saldo > 0 ? `Saldo $${Number(pedido.saldo).toFixed(2)}` : 'Pagado'}</span></td><td><span>{new Intl.DateTimeFormat('es-NI').format(new Date(pedido.updated_at))}</span></td><td><div className="flex justify-end gap-1.5"><Link to={`/pedidos/${pedido.id}`} className="table-action table-action-open" aria-label="Abrir pedido"><ArrowUpRight size={17} /></Link><button className="table-action table-action-danger" onClick={() => void remove(pedido)} aria-label="Eliminar pedido"><Trash2 size={17} /></button></div></td></tr>)}</tbody></table></div>
    </>}
  </div>
}

function MiniMetric({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Boxes }) { return <div className="flex items-center gap-3 rounded-xl border border-line bg-panel p-3 sm:p-4"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/[0.04] text-muted"><Icon size={18} /></span><div><strong className="block text-xl">{value}</strong><span className="text-[11px] text-muted">{label}</span></div></div> }
export function Status({ estado }: { estado: EstadoPedido }) { return <span className={`status-badge status-${estadoTone(estado)}`}>{estadoLabel(estado)}</span> }
// Miniatura del primer producto con foto (del catálogo); si no hay, muestra un ícono.
function ProductThumb({ pedido, size = 44 }: { pedido: Pedido; size?: number }) {
  const item = pedido.pedido_items?.find((i) => i.imagen) ?? pedido.pedido_items?.[0]
  const cantidad = pedido.pedido_items?.reduce((sum, i) => sum + Number(i.cantidad || 1), 0) ?? 0
  const style = { width: size, height: size }
  if (item?.imagen) return <div className="relative shrink-0 overflow-hidden rounded-xl bg-white/[0.04]" style={style}><img src={item.imagen} alt="" loading="lazy" className="size-full object-cover" />{cantidad > 1 && <span className="absolute bottom-0 right-0 rounded-tl-md bg-app/85 px-1 text-[10px] font-semibold leading-tight text-white">{cantidad}</span>}</div>
  return <div className="grid shrink-0 place-items-center rounded-xl bg-white/[0.04] text-muted" style={style}><Package size={Math.round(size * 0.42)} /></div>
}
function OrderCard({ pedido, onDelete }: { pedido: Pedido; onDelete: () => void }) { return <article className="rounded-2xl border border-line bg-panel p-4"><div className="flex items-start justify-between gap-3"><Link to={`/pedidos/${pedido.id}`} className="flex min-w-0 flex-1 items-center gap-3"><ProductThumb pedido={pedido} size={40} /><div className="min-w-0"><strong className="text-sm tracking-wide">{pedido.codigo}</strong><p className="mt-1 truncate text-xs text-muted">{pedido.clientes?.nombre}</p></div></Link><div className="flex gap-1.5"><Link to={`/pedidos/${pedido.id}`} className="table-action table-action-open" aria-label="Abrir pedido"><ArrowUpRight size={17} /></Link><button className="table-action table-action-danger" onClick={onDelete} aria-label="Eliminar pedido"><Trash2 size={17} /></button></div></div><Link to={`/pedidos/${pedido.id}`} className="block"><div className="mt-4"><Status estado={pedido.estado} /></div><p className="mt-4 truncate text-xs text-muted">{pedido.pedido_items?.map((item) => item.producto).join(', ')}</p><div className="mt-3 flex items-end justify-between border-t border-line pt-3"><div><span className="block text-[10px] uppercase tracking-wider text-muted">Total</span><strong>${Number(pedido.total).toFixed(2)}</strong></div><div className="text-right"><span className="block text-[10px] uppercase tracking-wider text-muted">Saldo</span><strong className={pedido.saldo > 0 ? 'text-amber-300' : 'text-[#62eaa0]'}>${Number(pedido.saldo).toFixed(2)}</strong></div></div></Link></article> }
