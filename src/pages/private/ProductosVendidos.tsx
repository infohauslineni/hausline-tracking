import { ArrowDownRight, ArrowRight, ArrowUpRight, FileSpreadsheet, FileText, Flame, Layers, Minus, Package, PackageX, Search, ShoppingBag, Sparkles, Trophy, Warehouse, Zap } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Modal } from '../../components/ui/Modal'
import { isSupabaseConfigured } from '../../lib/supabase'
import { listarInversiones, listarProductos } from '../../services/comercial.service'
import { listarPedidos, recargarPedidos, suscribirPedidos } from '../../services/pedidos.service'
import type { Inversion, Pedido, Producto } from '../../types/domain'
import { resolverImagenCatalogo } from '../../utils/catalogoImagen'
import {
  SIN_TALLA, lineasDeVenta, periodoAnterior, productosPocasVentas, rangoPreset, resumirProductos, serieVentas, stockDeProducto, tallasRecomendadas, ventasPorCategoria,
  type NivelDemanda, type Preset, type ResumenProducto, type Tendencia,
} from '../../utils/ventasProductos'

// Marca UTF-8 al inicio del archivo: así Excel abre bien los acentos.
const BOM = String.fromCharCode(0xfeff)
const money = (n: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0)
const fechaCorta = (s: string | null) => s ? new Intl.DateTimeFormat('es-NI', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${s.slice(0, 10)}T12:00:00`)) : '—'
const PRESETS: [Preset, string][] = [['hoy', 'Hoy'], ['7', '7 días'], ['30', '30 días'], ['90', '90 días'], ['anio', 'Este año'], ['custom', 'Personalizado']]
const TENDENCIA: Record<Tendencia, { label: string; cls: string; Icon: typeof ArrowUpRight }> = {
  aumento: { label: 'Demanda en aumento', cls: 'text-emerald-300', Icon: ArrowUpRight },
  estable: { label: 'Demanda estable', cls: 'text-white/70', Icon: Minus },
  baja: { label: 'Demanda en baja', cls: 'text-amber-300', Icon: ArrowDownRight },
}
const DEMANDA: Record<NivelDemanda, { label: string; cls: string; nota: string }> = {
  alta: { label: 'Alta demanda', cls: 'border-accent/40 bg-accent/[.07] text-accent', nota: 'Se pidió en 3 o más pedidos del período.' },
  media: { label: 'Demanda media', cls: 'border-sky-400/30 bg-sky-400/[.06] text-sky-300', nota: 'Se pidió en 2 pedidos del período.' },
  baja: { label: 'Baja demanda', cls: 'border-line bg-white/[.02] text-white/70', nota: 'Se pidió en 1 pedido del período.' },
}
type Orden = 'unidades' | 'ingresos' | 'ultima'

// Reportes → Productos más vendidos. Solo lee datos reales (pedidos, productos y Compras libres);
// no compra ni cambia nada: las recomendaciones dicen "Evaluar" y la decisión es del admin.
export function ProductosVendidos() {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [inversiones, setInversiones] = useState<Inversion[]>([])
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [preset, setPreset] = useState<Preset>('90')
  const [desde, setDesde] = useState(rangoPreset('90').desde)
  const [hasta, setHasta] = useState(rangoPreset('90').hasta)
  const [busqueda, setBusqueda] = useState('')
  const [orden, setOrden] = useState<Orden>('unidades')
  const [verTodos, setVerTodos] = useState(false)
  const [detalle, setDetalle] = useState<ResumenProducto | null>(null)
  const [pocasVer, setPocasVer] = useState(12)

  const cargar = useCallback(async () => {
    if (!isSupabaseConfigured) return
    const [p, pr, inv] = await Promise.allSettled([listarPedidos(setPedidos), listarProductos(setProductos), listarInversiones(setInversiones)])
    if (p.status === 'fulfilled') setPedidos(p.value)
    if (pr.status === 'fulfilled') setProductos(pr.value)
    if (inv.status === 'fulfilled') setInversiones(inv.value)
    if (p.status === 'rejected') toast.error('No se pudieron cargar los pedidos. Intentá actualizar la página.')
    setLoading(false)
  }, [])
  useEffect(() => { void Promise.resolve().then(cargar) }, [cargar])
  // En vivo: un pedido nuevo, un cambio de estado o una cancelación actualizan el reporte solos.
  useEffect(() => suscribirPedidos(() => { void recargarPedidos(setPedidos).then(setPedidos).catch(() => undefined) }), [])

  const elegirPreset = (p: Preset) => { setPreset(p); if (p !== 'custom') { const r = rangoPreset(p); setDesde(r.desde); setHasta(r.hasta) } }
  const rangoOk = desde && hasta && desde <= hasta

  const lineas = useMemo(() => lineasDeVenta(pedidos, productos), [pedidos, productos])
  const enRango = useMemo(() => rangoOk ? lineas.filter((l) => l.fecha >= desde && l.fecha <= hasta) : [], [lineas, desde, hasta, rangoOk])
  const resumen = useMemo(() => rangoOk ? resumirProductos(lineas, desde, hasta, productos) : [], [lineas, desde, hasta, productos, rangoOk])
  const categorias = useMemo(() => ventasPorCategoria(enRango), [enRango])
  const pocas = useMemo(() => productosPocasVentas(resumen, productos, lineas), [resumen, productos, lineas])
  const anterior = rangoOk ? periodoAnterior(desde, hasta) : null

  const metricas = useMemo(() => {
    const tallas = new Map<string, number>()
    for (const l of enRango) if (l.talla !== SIN_TALLA) tallas.set(l.talla, (tallas.get(l.talla) ?? 0) + l.cantidad)
    const tallaTop = [...tallas.entries()].sort((a, b) => b[1] - a[1])[0]
    return {
      unidades: enRango.reduce((s, l) => s + l.cantidad, 0),
      pedidos: new Set(enRango.map((l) => l.pedidoId)).size,
      ingresos: enRango.reduce((s, l) => s + l.ingreso, 0),
      top: resumen[0] ?? null,
      tallaTop: tallaTop ? { talla: tallaTop[0], unidades: tallaTop[1] } : null,
    }
  }, [enRango, resumen])

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    const lista = q ? resumen.filter((r) => [r.nombre, r.codigo, r.marca, r.categoria].some((v) => String(v ?? '').toLowerCase().includes(q))) : resumen
    return [...lista].sort((a, b) => orden === 'ingresos' ? b.ingresos - a.ingresos : orden === 'ultima' ? String(b.ultimaVenta).localeCompare(String(a.ultimaVenta)) : b.unidades - a.unidades || b.ingresos - a.ingresos)
  }, [resumen, busqueda, orden])

  // Oportunidades: demanda alta o media, que NO esté bajando. Solo sugerencia ("Evaluar").
  const oportunidades = useMemo(() => resumen.filter((r) => r.demanda !== 'baja' && r.tendencia !== 'baja').slice(0, 6), [resumen])
  const porDemanda = useMemo(() => ({ alta: resumen.filter((r) => r.demanda === 'alta'), media: resumen.filter((r) => r.demanda === 'media'), baja: resumen.filter((r) => r.demanda === 'baja') }), [resumen])
  const tendencias = useMemo(() => ({ aumento: resumen.filter((r) => r.tendencia === 'aumento').slice(0, 6), baja: resumen.filter((r) => r.tendencia === 'baja').slice(0, 6) }), [resumen])
  const stockDe = useCallback((codigo: string | null) => stockDeProducto(inversiones, codigo), [inversiones])

  const exportar = (formato: 'csv' | 'xls') => {
    const filas: (string | number)[][] = [['Producto', 'Codigo', 'Categoria', 'Unidades vendidas', 'Ingresos (USD)', 'Talla', 'Unidades por talla', 'Ultima venta']]
    for (const r of filtrados) for (const t of r.tallas) filas.push([r.nombre, r.codigo ?? '', r.categoria, r.unidades, r.ingresos.toFixed(2), t.talla, t.unidades, r.ultimaVenta ?? ''])
    if (filas.length === 1) return toast.info('No hay ventas en este período para exportar.')
    const nombre = `productos-mas-vendidos-${desde}_a_${hasta}`
    if (formato === 'csv') {
      const csv = filas.map((f) => f.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n')
      descargar(new Blob([BOM + csv], { type: 'text/csv;charset=utf-8' }), `${nombre}.csv`)
    } else {
      const escHtml = (v: string | number) => String(v).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))
      const tabla = `<table><tr>${filas[0].map((c) => `<th>${escHtml(c)}</th>`).join('')}</tr>${filas.slice(1).map((f) => `<tr>${f.map((c) => `<td>${escHtml(c)}</td>`).join('')}</tr>`).join('')}</table>`
      descargar(new Blob([`${BOM}<html><head><meta charset="utf-8"></head><body>${tabla}</body></html>`], { type: 'application/vnd.ms-excel' }), `${nombre}.xls`)
    }
    toast.success(`Reporte ${formato === 'csv' ? 'CSV' : 'Excel'} descargado.`)
  }

  const visibles = verTodos ? filtrados : filtrados.slice(0, 15)

  return <div>
    {/* Filtros */}
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-panel p-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-white/[.02] p-1">
        {PRESETS.map(([v, l]) => <button key={v} type="button" onClick={() => elegirPreset(v)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${preset === v ? 'bg-accent text-black' : 'text-muted hover:text-white'}`}>{l}</button>)}
      </div>
      {preset === 'custom' && <div className="flex flex-wrap items-center gap-2 text-xs"><input type="date" className="select-input" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} aria-label="Desde" /><span className="text-muted">a</span><input type="date" className="select-input" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} aria-label="Hasta" /></div>}
      <div className="flex gap-2">
        <button className="subtle-button px-3" onClick={() => exportar('csv')}><FileText size={15} /> CSV</button>
        <button className="subtle-button px-3" onClick={() => exportar('xls')}><FileSpreadsheet size={15} /> Excel</button>
      </div>
    </div>
    <p className="mt-2 text-[11px] text-muted">{rangoOk ? <>Del <b className="text-white/80">{fechaCorta(desde)}</b> al <b className="text-white/80">{fechaCorta(hasta)}</b>. Cuentan los pedidos no cancelados (misma regla que el resto de Reportes); no cuentan envíos ni cargos.</> : 'Elegí una fecha inicial anterior a la final.'}</p>

    {loading ? <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="metric-card h-24 animate-pulse" />)}</div> : <>
      {/* Métricas */}
      <section className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Metrica icon={Package} label="Productos vendidos" valor={`${metricas.unidades} u.`} />
        <Metrica icon={ShoppingBag} label="Pedidos" valor={String(metricas.pedidos)} />
        <Metrica icon={Trophy} label="Producto más vendido" valor={metricas.top?.nombre ?? '—'} sub={metricas.top ? `${metricas.top.unidades} u.` : undefined} texto />
        <Metrica icon={Sparkles} label="Talla más solicitada" valor={metricas.tallaTop?.talla ?? '—'} sub={metricas.tallaTop ? `${metricas.tallaTop.unidades} u.` : undefined} />
        <Metrica icon={Layers} label="Ingresos por productos" valor={`USD ${money(metricas.ingresos)}`} acento />
      </section>

      {resumen.length === 0 ? <div className="panel-card mt-4 py-14 text-center"><Package size={30} className="mx-auto text-muted" /><p className="mt-3 text-sm text-muted">No hay ventas en este período. Probá con un rango más amplio.</p></div> : <>
        {/* Top 3 */}
        <section className="mt-4 grid gap-3 md:grid-cols-3">
          {resumen.slice(0, 3).map((r, i) => <button key={r.clave} type="button" onClick={() => setDetalle(r)} className="panel-card flex items-center gap-3 text-left transition hover:border-accent/40">
            <Foto src={r.imagen} className="size-16" />
            <span className="min-w-0 flex-1">
              <span className="text-[11px] font-semibold text-muted">{['🏆 Producto #1', '🥈 Producto #2', '🥉 Producto #3'][i]}</span>
              <strong className="mt-0.5 block truncate text-sm">{r.nombre}</strong>
              <span className="block font-mono text-[11px] text-muted">{r.codigo ?? 'Sin código'}</span>
              <span className="mt-1 block text-sm font-semibold text-accent">{r.unidades} u. vendidas</span>
            </span>
          </button>)}
        </section>

        {/* Oportunidades de stock */}
        <article className="panel-card mt-4">
          <div className="panel-heading"><div><h2 className="flex items-center gap-2"><Zap size={17} className="text-accent" /> Oportunidades de stock</h2><p>Productos con demanda alta o media que no está bajando. Es una sugerencia: la decisión es tuya.</p></div></div>
          {oportunidades.length === 0 ? <p className="mt-4 py-4 text-center text-xs text-muted">Todavía no hay productos que se repitan en varios pedidos en este período.</p> : <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {oportunidades.map((r) => { const rec = tallasRecomendadas(r.tallas); const stock = stockDe(r.codigo); const t = TENDENCIA[r.tendencia]; return <div key={r.clave} className="rounded-xl border border-line bg-white/[.02] p-3">
              <div className="flex items-center gap-3"><Foto src={r.imagen} className="size-12" /><div className="min-w-0 flex-1"><button type="button" onClick={() => setDetalle(r)} className="block truncate text-left text-sm font-semibold hover:text-accent">{r.nombre}</button><span className="font-mono text-[11px] text-muted">{r.codigo ?? 'Sin código'}</span></div></div>
              <p className="mt-2 text-xs text-white/85"><b>{r.unidades} ventas</b> en el período · {r.historicas} históricas</p>
              {r.tallas.filter((x) => x.talla !== SIN_TALLA).slice(0, 3).map((x) => <p key={x.talla} className="text-[12px] text-muted">Talla {x.talla}: <b className="text-white/80">{x.unidades}</b> {x.unidades === 1 ? 'venta' : 'ventas'}</p>)}
              <p className={`mt-1.5 flex items-center gap-1 text-[12px] font-semibold ${t.cls}`}><t.Icon size={13} /> Demanda reciente: {DEMANDA[r.demanda].label.toLowerCase()} · {t.label.toLowerCase().replace('demanda ', '')}</p>
              {rec.tallas.length > 0 && <p className="mt-2 text-[12px]">Tallas con mayor demanda: <b className="text-accent">{rec.tallas.join(' · ')}</b></p>}
              {stock && <p className="mt-1 text-[11px] text-sky-300">En Compras libres: {stock.map((s) => `${s.talla} (${s.disponible + s.reservado + s.enCamino})`).join(', ')}</p>}
              <p className="mt-2 flex items-center gap-1 rounded-lg bg-accent/[.07] px-2 py-1.5 text-[12px] font-semibold text-accent"><ArrowRight size={13} /> Acción sugerida: Evaluar disponibilidad para stock</p>
            </div> })}
          </div>}
        </article>

        {/* Demanda para stock */}
        <article className="panel-card mt-4">
          <div className="panel-heading"><div><h2 className="flex items-center gap-2"><Flame size={17} className="text-accent" /> Demanda para stock</h2><p>Según en cuántos pedidos distintos se vendió cada producto en el período.</p></div></div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {(['alta', 'media', 'baja'] as NivelDemanda[]).map((nivel) => <div key={nivel} className={`rounded-xl border p-3 ${DEMANDA[nivel].cls}`}>
              <p className="text-sm font-semibold">{DEMANDA[nivel].label} <span className="text-xs font-normal opacity-80">({porDemanda[nivel].length})</span></p>
              <p className="text-[11px] opacity-75">{DEMANDA[nivel].nota}</p>
              <div className="mt-2 space-y-1">{porDemanda[nivel].slice(0, 6).map((r) => <button key={r.clave} type="button" onClick={() => setDetalle(r)} className="flex w-full items-center justify-between gap-2 rounded-lg bg-black/20 px-2 py-1.5 text-left text-[12px] text-white/85 hover:bg-black/35"><span className="truncate">{r.nombre}</span><b className="shrink-0 tabular-nums">{r.unidades} u.</b></button>)}{porDemanda[nivel].length > 6 && <p className="px-2 text-[11px] opacity-75">+{porDemanda[nivel].length - 6} más en la tabla</p>}{porDemanda[nivel].length === 0 && <p className="px-2 text-[11px] opacity-60">Ninguno.</p>}</div>
            </div>)}
          </div>
        </article>

        {/* Tabla */}
        <article className="panel-card mt-4">
          <div className="panel-heading flex-wrap"><div><h2 className="flex items-center gap-2"><Trophy size={17} className="text-accent" /> Productos más vendidos</h2><p>{filtrados.length} producto{filtrados.length === 1 ? '' : 's'} con ventas · tocá uno para ver tallas y tendencia</p></div>
            <label className="relative w-full sm:w-72"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input className="search-input w-full pl-9" placeholder="Buscar nombre, código, marca o categoría" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} /></label>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-[10px] uppercase tracking-wide text-muted"><tr className="border-b border-line">
                <th className="py-2.5 pr-3 font-bold">Producto</th><th className="px-3 py-2.5 font-bold">Código</th>
                <Th activo={orden === 'unidades'} onClick={() => setOrden('unidades')}>Unidades</Th>
                <Th activo={orden === 'ingresos'} onClick={() => setOrden('ingresos')}>Ingresos</Th>
                <Th activo={orden === 'ultima'} onClick={() => setOrden('ultima')}>Última venta</Th>
              </tr></thead>
              <tbody>{visibles.map((r, i) => <tr key={r.clave} onClick={() => setDetalle(r)} className="cursor-pointer border-b border-line/60 transition last:border-0 hover:bg-white/[.03]">
                <td className="py-2.5 pr-3"><span className="flex items-center gap-3"><span className="w-5 text-right text-[11px] text-muted">{i + 1}</span><Foto src={r.imagen} className="size-10" /><span className="min-w-0"><span className="block max-w-[260px] truncate font-semibold">{r.nombre}</span><span className="block text-[11px] text-muted">{[r.marca, r.categoria].filter(Boolean).join(' · ')}</span></span></span></td>
                <td className="px-3 py-2.5 font-mono text-[12px] text-muted">{r.codigo ?? '—'}</td>
                <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{r.unidades}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">USD {money(r.ingresos)}</td>
                <td className="px-3 py-2.5 text-right text-[12px] text-muted">{fechaCorta(r.ultimaVenta)}</td>
              </tr>)}</tbody>
            </table>
            {filtrados.length === 0 && <p className="py-6 text-center text-xs text-muted">Ningún producto coincide con “{busqueda}”.</p>}
          </div>
          {filtrados.length > 15 && <button type="button" className="mt-3 w-full rounded-lg border border-line py-2 text-xs font-semibold text-accent hover:bg-white/[.02]" onClick={() => setVerTodos((v) => !v)}>{verTodos ? 'Ver menos' : `Ver los ${filtrados.length}`}</button>}
        </article>

        {/* Categorías + Tendencia */}
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <article className="panel-card">
            <div className="panel-heading"><div><h2 className="flex items-center gap-2"><Layers size={17} className="text-accent" /> Ventas por categoría</h2><p>Unidades, pedidos, % del total e ingresos</p></div></div>
            <div className="mt-4 space-y-3">{categorias.map((c) => <div key={c.categoria}>
              <div className="flex items-baseline justify-between gap-2 text-sm"><span className="font-semibold">{c.categoria}</span><span className="text-[12px] text-muted"><b className="text-white">{c.unidades} u.</b> · {c.pedidos} pedido{c.pedidos === 1 ? '' : 's'} · USD {money(c.ingresos)}</span></div>
              <div className="mt-1 flex items-center gap-2"><div className="h-2 flex-1 rounded-full bg-white/[.06]"><div className="h-2 rounded-full bg-accent" style={{ width: `${Math.max(2, c.pct)}%` }} /></div><span className="w-9 text-right text-[11px] tabular-nums text-muted">{c.pct}%</span></div>
            </div>)}</div>
          </article>
          <article className="panel-card">
            <div className="panel-heading"><div><h2 className="flex items-center gap-2"><ArrowUpRight size={17} className="text-accent" /> Tendencia de demanda</h2><p>Este período contra el anterior del mismo largo{anterior ? ` (${fechaCorta(anterior.desde)} – ${fechaCorta(anterior.hasta)})` : ''}</p></div></div>
            <div className="mt-4 space-y-4">
              <ListaTendencia titulo="Aumentando" items={tendencias.aumento} tipo="aumento" onAbrir={setDetalle} />
              <ListaTendencia titulo="Disminuyendo" items={tendencias.baja} tipo="baja" onAbrir={setDetalle} />
              {!tendencias.aumento.length && !tendencias.baja.length && <p className="py-2 text-center text-xs text-muted">Sin cambios fuertes de demanda: los productos se mantienen estables.</p>}
            </div>
          </article>
        </div>
      </>}

      {/* Pocas o ninguna venta */}
      <article className="panel-card mt-4">
        <div className="panel-heading"><div><h2 className="flex items-center gap-2"><PackageX size={17} className="text-accent" /> Productos sin ventas o con pocas ventas</h2><p>Productos del catálogo con 0, 1 o 2 unidades en el período. Probablemente no conviene tenerlos en stock.</p></div></div>
        <div className="mt-4 grid grid-cols-3 gap-2">{[0, 1, 2].map((n) => <div key={n} className="rounded-xl border border-line bg-white/[.02] p-3 text-center"><strong className="block text-2xl tabular-nums">{pocas.filter((p) => p.unidades === n).length}</strong><span className="text-[11px] text-muted">{n === 0 ? 'sin ventas' : n === 1 ? 'con 1 venta' : 'con 2 ventas'}</span></div>)}</div>
        {pocas.length === 0 ? <p className="mt-3 text-center text-xs text-muted">{productos.length ? 'Todos los productos del catálogo tuvieron 3 o más ventas.' : 'No se pudo leer el catálogo de productos.'}</p> : <div className="mt-3 divide-y divide-line/60">
          {pocas.slice(0, pocasVer).map((p) => <div key={p.codigo} className="flex items-center gap-3 py-2 text-sm"><Foto src={p.imagen} className="size-9" /><span className="min-w-0 flex-1"><span className="block truncate">{p.nombre}</span><span className="block font-mono text-[11px] text-muted">{p.codigo} · {p.categoria}</span></span><span className="shrink-0 text-right text-[12px]"><b className="tabular-nums">{p.unidades}</b> <span className="text-muted">en el período</span><span className="block text-[11px] text-muted">{p.historicas} históricas{p.ultimaHistorica ? ` · última ${fechaCorta(p.ultimaHistorica)}` : ''}</span></span></div>)}
          {pocas.length > pocasVer && <button type="button" className="w-full py-2 text-xs font-semibold text-accent" onClick={() => setPocasVer((n) => n + 24)}>Ver más ({pocas.length - pocasVer})</button>}
        </div>}
      </article>
    </>}

    {detalle && <DetalleProducto r={detalle} lineas={lineas.filter((l) => l.clave === detalle.clave && l.fecha >= desde && l.fecha <= hasta)} desde={desde} hasta={hasta} stock={stockDe(detalle.codigo)} onClose={() => setDetalle(null)} />}
  </div>
}

