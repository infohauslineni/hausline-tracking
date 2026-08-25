import { AlertTriangle, ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, CircleDollarSign, Coins, CreditCard, History, PackageCheck, Plus, ReceiptText, Scale, Search, Tag, TrendingUp, WalletCards, Zap } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Modal } from '../../components/ui/Modal'
import { estadoLabel } from '../../constants/orders'
import { DEMO_PEDIDOS } from '../../data/demo'
import { isSupabaseConfigured } from '../../lib/supabase'
import { listarInversiones, listarPagos, listarVentasStock, obtenerTipoCambio, venderStockInmediato, type VentaStock } from '../../services/comercial.service'
import { listarPedidos } from '../../services/pedidos.service'
import type { Inversion, Pago, Pedido } from '../../types/domain'
import { desglosePedido, estadoPago, type EstadoPago } from '../../utils/pedidoCosto'
import { periodoDeMes } from '../../utils/periodo'
import { formatDate, PagoModal } from './PagosPage'

const money = (n: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0)

const claveMes = (fecha: string) => (fecha.length >= 7 ? fecha.slice(0, 7) : fecha)
const esEntregado = (estado: Pedido['estado']) => estado === 'entregado' || estado === 'cancelado'
const costoInversion = (item: Inversion) => Number(item.costo_unitario) * Number(item.cantidad) + Number(item.gastos_adicionales) + (item.gastos ?? []).reduce((s, g) => s + Number(g.monto || 0), 0)

