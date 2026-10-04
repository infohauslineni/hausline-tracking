import { Boxes, CircleDollarSign, Zap, ImagePlus, PackageCheck, Plus, Printer, Search, ShoppingBag, TrendingUp, Wallet, X } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Modal } from '../../components/ui/Modal'
import { CuentaSelect, type DestinoPago } from '../../components/finanzas/CuentaSelect'
import { subirImagenCatalogo } from '../../services/catalogoImagenes.service'
import { actualizarInversion, cambiarEstadoInversion, eliminarInversion, listarInversiones, listarProductos, listarVentasStock, obtenerTipoCambio, pagarInversion, registrarInversion, venderStockInmediato, type VentaStock } from '../../services/comercial.service'
import type { Inversion, Producto } from '../../types/domain'
import { enviarReciboStockCorreo, imprimirReciboStock } from '../../utils/reciboStock'
import { resolverImagenCatalogo } from '../../utils/catalogoImagen'
import { contarFotosInversiones, ponerEntregaInmediataCompra, quitarEntregaInmediata } from '../../services/archivos.service'
import { FotosCompraModal } from '../../components/inventario/FotosCompraModal'
import { CompraCard, CompraFila } from '../../components/inventario/CompraCard'
import { LibresTabs } from '../../components/layout/LibresTabs'
import { ProductoImg } from '../../components/ui/ProductoImg'

// pago: 'ahora' = se descuenta de la cuenta al registrar; 'antes' = ya estaba pagado/descontado;
// 'pendiente' = todavía no se le pagó al proveedor (queda "por pagar" en la tarjeta).
type Pago = 'ahora' | 'antes' | 'pendiente'
const empty = { fecha: new Date().toISOString().slice(0, 10), producto_id: '', codigo: '', producto: '', marca: '', talla_color: '', cantidad: '1', costo_unitario: '', gastos_adicionales: '', precio_venta_estimado: '', metodo: 'Transferencia', notas: '', tracking: '', transportista: '', url_tracking: '', pago: 'ahora' as Pago, estado: 'en_inventario' as Inversion['estado'] }
const statusLabel: Record<Inversion['estado'], string> = { en_transito: 'En camino', en_inventario: 'Disponible', reservado: 'Apartado', vendido: 'Vendido', descartado: 'Descartado' }
// Lo disponible se muestra primero; lo vendido o descartado se va al fondo.
const statusOrder: Record<Inversion['estado'], number> = { en_inventario: 0, en_transito: 1, reservado: 2, vendido: 3, descartado: 4 }
const activo = (estado: Inversion['estado']) => estado === 'en_inventario' || estado === 'en_transito' || estado === 'reservado'
// Sin la columna (antes de la migración) todo se considera pagado.
const porPagar = (item: Inversion) => item.pagado === false
// Costo total real: costo del producto + gastos del registro + gastos de envío/otros que se
// asociaron después desde la página de Gastos (item.gastos). Así el envío agregado luego sí suma.
const linkedExpenses = (item: Inversion) => (item.gastos ?? []).reduce((sum, expense) => sum + Number(expense.monto || 0), 0)
const totalCost = (item: Inversion) => Number(item.costo_unitario) * Number(item.cantidad) + Number(item.gastos_adicionales) + linkedExpenses(item)

