import { ArrowLeft, CreditCard, History, MapPin, MessageCircle, PackagePlus, Pencil, ShoppingBag } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { DEMO_CLIENTES, DEMO_PEDIDOS } from '../../data/demo'
import { isSupabaseConfigured } from '../../lib/supabase'
import { listarClientes } from '../../services/clientes.service'
import { listarPagos, obtenerTipoCambio } from '../../services/comercial.service'
import { listarPedidos } from '../../services/pedidos.service'
import type { Cliente, Pago, Pedido } from '../../types/domain'
import { estadoPago } from '../../utils/pedidoCosto'
import { whatsappUrl } from '../../utils/whatsapp'
import { ClienteModal } from './ClientesPage'
import { estadoLabel, estadoTone } from '../../constants/orders'
import { formatDate, PagoModal } from './PagosPage'

const money = (n: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0)

export function ClienteDetailPage() {
  const { id } = useParams()
  const [cliente, setCliente] = useState<Cliente | null>(isSupabaseConfigured ? null : DEMO_CLIENTES.find((c) => c.id === id) ?? null)
  const [pedidos, setPedidos] = useState<Pedido[]>(isSupabaseConfigured ? [] : DEMO_PEDIDOS)
  const [pagos, setPagos] = useState<Pago[]>([])
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [tipoCambio, setTipoCambio] = useState(37)
  const [editOpen, setEditOpen] = useState(false)
  const [abonoOpen, setAbonoOpen] = useState(false)

  const load = () => {
    if (!isSupabaseConfigured) return
    void Promise.all([listarClientes(), listarPedidos(), listarPagos()])
      .then(([clientes, orders, payments]) => { setCliente(clientes.find((c) => c.id === id) ?? null); setPedidos(orders); setPagos(payments) })
      .catch(() => toast.error('No se pudo cargar el cliente.'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [id])
  useEffect(() => { void obtenerTipoCambio().then(setTipoCambio).catch(() => undefined) }, [])

  const misPedidos = useMemo(() => pedidos.filter((p) => p.cliente_id === id).sort((a, b) => (b.fecha_pedido || '').localeCompare(a.fecha_pedido || '')), [pedidos, id])
  const misPagos = useMemo(() => pagos.filter((p) => p.cliente_id === id).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')), [pagos, id])

  const stats = useMemo(() => {
    const completados = misPedidos.filter((p) => p.estado === 'entregado').length
    const activos = misPedidos.filter((p) => !['entregado', 'cancelado'].includes(p.estado)).length
    const comprado = misPedidos.filter((p) => p.estado !== 'cancelado').reduce((s, p) => s + Number(p.total || 0), 0)
    const pagado = misPedidos.filter((p) => p.estado !== 'cancelado').reduce((s, p) => s + Number(p.abono || 0), 0)
    const saldo = misPedidos.filter((p) => p.estado !== 'cancelado').reduce((s, p) => s + Number(p.saldo || 0), 0)
    return { total: misPedidos.length, completados, activos, comprado, pagado, saldo }
  }, [misPedidos])

  if (loading) return <div className="grid min-h-96 place-items-center"><div className="loader" /></div>
  if (!cliente) return <div className="grid min-h-96 place-items-center text-muted"><div className="text-center"><p>Cliente no encontrado.</p><Link to="/clientes" className="subtle-button mx-auto mt-4">Volver a clientes</Link></div></div>

  const conSaldo = misPedidos.filter((p) => p.estado !== 'cancelado' && Number(p.saldo) > 0.01)

  return <div>
    <Link to="/clientes" className="mb-5 inline-flex items-center gap-2 text-xs text-muted transition hover:text-white"><ArrowLeft size={16} /> Volver a clientes</Link>

    <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex items-center gap-4">
        <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-accent/12 text-xl font-bold text-accent">{cliente.nombre.charAt(0).toUpperCase()}</span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{cliente.nombre}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span>{cliente.whatsapp}</span>
            {(cliente.ciudad || cliente.departamento) && <span className="flex items-center gap-1"><MapPin size={13} /> {[cliente.ciudad, cliente.departamento].filter(Boolean).join(', ')}</span>}
            <span>Registrado {formatDate(cliente.created_at)}</span>
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <a className="subtle-button px-4" href={whatsappUrl(cliente.whatsapp)} target="_blank" rel="noreferrer"><MessageCircle size={16} /> WhatsApp</a>
        <button className="subtle-button px-4" onClick={() => setEditOpen(true)}><Pencil size={16} /> Editar</button>
        {conSaldo.length > 0 && <button className="subtle-button px-4" onClick={() => setAbonoOpen(true)}><CreditCard size={16} /> Registrar abono</button>}
        <Link to="/pedidos/nuevo" className="primary-button px-5"><PackagePlus size={17} /> Nuevo pedido</Link>
      </div>
    </header>

    <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Stat label="Pedidos" value={String(stats.total)} />
      <Stat label="Completados" value={String(stats.completados)} tone="emerald" />
      <Stat label="Activos" value={String(stats.activos)} tone="blue" />
      <Stat label="Total comprado" value={`$${money(stats.comprado)}`} />
      <Stat label="Total pagado" value={`$${money(stats.pagado)}`} tone="emerald" />
      <Stat label="Saldo pendiente" value={`$${money(stats.saldo)}`} tone={stats.saldo > 0 ? 'amber' : 'accent'} />
    </section>

    <div className="mt-6 grid gap-5 xl:grid-cols-[1.5fr_1fr]">
      <section className="panel-card">
        <div className="panel-heading"><div><h2 className="flex items-center gap-2"><ShoppingBag size={17} className="text-accent" /> Historial de pedidos</h2><p>Todos los pedidos de este cliente</p></div></div>
        <div className="mt-4 hidden grid-cols-[.8fr_.7fr_.6fr_.6fr_.6fr] gap-3 px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted sm:grid"><span>Pedido</span><span>Fecha</span><span className="text-right">Total</span><span className="text-right">Pagado</span><span className="text-right">Saldo</span></div>
        <div className="divide-y divide-line">{misPedidos.length === 0 ? <p className="py-8 text-center text-xs text-muted">Sin pedidos todavía.</p> : misPedidos.map((p) => <Link key={p.id} to={`/pedidos/${p.id}`} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 rounded-lg px-2 py-3 transition hover:bg-white/[0.03] sm:grid-cols-[.8fr_.7fr_.6fr_.6fr_.6fr]">
          <div className="min-w-0"><div className="flex items-center gap-2"><strong className="text-sm">{p.codigo}</strong><span className={`status-badge status-${estadoTone(p.estado)}`}>{estadoLabel(p.estado)}</span></div><p className="mt-0.5 truncate text-xs text-muted">{p.pedido_items?.[0]?.producto ?? 'Producto'}</p></div>
          <span className="hidden text-xs text-muted sm:block">{formatDate(p.fecha_pedido)}</span>
          <strong className="text-right text-sm tabular-nums">${money(Number(p.total))}</strong>
          <strong className="hidden text-right text-sm tabular-nums text-emerald-300 sm:block">${money(Number(p.abono))}</strong>
          <strong className={`text-right text-sm tabular-nums ${Number(p.saldo) > 0 ? 'text-amber-300' : 'text-accent'}`}>${money(Number(p.saldo))}</strong>
        </Link>)}</div>
      </section>

      <section className="panel-card">
        <div className="panel-heading"><div><h2 className="flex items-center gap-2"><History size={17} className="text-accent" /> Historial de pagos</h2><p>Abonos y pagos recibidos</p></div></div>
        <div className="mt-4 space-y-2">{misPagos.length === 0 ? <p className="py-8 text-center text-xs text-muted">Sin pagos registrados.</p> : misPagos.map((p) => <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-white/[.02] px-3 py-2.5">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="text-xs capitalize">{p.tipo.replace('_', ' ')}</strong>{p.pedidos?.codigo && <span className="text-[10px] text-muted">{p.pedidos.codigo}</span>}</div><p className="truncate text-[11px] text-muted">{formatDate(p.fecha)} · {p.metodo_pago || 'Sin método'}{p.referencia ? ` · Ref. ${p.referencia}` : ''}</p></div>
          <strong className={`shrink-0 text-sm tabular-nums ${p.tipo === 'reembolso' ? 'text-red-300' : 'text-emerald-300'}`}>{p.tipo === 'reembolso' ? '−' : '+'} ${money(Number(p.monto))}</strong>
        </div>)}</div>
      </section>
    </div>

    <ClienteModal open={editOpen} cliente={cliente} onClose={() => setEditOpen(false)} onSaved={(saved) => { setCliente(saved); setEditOpen(false) }} />
    <PagoModal open={abonoOpen} pedidos={misPedidos} tipoCambio={tipoCambio} onClose={() => setAbonoOpen(false)} onSaved={() => { setAbonoOpen(false); load() }} />
  </div>
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'emerald' | 'blue' | 'amber' | 'accent' }) {
  const color = tone === 'emerald' ? 'text-emerald-300' : tone === 'blue' ? 'text-sky-300' : tone === 'amber' ? 'text-amber-300' : tone === 'accent' ? 'text-accent' : 'text-white'
  return <article className="metric-card"><p className="text-[11px] text-muted">{label}</p><strong className={`mt-1.5 block text-xl tabular-nums ${color}`}>{value}</strong></article>
}