function DetalleProducto({ r, lineas, desde, hasta, stock, onClose }: { r: ResumenProducto; lineas: ReturnType<typeof lineasDeVenta>; desde: string; hasta: string; stock: ReturnType<typeof stockDeProducto>; onClose: () => void }) {
  const rec = tallasRecomendadas(r.tallas)
  const serie = serieVentas(lineas, desde, hasta)
  const maxSerie = Math.max(1, ...serie.puntos.map((p) => p.unidades))
  const maxTalla = Math.max(1, ...r.tallas.map((t) => t.unidades))
  const t = TENDENCIA[r.tendencia]
  return <Modal open onClose={onClose} title={r.nombre} description={[r.codigo, r.marca, r.categoria].filter(Boolean).join(' · ')}>
    <div className="flex flex-col gap-4 sm:flex-row">
      <Foto src={r.imagen} className="size-28 shrink-0" />
      <div className="grid flex-1 grid-cols-2 gap-2 text-sm">
        <Dato label="Unidades vendidas" valor={String(r.unidades)} />
        <Dato label="Pedidos" valor={String(r.pedidos)} />
        <Dato label="Ingresos" valor={`USD ${money(r.ingresos)}`} />
        <Dato label="Última venta" valor={fechaCorta(r.ultimaVenta)} />
        <Dato label="Precio de catálogo" valor={r.precio != null ? `USD ${money(r.precio)}` : '—'} />
        <Dato label="Ventas históricas" valor={`${r.historicas} u.`} />
      </div>
    </div>

    <section className="mt-5">
      <h3 className="text-sm font-semibold">Tallas más vendidas</h3>
      {r.tallaTop && <p className="mt-1 text-sm">Talla más solicitada: <b className="text-accent">{r.tallaTop}</b></p>}
      <div className="mt-3 space-y-1.5">{r.tallas.map((x) => <div key={x.talla} className="flex items-center gap-2 text-sm">
        <span className={`w-20 shrink-0 ${x.talla === r.tallaTop ? 'font-semibold text-accent' : ''}`}>{x.talla === SIN_TALLA ? 'Sin talla' : `Talla ${x.talla}`}</span>
        <div className="h-2 flex-1 rounded-full bg-white/[.06]"><div className={`h-2 rounded-full ${x.talla === r.tallaTop ? 'bg-accent' : 'bg-white/40'}`} style={{ width: `${(x.unidades / maxTalla) * 100}%` }} /></div>
        <span className="w-24 shrink-0 text-right text-[12px] tabular-nums"><b>{x.unidades}</b> u. · {x.pct}%</span>
      </div>)}</div>
      {rec.tallas.length > 0 && <div className="mt-3 rounded-xl border border-accent/25 bg-accent/[.05] p-3 text-sm">
        <p>Tallas con mayor demanda: <b className="text-accent">{rec.tallas.join(' · ')}</b></p>
        <p className="mt-1 text-[12px] text-muted">Estas tallas representan el {rec.pct}% de las ventas de este producto en el período. Acción sugerida: <b className="text-white/85">Evaluar</b> disponibilidad para stock.</p>
      </div>}
    </section>

    <section className="mt-5">
      <h3 className="text-sm font-semibold">Tendencia</h3>
      <p className={`mt-1 flex items-center gap-1 text-sm font-semibold ${t.cls}`}><t.Icon size={15} /> {t.label}</p>
      <p className="text-[12px] text-muted">Este período: <b className="text-white/85">{r.unidades} u.</b> · período anterior del mismo largo: <b className="text-white/85">{r.anterior} u.</b></p>
      {serie.puntos.length > 0 && <div className="mt-3 flex h-28 items-end gap-1.5 overflow-x-auto">{serie.puntos.map((p) => <div key={p.periodo} className="flex h-full min-w-[26px] flex-1 flex-col justify-end" title={`${p.periodo}: ${p.unidades} u.`}>
        <span className="mb-1 text-center text-[10px] tabular-nums text-muted">{p.unidades}</span>
        <div className="rounded-t bg-gradient-to-t from-[#739f00] to-accent" style={{ height: `${Math.max(6, (p.unidades / maxSerie) * 100)}%` }} />
        <span className="mt-1 text-center text-[9px] text-muted">{serie.porMes ? p.periodo.slice(5) + '/' + p.periodo.slice(2, 4) : fechaCorta(p.periodo).replace(/ \d{4}$/, '')}</span>
      </div>)}</div>}
      <p className="mt-1 text-[11px] text-muted">Ventas por {serie.porMes ? 'mes' : 'semana (desde el lunes)'}.</p>
    </section>

    <section className="mt-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><Warehouse size={15} className="text-accent" /> Stock</h3>
      {stock ? <div className="mt-2 overflow-x-auto"><table className="w-full text-left text-[13px]"><thead className="text-[10px] uppercase tracking-wide text-muted"><tr><th className="py-1.5">Talla</th><th className="py-1.5 text-right">En inventario</th><th className="py-1.5 text-right">Reservado</th><th className="py-1.5 text-right">En camino</th></tr></thead>
        <tbody>{stock.map((s) => <tr key={s.talla} className="border-t border-line/60"><td className="py-1.5">{s.talla}</td><td className="py-1.5 text-right tabular-nums">{s.disponible}</td><td className="py-1.5 text-right tabular-nums">{s.reservado}</td><td className="py-1.5 text-right tabular-nums">{s.enCamino}</td></tr>)}</tbody></table>
        <p className="mt-1 text-[11px] text-muted">Según “Compras libres”.</p></div>
        : <p className="mt-1 text-[12px] text-muted">No hay unidades de este producto registradas en “Compras libres”. Cuando compres para stock y lo registres ahí, aparece aquí.</p>}
    </section>
  </Modal>
}