export function InventarioPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<Inversion[]>([])
  const [products, setProducts] = useState<Producto[]>([])
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Inversion | null>(null)
  const [preview, setPreview] = useState<Inversion | null>(null)
  const [selling, setSelling] = useState<Inversion | null>(null)
  const [ventas, setVentas] = useState<VentaStock[]>([])
  const [printingId, setPrintingId] = useState<string | null>(null)
  // Fotos de control de calidad por compra (cuántas tiene cada una) y la compra abierta.
  const [fotosCount, setFotosCount] = useState<Record<string, number>>({})
  const [fotosDe, setFotosDe] = useState<Inversion | null>(null)
  // Ficha "Ver detalles" de una compra (se lee de la lista para que refleje los cambios).
  const [detalleId, setDetalleId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'todos' | Inversion['estado']>('todos')
  // Datos para "Registrar costo" de un producto de entrega inmediata (abre el formulario ya lleno).
  const [inicial, setInicial] = useState<Partial<typeof empty> | null>(null)
  // Productos que la tienda muestra hoy como Entrega inmediata (catálogo web).
  const [ei, setEi] = useState<ProductoEI[] | null>(null)
  const [enCaminoTienda, setEnCaminoTienda] = useState<Set<string>>(new Set())
  // Colores de cada producto de la tienda (para elegir cuáles hay en Entrega inmediata).
  const [coloresTienda, setColoresTienda] = useState<Record<string, string[]>>({})
  const cargarEI = () => { void fetch('/api/catalogo', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : [])).then((c: ProductoEI[]) => { const lista = Array.isArray(c) ? c : []; setEi(lista.filter((p) => p.entrega_inmediata)); setEnCaminoTienda(new Set(lista.filter((p) => p.en_camino).map((p) => p.codigo.toUpperCase()))); setColoresTienda(Object.fromEntries(lista.map((p) => [p.codigo.toUpperCase(), p.colores ?? []]))) }).catch(() => setEi([])) }
  useEffect(cargarEI, [])
  const [poniendoEI, setPoniendoEI] = useState<Inversion | null>(null)
  const [quitandoEI, setQuitandoEI] = useState<string | null>(null)
  const quitarEI = async (codigo: string, nombre: string) => {
    if (!window.confirm(`¿Quitar "${nombre}" de Entrega inmediata? Deja de salir en esa sección de la tienda (sigue disponible por encargo). Después lo podés volver a poner.`)) return
    setQuitandoEI(codigo)
    try { await quitarEntregaInmediata(codigo); toast.success(`${nombre} ya no está en Entrega inmediata.`); setEi((l) => (l ?? []).filter((p) => p.codigo.toUpperCase() !== codigo.toUpperCase())); setTimeout(cargarEI, 2500) }
    catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo quitar.', { duration: 10000 }) }
    finally { setQuitandoEI(null) }
  }
  const load = () => {
    void Promise.all([listarInversiones(setItems), listarProductos((catalog) => setProducts(catalog.filter((item) => item.activo)))]).then(([investments, catalog]) => { setItems(investments); setProducts(catalog.filter((item) => item.activo)) }).catch(() => toast.error('No se pudo cargar el inventario. Ejecuta la migración nueva.'))
    // Ventas ya cerradas: se usan para reimprimir el recibo de un producto vendido con su cliente y monto reales.
    void listarVentasStock().then(setVentas).catch(() => undefined)
    void contarFotosInversiones().then(setFotosCount).catch(() => undefined)
  }
  useEffect(load, [])
  // Reimprime el recibo de un producto ya vendido, reconstruyendo cliente/monto de la venta registrada.
  const imprimirVendido = async (item: Inversion) => {
    const venta = ventas.find((v) => v.inversion_id === item.id)
    const total = Number(item.precio_venta_estimado) * Number(item.cantidad)
    setPrintingId(item.id)
    try {
      await imprimirReciboStock(item, { cliente: venta?.cliente ?? '', precioTotal: total, montoRecibido: venta?.monto ?? total, fecha: (venta?.fecha ?? item.fecha).slice(0, 10), metodo: venta?.metodo ?? null })
      toast.success('Recibo generado. Ábrelo para imprimir.')
    } catch { toast.error('No se pudo generar el recibo.') } finally { setPrintingId(null) }
  }
  // Métrica de capital: total invertido sobre TODO (visión de inversiones) y detalle sobre lo activo (visión de stock).
  const metrics = useMemo(() => items.reduce((result, item) => {
    const cost = totalCost(item), sale = Number(item.precio_venta_estimado) * Number(item.cantidad)
    result.invested += cost
    if (porPagar(item) && item.estado !== 'descartado') { result.debt += cost; result.debtCount++ }
    if (activo(item.estado)) { result.units += item.cantidad; result.costActive += cost; result.potential += sale }
    return result
  }, { invested: 0, units: 0, costActive: 0, potential: 0, debt: 0, debtCount: 0 }), [items])
  const [paying, setPaying] = useState<Inversion | null>(null)
  const counts = useMemo(() => items.reduce((acc, item) => { acc[item.estado] = (acc[item.estado] ?? 0) + 1; return acc }, {} as Record<Inversion['estado'], number>), [items])
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return items
      .filter((item) => (filter === 'todos' || item.estado === filter) && (!term || [item.producto, item.codigo, item.marca, item.talla_color, item.tracking].some((v) => v?.toLowerCase().includes(term))))
      .sort((a, b) => statusOrder[a.estado] - statusOrder[b.estado])
  }, [items, search, filter])
  const detalle = detalleId ? items.find((i) => i.id === detalleId) ?? null : null
  const updateStatus = async (item: Inversion, estado: Inversion['estado']) => { try { const updated = await cambiarEstadoInversion(item.id, estado); setItems((all) => all.map((current) => current.id === updated.id ? updated : current)); toast.success('Estado actualizado.') } catch { toast.error('No se pudo actualizar.') } }
  const remove = async (item: Inversion) => {
    if (!window.confirm(`¿Eliminar "${item.producto}" de Compras libres? Si ya se había pagado, ese monto vuelve a Mi cuenta. Esta acción no se puede deshacer.`)) return
    try { await eliminarInversion(item.id); setItems((all) => all.filter((current) => current.id !== item.id)); toast.success('Producto eliminado del inventario.') } catch { toast.error('No se pudo eliminar el producto.') }
  }
  // Apartar = convertir este producto de stock en un pedido normal (con cliente, abono y saldo).
  // Lleva el costo real como precio de compra para que la ganancia salga bien; ese costo NO se
  // vuelve a descontar (ya se pagó al traerlo). Al guardar el pedido, el producto sale del stock.
  const apartar = (item: Inversion) => {
    const unidades = Math.max(1, Number(item.cantidad) || 1)
    const precio = Number(item.precio_venta_estimado) || 0
    navigate('/pedidos/nuevo', { state: { prefill: {
      // En camino → el pedido arranca en tránsito; ya en Nicaragua → listo para entregar.
      estadoPedido: item.estado === 'en_transito' ? 'transito_internacional' : 'disponible_entrega',
      abono: Math.round(precio * 0.5 * 100) / 100,
      inversionId: item.id,
      producto: item.producto,
      marca: item.marca ?? '',
      codigo_producto: item.codigo ?? '',
      talla_color: item.talla_color ?? '',
      precio_unitario: Number(item.precio_venta_estimado) || 0,
      precio_compra: Math.round((totalCost(item) / unidades) * 100) / 100,
      imagen: item.imagen ?? null,
    } } })
  }

  return <div><LibresTabs /><div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Compras propias · sin pedido de cliente</p><h1 className="page-title">Compras libres</h1><p className="page-subtitle">Lo que compras por tu cuenta para vender (ej. unos Golden Goose para stock): si ya lo pagaste o no, si viene en camino o ya lo tenés, y apartalo a un cliente como pedido normal.</p></div><button className="primary-button px-5" onClick={() => { setEditing(null); setOpen(true) }}><Plus size={17} /> Registrar compra</button></div>
    <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><Metric icon={CircleDollarSign} label="Capital invertido" value={`USD ${metrics.invested.toFixed(2)}`} /><Metric icon={Wallet} label={`Por pagar al proveedor${metrics.debtCount ? ` (${metrics.debtCount})` : ''}`} value={`USD ${metrics.debt.toFixed(2)}`} warn={metrics.debt > 0} /><Metric icon={Boxes} label="Unidades activas" value={String(metrics.units)} /><Metric icon={ShoppingBag} label="Venta potencial" value={`USD ${metrics.potential.toFixed(2)}`} /><Metric icon={TrendingUp} label="Ganancia potencial" value={`USD ${Math.max(0, metrics.potential - metrics.costActive).toFixed(2)}`} accent /></div>
    <EntregaInmediataTienda lista={ei} items={items} quitando={quitandoEI} onQuitar={(p) => void quitarEI(p.codigo, p.nombre)} onRegistrar={(datos) => {
      const prod = products.find((p) => p.codigo?.trim().toUpperCase() === String(datos.codigo).toUpperCase())
      setEditing(null)
      setInicial({ ...datos, producto_id: prod?.id ?? '', costo_unitario: prod && Number(prod.precio_compra) > 0 ? String(prod.precio_compra) : '' })
      setOpen(true)
    }} />
    <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_240px]"><div className="relative"><Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" size={18} /><input className="search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Producto, código, marca o tracking" /></div><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="todos">Todos los estados ({items.length})</option>{(Object.keys(statusLabel) as Inversion['estado'][]).map((estado) => <option value={estado} key={estado}>{statusLabel[estado]} ({counts[estado] ?? 0})</option>)}</select></div>
    <div className="mt-6 space-y-2">
      <div className="hidden grid-cols-[56px_minmax(0,2.2fr)_130px_minmax(0,1.4fr)_minmax(0,1.6fr)_auto] gap-4 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted md:grid"><span /><span>Producto</span><span>Estado</span><span>Etiquetas</span><span className="text-right">Costo · Venta · Ganancia</span><span className="w-[110px]" /></div>
      {visible.map((item) => {
        const cod = (item.codigo ?? '').trim().toUpperCase()
        return <CompraFila key={item.id} item={item} costo={totalCost(item)} fotos={fotosCount[item.id] ?? 0}
          enEI={!!cod && (ei ?? []).some((p) => p.codigo.toUpperCase() === cod)} enCaminoPublicado={!!cod && enCaminoTienda.has(cod)}
          onDetalles={() => setDetalleId(item.id)} />
      })}
    </div>
    {detalle && (() => {
      const item = detalle
      const cod = (item.codigo ?? '').trim().toUpperCase()
      // Las acciones que abren otra ventana cierran primero la ficha.
      const luego = (fn: () => void) => () => { setDetalleId(null); fn() }
      return <Modal open onClose={() => setDetalleId(null)} title="Detalles de la compra" description={`${item.codigo ? `${item.codigo} · ` : ''}comprada el ${new Date(item.fecha + 'T12:00:00').toLocaleDateString('es-NI', { day: 'numeric', month: 'short', year: 'numeric' })}`}>
        <CompraCard enModal item={item} costo={totalCost(item)} gastosAsociados={linkedExpenses(item)}
          enEI={!!cod && (ei ?? []).some((p) => p.codigo.toUpperCase() === cod)} enCaminoPublicado={!!cod && enCaminoTienda.has(cod)}
          fotos={fotosCount[item.id] ?? 0} quitandoEI={quitandoEI === (item.codigo ?? '').trim()} imprimiendo={printingId === item.id}
          onEstado={(estado) => void updateStatus(item, estado)} onVer={luego(() => setPreview(item))} onEditar={luego(() => { setEditing(item); setOpen(true) })}
          onEliminar={luego(() => void remove(item))} onPagar={luego(() => setPaying(item))} onFotos={luego(() => setFotosDe(item))} onEntregaInmediata={luego(() => setPoniendoEI(item))}
          onQuitarEI={() => void quitarEI((item.codigo ?? '').trim(), item.producto)} onVender={luego(() => setSelling(item))} onApartar={luego(() => apartar(item))}
          onVerPedido={luego(() => navigate(`/pedidos/${item.pedido_id}`))} onImprimir={() => void imprimirVendido(item)} />
      </Modal>
    })()}
    {!items.length && <div className="mt-6 rounded-2xl border border-dashed border-line p-10 text-center text-sm text-muted">Todavía no hay compras libres. Registrá lo que compraste por tu cuenta para vender, esté pagado o no.</div>}
    {items.length > 0 && !visible.length && <div className="mt-6 rounded-2xl border border-dashed border-line p-10 text-center text-sm text-muted">Ningún producto coincide con esta búsqueda.</div>}
    <ProductModal open={open} item={editing} inicial={inicial} products={products} onClose={() => { setOpen(false); setEditing(null); setInicial(null) }} onSaved={(item) => { setItems((all) => editing ? all.map((current) => current.id === item.id ? item : current) : [item, ...all]); setOpen(false); setEditing(null); setInicial(null) }} />
    <SellModal item={selling} onClose={() => setSelling(null)} onSold={(item) => { setItems((all) => all.map((current) => current.id === item.id ? item : current)); setSelling(null); void listarVentasStock().then(setVentas).catch(() => undefined) }} />
    <PayModal item={paying} onClose={() => setPaying(null)} onPaid={(item) => { setItems((all) => all.map((current) => current.id === item.id ? item : current)); setPaying(null) }} />
    <ClientPreview item={preview} onClose={() => setPreview(null)} />
    {fotosDe && <FotosCompraModal item={fotosDe} onClose={() => setFotosDe(null)} onCambio={(n) => setFotosCount((c) => ({ ...c, [fotosDe.id]: n }))} />}
    <EntregaInmediataModal key={poniendoEI?.id ?? 'ninguna'} item={poniendoEI} enTienda={(ei ?? []).find((p) => p.codigo.toUpperCase() === (poniendoEI?.codigo ?? '').trim().toUpperCase()) ?? null} coloresProducto={coloresTienda[(poniendoEI?.codigo ?? '').trim().toUpperCase()] ?? []} onClose={() => setPoniendoEI(null)} onListo={() => { setPoniendoEI(null); setTimeout(cargarEI, 2500) }} />
  </div>
}

