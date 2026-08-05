import { ArrowUpRight, ChevronLeft, ChevronRight, CircleDollarSign, PackageCheck, Plus, Search, Tag, TrendingUp, WalletCards, Zap } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Modal } from '../../components/ui/Modal'
import { estadoLabel } from '../../constants/orders'
import { listarInversiones, listarVentasStock, venderStockInmediato, type VentaStock } from '../../services/comercial.service'
import { listarPedidos } from '../../services/pedidos.service'
import type { Inversion, Pedido } from '../../types/domain'
import { costoRealPedido } from '../../utils/pedidoCosto'
import { periodoDeMes } from '../../utils/periodo'

const claveMes = (fecha: string) => (fecha.length >= 7 ? fecha.slice(0, 7) : fecha)
const esEntregado = (estado: Pedido['estado']) => estado === 'entregado' || estado === 'cancelado'
const costoInversion = (item: Inversion) => Number(item.costo_unitario) * Number(item.cantidad) + Number(item.gastos_adicionales) + (item.gastos ?? []).reduce((s, g) => s + Number(g.monto || 0), 0)

export function VentasPage() {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [ventasStock, setVentasStock] = useState<VentaStock[]>([])
  const [stock, setStock] = useState<Inversion[]>([])
  const [search, setSearch] = useState('')
  const [mesRef, setMesRef] = useState(() => new Date())
  const [vender, setVender] = useState(false)

  const cargar = () => Promise.all([listarPedidos(), listarVentasStock(), listarInversiones()])
    .then(([orders, sales, inventory]) => { setPedidos(orders); setVentasStock(sales); setStock(inventory) })
    .catch(() => toast.error('No se pudieron cargar las ventas.'))
  useEffect(() => { void cargar() }, [])

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
      acc.ventas += Number(p.total); acc.cobrado += Number(p.abono)
      acc.costo += costoRealPedido(p)
    } else {
      acc.ventas += row.data.monto; acc.cobrado += row.data.monto; acc.costo += row.data.costo
    }
    return acc
  }, { ventas: 0, cobrado: 0, costo: 0 }), [filtered])

  return <div><Header onVender={() => setVender(true)} />
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-panel px-3 py-2.5">
      <button type="button" className="table-action" onClick={() => cambiarMes(-1)} aria-label="Mes anterior"><ChevronLeft size={18} /></button>
      <div className="text-center"><p className="text-sm font-semibold capitalize">{periodo.etiqueta}</p><p className="text-[11px] text-muted">{filtered.length} venta{filtered.length === 1 ? '' : 's'} este mes</p></div>
      <button type="button" className="table-action disabled:opacity-30" onClick={() => cambiarMes(1)} disabled={esMesActual} aria-label="Mes siguiente"><ChevronRight size={18} /></button>
    </div>
    <div className="mt-4 grid gap-3 sm:grid-cols-3"><Metric icon={WalletCards} label="Ventas" value={totales.ventas} /><Metric icon={CircleDollarSign} label="Cobrado" value={totales.cobrado} /><Metric icon={TrendingUp} label="Ganancia estimada" value={totales.ventas - totales.costo} accent /></div>
    <div className="relative mt-6 max-w-xl"><Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" size={18} /><input className="search-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Código, cliente o producto" /></div>
    <div className="mt-5 overflow-hidden rounded-2xl border border-line bg-panel"><div className="hidden grid-cols-[.8fr_1.2fr_.9fr_.8fr_.8fr_40px] gap-3 border-b border-line px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted md:grid"><span>Pedido</span><span>Cliente</span><span>Estado</span><span>Total</span><span>Saldo</span><span /></div>
      {filtered.map((row) => row.kind === 'pedido'
        ? <Link to={`/pedidos/${row.data.id}`} key={`p-${row.id}`} className={`grid gap-2 border-b border-line px-5 py-4 last:border-0 md:grid-cols-[.8fr_1.2fr_.9fr_.8fr_.8fr_40px] md:items-center ${row.activo ? '' : 'opacity-70'}`}><strong className="text-sm">{row.data.codigo}</strong><span className="text-sm">{row.data.clientes?.nombre}</span><span className="text-xs text-muted">{estadoLabel(row.data.estado)}</span><strong>${Number(row.data.total).toFixed(2)}</strong><strong className={Number(row.data.saldo) > 0 ? 'text-amber-300' : 'text-accent'}>${Number(row.data.saldo).toFixed(2)}</strong><ArrowUpRight size={16} className="text-muted" /></Link>
        : <div key={`s-${row.id}`} className="grid gap-2 border-b border-line px-5 py-4 last:border-0 md:grid-cols-[.8fr_1.2fr_.9fr_.8fr_.8fr_40px] md:items-center"><strong className="flex items-center gap-1.5 text-sm text-accent">{row.data.codigo || 'STOCK'}</strong><span className="text-sm">{row.data.cliente || row.data.producto}<span className="ml-2 text-xs text-muted">{row.data.cliente ? row.data.producto : 'Entrega inmediata'}</span></span><span className="flex items-center gap-1 text-xs text-accent"><Zap size={12} /> Venta inmediata</span><strong>${row.data.monto.toFixed(2)}</strong><strong className="text-accent">$0.00</strong><span /></div>)}
      {!filtered.length && <p className="p-10 text-center text-sm text-muted">No hay ventas en {periodo.etiqueta}.</p>}</div>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="form-field"><span>{label}</span>{children}</label> }
function Metric({ icon: Icon, label, value, accent }: { icon: typeof WalletCards; label: string; value: number; accent?: boolean }) { return <article className="metric-card"><Icon size={19} className={accent ? 'text-accent' : 'text-muted'} /><p className="mt-5 text-xs text-muted">{label}</p><strong className={`mt-1 block text-2xl ${accent ? 'text-accent' : ''}`}>USD {value.toFixed(2)}</strong></article> }