export function VentasPage() {
  const [pedidos, setPedidos] = useState<Pedido[]>(isSupabaseConfigured ? [] : DEMO_PEDIDOS)
  const [ventasStock, setVentasStock] = useState<VentaStock[]>([])
  const [stock, setStock] = useState<Inversion[]>([])
  const [pagos, setPagos] = useState<Pago[]>([])
  const [tipoCambio, setTipoCambio] = useState(37)
  const [search, setSearch] = useState('')
  const [mesRef, setMesRef] = useState(() => new Date())
  const [vender, setVender] = useState(false)
  const [abonoPedido, setAbonoPedido] = useState<Pedido | null>(null)
  const [historialPedido, setHistorialPedido] = useState<Pedido | null>(null)

  const cargar = () => { if (!isSupabaseConfigured) return Promise.resolve(); return Promise.all([listarPedidos(), listarVentasStock(), listarInversiones(), listarPagos()])
    .then(([orders, sales, inventory, payments]) => { setPedidos(orders); setVentasStock(sales); setStock(inventory); setPagos(payments) })
    .catch(() => toast.error('No se pudieron cargar las ventas.')) }
  useEffect(() => { void cargar(); void obtenerTipoCambio().then(setTipoCambio).catch(() => undefined) }, [])

  const periodo = useMemo(() => periodoDeMes(mesRef), [mesRef])
  const cambiarMes = (delta: number) => setMesRef((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1))
  const esMesActual = claveMes(periodo.desde) === claveMes(new Date().toISOString())
  const disponibles = useMemo(() => stock.filter((item) => item.estado === 'en_inventario' || item.estado === 'reservado'), [stock])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    const mes = claveMes(periodo.desde)
    const dePedidos = pedidos
      .filter((p) => claveMes(p.fecha_pedido) === mes)
      .filter((p) => !term || [p.codigo, p.clientes?.nombre].some((v) => v?.toLowerCase().includes(term)))
      .map((p) => ({ kind: 'pedido' as const, id: p.id, fecha: p.fecha_pedido, activo: !esEntregado(p.estado), data: p }))
    const deStock = ventasStock
      .filter((v) => claveMes(v.fecha) === mes)
      .filter((v) => !term || [v.producto, v.codigo, v.cliente].some((x) => x?.toLowerCase().includes(term)))
      .map((v) => ({ kind: 'stock' as const, id: v.id, fecha: v.fecha, activo: false, data: v }))
    // Los pedidos activos arriba; entregados y ventas inmediatas (ya cerradas) al fondo, por fecha reciente.
    return [...dePedidos, ...deStock].sort((a, b) => (a.activo === b.activo ? b.fecha.localeCompare(a.fecha) : a.activo ? -1 : 1))
  }, [pedidos, ventasStock, search, periodo])

  const totales = useMemo(() => filtered.reduce((acc, row) => {
    if (row.kind === 'pedido') {
      const p = row.data
      const d = desglosePedido(p)
      acc.ventas += d.venta; acc.cobrado += Number(p.abono); acc.porCobrar += Number(p.saldo)
      // La ganancia se realiza SOLO al entregar: solo entonces sumamos venta y costo a la base de ganancia.
      if (d.entregado) { acc.ventasEnt += d.venta; acc.costo += d.costoTotal; acc.costoDirecto += d.costoDirecto }
      if (estadoPago(p) === 'vencido') { acc.vencido += Number(p.saldo); acc.vencidoCount += 1 }
    } else {
      // Las ventas de stock inmediato ya están entregadas.
      acc.ventas += row.data.monto; acc.cobrado += row.data.monto; acc.ventasEnt += row.data.monto; acc.costo += row.data.costo; acc.costoDirecto += row.data.costo
    }
    return acc
  }, { ventas: 0, cobrado: 0, porCobrar: 0, ventasEnt: 0, costo: 0, costoDirecto: 0, vencido: 0, vencidoCount: 0 }), [filtered])
  const gananciaBruta = totales.ventasEnt - totales.costoDirecto
  const gananciaNeta = totales.ventasEnt - totales.costo
  const pagosDe = (pedidoId: string) => pagos.filter((pago) => pago.pedido_id === pedidoId)
  const recargarTrasAbono = (pago: Pago) => {
    setPagos((all) => [pago, ...all])
    const saldo = Number(pago.pedidos?.saldo)
    if (Number.isFinite(saldo)) setPedidos((all) => all.map((item) => item.id === pago.pedido_id ? { ...item, saldo, abono: Math.max(0, Number(item.total) - saldo) } : item))
    setAbonoPedido(null)
  }

  return <div><Header onVender={() => setVender(true)} />
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-panel px-3 py-2.5">
      <button type="button" className="table-action" onClick={() => cambiarMes(-1)} aria-label="Mes anterior"><ChevronLeft size={18} /></button>
      <div className="text-center"><p className="text-sm font-semibold capitalize">{periodo.etiqueta}</p><p className="text-[11px] text-muted">{filtered.length} venta{filtered.length === 1 ? '' : 's'} este mes</p></div>
      <button type="button" className="table-action disabled:opacity-30" onClick={() => cambiarMes(1)} disabled={esMesActual} aria-label="Mes siguiente"><ChevronRight size={18} /></button>
    </div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Metric icon={WalletCards} label="Ventas totales" value={totales.ventas} />
      <Metric icon={CircleDollarSign} label="Dinero cobrado" value={totales.cobrado} tone="emerald" />
      <Metric icon={Coins} label="Dinero por cobrar" value={totales.porCobrar} tone="amber" />
      <Metric icon={ReceiptText} label="Costo total" value={totales.costo} tone="muted" />
      <Metric icon={Scale} label="Ganancia bruta" value={gananciaBruta} tone={gananciaBruta >= 0 ? 'green' : 'red'} />
      <Metric icon={TrendingUp} label="Ganancia neta" value={gananciaNeta} accent />
    </div>
    <p className="mt-2 text-[11px] leading-5 text-muted">La ganancia cuenta <span className="text-white/80">solo los pedidos entregados</span> (antes de entregar aún no hay ganancia, aunque el cliente haya abonado). Bruta = venta − producto y envíos directos; Neta = bruta − gastos adicionales. Sin costo registrado sale como <span className="text-amber-300">Pendiente de calcular</span>.</p>
    {totales.vencidoCount > 0 && <Link to="/pedidos" className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-red-400/30 bg-red-400/[.06] px-4 py-3 transition hover:border-red-400/55"><span className="flex items-center gap-2.5 text-sm"><AlertTriangle size={17} className="text-red-300" /><span><strong className="text-red-300">Cobros vencidos:</strong> <span className="tabular-nums">USD {money(totales.vencido)}</span></span></span><span className="text-xs text-red-200/80">{totales.vencidoCount} {totales.vencidoCount === 1 ? 'pedido' : 'pedidos'} · cobrar →</span></Link>}
    <div className="relative mt-6 max-w-xl"><Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" size={18} /><input className="search-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Código, cliente o producto" /></div>
    <div className="mt-5 overflow-hidden rounded-2xl border border-line bg-panel"><div className="hidden grid-cols-[.7fr_1.1fr_.9fr_.7fr_.7fr_.7fr_32px] gap-3 border-b border-line px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted md:grid"><span>Pedido</span><span>Cliente</span><span>Pago</span><span>Total</span><span>Cobrado</span><span>Saldo</span><span /></div>
      {filtered.map((row) => row.kind === 'pedido'
        ? <VentaRow key={`p-${row.id}`} pedido={row.data} activo={row.activo} onAbono={() => setAbonoPedido(row.data)} onHistorial={() => setHistorialPedido(row.data)} />
        : <div key={`s-${row.id}`} className="grid gap-2 border-b border-line px-5 py-4 last:border-0 md:grid-cols-[.7fr_1.1fr_.9fr_.7fr_.7fr_.7fr_32px] md:items-center"><strong className="flex items-center gap-1.5 text-sm text-accent">{row.data.codigo || 'STOCK'}</strong><span className="truncate text-sm">{row.data.cliente || row.data.producto}</span><span className="flex items-center gap-1 text-xs text-accent"><Zap size={12} /> Inmediata</span><strong className="tabular-nums">${money(row.data.monto)}</strong><strong className="tabular-nums text-emerald-300">${money(row.data.monto)}</strong><strong className="tabular-nums text-accent">$0.00</strong><span /></div>)}
      {!filtered.length && <p className="p-10 text-center text-sm text-muted">No hay ventas en {periodo.etiqueta}.</p>}</div>
    <PagoModal open={!!abonoPedido} pedidos={pedidos} tipoCambio={tipoCambio} fijarPedido={abonoPedido?.id} onClose={() => setAbonoPedido(null)} onSaved={recargarTrasAbono} />
    <HistorialModal pedido={historialPedido} pagos={historialPedido ? pagosDe(historialPedido.id) : []} onClose={() => setHistorialPedido(null)} />
    <VentaStockModal open={vender} stock={disponibles} onClose={() => setVender(false)} onSold={() => { setVender(false); void cargar() }} />
  </div>
}