// Pago al proveedor de una compra que se registró "por pagar": sale de la cuenta elegida ahora.
function PayModal({ item, onClose, onPaid }: { item: Inversion | null; onClose: () => void; onPaid: (item: Inversion) => void }) {
  const [form, setForm] = useState({ fecha: new Date().toISOString().slice(0, 10), metodo: 'Transferencia' })
  const [destino, setDestino] = useState<DestinoPago>({ cuentaId: null, montoCuenta: 0 })
  const [tipoCambio, setTipoCambio] = useState(37)
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (item) { setForm({ fecha: new Date().toISOString().slice(0, 10), metodo: 'Transferencia' }); setDestino({ cuentaId: null, montoCuenta: 0 }); void obtenerTipoCambio().then(setTipoCambio).catch(() => undefined) } }, [item])
  if (!item) return null
  const monto = totalCost(item)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!destino.cuentaId) return toast.error('Elegí de qué cuenta sale el pago.')
    setSaving(true)
    try { onPaid(await pagarInversion(item, form, destino)); toast.success('Pago al proveedor registrado.') } catch { toast.error('No se pudo registrar el pago.') } finally { setSaving(false) }
  }
  return <Modal open={Boolean(item)} onClose={onClose} title={`Pagar al proveedor · ${item.producto}`} description="La compra quedó por pagar. Registrá el pago cuando se lo hagas al proveedor.">
    <form className="form-grid" onSubmit={(event) => void submit(event)}>
      <Field label="Fecha del pago"><input type="date" value={form.fecha} onChange={(event) => setForm({ ...form, fecha: event.target.value })} /></Field>
      <Field label="Método de pago"><input value={form.metodo} onChange={(event) => setForm({ ...form, metodo: event.target.value })} /></Field>
      <CuentaSelect requerido proposito="comprar" montoUsd={monto} tipoCambio={tipoCambio} value={destino} onChange={setDestino} modo="resta" />
      <div className="col-span-full rounded-xl border border-accent/20 bg-accent/[.05] p-4 text-sm">Se descontarán <strong className="text-accent">USD {monto.toFixed(2)}</strong> de la cuenta elegida y la compra quedará como pagada.</div>
      <div className="col-span-full flex justify-end gap-2"><button type="button" className="subtle-button" onClick={onClose}>Cancelar</button><button className="primary-button px-5" disabled={saving}>{saving ? 'Registrando…' : 'Registrar pago'}</button></div>
    </form>
  </Modal>
}

