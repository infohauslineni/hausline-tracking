import { AlertTriangle, ArrowUpRight, CalendarClock, CheckCircle2, CircleDollarSign, Coins, CreditCard, PackagePlus, PackageSearch, PiggyBank, Plus, ReceiptText, Search, TrendingUp, UserPlus, Wallet } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ESTADOS_PEDIDO, estadoLabel, estadoTone, etapaBase } from '../../constants/orders'
import { DEMO_PEDIDOS } from '../../data/demo'
import { isSupabaseConfigured } from '../../lib/supabase'
import { obtenerCajaMes, obtenerResumenComercial } from '../../services/comercial.service'
import { listarPedidos } from '../../services/pedidos.service'
import type { EstadoPedido, Pedido, ResumenComercial } from '../../types/domain'
import { calcularAlertas } from '../../utils/alertas'
import { desglosePedido } from '../../utils/pedidoCosto'
import { periodoDeMes } from '../../utils/periodo'

const EMPTY_SUMMARY: ResumenComercial = { ventas: 0, cobrado: 0, por_cobrar: 0, gastos: 0, costos_productos: 0, saldo_cuenta: 0, pedidos: 0 }

export function DashboardPage() {
  const [pedidos, setPedidos] = useState<Pedido[]>(isSupabaseConfigured ? [] : DEMO_PEDIDOS)
  const [search, setSearch] = useState('')
  const [summary, setSummary] = useState<ResumenComercial>(EMPTY_SUMMARY)
  const [saldoMes, setSaldoMes] = useState(0)
  const [ventasAnterior, setVentasAnterior] = useState(0)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [actualizado, setActualizado] = useState(() => Date.now())
  const [, setTick] = useState(0)
  const periodo = useMemo(() => periodoDeMes(), [])
  const prevPeriodo = useMemo(() => periodoDeMes(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)), [])

  useEffect(() => {
    if (!isSupabaseConfigured) return
    void Promise.all([
      listarPedidos(setPedidos),
      obtenerResumenComercial(periodo.desde, periodo.hasta, setSummary).catch(() => EMPTY_SUMMARY),
      obtenerCajaMes(periodo.periodo, (c) => setSaldoMes(c.saldo_mes)).catch(() => null),
      obtenerResumenComercial(prevPeriodo.desde, prevPeriodo.hasta).catch(() => EMPTY_SUMMARY),
    ])
      .then(([orders, commercial, caja, prevCommercial]) => { setPedidos(orders); setSummary(commercial); setSaldoMes(caja ? caja.saldo_mes : commercial.saldo_cuenta); setVentasAnterior((prevCommercial as ResumenComercial).ventas); setActualizado(Date.now()) })
      .catch(() => undefined)
      .finally(() => setLoading(false))
  }, [periodo, prevPeriodo])

  // Refresca la etiqueta "hace X min" cada minuto sin recargar datos.
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 60_000); return () => clearInterval(id) }, [])

  const term = search.trim().toLowerCase()
  const activos = pedidos.filter((p) => !['entregado', 'cancelado'].includes(p.estado))
  const porCobrar = pedidos.filter((p) => p.estado !== 'cancelado' && Number(p.saldo) > 0.01)
  const pendienteTotal = porCobrar.reduce((sum, p) => sum + Number(p.saldo), 0)
  const enTransito = activos.filter((p) => etapaBase(p.estado) === 'transito_internacional').length
  const enPreparacion = activos.filter((p) => etapaBase(p.estado) === 'en_preparacion').length
  const proximasHoy = activos.filter((p) => p.fecha_estimada === isoDay(0))
  const proximasManana = activos.filter((p) => p.fecha_estimada === isoDay(1))
  const atrasados = activos.filter((p) => diasDesde(p.fecha_pedido) > 35).sort((a, b) => diasDesde(b.fecha_pedido) - diasDesde(a.fecha_pedido))
  const resultados = term ? [...pedidos].filter((item) => [item.codigo, item.clientes?.nombre, item.clientes?.whatsapp].some((value) => value?.toLowerCase().includes(term))).sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 6) : []

  // Desglose del dinero por cobrar según cuánto se ha abonado.
  const sinPago = porCobrar.filter((p) => Number(p.abono) <= 0.01).length
  const mitad = porCobrar.filter((p) => { const t = Number(p.total); return t > 0 && Number(p.abono) / t >= 0.4 && Number(p.abono) / t <= 0.6 }).length
  const inicial = porCobrar.length - sinPago - mitad

  // Tendencia real vs mes pasado para "Ventas del mes" (▲ subió / ▼ bajó).
  const cambioVentas = ventasAnterior > 0 ? ((summary.ventas - ventasAnterior) / ventasAnterior) * 100 : null
  const trendVentas: Trend | undefined = cambioVentas != null ? { text: `${Math.abs(cambioVentas).toFixed(0)}%`, dir: cambioVentas >= 0 ? 'up' : 'down', label: 'vs. mes anterior' } : undefined
  const ganancia = summary.ventas - summary.gastos
  const margen = summary.ventas > 0 ? (ganancia / summary.ventas) * 100 : 0
  // Ganancia NETA realizada del mes: solo pedidos ENTREGADOS (la ganancia se realiza al entregar).
  const gananciaNeta = pedidos.filter((p) => p.estado === 'entregado' && p.fecha_pedido >= periodo.desde && p.fecha_pedido <= periodo.hasta).reduce((sum, p) => sum + desglosePedido(p).gananciaNeta, 0)
  // Pedidos activos por etapa, para "Pedidos por estado".
  const porEstado = ESTADOS_PEDIDO.filter((e) => e.value !== 'entregado').map((e) => ({ label: e.label, value: activos.filter((p) => etapaBase(p.estado) === e.value).length }))
  // Alertas accionables (mismas que la campana del encabezado).
  const alertas = calcularAlertas(pedidos)
  const nombre = (import.meta.env.VITE_ADMIN_NOMBRE as string | undefined) || 'Hausline'

  return <div>
    <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        <p className="eyebrow">Resumen</p>
        <h1 className="page-title mt-1.5 flex items-center gap-2 text-[1.65rem] sm:text-[1.9rem]">Hola, {nombre} <span className="text-2xl">👋</span></h1>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span className="capitalize">{fechaLarga()}</span>
          <span className="text-white/20">·</span>
          <span className="inline-flex items-center gap-1.5"><span className="relative flex size-1.5"><span className="absolute inline-flex size-full animate-ping rounded-full bg-accent/60" /><span className="relative inline-flex size-1.5 rounded-full bg-accent" /></span>Sistema operativo</span>
          <span className="text-white/20">·</span>
          <span>Última actualización {haceMin(actualizado)}</span>
        </p>
      </div>
      <div className="relative w-full lg:w-80"><Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" size={18} /><input className="search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Código, cliente o WhatsApp" /></div>
    </header>

    {term ? <SearchResults resultados={resultados} /> : loading ? <DashboardSkeleton /> : <>
      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <HeroMetric icon={CircleDollarSign} label="Ventas del mes" value={`USD ${money(summary.ventas)}`} tone="blue" trend={trendVentas} />
        <HeroMetric icon={Coins} label="Dinero cobrado" value={`USD ${money(summary.cobrado)}`} tone="emerald" sub={`Saldo caja USD ${money(saldoMes)}`} />
        <HeroMetric icon={ReceiptText} label="Por cobrar" value={`USD ${money(summary.por_cobrar)}`} tone="warning" sub={`${porCobrar.length} ${porCobrar.length === 1 ? 'pendiente' : 'pendientes'}`} />
        <HeroMetric icon={PiggyBank} label="Ganancia neta" value={`USD ${money(gananciaNeta)}`} tone="accent" sub="Entregados del mes" />
        <HeroMetric icon={CheckCircle2} label="Pedidos activos" value={`${activos.length}`} tone="blue" sub={`${enTransito} en tránsito · ${enPreparacion} en prep.`} />
      </section>

      {alertas.length > 0 && <section className="mt-3 flex flex-wrap gap-2">
        {alertas.map((a) => <Link key={a.id} to={a.to} className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition ${a.prioridad === 'alta' ? 'border-red-400/30 bg-red-400/[.06] hover:border-red-400/55' : a.prioridad === 'media' ? 'border-amber-400/25 bg-amber-400/[.05] hover:border-amber-400/50' : 'border-sky-400/25 bg-sky-400/[.05] hover:border-sky-400/50'}`}><span>{a.icono}</span><strong>{a.titulo}</strong><ArrowUpRight size={13} className="text-muted" /></Link>)}
      </section>}

      <section className="mt-3"><PedidosPorEstado data={porEstado} total={activos.length} /></section>

      <section className="mt-3 grid gap-3 xl:grid-cols-[1.6fr_1fr]">
        <RendimientoVentas pedidos={pedidos} />
        <GananciaEstimada ganancia={ganancia} ventas={summary.ventas} gastos={summary.gastos} margen={margen} />
      </section>

      <section className="mt-3 grid gap-3 lg:grid-cols-3">
        <ProximasEntregas hoy={proximasHoy} manana={proximasManana} />
        <DineroPendiente total={pendienteTotal} cantidad={porCobrar.length} mitad={mitad} inicial={inicial} sinPago={sinPago} />
        <PedidosAtrasados pedidos={atrasados} />
      </section>

      <section className="mt-3 grid gap-3 xl:grid-cols-[1.5fr_1fr]">
        <RecentOrders pedidos={pedidos} />
        <QuickActions />
      </section>
    </>}
  </div>
}

type MetricTone = 'accent' | 'warning' | 'blue' | 'emerald' | 'danger'
const METRIC_PALETTE: Record<MetricTone, string> = { accent: 'text-accent', warning: 'text-amber-300', blue: 'text-sky-300', emerald: 'text-emerald-300', danger: 'text-red-300' }
const METRIC_TILE: Record<MetricTone, string> = { accent: 'bg-accent/10', warning: 'bg-amber-300/10', blue: 'bg-sky-300/10', emerald: 'bg-emerald-300/10', danger: 'bg-red-300/10' }
type Trend = { text: string; dir: 'up' | 'down' | 'flat'; label?: string }
function HeroMetric({ icon: Icon, label, value, tone, trend, sub }: { icon: typeof Wallet; label: string; value: string; tone?: MetricTone; trend?: Trend; sub?: string }) {
  const color = tone ? METRIC_PALETTE[tone] : 'text-white'
  const iconColor = tone ? METRIC_PALETTE[tone] : 'text-muted'
  const trendColor = trend?.dir === 'up' ? 'text-emerald-300' : trend?.dir === 'down' ? 'text-red-300' : 'text-muted'
  const flecha = trend?.dir === 'up' ? '↑' : trend?.dir === 'down' ? '↓' : ''
  return <article className="metric-card">
    <div className="flex items-center justify-between">
      <span className={`grid size-10 place-items-center rounded-xl ${tone ? METRIC_TILE[tone] : 'bg-white/[0.04]'}`}><Icon size={20} className={iconColor} /></span>
      {trend && <span className={`inline-flex items-center gap-1 rounded-full bg-white/[0.03] px-2 py-1 font-mono text-[11px] font-bold ${trendColor}`}>{flecha} {trend.text}</span>}
    </div>
    <p className="mt-4 text-sm text-muted">{label}</p>
    <strong className={`font-display mt-1 block text-3xl font-extrabold tracking-tight tabular-nums sm:text-[2.05rem] ${color}`}>{value}</strong>
    {sub && <span className="mt-1.5 block text-[11px] text-muted">{trend?.label ? <>{trend.label}</> : sub}</span>}
  </article>
}

const RANGOS = [{ id: '30d', label: '30 días', dias: 30, buckets: 30 }, { id: '3m', label: '3 meses', dias: 90, buckets: 12 }, { id: '6m', label: '6 meses', dias: 180, buckets: 6 }] as const
type RangoId = (typeof RANGOS)[number]['id']

function RendimientoVentas({ pedidos }: { pedidos: Pedido[] }) {
  const [rango, setRango] = useState<RangoId>('30d')
  const cfg = RANGOS.find((r) => r.id === rango)!
  const { serie, ventas, cantidad } = useMemo(() => serieVentas(pedidos, cfg.dias, cfg.buckets), [pedidos, cfg.dias, cfg.buckets])
  const ticket = cantidad > 0 ? ventas / cantidad : 0
  return <article className="panel-card">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div><h2 className="flex items-center gap-2 text-[.95rem] font-semibold"><TrendingUp size={17} className="text-accent" /> Rendimiento de ventas</h2><p className="mt-1 text-[.7rem] text-muted">Evolución de las ventas registradas</p></div>
      <div className="flex gap-1 rounded-xl border border-line bg-white/[.02] p-1">{RANGOS.map((r) => <button key={r.id} type="button" onClick={() => setRango(r.id)} className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${rango === r.id ? 'bg-accent text-black' : 'text-muted hover:text-white'}`}>{r.label}</button>)}</div>
    </div>
    <div className="mt-5 grid grid-cols-3 gap-3">
      <Stat label="Ventas" value={`USD ${money(ventas)}`} strong />
      <Stat label="Pedidos" value={`${cantidad}`} />
      <Stat label="Ticket promedio" value={`USD ${money(ticket)}`} />
    </div>
    <AreaChart serie={serie} />
  </article>
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div className="rounded-xl border border-line bg-white/[.02] px-3 py-2.5"><p className="text-[10px] uppercase tracking-wide text-muted">{label}</p><strong className={`mt-0.5 block tabular-nums ${strong ? 'text-lg text-accent' : 'text-lg text-white'}`}>{value}</strong></div>
}

