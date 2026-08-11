import { Boxes, CircleDollarSign, Eye, ImagePlus, Link2, PackageCheck, Pencil, Plus, Search, ShoppingBag, Tag, Trash2, TrendingUp, X } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Modal } from '../../components/ui/Modal'
import { subirImagenCatalogo } from '../../services/catalogoImagenes.service'
import { actualizarInversion, cambiarEstadoInversion, eliminarInversion, listarInversiones, listarProductos, registrarInversion, venderStockInmediato } from '../../services/comercial.service'
import type { Inversion, Producto } from '../../types/domain'

const empty = { fecha: new Date().toISOString().slice(0, 10), producto_id: '', codigo: '', producto: '', marca: '', talla_color: '', cantidad: '1', costo_unitario: '', gastos_adicionales: '', precio_venta_estimado: '', metodo: 'Transferencia', notas: '', tracking: '', transportista: '', url_tracking: '', yaRegistrada: false }
const statusLabel: Record<Inversion['estado'], string> = { en_inventario: 'Disponible', reservado: 'Reservado', vendido: 'Vendido', descartado: 'Descartado' }
const statusTone: Record<Inversion['estado'], string> = { en_inventario: 'border-accent/30 bg-accent/10 text-accent', reservado: 'border-sky-400/30 bg-sky-400/10 text-sky-300', vendido: 'border-green-400/25 bg-green-400/10 text-green-300', descartado: 'border-white/15 bg-white/5 text-muted' }
// Lo disponible se muestra primero; lo vendido o descartado se va al fondo.
const statusOrder: Record<Inversion['estado'], number> = { en_inventario: 0, reservado: 1, vendido: 2, descartado: 3 }
// Costo total real: costo del producto + gastos del registro + gastos de envío/otros que se
// asociaron después desde la página de Gastos (item.gastos). Así el envío agregado luego sí suma.
const linkedExpenses = (item: Inversion) => (item.gastos ?? []).reduce((sum, expense) => sum + Number(expense.monto || 0), 0)
const totalCost = (item: Inversion) => Number(item.costo_unitario) * Number(item.cantidad) + Number(item.gastos_adicionales) + linkedExpenses(item)