function SellModal({ item, onClose, onSold }: { item: Inversion | null; onClose: () => void; onSold: (item: Inversion) => void }) {
  const [form, setForm] = useState({ fecha: new Date().toISOString().slice(0, 10), cliente: '', correo: '', precio_venta: '', monto_recibido: '', metodo: 'Transferencia', observaciones: '' })
  const [destino, setDestino] = useState<DestinoPago>({ cuentaId: null, montoCuenta: 0 })
  const [tipoCambio, setTipoCambio] = useState(37)
  const [saving, setSaving] = useState(false)
  const [printing, setPrinting] = useState(false)
  useEffect(() => { if (item) { const precio = (Number(item.precio_venta_estimado) * Number(item.cantidad)).toFixed(2); setForm({ fecha: new Date().toISOString().slice(0, 10), cliente: '', correo: '', precio_venta: precio, monto_recibido: precio, metodo: 'Transferencia', observaciones: '' }); setDestino({ cuentaId: null, montoCuenta: 0 }); void obtenerTipoCambio().then(setTipoCambio).catch(() => undefined) } }, [item])
  if (!item) return null
  const precio = Number(form.precio_venta), recibido = Number(form.monto_recibido), costo = totalCost(item)
  // Imprime el recibo con lo que hay en el formulario, sin registrar la venta todavía.
  const imprimir = async () => {
    if (precio <= 0) return toast.error('Indica el precio de venta.')
    setPrinting(true)
    try {
      await imprimirReciboStock(item, { cliente: form.cliente, precioTotal: precio, montoRecibido: Math.max(0, recibido), fecha: form.fecha, metodo: form.metodo })
      toast.success('Recibo generado. Ábrelo para imprimir.')
    } catch { toast.error('No se pudo generar el recibo.') } finally { setPrinting(false) }
  }
  const correo = form.correo.trim().toLowerCase()
  const correoValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (precio <= 0) return toast.error('Indica el precio de venta.')
    if (correo && !correoValido) return toast.error('Revisá el correo del cliente (ej. nombre@gmail.com).')
    if (recibido > 0 && !destino.cuentaId) return toast.error('Elegí a qué cuenta entra la venta.')
    setSaving(true)
    try {
      const sold = await venderStockInmediato(item, { fecha: form.fecha, precio_venta: precio / Number(item.cantidad), monto_recibido: Math.max(0, recibido), metodo: form.metodo, cliente: form.cliente, observaciones: form.observaciones }, destino)
      onSold(sold)
      toast.success('Venta registrada. El producto salió del inventario.')
      // Factura al correo del cliente (si lo dio). La venta ya quedó guardada aunque el correo falle.
      if (correoValido) void enviarReciboStockCorreo(item, { cliente: form.cliente, precioTotal: precio, montoRecibido: Math.max(0, recibido), fecha: form.fecha, metodo: form.metodo }, correo)
        .then(() => toast.success(`Factura enviada a ${correo}.`))
        .catch((e) => toast.error(`La venta quedó guardada, pero no se pudo enviar la factura: ${e instanceof Error ? e.message : 'error'}`, { duration: 10000 }))
    } catch { toast.error('No se pudo registrar la venta.') } finally { setSaving(false) }
  }
  return <Modal open={Boolean(item)} onClose={onClose} title={`Vender · ${item.producto}`} description="Registra la venta directa. No crea un pedido de importación.">
    <form className="form-grid" onSubmit={(event) => void submit(event)}>
      <Field label="Fecha de venta"><input type="date" value={form.fecha} onChange={(event) => setForm({ ...form, fecha: event.target.value })} /></Field>
      <Field label="Cliente (opcional)"><input value={form.cliente} onChange={(event) => setForm({ ...form, cliente: event.target.value })} placeholder="Nombre del cliente" /></Field>
      <Field label="Correo del cliente (para enviarle la factura)"><input type="email" inputMode="email" autoComplete="off" value={form.correo} onChange={(event) => setForm({ ...form, correo: event.target.value })} placeholder="cliente@gmail.com" /></Field>
      <Field label="Precio de venta (total)"><input type="number" min="0" step=".01" value={form.precio_venta} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setForm({ ...form, precio_venta: event.target.value })} /></Field>
      <Field label="Monto recibido"><input type="number" min="0" step=".01" value={form.monto_recibido} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setForm({ ...form, monto_recibido: event.target.value })} /></Field>
      <Field label="Método de pago"><input value={form.metodo} onChange={(event) => setForm({ ...form, metodo: event.target.value })} /></Field>
      <Field label="Nota (opcional)"><input value={form.observaciones} onChange={(event) => setForm({ ...form, observaciones: event.target.value })} /></Field>
      {recibido > 0 && <CuentaSelect requerido proposito="recibir" montoUsd={recibido} tipoCambio={tipoCambio} value={destino} onChange={setDestino} />}
      <div className="col-span-full grid grid-cols-3 gap-3 rounded-xl border border-line bg-white/[.02] p-4 text-center"><div><span className="text-[10px] uppercase text-muted">Costo</span><strong className="mt-1 block text-sm">USD {costo.toFixed(2)}</strong></div><div><span className="text-[10px] uppercase text-muted">Venta</span><strong className="mt-1 block text-sm text-accent">USD {(precio || 0).toFixed(2)}</strong></div><div><span className="text-[10px] uppercase text-muted">Ganancia</span><strong className="mt-1 block text-sm text-green-300">USD {Math.max(0, (precio || 0) - costo).toFixed(2)}</strong></div></div>
      {recibido < precio && recibido >= 0 && <p className="col-span-full rounded-xl border border-amber-300/20 bg-amber-300/[.05] p-3 text-[11px] leading-5 text-amber-200/90">Se registrará como ingreso solo el monto recibido (USD {Math.max(0, recibido).toFixed(2)}). El resto queda como acuerdo directo con el cliente, sin tracking.</p>}
      <div className="col-span-full flex flex-wrap justify-end gap-2"><button type="button" className="subtle-button" onClick={onClose}>Cancelar</button><button type="button" className="subtle-button" onClick={() => void imprimir()} disabled={printing}><Printer size={15} /> {printing ? 'Generando…' : 'Imprimir recibo'}</button><button className="primary-button px-5" disabled={saving}>{saving ? 'Registrando…' : 'Registrar venta'}</button></div>
    </form>
  </Modal>
}