function Header({ onVender }: { onVender: () => void }) {
  return <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Administración comercial</p><h1 className="page-title">Ventas</h1><p className="page-subtitle">Vende de tu stock inmediato o encarga una importación.</p></div><div className="flex flex-wrap gap-2"><Link to="/pedidos/nuevo" className="subtle-button px-4"><Plus size={16} /> Encargar importación</Link><button className="primary-button px-5" onClick={onVender}><Tag size={17} /> Registrar venta</button></div></div>
}

function VentaStockModal({ open, stock, onClose, onSold }: { open: boolean; stock: Inversion[]; onClose: () => void; onSold: () => void }) {
  const [selected, setSelected] = useState<Inversion | null>(null)
  const [form, setForm] = useState({ fecha: new Date().toISOString().slice(0, 10), cliente: '', precio_venta: '', monto_recibido: '', metodo: 'Transferencia', observaciones: '' })
  const [saving, setSaving] = useState(false)
  const [buscar, setBuscar] = useState('')
  useEffect(() => { if (open) { setSelected(null); setBuscar('') } }, [open])
  const elegir = (item: Inversion) => { const precio = (Number(item.precio_venta_estimado) * Number(item.cantidad)).toFixed(2); setSelected(item); setForm({ fecha: new Date().toISOString().slice(0, 10), cliente: '', precio_venta: precio, monto_recibido: precio, metodo: 'Transferencia', observaciones: '' }) }

  const lista = useMemo(() => { const t = buscar.trim().toLowerCase(); return stock.filter((i) => !t || [i.producto, i.codigo, i.marca].some((v) => v?.toLowerCase().includes(t))) }, [stock, buscar])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!selected) return
    const precio = Number(form.precio_venta), recibido = Number(form.monto_recibido)
    if (precio <= 0) return toast.error('Indica el precio de venta.')
    setSaving(true)
    try {
      await venderStockInmediato(selected, { fecha: form.fecha, precio_venta: precio / Number(selected.cantidad), monto_recibido: Math.max(0, recibido), metodo: form.metodo, cliente: form.cliente, observaciones: form.observaciones })
      toast.success('Venta registrada. El producto salió del stock.')
      onSold()
    } catch { toast.error('No se pudo registrar la venta.') } finally { setSaving(false) }
  }

  if (!selected) {
    return <Modal open={open} onClose={onClose} title="Registrar venta de stock" description="Elige el producto de entrega inmediata que vendiste.">
      <div className="relative mb-3"><Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" size={17} /><input className="search-input" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Producto, código o marca" /></div>
      <div className="grid max-h-[55vh] gap-2 overflow-y-auto pr-1">
        {lista.map((item) => <button type="button" key={item.id} onClick={() => elegir(item)} className="flex items-center gap-3 rounded-xl border border-line bg-white/[.02] p-3 text-left transition hover:border-accent/40 hover:bg-accent/[.05]">
          <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-accent/10 text-accent">{item.imagen ? <img src={item.imagen} alt={item.producto} className="size-full object-cover" /> : <PackageCheck size={20} />}</span>
          <span className="min-w-0 flex-1"><strong className="block truncate text-sm">{item.producto}</strong><span className="block truncate text-xs text-muted">{[item.codigo, item.marca, item.talla_color].filter(Boolean).join(' · ') || 'Sin detalle'}</span></span>
          <span className="shrink-0 text-right"><strong className="block text-accent">USD {(Number(item.precio_venta_estimado) * Number(item.cantidad)).toFixed(2)}</strong><span className="text-[10px] text-muted">{item.cantidad} disp.</span></span>
        </button>)}
        {!lista.length && <div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">{stock.length ? 'Ningún producto coincide.' : 'No tienes productos disponibles en stock inmediato.'}</div>}
      </div>
      <div className="mt-4 flex justify-end"><button type="button" className="subtle-button" onClick={onClose}>Cerrar</button></div>
    </Modal>
  }

  const precio = Number(form.precio_venta), recibido = Number(form.monto_recibido), costo = costoInversion(selected)
  return <Modal open={open} onClose={onClose} title={`Vender · ${selected.producto}`} description="Venta directa de stock. No crea un pedido de importación.">
    <form className="form-grid" onSubmit={(e) => void submit(e)}>
      <label className="form-field col-span-full"><span>Producto</span><button type="button" onClick={() => setSelected(null)} className="flex items-center justify-between rounded-xl border border-line bg-white/[.02] px-3 py-2.5 text-left text-sm"><span>{selected.producto} · <span className="text-muted">{selected.codigo || 'Sin código'}</span></span><span className="text-xs text-accent">Cambiar</span></button></label>
      <Field label="Fecha de venta"><input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} /></Field>
      <Field label="Cliente (opcional)"><input value={form.cliente} onChange={(e) => setForm({ ...form, cliente: e.target.value })} placeholder="Nombre del cliente" /></Field>
      <Field label="Precio de venta (total)"><input type="number" min="0" step=".01" value={form.precio_venta} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setForm({ ...form, precio_venta: e.target.value })} /></Field>
      <Field label="Monto recibido"><input type="number" min="0" step=".01" value={form.monto_recibido} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setForm({ ...form, monto_recibido: e.target.value })} /></Field>
      <Field label="Método de pago"><input value={form.metodo} onChange={(e) => setForm({ ...form, metodo: e.target.value })} /></Field>
      <Field label="Nota (opcional)"><input value={form.observaciones} onChange={(e) => setForm({ ...form, observaciones: e.target.value })} /></Field>
      <div className="col-span-full grid grid-cols-3 gap-3 rounded-xl border border-line bg-white/[.02] p-4 text-center"><div><span className="text-[10px] uppercase text-muted">Costo</span><strong className="mt-1 block text-sm">USD {costo.toFixed(2)}</strong></div><div><span className="text-[10px] uppercase text-muted">Venta</span><strong className="mt-1 block text-sm text-accent">USD {(precio || 0).toFixed(2)}</strong></div><div><span className="text-[10px] uppercase text-muted">Ganancia</span><strong className="mt-1 block text-sm text-green-300">USD {Math.max(0, (precio || 0) - costo).toFixed(2)}</strong></div></div>
      {recibido < precio && recibido >= 0 && <p className="col-span-full rounded-xl border border-amber-300/20 bg-amber-300/[.05] p-3 text-[11px] leading-5 text-amber-200/90">Se registra como ingreso solo el monto recibido (USD {Math.max(0, recibido).toFixed(2)}). El resto queda como acuerdo directo con el cliente.</p>}
      <div className="col-span-full flex justify-end gap-2"><button type="button" className="subtle-button" onClick={onClose}>Cancelar</button><button className="primary-button px-5" disabled={saving}>{saving ? 'Registrando…' : 'Registrar venta'}</button></div>
    </form>
  </Modal>
}