export function InventarioPage() {
  const [items, setItems] = useState<Inversion[]>([])
  const [products, setProducts] = useState<Producto[]>([])
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Inversion | null>(null)
  const [preview, setPreview] = useState<Inversion | null>(null)
  const [selling, setSelling] = useState<Inversion | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'todos' | Inversion['estado']>('todos')
  const load = () => void Promise.all([listarInversiones(), listarProductos()]).then(([investments, catalog]) => { setItems(investments); setProducts(catalog.filter((item) => item.activo)) }).catch(() => toast.error('No se pudo cargar el inventario. Ejecuta la migración nueva.'))
  useEffect(load, [])
  // Métrica de capital: total invertido sobre TODO (visión de inversiones) y detalle sobre lo activo (visión de stock).
  const metrics = useMemo(() => items.reduce((result, item) => {
    const cost = totalCost(item), sale = Number(item.precio_venta_estimado) * Number(item.cantidad)
    result.invested += cost
    if (item.estado === 'en_inventario' || item.estado === 'reservado') { result.units += item.cantidad; result.costActive += cost; result.potential += sale }
    return result
  }, { invested: 0, units: 0, costActive: 0, potential: 0 }), [items])
  const counts = useMemo(() => items.reduce((acc, item) => { acc[item.estado] = (acc[item.estado] ?? 0) + 1; return acc }, {} as Record<Inversion['estado'], number>), [items])
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return items
      .filter((item) => (filter === 'todos' || item.estado === filter) && (!term || [item.producto, item.codigo, item.marca, item.talla_color, item.tracking].some((v) => v?.toLowerCase().includes(term))))
      .sort((a, b) => statusOrder[a.estado] - statusOrder[b.estado])
  }, [items, search, filter])
  const updateStatus = async (item: Inversion, estado: Inversion['estado']) => { try { const updated = await cambiarEstadoInversion(item.id, estado); setItems((all) => all.map((current) => current.id === updated.id ? updated : current)); toast.success('Estado actualizado.') } catch { toast.error('No se pudo actualizar.') } }
  const remove = async (item: Inversion) => {
    if (!window.confirm(`¿Eliminar "${item.producto}" del inventario? Se devolverá su capital invertido a Mi cuenta. Esta acción no se puede deshacer.`)) return
    try { await eliminarInversion(item.id); setItems((all) => all.filter((current) => current.id !== item.id)); toast.success('Producto eliminado del inventario.') } catch { toast.error('No se pudo eliminar el producto.') }
  }

  return <div><div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Capital · stock · entrega inmediata</p><h1 className="page-title">Stock e inversiones</h1><p className="page-subtitle">Productos propios con foto, seguimiento y venta directa sin esperar importación.</p></div><button className="primary-button px-5" onClick={() => { setEditing(null); setOpen(true) }}><Plus size={17} /> Registrar producto</button></div>
    <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric icon={CircleDollarSign} label="Capital invertido" value={`USD ${metrics.invested.toFixed(2)}`} /><Metric icon={Boxes} label="Unidades disponibles" value={String(metrics.units)} /><Metric icon={ShoppingBag} label="Venta potencial" value={`USD ${metrics.potential.toFixed(2)}`} /><Metric icon={TrendingUp} label="Ganancia potencial" value={`USD ${Math.max(0, metrics.potential - metrics.costActive).toFixed(2)}`} accent /></div>
    <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_240px]"><div className="relative"><Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" size={18} /><input className="search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Producto, código, marca o tracking" /></div><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="todos">Todos los estados ({items.length})</option>{(Object.keys(statusLabel) as Inversion['estado'][]).map((estado) => <option value={estado} key={estado}>{statusLabel[estado]} ({counts[estado] ?? 0})</option>)}</select></div>
    <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{visible.map((item) => { const cerrado = item.estado === 'vendido' || item.estado === 'descartado'; const extra = linkedExpenses(item); return <article className={`panel-card transition ${cerrado ? 'opacity-70' : ''}`} key={item.id}><div className="flex items-start justify-between gap-3"><button className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-xl bg-accent/10 text-accent" onClick={() => setPreview(item)} aria-label={`Vista para cliente de ${item.producto}`}>{item.imagen ? <img src={item.imagen} alt={item.producto} className="size-full object-cover" /> : <PackageCheck size={22} />}</button><div className="flex items-start gap-2"><select className="w-auto text-xs" value={item.estado} onChange={(event) => void updateStatus(item, event.target.value as Inversion['estado'])}>{Object.entries(statusLabel).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><button className="table-action" onClick={() => setPreview(item)} aria-label={`Vista para cliente de ${item.producto}`}><Eye size={16} /></button><button className="table-action table-action-edit" onClick={() => { setEditing(item); setOpen(true) }} aria-label={`Editar ${item.producto}`}><Pencil size={16} /></button><button className="table-action table-action-danger" onClick={() => void remove(item)} aria-label={`Eliminar ${item.producto}`}><Trash2 size={16} /></button></div></div><div className="mt-4 flex items-center justify-between gap-2"><p className="text-[10px] font-semibold uppercase tracking-wider text-accent">{item.codigo || 'SIN CÓDIGO'}</p><span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${statusTone[item.estado]}`}>{statusLabel[item.estado]}</span></div><strong className="mt-1 block text-lg">{item.producto}</strong><p className="mt-1 text-xs text-muted">{[item.marca, item.talla_color, `${item.cantidad} unidad${item.cantidad === 1 ? '' : 'es'}`].filter(Boolean).join(' · ')}</p><div className="mt-5 grid grid-cols-3 gap-3 border-t border-line pt-4"><Money label="Costo total" value={totalCost(item)} /><Money label="Venta posible" value={Number(item.precio_venta_estimado) * Number(item.cantidad)} accent /><Money label="Ganancia" value={Math.max(0, Number(item.precio_venta_estimado) * Number(item.cantidad) - totalCost(item))} green /></div>{extra > 0 && <p className="mt-3 text-[11px] text-muted">Incluye USD {extra.toFixed(2)} en gastos asociados (envío u otros).</p>}{item.notas && <p className="mt-3 border-l border-accent/40 pl-3 text-[11px] leading-5 text-muted">{item.notas}</p>}{item.tracking && <div className="mt-3 flex items-center justify-between rounded-xl border border-line p-2.5 text-[11px]"><span className="min-w-0 truncate"><b>{item.transportista || 'Tracking'}:</b> {item.tracking}</span>{item.url_tracking && <a className="table-action" href={item.url_tracking} target="_blank" rel="noreferrer" aria-label="Abrir enlace de tracking"><Link2 size={15} /></a>}</div>}{(item.estado === 'en_inventario' || item.estado === 'reservado') && <button className="primary-button mt-4 w-full justify-center" onClick={() => setSelling(item)}><Tag size={15} /> Vender ahora</button>}{item.estado === 'vendido' && <p className="mt-4 rounded-xl border border-green-400/25 bg-green-400/[.07] p-2.5 text-center text-xs font-semibold text-green-300">Vendido</p>}</article> })}</div>
    {!items.length && <div className="mt-6 rounded-2xl border border-dashed border-line p-10 text-center text-sm text-muted">Todavía no hay productos. Registra tus inversiones o el stock disponible para entrega inmediata.</div>}
    {items.length > 0 && !visible.length && <div className="mt-6 rounded-2xl border border-dashed border-line p-10 text-center text-sm text-muted">Ningún producto coincide con esta búsqueda.</div>}
    <ProductModal open={open} item={editing} products={products} onClose={() => { setOpen(false); setEditing(null) }} onSaved={(item) => { setItems((all) => editing ? all.map((current) => current.id === item.id ? item : current) : [item, ...all]); setOpen(false); setEditing(null) }} />
    <SellModal item={selling} onClose={() => setSelling(null)} onSold={(item) => { setItems((all) => all.map((current) => current.id === item.id ? item : current)); setSelling(null) }} />
    <ClientPreview item={preview} onClose={() => setPreview(null)} />
  </div>
}

function SellModal({ item, onClose, onSold }: { item: Inversion | null; onClose: () => void; onSold: (item: Inversion) => void }) {
  const [form, setForm] = useState({ fecha: new Date().toISOString().slice(0, 10), cliente: '', precio_venta: '', monto_recibido: '', metodo: 'Transferencia', observaciones: '' })
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (item) { const precio = (Number(item.precio_venta_estimado) * Number(item.cantidad)).toFixed(2); setForm({ fecha: new Date().toISOString().slice(0, 10), cliente: '', precio_venta: precio, monto_recibido: precio, metodo: 'Transferencia', observaciones: '' }) } }, [item])
  if (!item) return null
  const precio = Number(form.precio_venta), recibido = Number(form.monto_recibido), costo = totalCost(item)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (precio <= 0) return toast.error('Indica el precio de venta.')
    setSaving(true)
    try {
      const sold = await venderStockInmediato(item, { fecha: form.fecha, precio_venta: precio / Number(item.cantidad), monto_recibido: Math.max(0, recibido), metodo: form.metodo, cliente: form.cliente, observaciones: form.observaciones })
      onSold(sold)
      toast.success('Venta registrada. El producto salió del inventario.')
    } catch { toast.error('No se pudo registrar la venta.') } finally { setSaving(false) }
  }
  return <Modal open={Boolean(item)} onClose={onClose} title={`Vender · ${item.producto}`} description="Registra la venta directa. No crea un pedido de importación.">
    <form className="form-grid" onSubmit={(event) => void submit(event)}>
      <Field label="Fecha de venta"><input type="date" value={form.fecha} onChange={(event) => setForm({ ...form, fecha: event.target.value })} /></Field>
      <Field label="Cliente (opcional)"><input value={form.cliente} onChange={(event) => setForm({ ...form, cliente: event.target.value })} placeholder="Nombre del cliente" /></Field>
      <Field label="Precio de venta (total)"><input type="number" min="0" step=".01" value={form.precio_venta} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setForm({ ...form, precio_venta: event.target.value })} /></Field>
      <Field label="Monto recibido"><input type="number" min="0" step=".01" value={form.monto_recibido} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setForm({ ...form, monto_recibido: event.target.value })} /></Field>
      <Field label="Método de pago"><input value={form.metodo} onChange={(event) => setForm({ ...form, metodo: event.target.value })} /></Field>
      <Field label="Nota (opcional)"><input value={form.observaciones} onChange={(event) => setForm({ ...form, observaciones: event.target.value })} /></Field>
      <div className="col-span-full grid grid-cols-3 gap-3 rounded-xl border border-line bg-white/[.02] p-4 text-center"><div><span className="text-[10px] uppercase text-muted">Costo</span><strong className="mt-1 block text-sm">USD {costo.toFixed(2)}</strong></div><div><span className="text-[10px] uppercase text-muted">Venta</span><strong className="mt-1 block text-sm text-accent">USD {(precio || 0).toFixed(2)}</strong></div><div><span className="text-[10px] uppercase text-muted">Ganancia</span><strong className="mt-1 block text-sm text-green-300">USD {Math.max(0, (precio || 0) - costo).toFixed(2)}</strong></div></div>
      {recibido < precio && recibido >= 0 && <p className="col-span-full rounded-xl border border-amber-300/20 bg-amber-300/[.05] p-3 text-[11px] leading-5 text-amber-200/90">Se registrará como ingreso solo el monto recibido (USD {Math.max(0, recibido).toFixed(2)}). El resto queda como acuerdo directo con el cliente, sin tracking.</p>}
      <div className="col-span-full flex justify-end gap-2"><button type="button" className="subtle-button" onClick={onClose}>Cancelar</button><button className="primary-button px-5" disabled={saving}>{saving ? 'Registrando…' : 'Registrar venta'}</button></div>
    </form>
  </Modal>
}