function ProductModal({ open, item, inicial, products, onClose, onSaved }: { open: boolean; item: Inversion | null; inicial?: Partial<typeof empty> | null; products: Producto[]; onClose: () => void; onSaved: (item: Inversion) => void }) {
  const [form, setForm] = useState(empty)
  const [file, setFile] = useState<File | null>(null)
  const [destino, setDestino] = useState<DestinoPago>({ cuentaId: null, montoCuenta: 0 })
  const [tipoCambio, setTipoCambio] = useState(37)
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (!open) return; setFile(null); setDestino({ cuentaId: null, montoCuenta: 0 }); void obtenerTipoCambio().then(setTipoCambio).catch(() => undefined); setForm(item ? { fecha: item.fecha.slice(0, 10), producto_id: item.producto_id ?? '', codigo: item.codigo ?? '', producto: item.producto, marca: item.marca ?? '', talla_color: item.talla_color ?? '', cantidad: String(item.cantidad), costo_unitario: String(item.costo_unitario), gastos_adicionales: String(item.gastos_adicionales), precio_venta_estimado: String(item.precio_venta_estimado), metodo: 'Transferencia', notas: item.notas ?? '', tracking: item.tracking ?? '', transportista: item.transportista ?? '', url_tracking: item.url_tracking ?? '', pago: porPagar(item) ? 'pendiente' : 'antes', estado: item.estado } : { ...empty, ...(inicial ?? {}) }) }, [item, open, inicial])

  // Al escribir el código se completa todo solo (nombre, marca, precios y foto) si coincide con un producto del catálogo.
  const aplicarCodigo = (codigo: string) => {
    const buscado = codigo.trim().toLowerCase()
    const product = buscado ? products.find((entry) => entry.codigo?.trim().toLowerCase() === buscado) : undefined
    setForm((current) => product ? { ...current, codigo, producto_id: product.id, producto: product.nombre, marca: product.marca || '', costo_unitario: String(product.precio_compra ?? ''), precio_venta_estimado: String(product.precio_venta ?? '') } : { ...current, codigo, producto_id: '' })
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const cantidad = Number(form.cantidad), costoUnitario = Number(form.costo_unitario), gastosAdicionales = Number(form.gastos_adicionales), precioVenta = Number(form.precio_venta_estimado)
    if (!form.producto.trim() || cantidad < 1 || precioVenta <= 0) return toast.error('Completa producto, cantidad y precio de venta.')
    const descuenta = !item && form.pago === 'ahora'
    if (descuenta && !destino.cuentaId) return toast.error('Elegí de qué cuenta sale el pago.')
    setSaving(true)
    try {
      // Al editar no se toca el pago (se registra con "Registrar pago al proveedor" en la tarjeta).
      const pagoCampos = item ? {} : { pagado: form.pago !== 'pendiente', pagado_at: form.pago === 'pendiente' ? null : new Date().toISOString() }
      const input = { fecha: form.fecha, producto_id: form.producto_id || null, codigo: form.codigo || null, producto: form.producto.trim(), marca: form.marca || null, talla_color: form.talla_color || null, cantidad, costo_unitario: costoUnitario, gastos_adicionales: gastosAdicionales, precio_venta_estimado: precioVenta, estado: item?.estado ?? form.estado, notas: form.notas || null, tracking: form.tracking || null, transportista: form.transportista || null, url_tracking: form.url_tracking || null, estado_tracking: form.tracking ? (item?.estado_tracking ?? 'Registrado') : null, pedido_id: item?.pedido_id ?? null, ...pagoCampos }
      let saved = item ? await actualizarInversion(item.id, input) : await registrarInversion(input, form.metodo, descuenta, destino)
      if (file) saved = await actualizarInversion(saved.id, { imagen: await subirImagenCatalogo('inversiones', saved.id, file) })
      else if (!saved.imagen && catalogImagen) saved = await actualizarInversion(saved.id, { imagen: catalogImagen })
      onSaved(saved)
      toast.success(item ? 'Compra actualizada.' : form.pago === 'ahora' ? 'Compra registrada y descontada de Mi cuenta.' : form.pago === 'antes' ? 'Compra registrada sin descontarla otra vez.' : 'Compra registrada como por pagar al proveedor.')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo guardar el producto.') } finally { setSaving(false) }
  }

  const total = Number(form.costo_unitario) * Number(form.cantidad) + Number(form.gastos_adicionales)
  const updateNumber = (field: 'cantidad' | 'costo_unitario' | 'gastos_adicionales' | 'precio_venta_estimado', value: string) => setForm({ ...form, [field]: value })
  // Foto automática de la web: primero por producto elegido en el desplegable, si no, por el código escrito.
  const catalogImagen = useMemo(() => {
    const codigo = form.codigo.trim().toLowerCase()
    const match = products.find((product) => product.id === form.producto_id) ?? (codigo ? products.find((product) => product.codigo?.trim().toLowerCase() === codigo) : undefined)
    return match?.imagen ?? null
  }, [products, form.producto_id, form.codigo])
  const usaCatalogo = !file && !item?.imagen && Boolean(catalogImagen)
  const previewSrc = file ? null : (item?.imagen ?? catalogImagen)

  return <Modal open={open} onClose={onClose} title={item ? 'Editar compra libre' : 'Registrar compra libre'}><form className="form-grid" onSubmit={(event) => void submit(event)}>
    <label className="form-field col-span-full"><span>Código del producto</span><input list="catalogo-codigos" value={form.codigo} onChange={(event) => aplicarCodigo(event.target.value)} placeholder="Escribe el código y el producto se completa solo" autoFocus /></label>
    <datalist id="catalogo-codigos">{products.map((product) => <option value={product.codigo} key={product.id}>{product.nombre}</option>)}</datalist>
    <Field label="Fecha de compra"><input type="date" value={form.fecha} onChange={(event) => setForm({ ...form, fecha: event.target.value })} /></Field><Field label="Producto"><input placeholder="Nombre del producto" value={form.producto} onChange={(event) => setForm({ ...form, producto: event.target.value })} /></Field>
    <Field label="Marca"><input value={form.marca} onChange={(event) => setForm({ ...form, marca: event.target.value })} /></Field><Field label="Talla / color"><input value={form.talla_color} onChange={(event) => setForm({ ...form, talla_color: event.target.value })} /></Field>
    <Field label="Cantidad"><input type="number" min="1" value={form.cantidad} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updateNumber('cantidad', event.target.value)} /></Field><Field label="Costo por unidad"><input type="number" min="0" step=".01" value={form.costo_unitario} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updateNumber('costo_unitario', event.target.value)} /></Field>
    <Field label="Envío u otros gastos"><input type="number" min="0" step=".01" value={form.gastos_adicionales} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updateNumber('gastos_adicionales', event.target.value)} /></Field><Field label="Precio de venta"><input type="number" min=".01" step=".01" value={form.precio_venta_estimado} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updateNumber('precio_venta_estimado', event.target.value)} /></Field>
    <Field label="Transportista (opcional)"><input value={form.transportista} onChange={(event) => setForm({ ...form, transportista: event.target.value })} placeholder="DHL, Everest…" /></Field><Field label="Tracking (opcional)"><input value={form.tracking} onChange={(event) => setForm({ ...form, tracking: event.target.value })} /></Field>
    <label className="form-field col-span-full"><span>Enlace de tracking (opcional)</span><input value={form.url_tracking} onChange={(event) => setForm({ ...form, url_tracking: event.target.value })} /></label>
    <Field label="Método de pago"><input value={form.metodo} onChange={(event) => setForm({ ...form, metodo: event.target.value })} /></Field><Field label="Notas"><input value={form.notas} onChange={(event) => setForm({ ...form, notas: event.target.value })} /></Field>
    <label className="form-field col-span-full"><span>Foto del producto</span><span className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-line p-4 text-sm text-muted">{previewSrc ? <img src={previewSrc} alt="" className="size-10 shrink-0 rounded-lg object-cover" /> : <ImagePlus size={20} className="text-accent" />}{file ? file.name : usaCatalogo ? 'Foto de la web (automática por código) · toca para reemplazar' : item?.imagen ? 'Cambiar foto actual' : 'Escribe el código y saldrá la foto de la web, o selecciónala'}<input className="hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></span></label>
    {!item && <Opciones label="¿Dónde está?" value={form.estado} onChange={(estado) => setForm({ ...form, estado: estado as Inversion['estado'] })} options={[['en_inventario', 'Ya lo tengo', 'Disponible para vender o entregar'], ['en_transito', 'Viene en camino', 'Comprado, todavía no llega']]} />}
    {!item && <Opciones label="¿Ya se lo pagaste al proveedor?" value={form.pago} onChange={(pago) => setForm({ ...form, pago: pago as Pago })} options={[['ahora', 'Sí, lo pago ahora', 'Se descuenta de la cuenta que elijas'], ['antes', 'Sí, ya estaba pagado', 'Ya salió de caja; no se descuenta otra vez'], ['pendiente', 'Todavía no', 'Queda "por pagar"; lo pagás después desde la tarjeta']]} />}
    {!item && form.pago === 'ahora' && <CuentaSelect requerido proposito="comprar" montoUsd={total} tipoCambio={tipoCambio} value={destino} onChange={setDestino} modo="resta" />}
    <div className="col-span-full rounded-xl border border-accent/20 bg-accent/[.05] p-4 text-sm">{item ? 'Se actualizará esta compra sin registrar un pago nuevo.' : <>Compra de <strong className="text-accent">USD {total.toFixed(2)}</strong>{form.pago === 'ahora' ? ': se descontará de Mi cuenta.' : form.pago === 'antes' ? ': no se descuenta otra vez de Mi cuenta.' : ': queda por pagar al proveedor (no sale de caja todavía).'}</>}</div>
    <div className="col-span-full flex justify-end gap-2"><button type="button" className="subtle-button" onClick={onClose}>Cancelar</button><button className="primary-button px-5" disabled={saving}>{saving ? 'Guardando…' : item ? 'Guardar cambios' : 'Registrar compra'}</button></div>
  </form></Modal>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="form-field"><span>{label}</span>{children}</label> }
