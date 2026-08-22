import { AlertTriangle, ArrowUpRight, CalendarClock, CheckCircle2, CircleDollarSign, Coins, CreditCard, PackagePlus, PackageSearch, Plus, ReceiptText, Search, UserPlus, Wallet } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { estadoLabel, estadoTone } from '../../constants/orders'
import { DEMO_PEDIDOS } from '../../data/demo'
import { isSupabaseConfigured } from '../../lib/supabase'
import { obtenerCajaMes, obtenerResumenComercial } from '../../services/comercial.service'
import { listarPedidos } from '../../services/pedidos.service'
import type { EstadoPedido, Pedido, ResumenComercial } from '../../types/domain'
import { periodoDeMes } from '../../utils/periodo'

const EMPTY_SUMMARY: ResumenComercial = { ventas: 0, cobrado: 0, por_cobrar: 0, gastos: 0, costos_productos: 0, saldo_cuenta: 0, pedidos: 0 }

export function DashboardPage() {
  const [pedidos, setPedidos] = useState<Pedido[]>(isSupabaseConfigured ? [] : DEMO_PEDIDOS)
  const [search, setSearch] = useState('')
  const [summary, setSummary] = useState<ResumenComercial>(EMPTY_SUMMARY)
  const [saldoMes, setSaldoMes] = useState(0)
  const [ventasAnterior, setVentasAnterior] = useState(0)
  const periodo = useMemo(() => periodoDeMes(), [])
  // Mes anterior, para el indicador de tendencia (▲/▼ %) de "Ventas del mes".
  const prevPeriodo = useMemo(() => periodoDeMes(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)), [])

  useEffect(() => {
    if (!isSupabaseConfigured) return
    void Promise.all([
      listarPedidos(setPedidos),
      obtenerResumenComercial(periodo.desde, periodo.hasta, setSummary).catch(() => EMPTY_SUMMARY),
      obtenerCajaMes(periodo.periodo, (c) => setSaldoMes(c.saldo_mes)).catch(() => null),
      obtenerResumenComercial(prevPeriodo.desde, prevPeriodo.hasta).catch(() => EMPTY_SUMMARY),
    ])
      .then(([orders, commercial, caja, prevCommercial]) => { setPedidos(orders); setSummary(commercial); setSaldoMes(caja ? caja.saldo_mes : commercial.saldo_cuenta); setVentasAnterior((prevCommercial as ResumenComercial).ventas) })
      .catch(() => undefined)
  }, [periodo, prevPeriodo])

  const term = search.trim().toLowerCase()
  const activos = pedidos.filter((p) => !['entregado', 'cancelado'].includes(p.estado))
  const porCobrar = pedidos.filter((p) => p.estado !== 'cancelado' && Number(p.saldo) > 0.01)
  const pendienteTotal = porCobrar.reduce((sum, p) => sum + Number(p.saldo), 0)
  const proximas = activos.filter((p) => p.fecha_estimada === isoDay(0) || p.fecha_estimada === isoDay(1)).sort((a, b) => String(a.fecha_estimada).localeCompare(String(b.fecha_estimada)))
  const atrasados = activos.filter((p) => diasDesde(p.fecha_pedido) > 35).sort((a, b) => diasDesde(b.fecha_pedido) - diasDesde(a.fecha_pedido))
  const resultados = term ? [...pedidos].filter((item) => [item.codigo, item.clientes?.nombre, item.clientes?.whatsapp].some((value) => value?.toLowerCase().includes(term))).sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 6) : []

  // Tendencia real vs mes pasado para "Ventas del mes" (▲ subió / ▼ bajó).
  const cambioVentas = ventasAnterior > 0 ? ((summary.ventas - ventasAnterior) / ventasAnterior) * 100 : null
  const trendVentas: Trend | undefined = cambioVentas != null ? { text: `${Math.abs(cambioVentas).toFixed(0)}%`, dir: cambioVentas >= 0 ? 'up' : 'down' } : undefined
  const trendCobrar: Trend | undefined = porCobrar.length > 0 ? { text: `${porCobrar.length} ${porCobrar.length === 1 ? 'pedido' : 'pedidos'}`, dir: 'flat' } : undefined
  const nombre = (import.meta.env.VITE_ADMIN_NOMBRE as string | undefined) || 'Hausline'

  return <div>
    <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="eyebrow">Resumen</p><h1 className="page-title">Hola, {nombre} 👋</h1><p className="page-subtitle">Un vistazo rápido de tu negocio.</p></div>
      <div className="relative w-full sm:w-72"><Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" size={18} /><input className="search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Código, cliente o WhatsApp" /></div>
    </div>

    {term ? <SearchResults resultados={resultados} /> : <>
      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <HeroMetric icon={CircleDollarSign} label="Ventas del mes" value={`USD ${summary.ventas.toFixed(2)}`} tone="blue" trend={trendVentas} />
        <HeroMetric icon={Wallet} label="Saldo de caja" value={`USD ${Number(saldoMes).toFixed(2)}`} tone="emerald" sub="Disponible" />
        <HeroMetric icon={ReceiptText} label="Por cobrar" value={`USD ${summary.por_cobrar.toFixed(2)}`} tone="warning" trend={trendCobrar} />
        <HeroMetric icon={CheckCircle2} label="Pedidos activos" value={String(activos.length)} tone="accent" sub="En proceso" />
      </section>

      <section className="mt-3 grid gap-3 lg:grid-cols-3">
        <ProximasEntregas pedidos={proximas} />
        <DineroPendiente cantidad={porCobrar.length} total={pendienteTotal} />
        <PedidosAtrasados pedidos={atrasados} />
      </section>

      <section className="mt-6 grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <RecentOrders pedidos={pedidos} />
        <QuickActions />
      </section>
    </>}
  </div>
}

