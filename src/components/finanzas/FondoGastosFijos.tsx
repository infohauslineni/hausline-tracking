import { Lock } from 'lucide-react'
import { useEffect, useState } from 'react'
import { isSupabaseConfigured } from '../../lib/supabase'
import { obtenerFondoDetalle, type CoberturaFijo, type MiGanancia } from '../../services/miGanancia.service'

// Fondo de gastos fijos: lo que está guardado (y no se toca) para pagar los fijos del mes que
// todavía faltan. Se llena con los pedidos entregados y baja cuando cada gasto se registra.
const usd = (n: number) => `US$ ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const nombreMes = (mes: string) => new Intl.DateTimeFormat('es-NI', { month: 'long', timeZone: 'UTC' }).format(new Date(`${mes}-01T00:00:00Z`))

// `recarga`: cambia cuando se agrega/edita un gasto para volver a calcular.
export function FondoGastosFijos({ recarga = 0 }: { recarga?: number }) {
  const [g, setG] = useState<MiGanancia | null>(null)
  const [pendientes, setPendientes] = useState<CoberturaFijo[]>([])
  useEffect(() => {
    if (!isSupabaseConfigured) return
    let vivo = true
    void obtenerFondoDetalle().then((d) => { if (vivo) { setG(d.resumen); setPendientes(d.pendientes) } }).catch(() => undefined)
    return () => { vivo = false }
  }, [recarga])
  if (!g || g.metaMes <= 0.005) return null
  const porPagar = g.pendienteNegocio + g.pendienteDueno
  const avance = porPagar > 0 ? Math.min(100, (g.apartado / porPagar) * 100) : 100
  return <section className="mt-3 rounded-2xl border border-line bg-panel p-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div><h2 className="flex items-center gap-2 text-sm font-semibold"><Lock size={16} className="text-accent" /> Fondo de gastos fijos · {nombreMes(g.mes)}</h2><p className="mt-1 text-xs text-muted">Dinero guardado para pagar los gastos fijos que faltan este mes. Va aparte de lo que el negocio usa para funcionar.</p></div>
      <div className="shrink-0 text-right"><span className="text-xs text-muted">Guardado</span><strong className="block text-2xl tabular-nums">{usd(g.apartado)}</strong><span className="text-[11px] text-muted">de {usd(porPagar)} por pagar</span></div>
    </div>
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${avance}%` }} /></div>
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
      <span>Fijos del mes: <b className="text-white">{usd(g.metaMes)}</b></span>
      <span>Ya pagados: <b className="text-white">{usd(g.pagadoMes)}</b></span>
      {g.apartadoNegocio > 0.005 && <span>Del negocio: <b className="text-white">{usd(g.apartadoNegocio)}</b></span>}
      {g.apartadoDueno > 0.005 && <span>De tu ganancia: <b className="text-white">{usd(g.apartadoDueno)}</b></span>}
      <span>Le queda al negocio: <b className="text-white">{usd(g.negocioLibre)}</b></span>
    </div>
    {pendientes.length > 0 && <div className="mt-3 space-y-1.5 border-t border-line pt-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Lo que falta pagar este mes</p>
      {pendientes.map((p) => <div key={p.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs">
        <span className="text-white"><b className="font-mono text-muted">{new Intl.DateTimeFormat('es-NI', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${p.fecha}T12:00:00Z`))}</b> · {p.descripcion} · {usd(p.usd)} <span className="text-muted">· {p.deGanancia ? 'de tu ganancia' : 'del negocio'}</span></span>
        {p.falta > 0.005 ? <b className="text-amber-200">Faltan {usd(p.falta)}</b> : <b className="text-emerald-300">Completo</b>}
      </div>)}
    </div>}
    {g.faltaApartar > 0.005 && <p className="mt-2 text-xs text-amber-200">Faltan {usd(g.faltaApartar)} por guardar. Se completan solos con los próximos pedidos que entregués.</p>}
  </section>
}