function Metric({ icon: Icon, label, value, accent, warn }: { icon: typeof Boxes; label: string; value: string; accent?: boolean; warn?: boolean }) { return <article className="metric-card"><Icon size={19} className={warn ? 'text-amber-200' : 'text-accent'} /><p className="mt-5 text-xs text-muted">{label}</p><strong className={`mt-1 block text-2xl ${accent ? 'text-accent' : warn ? 'text-amber-200' : ''}`}>{value}</strong></article> }
// Grupo de opciones tipo tarjeta (una sola elegida): [valor, título, ayuda].
function Opciones({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: [string, string, string][] }) {
  return <fieldset className="col-span-full"><legend className="mb-2 text-xs font-semibold text-muted">{label}</legend><div className={`grid gap-2 ${options.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>{options.map(([valor, titulo, ayuda]) => <label key={valor} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition ${value === valor ? 'border-accent/50 bg-accent/[.07]' : 'border-line hover:border-white/25'}`}><input type="radio" className="mt-0.5 size-4 accent-[#b7ff00]" checked={value === valor} onChange={() => onChange(valor)} /><span><strong className="block">{titulo}</strong><small className="mt-0.5 block text-muted">{ayuda}</small></span></label>)}</div></fieldset>
}

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

// Productos que la TIENDA muestra como "Entrega inmediata" (ya están en Nicaragua). Se leen del
// catálogo web (/api/catalogo): al venderse, la talla sale sola de la tienda y de esta lista.
// Si todavía no están registrados en Compras libres (con su costo), se registran con un toque.
type ProductoEI = { codigo: string; nombre: string; marca: string | null; imagen: string | null; precio_venta: number; precio_entrega_inmediata: number; tallas_entrega_inmediata: string[]; colores_entrega_inmediata: string[]; cantidad_disponible: number; entrega_inmediata: boolean; en_camino?: boolean; tallas_en_camino?: string[]; colores?: string[] }
function EntregaInmediataTienda({ lista, items, quitando, onQuitar, onRegistrar }: { lista: ProductoEI[] | null; items: Inversion[]; quitando: string | null; onQuitar: (p: ProductoEI) => void; onRegistrar: (datos: Partial<typeof empty>) => void }) {
  if (!lista?.length) return null
  const registrado = (codigo: string) => items.find((i) => (i.codigo ?? '').trim().toUpperCase() === codigo.toUpperCase() && activo(i.estado))
  const faltan = lista.filter((p) => !registrado(p.codigo)).length
  return <section className="mt-6 rounded-2xl border border-line bg-panel p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold"><span className="grid size-8 place-items-center rounded-lg bg-accent/10 text-accent"><Zap size={16} /></span> En la tienda como Entrega inmediata <span className="rounded-full bg-white/[.06] px-2 py-0.5 text-[11px] font-normal text-muted">{lista.length}</span></h2>
      {faltan > 0 && <span className="rounded-full bg-amber-300/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200">{faltan} sin registrar con su costo</span>}
    </div>
    <p className="mt-1.5 text-[11px] leading-4 text-muted">Lo que ven los clientes en "Entrega inmediata". Cuando se vende una talla, sale sola de la tienda y de aquí.</p>
    <div className="mt-3 grid gap-2 lg:grid-cols-2">{lista.map((p) => {
      const reg = registrado(p.codigo)
      const precio = p.precio_entrega_inmediata > 0 ? p.precio_entrega_inmediata : p.precio_venta
      const unidades = p.tallas_entrega_inmediata.length || p.cantidad_disponible || 1
      return <article key={p.codigo} className="flex items-center gap-3 rounded-xl border border-line bg-white/[.02] p-2.5 transition hover:border-white/15">
        <span className="size-12 shrink-0 overflow-hidden rounded-lg bg-white">{p.imagen ? <ProductoImg src={resolverImagenCatalogo(p.imagen)} className="size-full" /> : <PackageCheck size={16} className="m-auto mt-4 text-black/40" />}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold"><span className="mr-1.5 font-mono text-[10.5px] tracking-wider text-accent">{p.codigo}</span>{p.nombre}</p>
          <p className="mt-0.5 truncate text-[11px] text-muted">{p.tallas_entrega_inmediata.length ? `Talla${p.tallas_entrega_inmediata.length > 1 ? 's' : ''} ${p.tallas_entrega_inmediata.join(', ')}` : p.cantidad_disponible ? `${p.cantidad_disponible} disponibles` : 'Sin talla'} · <span className="font-mono text-white/80">USD {precio.toFixed(2)}</span></p>
          {reg && <p className="mt-0.5 text-[10.5px] font-semibold text-green-300/90">✓ En Compras libres · {statusLabel[reg.estado]}</p>}
        </div>
        {!reg && <button className="shrink-0 rounded-lg border border-amber-300/30 bg-amber-300/[.08] px-2.5 py-1.5 text-[11px] font-semibold text-amber-200 transition hover:bg-amber-300/[.15]" onClick={() => onRegistrar({ codigo: p.codigo, producto: p.nombre, marca: p.marca ?? '', talla_color: [p.tallas_entrega_inmediata.join(', '), p.colores_entrega_inmediata.join(', ')].filter(Boolean).join(' · '), cantidad: String(unidades), precio_venta_estimado: String(precio), pago: 'antes', estado: 'en_inventario' })}>+ Registrar su costo</button>}
        <button className="grid size-8 shrink-0 place-items-center rounded-lg border border-line text-muted transition hover:border-red-400/40 hover:bg-red-400/10 hover:text-red-300 disabled:opacity-50" title="Quitar de Entrega inmediata" aria-label="Quitar de Entrega inmediata" disabled={quitando === p.codigo} onClick={() => onQuitar(p)}>{quitando === p.codigo ? '…' : <X size={15} />}</button>
      </article>
    })}</div>
  </section>
}

