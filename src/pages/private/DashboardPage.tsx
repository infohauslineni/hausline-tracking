import { Activity, AlertTriangle, ArrowUpRight, BarChart3, CalendarClock, CheckCircle2, CircleDollarSign, Clapperboard, Coins, CreditCard, PackagePlus, PackageSearch, Plane, Plus, ReceiptText, Search, TrendingUp, UserPlus, Wallet } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { estadoLabel } from '../../constants/orders'
import { DEMO_PEDIDOS } from '../../data/demo'
import { DEMO_TRAYECTOS } from '../../data/demoLogistics'
import { isSupabaseConfigured } from '../../lib/supabase'
import { listarGastos, listarPagos, obtenerCajaMes, obtenerResumenComercial } from '../../services/comercial.service'
import { listarIdeasContenido } from '../../services/contenido.service'
import { listarTrayectos } from '../../services/logistica.service'
import { listarPedidos } from '../../services/pedidos.service'
import type { EstadoPedido, Gasto, IdeaContenido, Pago, Pedido, ResumenComercial, Trayecto } from '../../types/domain'
import { periodoDeMes } from '../../utils/periodo'
import { promedioDiasTransito } from '../../utils/transito'

const EMPTY_SUMMARY: ResumenComercial = { ventas: 0, cobrado: 0, por_cobrar: 0, gastos: 0, costos_productos: 0, saldo_cuenta: 0, pedidos: 0 }