type MetricTone = 'accent' | 'warning' | 'blue' | 'emerald' | 'danger'
const METRIC_PALETTE: Record<MetricTone, string> = { accent: 'text-accent', warning: 'text-amber-300', blue: 'text-sky-300', emerald: 'text-emerald-300', danger: 'text-red-300' }
const METRIC_TILE: Record<MetricTone, string> = { accent: 'bg-accent/10', warning: 'bg-amber-300/10', blue: 'bg-sky-300/10', emerald: 'bg-emerald-300/10', danger: 'bg-red-300/10' }
type Trend = { text: string; dir: 'up' | 'down' | 'flat' }
function HeroMetric({ icon: Icon, label, value, tone, trend, sub }: { icon: typeof Wallet; label: string; value: string; tone?: MetricTone; trend?: Trend; sub?: string }) {
  const color = tone ? METRIC_PALETTE[tone] : 'text-white'
  const iconColor = tone ? METRIC_PALETTE[tone] : 'text-muted'
  const trendColor = trend?.dir === 'up' ? 'text-emerald-300' : trend?.dir === 'down' ? 'text-red-300' : 'text-muted'
  const flecha = trend?.dir === 'up' ? '▲ ' : trend?.dir === 'down' ? '▼ ' : ''
  return <article className="metric-card"><div className="flex items-center justify-between"><span className={`grid size-10 place-items-center rounded-xl ${tone ? METRIC_TILE[tone] : 'bg-white/[0.04]'}`}><Icon size={20} className={iconColor} /></span>{trend && <span className={`font-mono text-[11px] font-bold ${trendColor}`}>{flecha}{trend.text}</span>}</div><p className="mt-4 text-sm text-muted">{label}</p><strong className={`font-display mt-1 block text-3xl font-extrabold tracking-tight tabular-nums sm:text-[2.1rem] ${color}`}>{value}</strong>{sub && <span className="mt-1 block text-[11px] text-muted">{sub}</span>}</article>
}