function ListaTendencia({ titulo, items, tipo, onAbrir }: { titulo: string; items: ResumenProducto[]; tipo: Tendencia; onAbrir: (r: ResumenProducto) => void }) {
  if (!items.length) return null
  const t = TENDENCIA[tipo]
  return <div><p className={`flex items-center gap-1 text-xs font-semibold ${t.cls}`}><t.Icon size={14} /> {titulo}</p>
    <div className="mt-1.5 space-y-1">{items.map((r) => <button key={r.clave} type="button" onClick={() => onAbrir(r)} className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-sm odd:bg-white/[.015] hover:bg-white/[.04]">
      <span className="truncate">{r.nombre}</span><span className="shrink-0 text-[12px] tabular-nums text-muted"><b className="text-white">{r.unidades} u.</b> vs {r.anterior} u.</span>
    </button>)}</div></div>
}

function Metrica({ icon: Icon, label, valor, sub, acento, texto }: { icon: typeof Package; label: string; valor: string; sub?: string; acento?: boolean; texto?: boolean }) {
  return <article className="metric-card min-w-0"><Icon size={18} className={acento ? 'text-accent' : 'text-muted'} /><p className="mt-3 text-[11px] text-muted">{label}</p>
    <strong className={`mt-1 block ${texto ? 'truncate text-sm' : 'text-xl tabular-nums'} ${acento ? 'text-accent' : 'text-white'}`} title={valor}>{valor}</strong>{sub && <span className="text-[11px] text-muted">{sub}</span>}</article>
}

function Th({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: string }) {
  return <th className="px-3 py-2.5 text-right font-bold"><button type="button" onClick={onClick} className={`uppercase tracking-wide ${activo ? 'text-accent' : 'hover:text-white'}`}>{children}{activo ? ' ↓' : ''}</button></th>
}

function Dato({ label, valor }: { label: string; valor: string }) {
  return <div className="rounded-xl border border-line bg-white/[.02] p-2.5"><p className="text-[10px] uppercase tracking-wide text-muted">{label}</p><p className="mt-0.5 truncate font-semibold tabular-nums">{valor}</p></div>
}

function Foto({ src, className }: { src: string | null; className: string }) {
  const [rota, setRota] = useState(false)
  const url = src ? resolverImagenCatalogo(src) : ''
  return <span className={`grid shrink-0 place-items-center overflow-hidden rounded-xl bg-white/[.04] ${className}`}>{url && !rota ? <img src={url} alt="" loading="lazy" className="size-full object-cover" onError={() => setRota(true)} /> : <Package size={18} className="text-muted" />}</span>
}

function descargar(blob: Blob, nombre: string) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = nombre; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