export function DashboardPage() {
  const [pedidos, setPedidos] = useState<Pedido[]>(isSupabaseConfigured ? [] : DEMO_PEDIDOS)
  const [search, setSearch] = useState('')
  const [summary, setSummary] = useState<ResumenComercial>(EMPTY_SUMMARY)
  const [pagos, setPagos] = useState<Pago[]>([])
  const [gastos, setGastos] = useState<Gasto[]>([])
  const [ideas, setIdeas] = useState<IdeaContenido[]>([])
  const [trayectos, setTrayectos] = useState<Trayecto[]>(isSupabaseConfigured ? [] : DEMO_TRAYECTOS)
  const [saldoMes, setSaldoMes] = useState(0)
  const periodo = useMemo(() => periodoDeMes(), [])

  useEffect(() => {
    if (!isSupabaseConfigured) return
    void Promise.all([listarPedidos(), obtenerResumenComercial(periodo.desde, periodo.hasta).catch(() => EMPTY_SUMMARY), listarPagos(), listarGastos(), listarIdeasContenido().catch(() => []), obtenerCajaMes(periodo.periodo).catch(() => null), listarTrayectos().catch(() => [])])
      .then(([orders, commercial, payments, expenses, content, caja, routes]) => { setPedidos(orders); setSummary(commercial); setPagos(payments); setGastos(expenses); setIdeas(content); setSaldoMes(caja ? caja.saldo_mes : commercial.saldo_cuenta); setTrayectos(routes) })
      .catch(() => undefined)
  }, [periodo])

  const transitoNormal = useMemo(() => promedioDiasTransito(trayectos), [trayectos])

  const costosSinGasto = pedidos.reduce((total, pedido) => {
    const compraYaRegistrada = pedido.gastos?.some((gasto) => gasto.categoria.toLowerCase().includes('proveedor'))
    if (compraYaRegistrada) return total
    return total + (pedido.pedido_items ?? []).reduce((sum, item) => sum + Number(item.cantidad || 1) * (Number(item.precio_compra || 0) + Number(item.envio_internacional || 0) + Number(item.costo_delivery || 0) + Number(item.otros_gastos || 0)), 0)
  }, 0)
  const term = search.trim().toLowerCase()
  const activos = pedidos.filter((p) => !['entregado', 'cancelado'].includes(p.estado))
  const porCobrar = pedidos.filter((p) => p.estado !== 'cancelado' && Number(p.saldo) > 0.01)
  const pendienteTotal = porCobrar.reduce((sum, p) => sum + Number(p.saldo), 0)
  const proximas = activos.filter((p) => p.fecha_estimada === isoDay(0) || p.fecha_estimada === isoDay(1)).sort((a, b) => String(a.fecha_estimada).localeCompare(String(b.fecha_estimada)))
  const atrasados = activos.filter((p) => diasDesde(p.fecha_pedido) > 35).sort((a, b) => diasDesde(b.fecha_pedido) - diasDesde(a.fecha_pedido))
  const resultados = term ? [...pedidos].filter((item) => [item.codigo, item.clientes?.nombre, item.clientes?.whatsapp].some((value) => value?.toLowerCase().includes(term))).sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 6) : []
  const feed = useMemo(() => construirFeed(pedidos, pagos), [pedidos, pagos])
  const chartDays = useMemo(() => lastDays(7).map((date) => ({
    date,
    label: new Intl.DateTimeFormat('es-NI', { weekday: 'short' }).format(new Date(`${date}T12:00:00`)).replace('.', ''),
    ventas: pedidos.filter((order) => order.fecha_pedido === date).reduce((sum, order) => sum + Number(order.total), 0),
    entradas: pagos.filter((payment) => payment.fecha === date && payment.tipo !== 'reembolso').reduce((sum, payment) => sum + Number(payment.monto), 0),
    salidas: gastos.filter((expense) => expense.fecha === date).reduce((sum, expense) => sum + Number(expense.monto), 0),
  })), [pedidos, pagos, gastos])

  return <div>
    <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Panel operativo</p><h1 className="page-title">Buenos días, Hausline.</h1><p className="page-subtitle">Aquí tienes el estado de tus operaciones.</p></div><div className="relative w-full sm:w-72"><Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" size={18} /><input className="search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Código, cliente o WhatsApp" /></div></div>

    <QuickActions />

    {term ? <SearchResults resultados={resultados} /> : <>
      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <HeroMetric icon={CircleDollarSign} label="Ventas del mes" value={`USD ${summary.ventas.toFixed(2)}`} tone="blue" />
        <HeroMetric icon={Wallet} label="Saldo de caja" value={`USD ${Number(saldoMes).toFixed(2)}`} tone="emerald" />
        <HeroMetric icon={ReceiptText} label="Por cobrar" value={`USD ${summary.por_cobrar.toFixed(2)}`} tone="warning" />
        <HeroMetric icon={CheckCircle2} label="Pedidos activos" value={String(activos.length)} tone="accent" />
      </section>

      <section className="mt-3 grid gap-3 lg:grid-cols-3">
        <ProximasEntregas pedidos={proximas} />
        <DineroPendiente cantidad={porCobrar.length} total={pendienteTotal} />
        <PedidosAtrasados pedidos={atrasados} />
      </section>

      <EstadoTarjetas pedidos={pedidos} />

      <TransitoNormal data={transitoNormal} />

      <section className="mt-6 grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <ActivityFeed feed={feed} />
        <StatusChart pedidos={pedidos} />
      </section>

      <ContentSummary ideas={ideas} pedidos={pedidos} />

      <section className="mt-6 grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <SalesChart data={chartDays} />
        <div className="grid gap-3 sm:grid-cols-2">
          <HeroMetric icon={TrendingUp} label="Ganancia estimada del mes" value={`USD ${(summary.ventas - summary.gastos - costosSinGasto).toFixed(2)}`} tone={summary.ventas - summary.gastos - costosSinGasto >= 0 ? 'emerald' : 'danger'} />
          <HeroMetric icon={ReceiptText} label="Gastos del mes" value={`USD ${summary.gastos.toFixed(2)}`} tone="danger" />
        </div>
      </section>
      <section className="mt-5"><CashFlowChart data={chartDays} /></section>
    </>}
  </div>
}

