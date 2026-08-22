import { BarChart3 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { DEMO_PEDIDOS } from '../data/demo'
import { isSupabaseConfigured } from '../lib/supabase'
import { listarGastos, listarPagos } from '../services/comercial.service'
import { listarPedidos } from '../services/pedidos.service'
import type { Gasto, Pago, Pedido } from '../types/domain'

// Gráficos operativos (ventas 7 días, flujo de dinero, pedidos por etapa). Antes vivían
// en el Resumen; se movieron a Reportes para dejar el dashboard limpio. Este componente
// carga sus propios datos para no depender del dashboard.
type ChartDay = { date: string; label: string; ventas: number; entradas: number; salidas: number }

export function OperacionesCharts() {
  const [pedidos, setPedidos] = useState<Pedido[]>(isSupabaseConfigured ? [] : DEMO_PEDIDOS)
  const [pagos, setPagos] = useState<Pago[]>([])
  const [gastos, setGastos] = useState<Gasto[]>([])

  useEffect(() => {
    if (!isSupabaseConfigured) return
    void Promise.all([listarPedidos(), listarPagos(), listarGastos()])
      .then(([orders, payments, expenses]) => { setPedidos(orders); setPagos(payments); setGastos(expenses) })
      .catch(() => undefined)
  }, [])

  const chartDays = useMemo(() => lastDays(7).map((date) => ({
    date,
    label: new Intl.DateTimeFormat('es-NI', { weekday: 'short' }).format(new Date(`${date}T12:00:00`)).replace('.', ''),
    ventas: pedidos.filter((order) => order.fecha_pedido === date).reduce((sum, order) => sum + Number(order.total), 0),
    entradas: pagos.filter((payment) => payment.fecha === date && payment.tipo !== 'reembolso').reduce((sum, payment) => sum + Number(payment.monto), 0),
    salidas: gastos.filter((expense) => expense.fecha === date).reduce((sum, expense) => sum + Number(expense.monto), 0),
  })), [pedidos, pagos, gastos])

  return <div className="mt-6 space-y-5">
    <section className="grid gap-5 xl:grid-cols-[1.4fr_1fr]"><SalesChart data={chartDays} /><StatusChart pedidos={pedidos} /></section>
    <CashFlowChart data={chartDays} />
  </div>
}

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