// Desglose financiero de cada venta: precio de venta, costo, gastos, ganancia y margen.
// Si el pedido aún no tiene costos registrados, muestra "Pendiente de calcular".
function VentaDesglose({ pedido }: { pedido: Pedido }) {
  const d = desglosePedido(pedido)
  // Todavía no entregado: la ganancia aún no se realiza (aunque haya abono).
  if (!d.entregado) return <p className="mt-2 text-[11px] text-muted">Ganancia: <em className="not-italic font-semibold text-sky-300">se realiza al entregar</em>{!d.pendiente && <> · estimada <b className="tabular-nums text-white/80">${money(d.gananciaNeta)}</b></>}</p>
  if (d.pendiente) return <p className="mt-2 text-[11px] text-muted">Ganancia: <em className="not-italic font-semibold text-amber-300">Pendiente de calcular</em> · falta registrar el costo del producto</p>
  const gan = d.gananciaNeta >= 0 ? 'text-green-300' : 'text-red-300'
  return <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
    <span>Venta <b className="tabular-nums text-white">${money(d.venta)}</b></span>
    <span>Costo <b className="tabular-nums text-white">${money(d.costoTotal)}</b></span>
    {d.gastosAdicionales > 0.001 && <span>Gastos <b className="tabular-nums text-white">${money(d.gastosAdicionales)}</b></span>}
    <span>Ganancia <b className={`tabular-nums ${gan}`}>${money(d.gananciaNeta)}</b></span>
    <span>Margen <b className={`tabular-nums ${gan}`}>{d.margen.toFixed(0)}%</b></span>
  </div>
}