function AreaChart({ serie }: { serie: { label: string; value: number }[] }) {
  const max = Math.max(1, ...serie.map((p) => p.value))
  const n = serie.length
  const coords = serie.map((p, i) => [n <= 1 ? 0 : (i / (n - 1)) * 100, 38 - (p.value / max) * 34] as const)
  const line = coords.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
  const area = coords.length ? `${line} L100,40 L0,40 Z` : ''
  const vacio = serie.every((p) => p.value === 0)
  return <div className="relative mt-5">
    {vacio && <div className="absolute inset-0 grid place-items-center text-[11px] text-muted">Aún no hay ventas en este rango.</div>}
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-40 w-full" role="img" aria-label="Gráfica de ventas">
      <defs><linearGradient id="ventasFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#b7ff00" stopOpacity="0.22" /><stop offset="1" stopColor="#b7ff00" stopOpacity="0" /></linearGradient></defs>
      <line x1="0" y1="39.5" x2="100" y2="39.5" stroke="rgba(255,255,255,.08)" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
      {!vacio && <><path d={area} fill="url(#ventasFill)" /><path d={line} fill="none" stroke="#b7ff00" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /></>}
    </svg>
    <div className="mt-2 flex justify-between text-[10px] text-muted"><span>{serie[0]?.label}</span><span>{serie[Math.floor(n / 2)]?.label}</span><span>{serie[n - 1]?.label}</span></div>
  </div>
}