// Tallas de una compra para "Poner en Entrega inmediata": la talla del registro (antes del "·" del
// color) repetida por cada unidad; si trae varias separadas por coma, se usan tal cual.
function tallasDeCompra(item: Inversion): string {
  const base = String(item.talla_color ?? '').split('·')[0].trim()
  const partes = base.split(',').map((t) => t.trim()).filter(Boolean)
  // "M BLACK" → "M" (talla y color escritos juntos).
  if (partes.length === 1 && /^(xxs|xs|s|m|l|xl|xxl|xxxl|\d{1,2}(\.5)?)\s+\S/i.test(partes[0])) partes[0] = partes[0].split(/\s+/)[0]
  if (partes.length === 1 && Number(item.cantidad) > 1) return Array(Math.min(20, Number(item.cantidad))).fill(partes[0]).join(', ')
  return partes.join(', ')
}

// Color de una compra: después de "·" ("S · Negro") o después de la talla ("M BLACK"). Espejo de
// colores_de_compra (SQL 202610020005).
function coloresDeCompra(item: Inversion): string {
  const t = String(item.talla_color ?? '').trim()
  if (t.includes('·')) return t.slice(t.indexOf('·') + 1).trim()
  if (/^(xxs|xs|s|m|l|xl|xxl|xxxl|\d{1,2}(\.5)?)\s+\S/i.test(t)) return t.replace(/^\S+\s+/, '').trim()
  return ''
}