// Estado de cobro con su badge (🟢 Pagado · 🟡 Abono pendiente · 🔴 Vencido).
const PAGO_BADGE: Record<EstadoPago, { label: string; cls: string }> = {
  pagado: { label: '🟢 Pagado', cls: 'status-badge status-success' },
  pendiente: { label: '🟡 Abono pendiente', cls: 'status-badge status-preparacion' },
  vencido: { label: '🔴 Vencido', cls: 'status-badge status-danger' },
}

// Fila de venta expandible: muestra Total / Cobrado / Saldo + estado de cobro, y al
// abrir revela el desglose de ganancia y los botones "Registrar abono" / "Ver historial".
function VentaRow({ pedido, activo, onAbono, onHistorial }: { pedido: Pedido; activo: boolean; onAbono: () => void; onHistorial: () => void }) {
  const [abierto, setAbierto] = useState(false)
  const badge = PAGO_BADGE[estadoPago(pedido)]
  const total = Number(pedido.total), cobrado = Number(pedido.abono), saldo = Number(pedido.saldo)
  return <div className={`border-b border-line last:border-0 ${activo ? '' : 'opacity-70'}`}>
    <div className="grid gap-2 px-5 py-4 md:grid-cols-[.7fr_1.1fr_.9fr_.7fr_.7fr_.7fr_32px] md:items-center">
      <Link to={`/pedidos/${pedido.id}`} className="text-sm font-semibold transition hover:text-accent">{pedido.codigo}</Link>
      <Link to={`/pedidos/${pedido.id}`} className="truncate text-sm transition hover:text-accent">{pedido.clientes?.nombre}</Link>
      <span><span className={badge.cls}>{badge.label}</span></span>
      <strong className="tabular-nums">${money(total)}</strong>
      <strong className="tabular-nums text-emerald-300">${money(cobrado)}</strong>
      <strong className={`tabular-nums ${saldo > 0 ? 'text-amber-300' : 'text-accent'}`}>${money(saldo)}</strong>
      <button type="button" onClick={() => setAbierto((v) => !v)} className="table-action justify-self-end" aria-expanded={abierto} aria-label={abierto ? 'Cerrar detalle' : 'Ver detalle'}><ChevronDown size={16} className={`transition ${abierto ? 'rotate-180' : ''}`} /></button>
    </div>
    {abierto && <div className="border-t border-line bg-white/[0.015] px-5 py-4">
      <p className="text-[11px] text-muted">Estado del pedido: <span className="text-white/80">{estadoLabel(pedido.estado)}</span></p>
      <VentaDesglose pedido={pedido} />
      <div className="mt-3 flex flex-wrap gap-2">
        {saldo > 0.01 && <button type="button" onClick={onAbono} className="primary-button min-h-[2.5rem] px-4 text-[.8rem]"><CreditCard size={15} /> Registrar abono</button>}
        <button type="button" onClick={onHistorial} className="subtle-button px-4"><History size={15} /> Ver historial de pagos</button>
        <Link to={`/pedidos/${pedido.id}`} className="subtle-button px-4">Abrir pedido <ArrowUpRight size={14} /></Link>
      </div>
    </div>}
  </div>
}