function GananciaEstimada({ ganancia, ventas, gastos, margen }: { ganancia: number; ventas: number; gastos: number; margen: number }) {
  return <article className="panel-card flex flex-col">
    <div className="panel-heading"><div><h2 className="flex items-center gap-2"><PiggyBank size={17} className="text-accent" /> Ganancia estimada</h2><p>Después de gastos registrados</p></div></div>
    <strong className={`font-display mt-4 block text-4xl font-extrabold tracking-tight tabular-nums ${ganancia >= 0 ? 'text-accent' : 'text-red-300'}`}>USD {money(ganancia)}</strong>
    <div className="mt-5 space-y-2.5 text-sm">
      <div className="flex items-center justify-between"><span className="text-muted">Ventas</span><strong className="tabular-nums text-emerald-300">USD {money(ventas)}</strong></div>
      <div className="flex items-center justify-between"><span className="text-muted">Gastos</span><strong className="tabular-nums text-red-300">− USD {money(gastos)}</strong></div>
      <div className="mt-1 border-t border-line pt-3"><div className="flex items-center justify-between text-xs"><span className="text-muted">Margen</span><strong className="text-white">{margen.toFixed(0)}%</strong></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[.05]"><div className="h-full rounded-full bg-gradient-to-r from-[#739f00] to-accent transition-all" style={{ width: `${Math.max(0, Math.min(100, margen))}%` }} /></div></div>
    </div>
  </article>
}

function PedidosPorEstado({ data, total }: { data: { label: string; value: number }[]; total: number }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return <article className="panel-card">
    <div className="panel-heading"><div><h2 className="flex items-center gap-2"><PackageSearch size={17} className="text-accent" /> Pedidos por estado</h2><p>{total} activos en proceso</p></div><Link to="/pedidos" className="subtle-button">Ver pedidos <ArrowUpRight size={15} /></Link></div>
    <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">{data.map((d) => <Link key={d.label} to="/pedidos" className="rounded-xl border border-line bg-white/[.02] p-3 text-center transition hover:border-accent/40"><strong className="block text-2xl tabular-nums">{d.value}</strong><span className="mt-1 block text-[10px] leading-3 text-muted">{d.label}</span><div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full rounded-full bg-accent" style={{ width: `${(d.value / max) * 100}%` }} /></div></Link>)}</div>
  </article>
}