function EntregaInmediataModal({ item, enTienda, coloresProducto, onClose, onListo }: { item: Inversion | null; enTienda: ProductoEI | null; coloresProducto: string[]; onClose: () => void; onListo: () => void }) {
  // Se monta de nuevo por cada compra (key en el padre): arranca con sus tallas.
  const [tallas, setTallas] = useState(() => (item ? tallasDeCompra(item) : ''))
  // Si la compra no dice el color y el producto tiene UN solo color, se usa ese.
  const [colores, setColores] = useState(() => (item ? (coloresDeCompra(item) || (coloresProducto.length === 1 ? coloresProducto[0] : '')) : ''))
  const [guardando, setGuardando] = useState(false)
  if (!item) return null
  const lista = tallas.split(',').map((t) => t.trim()).filter(Boolean)
  const listaColores = colores.split(',').map((t) => t.trim()).filter(Boolean)
  const alternarColor = (c: string) => setColores(listaColores.some((x) => x.toLowerCase() === c.toLowerCase()) ? listaColores.filter((x) => x.toLowerCase() !== c.toLowerCase()).join(', ') : [...listaColores, c].join(', '))
  const poner = async (event: FormEvent) => {
    event.preventDefault()
    if (!item.codigo?.trim()) return toast.error('Esta compra no tiene código de producto. Editala y ponele el código de la tienda.')
    setGuardando(true)
    try {
      const r = await ponerEntregaInmediataCompra(item.id, lista, listaColores)
      toast.success(r.soloColores ? `Listo: en Entrega inmediata ahora sale solo el color ${listaColores.join(', ')}.` : `${item.producto} ya está en Entrega inmediata en la tienda${lista.length ? ` (talla${lista.length > 1 ? 's' : ''} ${lista.join(', ')})` : ''}${listaColores.length ? ` · color ${listaColores.join(', ')}` : ''}.`)
      onListo()
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo.', { duration: 10000 }) }
    finally { setGuardando(false) }
  }
  return <Modal open={Boolean(item)} onClose={onClose} title="Poner en Entrega inmediata" description={`${item.producto} (${item.codigo || 'sin código'}) va a salir en la tienda como Entrega inmediata, con las tallas que pongas abajo.`}>
    <form className="form-grid" onSubmit={(event) => void poner(event)}>
      {enTienda && <p className="col-span-full rounded-xl border border-amber-300/30 bg-amber-300/[.07] px-3 py-2 text-xs text-amber-200">Ya está en Entrega inmediata con talla <b>{enTienda.tallas_entrega_inmediata.length ? enTienda.tallas_entrega_inmediata.join(', ') : '—'}</b>{enTienda.colores_entrega_inmediata.length ? <> y color <b>{enTienda.colores_entrega_inmediata.join(', ')}</b></> : coloresProducto.length > 1 ? <> y <b>todos los colores</b> (no se eligió ninguno)</> : null}. Si esta compra ya está ahí, usá esta ventana solo para corregir el color.</p>}
      <label className="form-field sm:col-span-2"><span>Tallas disponibles (separadas por coma)</span><input value={tallas} onChange={(event) => setTallas(event.target.value)} placeholder="Ej. 42  ·  o  S, M  ·  dejá vacío si no tiene talla" autoFocus /></label>
      <p className="col-span-full -mt-1 text-[11px] leading-4 text-muted">Una talla por unidad: si tenés 2 de la 42, escribí <b className="text-white">42, 42</b>. Cuando se venda, la talla sale sola de la tienda.</p>
      <label className="form-field sm:col-span-2"><span>Color(es) que tenés</span><input value={colores} onChange={(event) => setColores(event.target.value)} placeholder={coloresProducto.length ? 'Tocá abajo o escribí, ej. BLACK' : 'Opcional, ej. Negro'} /></label>
      {coloresProducto.length > 0 && <div className="col-span-full -mt-1 flex flex-wrap gap-1.5">{coloresProducto.map((c) => { const on = listaColores.some((x) => x.toLowerCase() === c.toLowerCase()); return <button type="button" key={c} onClick={() => alternarColor(c)} className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${on ? 'border-accent bg-accent text-black' : 'border-line text-muted hover:text-white'}`}>{c}</button> })}</div>}
      {coloresProducto.length > 1 && !listaColores.length && <p className="col-span-full -mt-1 text-[11px] text-amber-200">Si no elegís color, en la tienda van a salir todos ({coloresProducto.join(', ')}).</p>}
      <div className="col-span-full flex justify-end gap-2"><button type="button" className="subtle-button" onClick={onClose}>Cancelar</button><button className="primary-button px-5" disabled={guardando}><Zap size={15} /> {guardando ? 'Poniendo…' : 'Poner en Entrega inmediata'}</button></div>
    </form>
  </Modal>
}