function QuickActions() {
  const acciones = [
    { to: '/pedidos/nuevo', label: 'Nuevo pedido', icon: PackagePlus },
    { to: '/pagos', label: 'Registrar pago', icon: CreditCard },
    { to: '/clientes', label: 'Nuevo cliente', icon: UserPlus },
    { to: '/gastos', label: 'Registrar gasto', icon: ReceiptText },
  ]
  return <section className="mt-6 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">{acciones.map(({ to, label, icon: Icon }) => <Link key={to} to={to} className="flex items-center gap-3 rounded-2xl border border-line bg-white/[0.02] px-4 py-3.5 transition hover:border-accent/50 hover:bg-accent/[0.04]"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent"><Icon size={18} /></span><span className="text-sm font-semibold">{label}</span><Plus size={15} className="ml-auto text-muted" /></Link>)}</section>
}

type MetricTone = 'accent' | 'warning' | 'blue' | 'emerald' | 'danger'
const METRIC_PALETTE: Record<MetricTone, string> = { accent: 'text-accent', warning: 'text-amber-300', blue: 'text-sky-300', emerald: 'text-emerald-300', danger: 'text-red-300' }
function HeroMetric({ icon: Icon, label, value, tone }: { icon: typeof Wallet; label: string; value: string; tone?: MetricTone }) {
  const color = tone ? METRIC_PALETTE[tone] : 'text-white'
  const iconColor = tone ? METRIC_PALETTE[tone] : 'text-muted'
  return <article className="metric-card"><div className="flex items-center justify-between"><Icon size={22} className={iconColor} /></div><p className="mt-5 text-sm text-muted">{label}</p><strong className={`mt-1.5 block text-3xl font-bold tracking-tight sm:text-[2.1rem] ${color}`}>{value}</strong></article>
}

function ProximasEntregas({ pedidos }: { pedidos: Pedido[] }) {
  return <article className="panel-card"><div className="panel-heading"><div><h2 className="flex items-center gap-2"><CalendarClock size={17} className="text-accent" /> Próximas entregas</h2><p>Estimadas para hoy y mañana</p></div></div><div className="mt-4 space-y-2.5">{pedidos.length === 0 ? <p className="py-4 text-center text-xs text-muted">Sin entregas para hoy o mañana.</p> : pedidos.slice(0, 5).map((p) => <Link to={`/pedidos/${p.id}`} key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-white/[0.02] px-3 py-2.5 transition hover:border-accent/40"><div className="min-w-0"><strong className="block truncate text-sm">{p.clientes?.nombre ?? 'Cliente'}</strong><span className="text-[11px] text-muted">{p.codigo}</span></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${p.fecha_estimada === isoDay(0) ? 'bg-accent/15 text-accent' : 'bg-white/[0.06] text-muted'}`}>{p.fecha_estimada === isoDay(0) ? 'Hoy' : 'Mañana'}</span></Link>)}</div></article>
}

function DineroPendiente({ cantidad, total }: { cantidad: number; total: number }) {
  return <article className="panel-card flex flex-col"><div className="panel-heading"><div><h2 className="flex items-center gap-2"><Coins size={17} className="text-accent" /> Dinero pendiente de cobrar</h2><p>Saldos de pedidos activos</p></div></div><div className="mt-5 flex-1"><p className="text-sm text-muted">{cantidad} {cantidad === 1 ? 'pedido' : 'pedidos'}</p><strong className="mt-1 block text-4xl font-bold tracking-tight text-amber-300">USD {total.toFixed(2)}</strong></div><Link to="/pagos" className="subtle-button mt-5 w-fit">Ver pedidos <ArrowUpRight size={15} /></Link></article>
}

function PedidosAtrasados({ pedidos }: { pedidos: Pedido[] }) {
  const hay = pedidos.length > 0
  return <article className={`panel-card ${hay ? 'border-red-400/40 bg-red-400/[0.05]' : ''}`}><div className="panel-heading"><div><h2 className="flex items-center gap-2"><AlertTriangle size={17} className={hay ? 'text-red-300' : 'text-accent'} /> Pedidos atrasados</h2><p>Más de 35 días sin entregar</p></div></div>{!hay ? <p className="mt-4 py-4 text-center text-xs text-muted">Ningún pedido atrasado. 👌</p> : <><strong className="mt-4 block text-3xl font-bold text-red-300">⚠ {pedidos.length} {pedidos.length === 1 ? 'pedido retrasado' : 'pedidos retrasados'}</strong><div className="mt-3 space-y-2">{pedidos.slice(0, 3).map((p) => <Link to={`/pedidos/${p.id}`} key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-red-400/20 bg-black/10 px-3 py-2 transition hover:border-red-400/50"><div className="min-w-0"><strong className="block truncate text-xs">{p.clientes?.nombre ?? 'Cliente'}</strong><span className="text-[10px] text-muted">{p.codigo}</span></div><span className="shrink-0 text-[11px] font-bold text-red-300">{diasDesde(p.fecha_pedido)} días</span></Link>)}</div></>}</article>
}

function EstadoTarjetas({ pedidos }: { pedidos: Pedido[] }) {
  const cards = [
    { label: 'Confirmados', states: ['pedido_confirmado'] },
    { label: 'Producción', states: ['en_preparacion'] },
    { label: 'Calidad', states: ['control_calidad'] },
    { label: 'Despachados', states: ['etiqueta_creada', 'despachado'] },
    { label: 'En tránsito', states: ['transito_internacional', 'recibido_estados_unidos', 'transito_nicaragua'] },
    { label: 'En Nicaragua', states: ['llego_nicaragua'] },
    { label: 'Disponibles', states: ['disponible_entrega'] },
    { label: 'Entregados', states: ['entregado'] },
  ].map((c) => ({ ...c, value: pedidos.filter((p) => c.states.includes(p.estado)).length }))
  return <section className="mt-3"><article className="panel-card"><div className="panel-heading"><div><h2 className="flex items-center gap-2"><PackageSearch size={17} className="text-accent" /> Estado de pedidos</h2><p>Cuántos hay en cada etapa</p></div></div><div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:grid-cols-8">{cards.map((c) => <div key={c.label} className="rounded-xl border border-line bg-white/[0.02] p-3 text-center"><strong className={`block text-2xl font-bold tracking-tight ${c.value > 0 ? 'text-accent' : 'text-muted'}`}>{c.value}</strong><span className="mt-1 block text-[10px] leading-tight text-muted">{c.label}</span></div>)}</div></article></section>
}

function TransitoNormal({ data }: { data: ReturnType<typeof promedioDiasTransito> }) {
  return <section className="mt-3"><article className="panel-card"><div className="panel-heading"><div><h2 className="flex items-center gap-2"><Plane size={17} className="text-accent" /> Días en tránsito</h2><p>Desde el despacho hasta que llega al país</p></div></div>
    {!data ? <p className="mt-4 py-4 text-center text-xs text-muted">Aún no hay pedidos con despacho y llegada registrados para calcular el promedio.</p> : <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div className="rounded-xl border border-accent/25 bg-accent/[0.05] p-4 text-center"><strong className="block text-3xl font-bold tracking-tight text-accent">{data.promedio}</strong><span className="mt-1 block text-[10px] font-semibold uppercase tracking-wider text-muted">Días normal (promedio)</span></div>
      <div className="rounded-xl border border-line bg-white/[0.02] p-4 text-center"><strong className="block text-3xl font-bold tracking-tight">{data.min}</strong><span className="mt-1 block text-[10px] font-semibold uppercase tracking-wider text-muted">Más rápido</span></div>
      <div className="rounded-xl border border-line bg-white/[0.02] p-4 text-center"><strong className="block text-3xl font-bold tracking-tight">{data.max}</strong><span className="mt-1 block text-[10px] font-semibold uppercase tracking-wider text-muted">Más lento</span></div>
      <div className="rounded-xl border border-line bg-white/[0.02] p-4 text-center"><strong className="block text-3xl font-bold tracking-tight">{data.muestra}</strong><span className="mt-1 block text-[10px] font-semibold uppercase tracking-wider text-muted">Pedidos medidos</span></div>
    </div>}
  </article></section>
}

function SearchResults({ resultados }: { resultados: Pedido[] }) {
  return <section className="mt-6"><article className="panel-card"><div className="panel-heading"><div><h2>Resultados de búsqueda</h2><p>{resultados.length} coincidencia(s)</p></div><Link to="/pedidos" className="subtle-button">Ver todos <ArrowUpRight size={15} /></Link></div><div className="mt-4 divide-y divide-line">{resultados.map((order) => <Link to={`/pedidos/${order.id}`} className="flex items-center gap-3 py-4" key={order.id}><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/[0.04]"><PackageSearch size={18} className="text-muted" /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><strong className="text-sm">{order.codigo}</strong><span className={`order-dot ${statusColor(order.estado)}`} /></div><p className="truncate text-xs text-muted">{order.clientes?.nombre}</p></div><div className="hidden text-right sm:block"><p className="text-xs font-medium">{estadoLabel(order.estado)}</p><p className="mt-1 text-[11px] text-muted">{relativeDate(order.updated_at)}</p></div></Link>)}{resultados.length === 0 && <div className="py-8 text-center text-xs text-muted">Sin coincidencias.</div>}</div></article></section>
}

type FeedItem = { id: string; kind: 'pago' | 'estado' | 'nuevo'; text: string; sub?: string; time: number }
function construirFeed(pedidos: Pedido[], pagos: Pago[]): FeedItem[] {
  const items: FeedItem[] = []
  for (const p of pagos) {
    const verbo = p.tipo === 'abono_inicial' ? 'pagó el depósito inicial' : p.tipo === 'pago_final' ? 'pagó el saldo final' : p.tipo === 'reembolso' ? 'recibió un reembolso' : 'abonó'
    items.push({ id: `pago-${p.id}`, kind: 'pago', text: `${p.clientes?.nombre ?? 'Cliente'} ${verbo}`, sub: `USD ${Number(p.monto).toFixed(2)}${p.pedidos?.codigo ? ` · ${p.pedidos.codigo}` : ''}`, time: new Date(p.created_at ?? p.fecha).getTime() })
  }
  for (const o of pedidos) {
    items.push({ id: `nuevo-${o.id}`, kind: 'nuevo', text: `Nuevo pedido ${o.codigo}`, sub: o.clientes?.nombre ?? undefined, time: new Date(o.created_at).getTime() })
    if (o.estado !== 'pedido_confirmado' && new Date(o.updated_at).getTime() - new Date(o.created_at).getTime() > 60_000) {
      items.push({ id: `estado-${o.id}`, kind: 'estado', text: `${o.codigo} · ${estadoLabel(o.estado)}`, sub: o.clientes?.nombre ?? undefined, time: new Date(o.updated_at).getTime() })
    }
  }
  return items.sort((a, b) => b.time - a.time).slice(0, 8)
}

function ActivityFeed({ feed }: { feed: FeedItem[] }) {
  const color = (kind: FeedItem['kind']) => kind === 'pago' ? 'bg-green-400/15 text-green-300' : kind === 'nuevo' ? 'bg-accent/15 text-accent' : 'bg-blue-400/15 text-blue-300'
  const icon = (kind: FeedItem['kind']) => kind === 'pago' ? <Coins size={16} /> : kind === 'nuevo' ? <PackagePlus size={16} /> : <PackageSearch size={16} />
  return <article className="panel-card"><div className="panel-heading"><div><h2 className="flex items-center gap-2"><Activity size={17} className="text-accent" /> Actividad reciente</h2><p>Pagos, nuevos pedidos y cambios de estado</p></div></div><div className="mt-4 divide-y divide-line">{feed.length === 0 ? <div className="py-8 text-center text-xs text-muted">Sin actividad todavía.</div> : feed.map((item) => <div key={item.id} className="flex items-center gap-3 py-3"><span className={`grid size-9 shrink-0 place-items-center rounded-xl ${color(item.kind)}`}>{icon(item.kind)}</span><div className="min-w-0 flex-1"><strong className="block truncate text-sm">{item.text}</strong>{item.sub && <span className="truncate text-xs text-muted">{item.sub}</span>}</div><span className="shrink-0 text-[11px] text-muted">{relativeTime(item.time)}</span></div>)}</div></article>
}

function ContentSummary({ ideas, pedidos }: { ideas: IdeaContenido[]; pedidos: Pedido[] }) {
  const pending = ideas.filter((idea) => idea.estado === 'pendiente_grabacion')
  const orders = new Map(pedidos.map((order) => [order.id, order]))
  return <section className="mt-6"><article className="panel-card">
    <div className="panel-heading"><div><h2 className="flex items-center gap-2"><Clapperboard size={17} className="text-accent" /> Contenido por grabar</h2><p>Ideas privadas asociadas a tus pedidos</p></div><div className="flex items-center gap-3"><strong className="text-2xl text-accent">{pending.length}</strong><Link to="/contenido" className="subtle-button">Abrir catálogo <ArrowUpRight size={15} /></Link></div></div>
    <div className="mt-4 grid gap-3 md:grid-cols-3">{pending.slice(0, 3).map((idea) => {
      const order = idea.pedido_id ? orders.get(idea.pedido_id) : null
      return <Link to="/contenido" className="rounded-xl border border-line bg-white/[0.02] p-4 transition hover:border-accent/40" key={idea.id}><span className="text-[10px] font-semibold uppercase tracking-wider text-accent">{idea.formato}</span><strong className="mt-2 block text-sm">{idea.titulo}</strong><p className="mt-2 truncate text-[11px] text-muted">{order ? `${order.codigo} · ${order.clientes?.nombre ?? 'Pedido asociado'}` : 'Sin pedido asociado'}</p></Link>
    })}{pending.length === 0 && <div className="col-span-full py-4 text-center text-xs text-muted">No tienes grabaciones pendientes.</div>}</div>
  </article></section>
}

type ChartDay = { date: string; label: string; ventas: number; entradas: number; salidas: number }
function SalesChart({ data }: { data: ChartDay[] }) {
  const max = Math.max(1, ...data.map((item) => item.ventas))
  return <article className="panel-card"><div className="panel-heading"><div><h2 className="flex items-center gap-2"><BarChart3 size={17} className="text-accent" /> Ventas de los últimos 7 días</h2><p>Valor de pedidos registrados por día</p></div></div><div className="mt-7 flex h-48 items-end gap-2 sm:gap-4">{data.map((item) => <div className="flex h-full min-w-0 flex-1 flex-col justify-end" key={item.date}><div className="mb-2 text-center text-[9px] font-semibold text-muted">{item.ventas > 0 ? `$${item.ventas.toFixed(0)}` : ''}</div><div title={`${item.date}: USD ${item.ventas.toFixed(2)}`} className="min-h-1 rounded-t-lg bg-gradient-to-t from-[#739f00] to-accent transition-all hover:brightness-125" style={{ height: `${Math.max(3, (item.ventas / max) * 100)}%` }} /><span className="mt-2 text-center text-[10px] capitalize text-muted">{item.label}</span></div>)}</div></article>
}

function StatusChart({ pedidos }: { pedidos: Pedido[] }) {
  const groups = [
    { label: 'Confirmada', states: ['pedido_confirmado'], color: 'bg-slate-400' },
    { label: 'Preparación', states: ['en_preparacion'], color: 'bg-blue-400' },
    { label: 'Calidad', states: ['control_calidad'], color: 'bg-yellow-300' },
    { label: 'Despachado', states: ['etiqueta_creada','despachado'], color: 'bg-sky-300' },
    { label: 'En tránsito', states: ['transito_internacional','recibido_estados_unidos','transito_nicaragua'], color: 'bg-violet-400' },
    { label: 'País destino', states: ['llego_nicaragua'], color: 'bg-cyan-300' },
    { label: 'Disponible', states: ['disponible_entrega'], color: 'bg-accent' },
    { label: 'Entregado', states: ['entregado'], color: 'bg-green-400' },
  ].map((group) => ({ ...group, value: pedidos.filter((order) => group.states.includes(order.estado)).length }))
  const max = Math.max(1, ...groups.map((group) => group.value))
  return <article className="panel-card"><div className="panel-heading"><div><h2>Pedidos por etapa</h2><p>Distribución actual de operaciones</p></div></div><div className="mt-5 space-y-3">{groups.map((group) => <div key={group.label}><div className="mb-1.5 flex justify-between text-[11px]"><span className="text-muted">{group.label}</span><strong>{group.value}</strong></div><div className="h-2 overflow-hidden rounded-full bg-white/[.05]"><div className={`h-full rounded-full ${group.color}`} style={{ width: `${(group.value / max) * 100}%` }} /></div></div>)}</div></article>
}

function CashFlowChart({ data }: { data: ChartDay[] }) {
  const max = Math.max(1, ...data.flatMap((item) => [item.entradas, item.salidas]))
  const totalEntradas = data.reduce((sum, item) => sum + item.entradas, 0)
  const totalSalidas = data.reduce((sum, item) => sum + item.salidas, 0)
  const neto = totalEntradas - totalSalidas
  const [selected, setSelected] = useState<number | null>(null)
  const activo = selected != null ? data[selected] : null
  return <article className="panel-card">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div><h2>Flujo de dinero</h2><p className="mt-1 text-xs text-muted">Pagos recibidos frente a gastos (últimos 7 días)</p></div>
      <div className="flex gap-2">
        <div className="rounded-xl border border-green-400/20 bg-green-400/[.06] px-3 py-2"><span className="flex items-center gap-1.5 text-[10px] text-muted"><i className="size-2 rounded-full bg-green-400" /> Entradas</span><strong className="mt-0.5 block text-sm text-green-300">USD {totalEntradas.toFixed(2)}</strong></div>
        <div className="rounded-xl border border-red-400/20 bg-red-400/[.06] px-3 py-2"><span className="flex items-center gap-1.5 text-[10px] text-muted"><i className="size-2 rounded-full bg-red-400" /> Salidas</span><strong className="mt-0.5 block text-sm text-red-300">USD {totalSalidas.toFixed(2)}</strong></div>
      </div>
    </div>
    <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-line bg-white/[.02] px-4 py-2.5 text-xs">
      <span className="capitalize text-muted">{activo ? new Intl.DateTimeFormat('es-NI', { weekday: 'long', day: 'numeric', month: 'short' }).format(new Date(`${activo.date}T12:00:00`)) : 'Balance neto de la semana'}</span>
      {activo
        ? <span className="flex shrink-0 gap-3 font-semibold"><b className="text-green-300">+{activo.entradas.toFixed(2)}</b><b className="text-red-300">−{activo.salidas.toFixed(2)}</b></span>
        : <strong className={`shrink-0 ${neto >= 0 ? 'text-green-300' : 'text-red-300'}`}>{neto >= 0 ? '+' : '−'} USD {Math.abs(neto).toFixed(2)}</strong>}
    </div>
    <div className="mt-5 flex h-40 items-end gap-1 sm:gap-3">{data.map((item, index) => <button type="button" key={item.date} onMouseEnter={() => setSelected(index)} onMouseLeave={() => setSelected(null)} onFocus={() => setSelected(index)} onBlur={() => setSelected(null)} onClick={() => setSelected((current) => current === index ? null : index)} className={`flex h-full min-w-0 flex-1 flex-col justify-end rounded-lg px-0.5 pt-2 transition ${selected === index ? 'bg-white/[.05]' : 'hover:bg-white/[.025]'}`} aria-label={`${item.label}: entradas USD ${item.entradas.toFixed(2)}, salidas USD ${item.salidas.toFixed(2)}`}><div className="flex h-full items-end justify-center gap-1"><div className="w-2.5 rounded-t bg-green-400/80 transition-all sm:w-5" style={{ height: `${Math.max(2, item.entradas / max * 100)}%` }} /><div className="w-2.5 rounded-t bg-red-400/80 transition-all sm:w-5" style={{ height: `${Math.max(2, item.salidas / max * 100)}%` }} /></div><span className={`mt-2 text-center text-[10px] capitalize ${selected === index ? 'font-semibold text-white' : 'text-muted'}`}>{item.label}</span></button>)}</div>
  </article>
}

function lastDays(total: number) { return Array.from({ length: total }, (_, index) => { const date = new Date(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() - (total - index - 1)); return date.toISOString().slice(0, 10) }) }
// Fecha (YYYY-MM-DD) desplazada `offset` días desde hoy, en hora local.
function isoDay(offset: number) { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
function diasDesde(dateStr: string) { const target = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T12:00:00`); return Math.floor((Date.now() - target.getTime()) / 86_400_000) }
function relativeTime(time: number) { const min = Math.max(0, Math.floor((Date.now() - time) / 60_000)); if (min < 1) return 'ahora'; if (min < 60) return `hace ${min} min`; const h = Math.floor(min / 60); if (h < 24) return `hace ${h} h`; const d = Math.floor(h / 24); return `hace ${d} d` }

function statusColor(estado: EstadoPedido) { if (estado === 'disponible_entrega' || estado === 'entregado') return 'bg-green'; if (estado === 'control_calidad') return 'bg-yellow'; if (estado === 'recibido_estados_unidos' || estado === 'transito_nicaragua') return 'bg-purple'; return 'bg-blue' }
function relativeDate(value: string) { const hours = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 3_600_000)); if (hours < 1) return 'Actualizado recientemente'; if (hours < 24) return `Actualizado hace ${hours} h`; return `Actualizado hace ${Math.floor(hours / 24)} d` }
