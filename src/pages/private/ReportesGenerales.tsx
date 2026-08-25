import { BarChart3, Download, FileSpreadsheet, FileText, Layers, PackageCheck, Printer, ShoppingBag, TrendingUp, Truck, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { estadoLabel, etapaBase } from '../../constants/orders'
import { DEMO_PEDIDOS } from '../../data/demo'
import { isSupabaseConfigured } from '../../lib/supabase'
import { listarPedidos } from '../../services/pedidos.service'
import type { Pedido } from '../../types/domain'
import { desglosePedido } from '../../utils/pedidoCosto'

const money = (n: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0)
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
type Preset = 'hoy' | 'semana' | 'mes' | 'anio' | 'custom'

function rango(preset: Preset): { desde: string; hasta: string } {
  const hoy = new Date(); hoy.setHours(12, 0, 0, 0)
  const d = new Date(hoy)
  if (preset === 'hoy') return { desde: iso(hoy), hasta: iso(hoy) }
  if (preset === 'semana') { d.setDate(hoy.getDate() - 6); return { desde: iso(d), hasta: iso(hoy) } }
  if (preset === 'anio') return { desde: `${hoy.getFullYear()}-01-01`, hasta: iso(hoy) }
  // mes (por defecto)
  return { desde: `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`, hasta: iso(hoy) }
}

export function ReportesGenerales() {
  const [pedidos, setPedidos] = useState<Pedido[]>(isSupabaseConfigured ? [] : DEMO_PEDIDOS)
  const [preset, setPreset] = useState<Preset>('mes')
  const [desde, setDesde] = useState(rango('mes').desde)
  const [hasta, setHasta] = useState(rango('mes').hasta)

  useEffect(() => { if (isSupabaseConfigured) void listarPedidos().then(setPedidos).catch(() => toast.error('No se pudieron cargar los datos.')) }, [])
  const setRango = (p: Preset) => { setPreset(p); if (p !== 'custom') { const r = rango(p); setDesde(r.desde); setHasta(r.hasta) } }

  const enRango = useMemo(() => pedidos.filter((p) => { const f = (p.fecha_pedido || '').slice(0, 10); return p.estado !== 'cancelado' && f >= desde && f <= hasta }), [pedidos, desde, hasta])

  const r = useMemo(() => {
    const ventas = enRango.reduce((s, p) => s + Number(p.total || 0), 0)
    const cantidad = enRango.length
    const ticket = cantidad ? ventas / cantidad : 0
    const entregados = enRango.filter((p) => p.estado === 'entregado')
    const gb = entregados.reduce((s, p) => s + desglosePedido(p).gananciaBruta, 0)
    const gn = entregados.reduce((s, p) => s + desglosePedido(p).gananciaNeta, 0)
    const ventasEnt = entregados.reduce((s, p) => s + Number(p.total || 0), 0)
    const margen = ventasEnt > 0 ? (gn / ventasEnt) * 100 : 0

    // Ventas por día (para la mini-gráfica).
    const porDiaMap = new Map<string, number>()
    for (const p of enRango) { const k = (p.fecha_pedido || '').slice(0, 10); porDiaMap.set(k, (porDiaMap.get(k) || 0) + Number(p.total || 0)) }
    const porDia = [...porDiaMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([fecha, valor]) => ({ fecha, valor }))

    // Productos (agregado de los ítems).
    const prodMap = new Map<string, { nombre: string; cantidad: number; venta: number; ganancia: number; tieneCosto: boolean }>()
    for (const p of enRango) for (const it of p.pedido_items ?? []) {
      if (/env[íi]o r[áa]pido/i.test(it.producto)) continue
      const key = (it.codigo_producto || it.producto || '').toUpperCase()
      const cant = Number(it.cantidad || 1)
      const venta = cant * Number(it.precio_unitario || 0)
      const costoUnit = Number(it.precio_compra || 0) + Number(it.envio_internacional || 0) + Number(it.costo_delivery || 0) + Number(it.otros_gastos || 0)
      const tieneCosto = costoUnit > 0
      const cur = prodMap.get(key) ?? { nombre: it.producto, cantidad: 0, venta: 0, ganancia: 0, tieneCosto: false }
      cur.cantidad += cant; cur.venta += venta; cur.ganancia += cant * (Number(it.precio_unitario || 0) - costoUnit); cur.tieneCosto = cur.tieneCosto || tieneCosto
      prodMap.set(key, cur)
    }
    const productos = [...prodMap.values()]
    const masVendidos = [...productos].sort((a, b) => b.cantidad - a.cantidad).slice(0, 5)
    const conGanancia = productos.filter((p) => p.tieneCosto)
    const mayorGanancia = [...conGanancia].sort((a, b) => b.ganancia - a.ganancia).slice(0, 5)
    const menorGanancia = [...conGanancia].sort((a, b) => a.ganancia - b.ganancia).slice(0, 5)

    // Clientes.
    const cliMap = new Map<string, { nombre: string; pedidos: number; comprado: number; saldo: number }>()
    for (const p of enRango) { const key = p.cliente_id || p.clientes?.nombre || 'x'; const cur = cliMap.get(key) ?? { nombre: p.clientes?.nombre ?? 'Cliente', pedidos: 0, comprado: 0, saldo: 0 }; cur.pedidos += 1; cur.comprado += Number(p.total || 0); cur.saldo += Number(p.saldo || 0); cliMap.set(key, cur) }
    const clientes = [...cliMap.values()]
    const topClientes = [...clientes].sort((a, b) => b.comprado - a.comprado).slice(0, 5)
    const mayorSaldo = [...clientes].filter((c) => c.saldo > 0.01).sort((a, b) => b.saldo - a.saldo).slice(0, 5)
    const recurrentes = clientes.filter((c) => c.pedidos > 1).length

    // Categorías.
    const catMap = new Map<string, { cantidad: number; venta: number }>()
    for (const p of enRango) for (const it of p.pedido_items ?? []) {
      if (/env[íi]o r[áa]pido/i.test(it.producto)) continue
      const cat = (it.categoria || 'Otras').trim() || 'Otras'
      const cur = catMap.get(cat) ?? { cantidad: 0, venta: 0 }
      cur.cantidad += Number(it.cantidad || 1); cur.venta += Number(it.cantidad || 1) * Number(it.precio_unitario || 0); catMap.set(cat, cur)
    }
    const categorias = [...catMap.entries()].map(([nombre, v]) => ({ nombre, ...v })).sort((a, b) => b.venta - a.venta)

    // Logística (estado actual de los pedidos del rango).
    const logistica = {
      preparacion: enRango.filter((p) => etapaBase(p.estado) === 'en_preparacion').length,
      transito: enRango.filter((p) => etapaBase(p.estado) === 'transito_internacional').length,
      entregados: entregados.length,
      atrasados: enRango.filter((p) => p.estado !== 'entregado' && diasDesde(p.fecha_pedido) > 35).length,
    }

    return { ventas, cantidad, ticket, gb, gn, margen, porDia, masVendidos, mayorGanancia, menorGanancia, topClientes, mayorSaldo, recurrentes, categorias, logistica }
  }, [enRango])

  const exportar = (formato: 'csv' | 'xls') => {
    const filas = [['Codigo', 'Cliente', 'Fecha', 'Estado', 'Total', 'Cobrado', 'Saldo', 'Ganancia neta'],
      ...enRango.map((p) => { const d = desglosePedido(p); return [p.codigo, p.clientes?.nombre ?? '', (p.fecha_pedido || '').slice(0, 10), estadoLabel(p.estado), Number(p.total).toFixed(2), Number(p.abono).toFixed(2), Number(p.saldo).toFixed(2), p.estado === 'entregado' ? d.gananciaNeta.toFixed(2) : 'pendiente'] })]
    if (formato === 'csv') {
      const csv = filas.map((f) => f.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n')
      descargar(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `reporte-${desde}_a_${hasta}.csv`)
    } else {
      const tabla = `<table><tr>${filas[0].map((c) => `<th>${c}</th>`).join('')}</tr>${filas.slice(1).map((f) => `<tr>${f.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`
      descargar(new Blob([`﻿<html><head><meta charset="utf-8"></head><body>${tabla}</body></html>`], { type: 'application/vnd.ms-excel' }), `reporte-${desde}_a_${hasta}.xls`)
    }
    toast.success(`Reporte ${formato.toUpperCase()} descargado.`)
  }

  return <div>
    {/* Filtro de fecha */}
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-panel p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-white/[.02] p-1">
        {([['hoy', 'Hoy'], ['semana', 'Semana'], ['mes', 'Mes'], ['anio', 'Año'], ['custom', 'Personalizado']] as [Preset, string][]).map(([v, l]) => <button key={v} type="button" onClick={() => setRango(v)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${preset === v ? 'bg-accent text-black' : 'text-muted hover:text-white'}`}>{l}</button>)}
      </div>
      {preset === 'custom' && <div className="flex items-center gap-2 text-xs"><input type="date" className="select-input" value={desde} onChange={(e) => setDesde(e.target.value)} /><span className="text-muted">a</span><input type="date" className="select-input" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>}
      <div className="flex gap-2">
        <button className="subtle-button px-3" onClick={() => exportar('csv')}><FileText size={15} /> CSV</button>
        <button className="subtle-button px-3" onClick={() => exportar('xls')}><FileSpreadsheet size={15} /> Excel</button>
        <button className="subtle-button px-3" onClick={() => window.print()}><Printer size={15} /> PDF</button>
      </div>
    </div>

    {/* Ventas y ganancias */}
    <section className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Stat icon={ShoppingBag} label="Ventas totales" value={`USD ${money(r.ventas)}`} />
      <Stat icon={BarChart3} label="Cantidad" value={String(r.cantidad)} />
      <Stat icon={TrendingUp} label="Ticket promedio" value={`USD ${money(r.ticket)}`} />
      <Stat icon={TrendingUp} label="Ganancia bruta" value={`USD ${money(r.gb)}`} tone="emerald" />
      <Stat icon={TrendingUp} label="Ganancia neta" value={`USD ${money(r.gn)}`} tone="accent" />
      <Stat icon={BarChart3} label="Margen promedio" value={`${r.margen.toFixed(0)}%`} tone="emerald" />
    </section>
    <p className="mt-2 text-[11px] text-muted">Ganancias y margen cuentan solo los pedidos <span className="text-white/80">entregados</span> del rango.</p>

    {/* Ventas por día */}
    <article className="panel-card mt-4"><div className="panel-heading"><div><h2 className="flex items-center gap-2"><BarChart3 size={17} className="text-accent" /> Ventas por día</h2><p>{desde} a {hasta}</p></div></div><BarsPorDia data={r.porDia} /></article>

    {/* Productos + Clientes */}
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <Ranking icon={PackageCheck} titulo="Productos más vendidos" filas={r.masVendidos.map((p) => ({ label: p.nombre, valor: `${p.cantidad} u.`, sub: `USD ${money(p.venta)}` }))} />
      <Ranking icon={TrendingUp} titulo="Productos con mayor ganancia" filas={r.mayorGanancia.map((p) => ({ label: p.nombre, valor: `USD ${money(p.ganancia)}`, tone: 'emerald' }))} vacio="Registra costos para ver ganancia por producto." />
      <Ranking icon={Users} titulo="Clientes que más compran" filas={r.topClientes.map((c) => ({ label: c.nombre, valor: `USD ${money(c.comprado)}`, sub: `${c.pedidos} pedido${c.pedidos === 1 ? '' : 's'}` }))} extra={`${r.recurrentes} cliente(s) recurrente(s)`} />
      <Ranking icon={Users} titulo="Clientes con mayor saldo pendiente" filas={r.mayorSaldo.map((c) => ({ label: c.nombre, valor: `USD ${money(c.saldo)}`, tone: 'amber' }))} vacio="Nadie debe saldo en este rango. 🎉" />
    </div>

    {/* Categorías + Logística */}
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <article className="panel-card"><div className="panel-heading"><div><h2 className="flex items-center gap-2"><Layers size={17} className="text-accent" /> Por categoría</h2><p>Ventas por tipo de producto</p></div></div><div className="mt-4 space-y-2">{r.categorias.length === 0 ? <p className="py-4 text-center text-xs text-muted">Sin datos.</p> : r.categorias.map((c) => <div key={c.nombre} className="flex items-center justify-between rounded-xl border border-line bg-white/[.02] px-3 py-2 text-sm"><span>{c.nombre}</span><span className="tabular-nums"><b>USD {money(c.venta)}</b> <span className="text-[11px] text-muted">· {c.cantidad} u.</span></span></div>)}</div></article>
      <article className="panel-card"><div className="panel-heading"><div><h2 className="flex items-center gap-2"><Truck size={17} className="text-accent" /> Logística</h2><p>Estado de los pedidos del rango</p></div></div><div className="mt-4 grid grid-cols-2 gap-2.5"><LogTile label="En preparación" value={r.logistica.preparacion} cls="text-amber-300" /><LogTile label="En tránsito" value={r.logistica.transito} cls="text-sky-300" /><LogTile label="Entregados" value={r.logistica.entregados} cls="text-emerald-300" /><LogTile label="Atrasados" value={r.logistica.atrasados} cls="text-red-300" /></div></article>
    </div>
  </div>
}

function Stat({ icon: Icon, label, value, tone }: { icon: typeof BarChart3; label: string; value: string; tone?: 'emerald' | 'accent' }) {
  const color = tone === 'emerald' ? 'text-emerald-300' : tone === 'accent' ? 'text-accent' : 'text-white'
  return <article className="metric-card"><Icon size={18} className={tone ? color : 'text-muted'} /><p className="mt-3 text-[11px] text-muted">{label}</p><strong className={`mt-1 block text-xl tabular-nums ${color}`}>{value}</strong></article>
}

function BarsPorDia({ data }: { data: { fecha: string; valor: number }[] }) {
  if (!data.length) return <p className="py-8 text-center text-xs text-muted">Sin ventas en este rango.</p>
  const max = Math.max(1, ...data.map((d) => d.valor))
  return <div className="mt-5 flex h-40 items-end gap-1 overflow-x-auto sm:gap-2">{data.map((d) => <div key={d.fecha} className="flex h-full min-w-[14px] flex-1 flex-col justify-end" title={`${d.fecha}: USD ${money(d.valor)}`}><div className="rounded-t bg-gradient-to-t from-[#739f00] to-accent transition-all hover:brightness-125" style={{ height: `${Math.max(3, (d.valor / max) * 100)}%` }} /><span className="mt-1.5 text-center text-[8px] text-muted">{d.fecha.slice(8)}</span></div>)}</div>
}

function Ranking({ icon: Icon, titulo, filas, vacio, extra }: { icon: typeof Users; titulo: string; filas: { label: string; valor: string; sub?: string; tone?: 'emerald' | 'amber' }[]; vacio?: string; extra?: string }) {
  return <article className="panel-card"><div className="panel-heading"><div><h2 className="flex items-center gap-2"><Icon size={17} className="text-accent" /> {titulo}</h2>{extra && <p>{extra}</p>}</div></div>
    <div className="mt-4 space-y-1.5">{filas.length === 0 ? <p className="py-4 text-center text-xs text-muted">{vacio ?? 'Sin datos.'}</p> : filas.map((f, i) => <div key={i} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm odd:bg-white/[.015]"><span className="flex min-w-0 items-center gap-2"><span className="text-[11px] text-muted">{i + 1}.</span><span className="truncate">{f.label}</span></span><span className={`shrink-0 tabular-nums text-sm font-semibold ${f.tone === 'emerald' ? 'text-emerald-300' : f.tone === 'amber' ? 'text-amber-300' : ''}`}>{f.valor}{f.sub && <span className="ml-1 text-[11px] font-normal text-muted">{f.sub}</span>}</span></div>)}</div>
  </article>
}

function LogTile({ label, value, cls }: { label: string; value: number; cls: string }) {
  return <Link to="/pedidos" className="rounded-xl border border-line bg-white/[.02] p-3 text-center transition hover:border-accent/40"><strong className={`block text-2xl tabular-nums ${cls}`}>{value}</strong><span className="mt-1 block text-[10px] text-muted">{label}</span></Link>
}

function diasDesde(dateStr: string) { const t = new Date((dateStr || '').includes('T') ? dateStr : `${dateStr}T12:00:00`); return Math.floor((Date.now() - t.getTime()) / 86_400_000) }

function descargar(blob: Blob, nombre: string) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = nombre; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