function ProximasEntregas({ hoy, manana }: { hoy: Pedido[]; manana: Pedido[] }) {
  const vacio = hoy.length === 0 && manana.length === 0
  return <article className="panel-card flex flex-col">
    <div className="panel-heading"><div><h2 className="flex items-center gap-2"><CalendarClock size={17} className="text-accent" /> Próximas entregas</h2><p>Estimadas para hoy y mañana</p></div></div>
    <div className="mt-4 flex-1 space-y-4">
      {vacio && <p className="py-6 text-center text-xs text-muted">No hay entregas para hoy o mañana.</p>}
      {hoy.length > 0 && <GrupoEntregas titulo="Hoy" tone="accent" pedidos={hoy} />}
      {manana.length > 0 && <GrupoEntregas titulo="Mañana" tone="muted" pedidos={manana} />}
    </div>
    <Link to="/pedidos" className="subtle-button mt-4 w-fit">Ver todas <ArrowUpRight size={15} /></Link>
  </article>
}

function GrupoEntregas({ titulo, tone, pedidos }: { titulo: string; tone: 'accent' | 'muted'; pedidos: Pedido[] }) {
  return <div>
    <p className={`mb-2 text-[10px] font-bold uppercase tracking-wider ${tone === 'accent' ? 'text-accent' : 'text-muted'}`}>{titulo}</p>
    <div className="space-y-2">{pedidos.slice(0, 4).map((p) => <Link to={`/pedidos/${p.id}`} key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-white/[0.02] px-3 py-2.5 transition hover:border-accent/40 hover:bg-white/[0.03]"><div className="min-w-0"><strong className="block truncate text-sm">{p.clientes?.nombre ?? 'Cliente'}</strong><span className="text-[11px] text-muted">{p.codigo} · {estadoLabel(p.estado)}</span></div><strong className="shrink-0 text-sm tabular-nums">${money(Number(p.total))}</strong></Link>)}</div>
  </div>
}

function DineroPendiente({ total, cantidad, mitad, inicial, sinPago }: { total: number; cantidad: number; mitad: number; inicial: number; sinPago: number }) {
  const filas = [{ n: mitad, label: 'Abonó 50%', color: 'text-amber-300' }, { n: inicial, label: 'Pago inicial', color: 'text-sky-300' }, { n: sinPago, label: 'Sin pago', color: 'text-red-300' }].filter((f) => f.n > 0)
  return <article className="panel-card flex flex-col">
    <div className="panel-heading"><div><h2 className="flex items-center gap-2"><Coins size={17} className="text-accent" /> Dinero pendiente</h2><p>Saldos de pedidos activos</p></div></div>
    <div className="mt-4"><p className="text-xs text-muted">{cantidad} {cantidad === 1 ? 'pedido pendiente' : 'pedidos pendientes'}</p><strong className="font-display mt-0.5 block text-4xl font-extrabold tracking-tight tabular-nums text-amber-300">USD {money(total)}</strong></div>
    <div className="mt-4 flex-1 space-y-2">{filas.length === 0 ? <p className="py-2 text-xs text-muted">Todo cobrado. 🎉</p> : filas.map((f) => <div key={f.label} className="flex items-center justify-between rounded-lg border border-line bg-white/[.02] px-3 py-2 text-xs"><span className="flex items-center gap-2 text-muted"><span className={`font-mono font-bold ${f.color}`}>{f.n}</span> {f.label}</span></div>)}</div>
    <Link to="/pedidos" className="primary-button mt-4 min-h-[2.6rem] px-4 text-[.8rem]">Cobrar pendientes <ArrowUpRight size={15} /></Link>
  </article>
}

function PedidosAtrasados({ pedidos }: { pedidos: Pedido[] }) {
  const hay = pedidos.length > 0
  return <article className={`panel-card flex flex-col ${hay ? 'border-red-400/40 bg-red-400/[0.05]' : ''}`}>
    <div className="panel-heading"><div><h2 className="flex items-center gap-2"><AlertTriangle size={17} className={hay ? 'text-red-300' : 'text-accent'} /> Pedidos atrasados</h2><p>Más de 35 días sin entregar</p></div></div>
    {!hay ? <div className="mt-4 flex flex-1 items-center justify-center py-6 text-center text-xs text-muted">Sin pedidos atrasados. Todo al día.</div> : <>
      <strong className="mt-4 block text-3xl font-bold tabular-nums text-red-300">{pedidos.length} {pedidos.length === 1 ? 'atrasado' : 'atrasados'}</strong>
      <div className="mt-3 flex-1 space-y-2">{pedidos.slice(0, 3).map((p) => <Link to={`/pedidos/${p.id}`} key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-red-400/20 bg-black/10 px-3 py-2 transition hover:border-red-400/50"><div className="min-w-0"><strong className="block truncate text-xs">{p.clientes?.nombre ?? 'Cliente'}</strong><span className="text-[10px] text-muted">{p.codigo}</span></div><span className="shrink-0 text-[11px] font-bold text-red-300">{diasDesde(p.fecha_pedido)} días</span></Link>)}</div>
      <Link to="/pedidos" className="subtle-button mt-4 w-fit">Ver todos <ArrowUpRight size={15} /></Link>
    </>}
  </article>
}

function StatusBadge({ estado }: { estado: EstadoPedido }) { return <span className={`status-badge status-${estadoTone(estado)}`}>{estadoLabel(estado)}</span> }

function RecentOrders({ pedidos }: { pedidos: Pedido[] }) {
  const recientes = [...pedidos].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 6)
  return <article className="panel-card">
    <div className="panel-heading"><div><h2 className="flex items-center gap-2"><PackageSearch size={17} className="text-accent" /> Pedidos recientes</h2><p>Últimos movimientos</p></div><Link to="/pedidos" className="subtle-button">Ver todos <ArrowUpRight size={15} /></Link></div>
    <div className="mt-4 hidden grid-cols-[1fr_1fr_auto_auto] gap-3 px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted sm:grid"><span>Pedido</span><span>Cliente</span><span className="text-right">Total</span><span className="text-right">Fecha</span></div>
    <div className="divide-y divide-line">{recientes.length === 0 ? <p className="py-8 text-center text-xs text-muted">Sin pedidos todavía.</p> : recientes.map((p) => <Link to={`/pedidos/${p.id}`} key={p.id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 rounded-lg px-2 py-3 transition hover:bg-white/[0.03] sm:grid-cols-[1fr_1fr_auto_auto]">
      <div className="min-w-0"><div className="flex items-center gap-2"><strong className="text-sm">{p.codigo}</strong><span className="sm:hidden"><StatusBadge estado={p.estado} /></span></div><p className="mt-0.5 truncate text-xs text-muted sm:hidden">{p.clientes?.nombre ?? 'Sin cliente'}</p></div>
      <div className="hidden min-w-0 items-center gap-2 sm:flex"><span className="truncate text-sm text-white/90">{p.clientes?.nombre ?? 'Sin cliente'}</span><StatusBadge estado={p.estado} /></div>
      <strong className="text-right text-sm tabular-nums">${money(Number(p.total))}</strong>
      <span className="hidden text-right text-[11px] text-muted sm:block">{fechaCorta(p.updated_at)}</span>
    </Link>)}</div>
  </article>
}

function QuickActions() {
  const acciones = [
    { to: '/pedidos/nuevo', label: 'Nuevo pedido', icon: PackagePlus },
    { to: '/pagos', label: 'Registrar pago', icon: CreditCard },
    { to: '/clientes', label: 'Nuevo cliente', icon: UserPlus },
    { to: '/gastos', label: 'Registrar gasto', icon: ReceiptText },
  ]
  return <article className="panel-card">
    <div className="panel-heading"><div><h2 className="flex items-center gap-2"><Plus size={17} className="text-accent" /> Accesos rápidos</h2><p>Crea en un toque</p></div></div>
    <div className="mt-4 grid grid-cols-2 gap-2.5">{acciones.map(({ to, label, icon: Icon }) => <Link key={to} to={to} title={label} className="group flex flex-col gap-2.5 rounded-xl border border-line bg-white/[0.02] p-3.5 transition hover:-translate-y-0.5 hover:border-accent/50 hover:bg-accent/[0.05]"><span className="grid size-9 place-items-center rounded-xl bg-accent/10 text-accent transition group-hover:bg-accent group-hover:text-black"><Icon size={18} /></span><span className="text-[.8rem] font-semibold leading-tight">{label}</span></Link>)}</div>
  </article>
}

function SearchResults({ resultados }: { resultados: Pedido[] }) {
  return <section className="mt-6"><article className="panel-card"><div className="panel-heading"><div><h2>Resultados de búsqueda</h2><p>{resultados.length} coincidencia(s)</p></div><Link to="/pedidos" className="subtle-button">Ver todos <ArrowUpRight size={15} /></Link></div><div className="mt-4 divide-y divide-line">{resultados.map((order) => <Link to={`/pedidos/${order.id}`} className="flex items-center gap-3 py-4 transition hover:bg-white/[0.03]" key={order.id}><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/[0.04]"><PackageSearch size={18} className="text-muted" /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><strong className="text-sm">{order.codigo}</strong><StatusBadge estado={order.estado} /></div><p className="truncate text-xs text-muted">{order.clientes?.nombre}</p></div><div className="hidden text-right sm:block"><p className="text-xs font-medium tabular-nums">${money(Number(order.total))}</p><p className="mt-1 text-[11px] text-muted">{relativeDate(order.updated_at)}</p></div></Link>)}{resultados.length === 0 && <div className="py-8 text-center text-xs text-muted">Sin coincidencias.</div>}</div></article></section>
}

function DashboardSkeleton() {
  return <div className="animate-pulse">
    <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-32 rounded-2xl border border-line bg-panel" />)}</div>
    <div className="mt-3 grid gap-3 xl:grid-cols-[1.6fr_1fr]"><div className="h-64 rounded-2xl border border-line bg-panel" /><div className="h-64 rounded-2xl border border-line bg-panel" /></div>
    <div className="mt-3 grid gap-3 lg:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-52 rounded-2xl border border-line bg-panel" />)}</div>
  </div>
}

// ── Serie de ventas para la gráfica de rendimiento ──────────────────────────
// Agrupa los pedidos por fecha_pedido en `buckets` tramos dentro de los últimos
// `dias` días. Devuelve la serie + el total vendido y la cantidad de pedidos.
function serieVentas(pedidos: Pedido[], dias: number, buckets: number) {
  const hoy = new Date(); hoy.setHours(12, 0, 0, 0)
  const desde = new Date(hoy); desde.setDate(hoy.getDate() - (dias - 1))
  const anchoMs = (dias * 86_400_000) / buckets
  const serie = Array.from({ length: buckets }, (_, i) => {
    const inicio = new Date(desde.getTime() + i * anchoMs)
    return { label: new Intl.DateTimeFormat('es-NI', dias > 45 ? { month: 'short' } : { day: 'numeric', month: 'short' }).format(inicio).replace('.', ''), value: 0 }
  })
  let ventas = 0, cantidad = 0
  for (const p of pedidos) {
    const raw = p.fecha_pedido
    if (!raw) continue
    const fecha = new Date(raw.includes('T') ? raw : `${raw}T12:00:00`)
    if (Number.isNaN(fecha.getTime()) || fecha < desde || fecha > hoy) continue
    const idx = Math.min(buckets - 1, Math.max(0, Math.floor((fecha.getTime() - desde.getTime()) / anchoMs)))
    serie[idx].value += Number(p.total)
    ventas += Number(p.total)
    cantidad += 1
  }
  return { serie, ventas, cantidad }
}

const money = (n: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0)
function fechaLarga() { return new Intl.DateTimeFormat('es-NI', { day: 'numeric', month: 'long' }).format(new Date()) }
function fechaCorta(value: string) { return new Intl.DateTimeFormat('es-NI', { day: 'numeric', month: 'short' }).format(new Date(value)) }
function haceMin(ts: number) { const min = Math.floor((Date.now() - ts) / 60_000); if (min < 1) return 'ahora mismo'; if (min < 60) return `hace ${min} min`; const h = Math.floor(min / 60); return `hace ${h} h` }
// Fecha (YYYY-MM-DD) desplazada `offset` días desde hoy, en hora local.
function isoDay(offset: number) { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
function diasDesde(dateStr: string) { const target = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T12:00:00`); return Math.floor((Date.now() - target.getTime()) / 86_400_000) }
function relativeDate(value: string) { const hours = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 3_600_000)); if (hours < 1) return 'Actualizado recientemente'; if (hours < 24) return `Actualizado hace ${hours} h`; return `Actualizado hace ${Math.floor(hours / 24)} d` }