function ProximasEntregas({ pedidos }: { pedidos: Pedido[] }) {
  return <article className="panel-card"><div className="panel-heading"><div><h2 className="flex items-center gap-2"><CalendarClock size={17} className="text-accent" /> Próximas entregas</h2><p>Estimadas para hoy y mañana</p></div></div><div className="mt-4 space-y-2.5">{pedidos.length === 0 ? <p className="py-4 text-center text-xs text-muted">No hay entregas para hoy o mañana.</p> : pedidos.slice(0, 5).map((p) => <Link to={`/pedidos/${p.id}`} key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-white/[0.02] px-3 py-2.5 transition hover:border-accent/40"><div className="min-w-0"><strong className="block truncate text-sm">{p.clientes?.nombre ?? 'Cliente'}</strong><span className="text-[11px] text-muted">{p.codigo}</span></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${p.fecha_estimada === isoDay(0) ? 'bg-accent/15 text-accent' : 'bg-white/[0.06] text-muted'}`}>{p.fecha_estimada === isoDay(0) ? 'Hoy' : 'Mañana'}</span></Link>)}</div></article>
}

function DineroPendiente({ cantidad, total }: { cantidad: number; total: number }) {
  return <article className="panel-card flex flex-col"><div className="panel-heading"><div><h2 className="flex items-center gap-2"><Coins size={17} className="text-accent" /> Dinero pendiente de cobrar</h2><p>Saldos de pedidos activos</p></div></div><div className="mt-5 flex-1"><p className="text-sm text-muted">{cantidad} {cantidad === 1 ? 'pedido' : 'pedidos'}</p><strong className="mt-1 block text-4xl font-bold tracking-tight text-amber-300">USD {total.toFixed(2)}</strong></div><Link to="/pagos" className="subtle-button mt-5 w-fit">Ver pedidos <ArrowUpRight size={15} /></Link></article>
}

function PedidosAtrasados({ pedidos }: { pedidos: Pedido[] }) {
  const hay = pedidos.length > 0
  return <article className={`panel-card ${hay ? 'border-red-400/40 bg-red-400/[0.05]' : ''}`}><div className="panel-heading"><div><h2 className="flex items-center gap-2"><AlertTriangle size={17} className={hay ? 'text-red-300' : 'text-accent'} /> Pedidos atrasados</h2><p>Más de 35 días sin entregar</p></div></div>{!hay ? <p className="mt-4 py-4 text-center text-xs text-muted">No hay pedidos atrasados.</p> : <><strong className="mt-4 block text-3xl font-bold text-red-300">⚠ {pedidos.length} {pedidos.length === 1 ? 'pedido retrasado' : 'pedidos retrasados'}</strong><div className="mt-3 space-y-2">{pedidos.slice(0, 3).map((p) => <Link to={`/pedidos/${p.id}`} key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-red-400/20 bg-black/10 px-3 py-2 transition hover:border-red-400/50"><div className="min-w-0"><strong className="block truncate text-xs">{p.clientes?.nombre ?? 'Cliente'}</strong><span className="text-[10px] text-muted">{p.codigo}</span></div><span className="shrink-0 text-[11px] font-bold text-red-300">{diasDesde(p.fecha_pedido)} días</span></Link>)}</div><Link to="/pedidos" className="subtle-button mt-4 w-fit">Ver todos los pedidos <ArrowUpRight size={15} /></Link></>}</article>
}

function StatusBadge({ estado }: { estado: EstadoPedido }) { return <span className={`status-badge status-${estadoTone(estado)}`}>{estadoLabel(estado)}</span> }

function RecentOrders({ pedidos }: { pedidos: Pedido[] }) {
  const recientes = [...pedidos].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 6)
  return <article className="panel-card"><div className="panel-heading"><div><h2 className="flex items-center gap-2"><PackageSearch size={17} className="text-accent" /> Pedidos recientes</h2><p>Últimos movimientos</p></div><Link to="/pedidos" className="subtle-button">Ver todos <ArrowUpRight size={15} /></Link></div>
    <div className="mt-4 divide-y divide-line">{recientes.length === 0 ? <p className="py-8 text-center text-xs text-muted">Sin pedidos todavía.</p> : recientes.map((p) => <Link to={`/pedidos/${p.id}`} key={p.id} className="flex items-center gap-3 py-3 transition hover:opacity-80">
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{p.codigo}</strong><StatusBadge estado={p.estado} /></div><p className="mt-0.5 truncate text-xs text-muted">{p.clientes?.nombre ?? 'Sin cliente'}</p></div>
      <div className="shrink-0 text-right"><strong className="block text-sm tabular-nums">${Number(p.total).toFixed(2)}</strong><span className="text-[11px] text-muted">{new Intl.DateTimeFormat('es-NI', { day: 'numeric', month: 'short' }).format(new Date(p.updated_at))}</span></div>
      <ArrowUpRight size={16} className="shrink-0 text-muted" />
    </Link>)}</div></article>
}

function QuickActions() {
  const acciones = [
    { to: '/pedidos/nuevo', label: 'Nuevo pedido', icon: PackagePlus },
    { to: '/pagos', label: 'Registrar pago', icon: CreditCard },
    { to: '/clientes', label: 'Nuevo cliente', icon: UserPlus },
    { to: '/gastos', label: 'Registrar gasto', icon: ReceiptText },
  ]
  return <article className="panel-card"><div className="panel-heading"><div><h2 className="flex items-center gap-2"><Plus size={17} className="text-accent" /> Accesos rápidos</h2><p>Crea en un toque</p></div></div>
    <div className="mt-4 grid gap-2.5">{acciones.map(({ to, label, icon: Icon }) => <Link key={to} to={to} className="flex items-center gap-3 rounded-xl border border-line bg-white/[0.02] px-4 py-3.5 transition hover:border-accent/50 hover:bg-accent/[0.04]"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent"><Icon size={18} /></span><span className="text-sm font-semibold">{label}</span><Plus size={15} className="ml-auto text-muted" /></Link>)}</div></article>
}

function SearchResults({ resultados }: { resultados: Pedido[] }) {
  return <section className="mt-6"><article className="panel-card"><div className="panel-heading"><div><h2>Resultados de búsqueda</h2><p>{resultados.length} coincidencia(s)</p></div><Link to="/pedidos" className="subtle-button">Ver todos <ArrowUpRight size={15} /></Link></div><div className="mt-4 divide-y divide-line">{resultados.map((order) => <Link to={`/pedidos/${order.id}`} className="flex items-center gap-3 py-4" key={order.id}><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/[0.04]"><PackageSearch size={18} className="text-muted" /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><strong className="text-sm">{order.codigo}</strong><StatusBadge estado={order.estado} /></div><p className="truncate text-xs text-muted">{order.clientes?.nombre}</p></div><div className="hidden text-right sm:block"><p className="text-xs font-medium">${Number(order.total).toFixed(2)}</p><p className="mt-1 text-[11px] text-muted">{relativeDate(order.updated_at)}</p></div></Link>)}{resultados.length === 0 && <div className="py-8 text-center text-xs text-muted">Sin coincidencias.</div>}</div></article></section>
}

// Fecha (YYYY-MM-DD) desplazada `offset` días desde hoy, en hora local.
function isoDay(offset: number) { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
function diasDesde(dateStr: string) { const target = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T12:00:00`); return Math.floor((Date.now() - target.getTime()) / 86_400_000) }
function relativeDate(value: string) { const hours = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 3_600_000)); if (hours < 1) return 'Actualizado recientemente'; if (hours < 24) return `Actualizado hace ${hours} h`; return `Actualizado hace ${Math.floor(hours / 24)} d` }