function ProductModal({ open, item, products, onClose, onSaved }: { open: boolean; item: Inversion | null; products: Producto[]; onClose: () => void; onSaved: (item: Inversion) => void }) {
  const [form, setForm] = useState(empty)
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (!open) return; setFile(null); setForm(item ? { fecha: item.fecha.slice(0, 10), producto_id: item.producto_id ?? '', codigo: item.codigo ?? '', producto: item.producto, marca: item.marca ?? '', talla_color: item.talla_color ?? '', cantidad: String(item.cantidad), costo_unitario: String(item.costo_unitario), gastos_adicionales: String(item.gastos_adicionales), precio_venta_estimado: String(item.precio_venta_estimado), metodo: 'Transferencia', notas: item.notas ?? '', tracking: item.tracking ?? '', transportista: item.transportista ?? '', url_tracking: item.url_tracking ?? '', yaRegistrada: true } : empty) }, [item, open])

  const choose = (id: string) => {
    const product = products.find((entry) => entry.id === id)
    setForm((current) => product ? { ...current, producto_id: id, codigo: product.codigo, producto: product.nombre, marca: product.marca || '', costo_unitario: String(product.precio_compra ?? ''), precio_venta_estimado: String(product.precio_venta ?? '') } : { ...current, producto_id: '' })
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const cantidad = Number(form.cantidad), costoUnitario = Number(form.costo_unitario), gastosAdicionales = Number(form.gastos_adicionales), precioVenta = Number(form.precio_venta_estimado)
    if (!form.producto.trim() || cantidad < 1 || precioVenta <= 0) return toast.error('Completa producto, cantidad y precio de venta.')
    setSaving(true)
    try {
      const input = { fecha: form.fecha, producto_id: form.producto_id || null, codigo: form.codigo || null, producto: form.producto.trim(), marca: form.marca || null, talla_color: form.talla_color || null, cantidad, costo_unitario: costoUnitario, gastos_adicionales: gastosAdicionales, precio_venta_estimado: precioVenta, estado: item?.estado ?? 'en_inventario' as Inversion['estado'], notas: form.notas || null, tracking: form.tracking || null, transportista: form.transportista || null, url_tracking: form.url_tracking || null, estado_tracking: form.tracking ? (item?.estado_tracking ?? 'Registrado') : null, pedido_id: item?.pedido_id ?? null }
      let saved = item ? await actualizarInversion(item.id, input) : await registrarInversion(input, form.metodo, !form.yaRegistrada)
      const catalogImage = products.find((product) => product.id === form.producto_id)?.imagen
      if (file) saved = await actualizarInversion(saved.id, { imagen: await subirImagenCatalogo('inversiones', saved.id, file) })
      else if (!saved.imagen && catalogImage) saved = await actualizarInversion(saved.id, { imagen: catalogImage })
      onSaved(saved)
      toast.success(item ? 'Producto actualizado.' : (form.yaRegistrada ? 'Producto registrado sin descontarlo otra vez.' : 'Producto registrado y descontado de Mi cuenta.'))
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo guardar el producto.') } finally { setSaving(false) }
  }

  const total = Number(form.costo_unitario) * Number(form.cantidad) + Number(form.gastos_adicionales)
  const updateNumber = (field: 'cantidad' | 'costo_unitario' | 'gastos_adicionales' | 'precio_venta_estimado', value: string) => setForm({ ...form, [field]: value })

  return <Modal open={open} onClose={onClose} title={item ? 'Editar producto del inventario' : 'Registrar producto para inventario'}><form className="form-grid" onSubmit={(event) => void submit(event)}>
    <Field label="Producto del catálogo (opcional)"><select value={form.producto_id} onChange={(event) => choose(event.target.value)}><option value="">Registrar manualmente</option>{products.map((product) => <option value={product.id} key={product.id}>{product.codigo} · {product.nombre}</option>)}</select></Field>
    <Field label="Fecha de compra"><input type="date" value={form.fecha} onChange={(event) => setForm({ ...form, fecha: event.target.value })} /></Field>
    <Field label="Producto"><input placeholder="Nombre del producto" value={form.producto} onChange={(event) => setForm({ ...form, producto: event.target.value })} /></Field><Field label="Código"><input value={form.codigo} onChange={(event) => setForm({ ...form, codigo: event.target.value })} /></Field>
    <Field label="Marca"><input value={form.marca} onChange={(event) => setForm({ ...form, marca: event.target.value })} /></Field><Field label="Talla / color"><input value={form.talla_color} onChange={(event) => setForm({ ...form, talla_color: event.target.value })} /></Field>
    <Field label="Cantidad"><input type="number" min="1" value={form.cantidad} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updateNumber('cantidad', event.target.value)} /></Field><Field label="Costo por unidad"><input type="number" min="0" step=".01" value={form.costo_unitario} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updateNumber('costo_unitario', event.target.value)} /></Field>
    <Field label="Envío u otros gastos"><input type="number" min="0" step=".01" value={form.gastos_adicionales} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updateNumber('gastos_adicionales', event.target.value)} /></Field><Field label="Precio de venta"><input type="number" min=".01" step=".01" value={form.precio_venta_estimado} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updateNumber('precio_venta_estimado', event.target.value)} /></Field>
    <Field label="Transportista (opcional)"><input value={form.transportista} onChange={(event) => setForm({ ...form, transportista: event.target.value })} placeholder="DHL, Everest…" /></Field><Field label="Tracking (opcional)"><input value={form.tracking} onChange={(event) => setForm({ ...form, tracking: event.target.value })} /></Field>
    <label className="form-field col-span-full"><span>Enlace de tracking (opcional)</span><input value={form.url_tracking} onChange={(event) => setForm({ ...form, url_tracking: event.target.value })} /></label>
    <Field label="Método de pago"><input value={form.metodo} onChange={(event) => setForm({ ...form, metodo: event.target.value })} /></Field><Field label="Notas"><input value={form.notas} onChange={(event) => setForm({ ...form, notas: event.target.value })} /></Field>
    <label className="form-field col-span-full"><span>Foto del producto</span><span className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-line p-4 text-sm text-muted"><ImagePlus size={20} className="text-accent" />{file ? file.name : item?.imagen ? 'Cambiar foto actual' : 'Seleccionar foto'}<input className="hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></span></label>
    {!item && <label className="col-span-full flex items-center gap-3 rounded-xl border border-line p-4 text-sm"><input type="checkbox" className="size-5 accent-[#b7ff00]" checked={form.yaRegistrada} onChange={(event) => setForm({ ...form, yaRegistrada: event.target.checked })} /><span><strong>¿Esta inversión ya estaba pagada/registrada?</strong><small className="mt-1 block text-muted">Márcalo para no descontarla nuevamente de Mi cuenta.</small></span></label>}
    <div className="col-span-full rounded-xl border border-accent/20 bg-accent/[.05] p-4 text-sm">{item ? 'Se actualizará este producto sin registrar una inversión nueva.' : <>Se registrará una inversión de <strong className="text-accent">USD {total.toFixed(2)}</strong>{form.yaRegistrada ? ' sin descontarla nuevamente de Mi cuenta.' : ' y se descontará de Mi cuenta.'}</>}</div>
    <div className="col-span-full flex justify-end gap-2"><button type="button" className="subtle-button" onClick={onClose}>Cancelar</button><button className="primary-button px-5" disabled={saving}>{saving ? 'Guardando…' : item ? 'Guardar cambios' : 'Registrar producto'}</button></div>
  </form></Modal>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="form-field"><span>{label}</span>{children}</label> }
