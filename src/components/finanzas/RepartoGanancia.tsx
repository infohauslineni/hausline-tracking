import { AlertTriangle, Building2, PiggyBank, Split, UserRound } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { isSupabaseConfigured } from '../../lib/supabase'
import { listarGastos, listarPagos, listarVentasStock } from '../../services/comercial.service'
import { DEFAULT_FINANZAS, obtenerConfiguracionFinanzas, obtenerGananciaRealizada, periodoComercial } from '../../services/finanzas.service'
import type { Gasto, Pago, Pedido } from '../../types/domain'
import { repartoPedido, repartoPeriodo, type DiaReparto } from '../../utils/reparto'

// Reparto de la ganancia: cuánto de cada pedido (y del mes) se queda en el negocio y cuánto es
// del dueño. El porcentaje del negocio es la "Reserva del negocio" de Reportes → Cierre y retiro.

const usd = (n: number) => `US$ ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Lee el % del negocio una vez (el mismo de Reportes → Cierre y retiro).
export function usePorcentajeNegocio() {
  const [pct, setPct] = useState(DEFAULT_FINANZAS.porcentaje_reserva_negocio)
  useEffect(() => { if (isSupabaseConfigured) void obtenerConfiguracionFinanzas().then((c) => setPct(c.porcentaje_reserva_negocio)).catch(() => undefined) }, [])
  return pct
}

// ---------- En el pedido ----------
export function RepartoPedidoBox({ pedido, pctNegocio }: { pedido: Pedido; pctNegocio: number }) {
  const r = repartoPedido(pedido, pctNegocio)
  if (pedido.estado === 'cancelado') return null
  const avance = r.tuyo > 0 ? Math.min(100, (r.tuyoYa / r.tuyo) * 100) : 0
  const estado = r.pendiente ? 'Falta registrar el costo del pedido para poder calcular la ganancia.'
    : r.ganancia <= 0 ? 'Este pedido no deja ganancia: lo que costó es igual o mayor a la venta.'
      : r.completo ? `Ya entró completa: ${usd(r.tuyoYa)} son tuyos y ${usd(r.negocioYa)} quedan en el negocio.`
        : r.realizada > 0 ? `Ya es tuyo ${usd(r.tuyoYa)}. Los otros ${usd(r.tuyo - r.tuyoYa)} entran cuando pague el saldo.`
          : `Lo cobrado (${usd(r.cobrado)}) todavía está reponiendo el costo: faltan ${usd(r.faltaCosto)}. Lo tuyo entra cuando pague el saldo.`
  return <div className="mt-4 rounded-xl border border-accent/25 bg-accent/[.045] p-3 text-sm">
    <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-accent"><Split size={14} /> Reparto de la ganancia</p>
    {!r.pendiente && r.ganancia > 0 && <div className="mt-3 space-y-2">
      <div className="flex justify-between gap-3"><span className="text-muted">Ganancia neta</span><strong>{usd(r.ganancia)}</strong></div>
      <div className="flex justify-between gap-3"><span className="flex items-center gap-1.5 text-muted"><Building2 size={13} /> Se queda en el negocio ({pctNegocio}%)</span><strong className="text-sky-300">{usd(r.negocio)}</strong></div>
      <div className="flex justify-between gap-3"><span className="flex items-center gap-1.5 text-muted"><UserRound size={13} /> Para vos</span><strong className="text-accent">{usd(r.tuyo)}</strong></div>
      <div className="pt-1"><div className="flex justify-between text-[11px] text-muted"><span>Ya es tuyo</span><b className="text-white">{usd(r.tuyoYa)} de {usd(r.tuyo)}</b></div><div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${avance}%` }} /></div></div>
    </div>}
    <p className={`mt-2.5 text-xs leading-5 ${r.pendiente || r.ganancia <= 0 ? 'text-amber-200' : 'text-muted'}`}>{estado}</p>
  </div>
}