function HistorialModal({ pedido, pagos, onClose }: { pedido: Pedido | null; pagos: Pago[]; onClose: () => void }) {
  if (!pedido) return null
  return <Modal open={!!pedido} onClose={onClose} title={`Historial de pagos · ${pedido.codigo}`} description={`Total USD ${money(Number(pedido.total))} · Cobrado USD ${money(Number(pedido.abono))} · Saldo USD ${money(Number(pedido.saldo))}`}>
    <div className="space-y-2">
      {pagos.length === 0
        ? <p className="py-6 text-center text-sm text-muted">Aún no hay pagos registrados para este pedido.</p>
        : pagos.map((p) => <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-white/[.02] px-4 py-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm capitalize">{p.tipo.replace('_', ' ')}</strong>{p.referencia && <span className="text-[11px] text-muted">Ref. {p.referencia}</span>}</div><p className="truncate text-xs text-muted">{formatDate(p.fecha)} · {p.metodo_pago || 'Sin método'}{p.observaciones ? ` · ${p.observaciones}` : ''}</p></div><strong className={`shrink-0 tabular-nums ${p.tipo === 'reembolso' ? 'text-red-300' : 'text-emerald-300'}`}>{p.tipo === 'reembolso' ? '−' : '+'} USD {money(Number(p.monto))}</strong></div>)}
    </div>
  </Modal>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="form-field"><span>{label}</span>{children}</label> }
type Tone = 'accent' | 'emerald' | 'amber' | 'green' | 'red' | 'muted'
const TONE_TEXT: Record<Tone, string> = { accent: 'text-accent', emerald: 'text-emerald-300', amber: 'text-amber-300', green: 'text-green-300', red: 'text-red-300', muted: 'text-white' }
function Metric({ icon: Icon, label, value, accent, tone }: { icon: typeof WalletCards; label: string; value: number; accent?: boolean; tone?: Tone }) {
  const t: Tone = accent ? 'accent' : (tone ?? 'muted')
  return <article className="metric-card"><Icon size={19} className={t === 'muted' ? 'text-muted' : TONE_TEXT[t]} /><p className="mt-5 text-xs text-muted">{label}</p><strong className={`mt-1 block text-2xl tabular-nums ${t === 'muted' ? '' : TONE_TEXT[t]}`}>USD {money(value)}</strong></article>
}