function Metric({ icon: Icon, label, value, accent }: { icon: typeof Boxes; label: string; value: string; accent?: boolean }) { return <article className="metric-card"><Icon size={19} className="text-accent" /><p className="mt-5 text-xs text-muted">{label}</p><strong className={`mt-1 block text-2xl ${accent ? 'text-accent' : ''}`}>{value}</strong></article> }
function Money({ label, value, accent, green }: { label: string; value: number; accent?: boolean; green?: boolean }) { return <div><span className="text-[10px] uppercase text-muted">{label}</span><strong className={`mt-1 block text-sm ${accent ? 'text-accent' : green ? 'text-green-300' : ''}`}>USD {Number(value).toFixed(2)}</strong></div> }

function ClientPreview({ item, onClose }: { item: Inversion | null; onClose: () => void }) {
  useEffect(() => {
    if (!item) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [item, onClose])
  if (!item) return null
  return <div className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-black/90 p-3 backdrop-blur-md sm:p-6" role="dialog" aria-modal="true" aria-label="Vista para cliente">
    <button className="absolute inset-0" aria-label="Cerrar vista" onClick={onClose} />
    <button type="button" className="fixed right-4 z-[90] grid size-12 place-items-center rounded-full border border-white/25 bg-black text-white shadow-2xl" style={{ top: 'calc(env(safe-area-inset-top) + 12px)' }} onClick={onClose} aria-label="Cerrar vista previa"><X size={23} /></button>
    <section className="relative w-full max-w-[460px] overflow-hidden rounded-[28px] border border-white/15 bg-[#080a08] shadow-2xl">
      <header className="flex items-center justify-between border-b border-white/10 px-5 py-4"><div><strong className="block text-lg font-black tracking-[.24em] text-white">HAUSLINE</strong><span className="block text-[9px] font-bold tracking-[.42em] text-accent">NICARAGUA</span></div><span className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-accent">Entrega inmediata</span></header>
      <div className="relative aspect-square overflow-hidden bg-white">{item.imagen ? <img src={item.imagen} alt={item.producto} className="size-full object-contain" /> : <div className="grid size-full place-items-center bg-[#111511] text-muted"><PackageCheck size={58} /><span className="sr-only">Sin foto</span></div>}</div>
      <div className="p-6"><p className="text-[11px] font-bold uppercase tracking-[.2em] text-accent">{item.codigo || 'Disponible'}</p><h2 className="mt-2 text-3xl font-black leading-tight text-white">{item.producto}</h2>{item.marca && <p className="mt-2 text-sm uppercase tracking-wider text-white/55">{item.marca}</p>}
        <div className="mt-6 grid grid-cols-2 gap-3"><div className="rounded-2xl border border-white/10 bg-white/[.035] p-4"><span className="text-[10px] font-bold uppercase tracking-wider text-white/45">Talla / color</span><strong className="mt-2 block text-xl text-white">{item.talla_color || 'Consultar'}</strong></div><div className="rounded-2xl border border-white/10 bg-white/[.035] p-4"><span className="text-[10px] font-bold uppercase tracking-wider text-white/45">Disponibles</span><strong className="mt-2 block text-xl text-white">{item.cantidad}</strong></div></div>
        <div className="mt-4 flex items-end justify-between rounded-2xl border border-accent/30 bg-accent/[.08] p-5"><div><span className="text-[10px] font-bold uppercase tracking-wider text-white/50">Precio</span><strong className="mt-1 block text-3xl font-black text-accent">USD {Number(item.precio_venta_estimado).toFixed(2)}</strong></div><span className="pb-1 text-xs font-semibold text-white/55">Disponible ahora</span></div>
        <p className="mt-5 text-center text-[10px] uppercase tracking-[.18em] text-white/35">Sneakers · Ropa · Accesorios</p>
        <button type="button" className="subtle-button mt-5 min-h-12 w-full justify-center" onClick={onClose}><X size={17} /> Cerrar vista previa</button>
      </div>
    </section>
  </div>
}