// ---------- En el Resumen: el mes ----------
export function RepartoMes({ pedidos }: { pedidos: Pedido[] }) {
  const [pagos, setPagos] = useState<Pago[]>([])
  const [gastos, setGastos] = useState<Gasto[]>([])
  const [ventas, setVentas] = useState<{ fecha: string; monto: number; costo: number }[]>([])
  const [config, setConfig] = useState(DEFAULT_FINANZAS)
  const [asignada, setAsignada] = useState(0)
  const [listo, setListo] = useState(!isSupabaseConfigured)

  useEffect(() => {
    if (!isSupabaseConfigured) return
    let vivo = true
    void (async () => {
      const cfg = await obtenerConfiguracionFinanzas().catch(() => DEFAULT_FINANZAS)
      const per = periodoComercial(new Date(), cfg.dia_inicio_mes)
      const [pg, gs, vs, gr] = await Promise.all([
        listarPagos().catch(() => [] as Pago[]), listarGastos().catch(() => [] as Gasto[]), listarVentasStock().catch(() => []),
        obtenerGananciaRealizada(per.desde, per.hasta).catch(() => null),
      ])
      if (!vivo) return
      setConfig(cfg); setPagos(pg); setGastos(gs); setVentas(vs); setAsignada(gr?.ganancia_asignada ?? 0); setListo(true)
    })()
    return () => { vivo = false }
  }, [])

  const periodo = useMemo(() => periodoComercial(new Date(), config.dia_inicio_mes), [config.dia_inicio_mes])
  const r = useMemo(() => repartoPeriodo({ pedidos, pagos, gastos, ventasStock: ventas, desde: periodo.desde, hasta: periodo.hasta, pctNegocio: config.porcentaje_reserva_negocio }), [pedidos, pagos, gastos, ventas, periodo, config.porcentaje_reserva_negocio])
  const porRetirar = Math.max(0, r.tuyo - asignada)
  const fecha = (iso: string) => new Intl.DateTimeFormat('es-NI', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`))

  if (!listo) return <article className="panel-card h-56 animate-pulse" />
  return <article className="panel-card">
    <div className="panel-heading"><div><h2 className="flex items-center gap-2"><Split size={17} className="text-accent" /> Reparto de tu ganancia</h2><p>{fecha(periodo.desde)} – {fecha(periodo.hasta)} · por lo que ya cobraste, no por lo vendido</p></div><Link to="/reportes" className="subtle-button shrink-0">Cambiar el {config.porcentaje_reserva_negocio}%</Link></div>
    <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_1.35fr]">
      <div>
        <span className="text-xs text-muted">Tuyo este mes</span>
        <strong className={`font-display block text-4xl font-extrabold tracking-tight tabular-nums ${r.tuyo >= 0 ? 'text-accent' : 'text-red-300'}`}>{usd(r.tuyo)}</strong>
        <div className="mt-4 space-y-2 text-sm">
          <Fila label="Ganancia neta que ya entró" valor={usd(r.realizada)} fuerte />
          <Fila icon={Building2} label={`Para el negocio (${config.porcentaje_reserva_negocio}%)`} valor={usd(r.negocioBruto)} tono="text-sky-300" />
          <Fila label="Gastos generales del mes" valor={`− ${usd(r.gastos)}`} tono="text-red-300" sangria />
          <Fila label="Le queda al negocio" valor={usd(r.negocioQueda)} tono="text-sky-300" sangria fuerte />
          <Fila icon={UserRound} label={`Para vos (${100 - config.porcentaje_reserva_negocio}%)`} valor={usd(r.tuyoBruto)} tono="text-accent" />
          {r.deficit > 0.005 && <Fila label="Gastos que el negocio no alcanzó a cubrir" valor={`− ${usd(r.deficit)}`} tono="text-red-300" sangria />}
          {asignada > 0.005 && <><Fila label="Ya retirado o apartado en metas" valor={`− ${usd(asignada)}`} sangria /><Fila label="Te queda por retirar" valor={usd(porRetirar)} tono="text-accent" sangria fuerte /></>}
        </div>
        {r.deficit > 0.005 && <p className="mt-3 flex items-start gap-2 rounded-lg border border-red-400/25 bg-red-400/[.06] p-2.5 text-xs leading-5 text-red-100"><AlertTriangle size={14} className="mt-0.5 shrink-0" /> Los gastos del mes ({usd(r.gastos)}) superan la parte del negocio. La diferencia ({usd(r.deficit)}) se descontó de lo tuyo.</p>}
        {(r.porEntrar.tuyo > 0.005 || r.sinCosto > 0) && <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted"><PiggyBank size={14} className="mt-0.5 shrink-0 text-accent" /><span>{r.porEntrar.tuyo > 0.005 && <>Por entrar cuando cobrés los saldos pendientes: <b className="text-white">{usd(r.porEntrar.tuyo)}</b> tuyos y <b className="text-white">{usd(r.porEntrar.negocio)}</b> del negocio. </>}{r.sinCosto > 0 && <>{r.sinCosto} {r.sinCosto === 1 ? 'pedido del mes no tiene' : 'pedidos del mes no tienen'} costo registrado y no {r.sinCosto === 1 ? 'entra' : 'entran'} en la cuenta.</>}</span></p>}
      </div>
      <GraficoReparto serie={r.serie} fecha={fecha} />
    </div>
  </article>
}

function Fila({ icon: Icon, label, valor, tono, sangria, fuerte }: { icon?: typeof Building2; label: string; valor: string; tono?: string; sangria?: boolean; fuerte?: boolean }) {
  return <div className={`flex items-center justify-between gap-3 ${sangria ? 'pl-5 text-xs' : ''}`}><span className="flex items-center gap-1.5 text-muted">{Icon && <Icon size={13} />}{label}</span><strong className={`tabular-nums ${fuerte ? '' : 'font-medium'} ${tono ?? 'text-white'}`}>{valor}</strong></div>
}

// Barras por día: lo tuyo (verde) y lo del negocio (celeste) apilados; los gastos generales en rojo hacia abajo.
function GraficoReparto({ serie, fecha }: { serie: DiaReparto[]; fecha: (iso: string) => string }) {
  if (!serie.length) return <div className="grid min-h-48 place-items-center rounded-xl border border-dashed border-line px-4 text-center text-xs text-muted">Todavía no entró ganancia este mes. Aparece aquí en cuanto registrés un pago que cubra el costo de un pedido.</div>
  const W = 560, H = 210, ALTO_ARRIBA = 140, ALTO_ABAJO = 44, BASE = 150
  const maxArriba = Math.max(1, ...serie.map((d) => Math.max(0, d.tuyo) + d.negocio))
  const maxAbajo = Math.max(1, ...serie.map((d) => d.gastos + Math.max(0, -d.tuyo)))
  const paso = W / serie.length
  const ancho = Math.min(34, paso * 0.62)
  return <div>
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Ganancia por día: tuya, del negocio y gastos generales">
      <line x1="0" x2={W} y1={BASE} y2={BASE} stroke="rgba(255,255,255,.14)" />
      {serie.map((d, i) => {
        const x = i * paso + (paso - ancho) / 2
        const hNeg = (d.negocio / maxArriba) * ALTO_ARRIBA
        const hTuyo = (Math.max(0, d.tuyo) / maxArriba) * ALTO_ARRIBA
        const hGasto = ((d.gastos + Math.max(0, -d.tuyo)) / maxAbajo) * ALTO_ABAJO
        return <g key={d.dia}>
          <title>{`${fecha(d.dia)} · tuyo ${usd(d.tuyo)} · negocio ${usd(d.negocio)}${d.gastos > 0 ? ` · gastos ${usd(d.gastos)}` : ''}`}</title>
          {hNeg > 0 && <rect x={x} y={BASE - hNeg} width={ancho} height={hNeg} rx="3" fill="#7dd3fc" opacity=".85" />}
          {hTuyo > 0 && <rect x={x} y={BASE - hNeg - hTuyo} width={ancho} height={hTuyo} rx="3" fill="#b7ff00" />}
          {hGasto > 0 && <rect x={x} y={BASE + 1} width={ancho} height={hGasto} rx="3" fill="#fca5a5" opacity=".8" />}
          {(serie.length <= 12 || i % Math.ceil(serie.length / 10) === 0) && <text x={x + ancho / 2} y={H - 2} textAnchor="middle" fontSize="10" fill="#8c948f">{fecha(d.dia)}</text>}
        </g>
      })}
    </svg>
    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted"><span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-accent" /> Tuyo</span><span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-sky-300" /> Negocio</span><span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-red-300" /> Gastos generales</span><span>Cada barra es un día en que entró dinero o hubo un gasto.</span></div>
  </div>
}
