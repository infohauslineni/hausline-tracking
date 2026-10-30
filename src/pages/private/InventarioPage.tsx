import { Boxes, CircleDollarSign, Smartphone, Zap, ImagePlus, Layers, PackageCheck, Plus, Printer, Scissors, Search, ShoppingBag, TrendingUp, Truck, Wallet, X } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useEstadoVista } from '../../hooks/useEstadoVista'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Modal } from '../../components/ui/Modal'
import { CuentaSelect, type DestinoPago } from '../../components/finanzas/CuentaSelect'
import { subirImagenCatalogo } from '../../services/catalogoImagenes.service'
import { actualizarInversion, cambiarEstadoInversion, eliminarInversion, listarInversiones, listarProductos, listarVentasStock, obtenerTipoCambio, abonarInversion, pagarInversion, registrarCompraLibre, separarCompraLibre, venderStockInmediato, type VentaStock } from '../../services/comercial.service'
import type { Inversion, Producto } from '../../types/domain'
import { enviarReciboStockCorreo, imprimirReciboStock } from '../../utils/reciboStock'
import { resolverImagenCatalogo } from '../../utils/catalogoImagen'
import { contarFotosInversiones, enviarHistoriaEntregaInmediata, ponerEntregaInmediataCompra, quitarEntregaInmediata } from '../../services/archivos.service'
import { clienteParaVenta } from '../../services/clientes.service'
import { sugerenciaCorreo } from '../../services/saludClientes.service'
import { venderInmediatoComoPedido } from '../../services/pedidos.service'
import { FotosCompraModal } from '../../components/inventario/FotosCompraModal'
import { FichaClienteModal } from '../../components/inventario/FichaClienteModal'
import { LinkPagoModal } from '../../components/inventario/LinkPagoModal'
import { type EstadoCompra, CompraCard, CompraFila } from '../../components/inventario/CompraCard'
import { LibresTabs } from '../../components/layout/LibresTabs'
import { ProductoImg } from '../../components/ui/ProductoImg'
import { esEtapaCompra, etapaDeCompra, estadoPedidoDesdeEtapa } from '../../utils/compraEtapa'
import { CompraLoteModal } from '../../components/inventario/CompraLoteModal'
import { PagarVariasModal, RepartirEnvioModal } from '../../components/inventario/VariasComprasModals'
import { pagadoInversion, porPagarInversion, tallasDeTexto } from '../../utils/compraPago'
import { loteDe } from '../../utils/repartoCompra'

// pago: 'ahora' = se descuenta de la cuenta al registrar; 'antes' = ya estaba pagado/descontado;
// 'pendiente' = todavía no se le pagó al proveedor (queda "por pagar" en la tarjeta);
// 'parte' = se le dio un adelanto y el resto queda por pagar.
type Pago = 'ahora' | 'antes' | 'pendiente' | 'parte'
const empty = { fecha: new Date().toISOString().slice(0, 10), producto_id: '', codigo: '', producto: '', marca: '', talla_color: '', cantidad: '1', costo_unitario: '', gastos_adicionales: '', precio_venta_estimado: '', metodo: 'Transferencia', notas: '', tracking: '', transportista: '', url_tracking: '', llega_aprox: '', mostrar_tienda: true, preparando: false, pago: 'ahora' as Pago, adelanto: '', porTalla: true, estado: 'en_inventario' as Inversion['estado'] }
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
// Pestañas de la lista: "Activas" (lo que tenés o viene) es la vista de todos los días.
type Filtro = 'activos' | 'todos' | 'por_pagar' | Inversion['estado']
const usdTxt = (n: number) => `US$ ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

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
  const [fichaDe, setFichaDe] = useState<Inversion | null>(null)
  const [linkDe, setLinkDe] = useState<Inversion | null>(null)
  // Ficha "Ver detalles" de una compra (se lee de la lista para que refleje los cambios).
  const [detalleId, setDetalleId] = useState<string | null>(null)
  const [search, setSearch] = useEstadoVista('stock.busqueda', '')
  const [filter, setFilter] = useEstadoVista<Filtro>('stock.filtro', 'activos')
  // Compra en conjunto (varios productos, un pago) y selección de varias compras.
  const [loteOpen, setLoteOpen] = useState(false)
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const [enviando, setEnviando] = useState<Inversion[] | null>(null)
  const [pagandoVarias, setPagandoVarias] = useState<Inversion[] | null>(null)
  const alternar = (id: string) => setSeleccion((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  // Datos para "Registrar costo" de un producto de entrega inmediata (abre el formulario ya lleno).
  const [inicial, setInicial] = useState<Partial<typeof empty> | null>(null)
  // Productos que la tienda muestra hoy como Entrega inmediata (catálogo web).
  const [ei, setEi] = useState<ProductoEI[] | null>(null)
  // 'Historia de hoy': arma la imagen 9:16 de Entrega inmediata y la manda al correo y a Drive.
  const [armandoHistoria, setArmandoHistoria] = useState(false)
  const historiaHoy = async () => {
    setArmandoHistoria(true)
    try { const n = await enviarHistoriaEntregaInmediata(); toast.success(`Listo: ${n === 1 ? 'la historia' : `${n} historias`} de Entrega inmediata te llegaron al correo y quedaron en Drive.`) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo armar la historia.') }
    finally { setArmandoHistoria(false) }
  }
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
  // Números simples, sin cuentas: cuánto tenés metido en mercadería, cuánto debés, cuánto ya
  // vendiste y cuánto ganaste (lo vendido menos lo que costó, con comisión y envío).
  const metrics = useMemo(() => items.reduce((result, item) => {
    const cost = totalCost(item), sale = Number(item.precio_venta_estimado) * Number(item.cantidad)
    if (porPagar(item) && item.estado !== 'descartado') { result.debt += porPagarInversion(item, cost - linkedExpenses(item)); result.debtCount++ }
    if (activo(item.estado)) { result.units += item.cantidad; result.costActive += cost; result.potential += sale }
    if (item.estado === 'vendido') { result.sold += sale; result.earned += sale - cost; result.soldCount++ }
    return result
  }, { units: 0, costActive: 0, potential: 0, debt: 0, debtCount: 0, sold: 0, earned: 0, soldCount: 0 }), [items])
  const [paying, setPaying] = useState<Inversion | null>(null)
  const counts = useMemo(() => items.reduce((acc, item) => { acc[item.estado] = (acc[item.estado] ?? 0) + 1; return acc }, {} as Record<Inversion['estado'], number>), [items])
  const deben = useMemo(() => items.filter((i) => porPagar(i) && i.estado !== 'descartado'), [items])
  // Cuántas compras tiene cada lote (compra en conjunto).
  const lotes = useMemo(() => items.reduce((m, i) => { const l = loteDe(i.notas); if (l) m.set(l, (m.get(l) ?? 0) + 1); return m }, new Map<string, number>()), [items])
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    const pasa = (item: Inversion) => filter === 'todos' ? true : filter === 'activos' ? activo(item.estado) : filter === 'por_pagar' ? porPagar(item) && item.estado !== 'descartado' : item.estado === filter
    return items
      .filter((item) => pasa(item) && (!term || [item.producto, item.codigo, item.marca, item.talla_color, item.tracking, loteDe(item.notas)].some((v) => v?.toLowerCase().includes(term))))
      // Por estado y, dentro, lo más nuevo primero; las compras de un mismo lote quedan juntas.
      .sort((a, b) => statusOrder[a.estado] - statusOrder[b.estado] || b.fecha.localeCompare(a.fecha) || (loteDe(a.notas) ?? '').localeCompare(loteDe(b.notas) ?? ''))
  }, [items, search, filter])
  const seleccionadas = useMemo(() => items.filter((i) => seleccion.has(i.id)), [items, seleccion])
  const elegirLote = (lote: string) => setSeleccion(new Set(items.filter((i) => loteDe(i.notas) === lote && i.estado !== 'descartado').map((i) => i.id)))
  const detalle = detalleId ? items.find((i) => i.id === detalleId) ?? null : null
  // Mostrar / ocultar en la tienda sin tocar el estado (la base de datos avisa al catálogo sola).
  const mostrarTienda = async (item: Inversion, mostrar: boolean) => {
    try {
      const updated = await actualizarInversion(item.id, { mostrar_tienda: mostrar })
      setItems((all) => all.map((current) => current.id === updated.id ? updated : current))
      toast.success(mostrar ? 'Se publica en la tienda en unos segundos.' : 'Se quitó de la tienda. En el panel sigue igual.')
      window.setTimeout(cargarEI, 4000)
    } catch { toast.error('No se pudo cambiar. ¿Ya se aplicó el SQL 202610140001?') }
  }
  const updateStatus = async (item: Inversion, estadoElegido: EstadoCompra) => { try {
    // Las etapas (En preparación, Control de calidad, En tránsito…) son estado 'en_transito' + `etapa`.
    const etapa = esEtapaCompra(estadoElegido) ? estadoElegido : null
    const estado: Inversion['estado'] = etapa ? 'en_transito' : (estadoElegido as Inversion['estado'])
    if (etapa && item.etapa === undefined) { toast.error('Falta aplicar el SQL 202610140002 para usar las etapas.'); return }
    const updated = item.etapa !== undefined ? await actualizarInversion(item.id, { estado, etapa }) : await cambiarEstadoInversion(item.id, estado); setItems((all) => all.map((current) => current.id === updated.id ? updated : current)); toast.success('Estado actualizado.') } catch { toast.error('No se pudo actualizar.') } }
  const remove = async (item: Inversion) => {
    if (!window.confirm(`¿Eliminar "${item.producto}" de Compras libres? Si ya se había pagado, ese monto vuelve a Mi cuenta. Esta acción no se puede deshacer.`)) return
    try { await eliminarInversion(item.id); setItems((all) => all.filter((current) => current.id !== item.id)); toast.success('Producto eliminado del inventario.') } catch { toast.error('No se pudo eliminar el producto.') }
  }
  // Separar una compra de varios pares en una por talla, para venderlas o apartarlas por separado.
  const separar = async (item: Inversion) => {
    const tallas = tallasDeTexto(item.talla_color)
    const n = Number(item.cantidad)
    if (tallas.length > 1 && tallas.length !== n) return toast.error(`La compra tiene ${tallas.length} tallas para ${n} pares: editala y poné una talla por par, separadas por coma.`)
    if (!window.confirm(`¿Separar esta compra en ${n} compras de 1 par${tallas.length === n ? ` (${tallas.join(', ')})` : ''}? El pago y los datos se copian a cada una.`)) return
    try {
      const filas = await separarCompraLibre(item, tallas)
      setItems((all) => [...filas.slice(1), ...all.map((c) => c.id === item.id ? filas[0] : c)])
      toast.success(`Listo: ahora son ${filas.length} compras, una por talla.`)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo separar.') }
  }

  // Apartar = convertir este producto de stock en un pedido normal (con cliente, abono y saldo).
  // Lleva el costo real como precio de compra para que la ganancia salga bien; ese costo NO se
  // vuelve a descontar (ya se pagó al traerlo). Al guardar el pedido, el producto sale del stock.
  const apartar = (item: Inversion) => {
    const unidades = Math.max(1, Number(item.cantidad) || 1)
    const precio = Number(item.precio_venta_estimado) || 0
    navigate('/pedidos/nuevo', { state: { prefill: {
      // En camino → el pedido arranca en tránsito; ya en Nicaragua → listo para entregar.
      // En camino → arranca en su etapa real: en preparación (con fotos de calidad pasa sola a
      // Control de calidad y le llega el correo); si ya tiene tracking y no hay fotos, en tránsito.
      // Ya en Nicaragua → listo para entregar.
      estadoPedido: item.estado === 'en_transito' ? estadoPedidoDesdeEtapa(etapaDeCompra(item), 0) : 'disponible_entrega',
      // Igual que la tienda: el 50% se redondea hacia arriba al dólar (155 → abono 78).
      abono: Math.ceil(precio * 0.5),
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

  return <div className={seleccion.size ? 'pb-24' : ''}><LibresTabs /><div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Stock propio · sin pedido de cliente</p><h1 className="page-title">Compras libres</h1><p className="page-subtitle">Lo que comprás por tu cuenta para vender. Registrá una compra en conjunto y el costo, la comisión y el envío se reparten solos.</p></div><div className="flex flex-wrap gap-2"><button type="button" className="subtle-button px-4" disabled={armandoHistoria} onClick={() => void historiaHoy()} title="Imagen 9:16 con lo que hay en Entrega inmediata, al correo y a Drive (también llega sola cada día a las 6 a. m.)"><Smartphone size={16} /> {armandoHistoria ? 'Armando…' : 'Historia de hoy'}</button><button className="subtle-button px-4" onClick={() => { setEditing(null); setOpen(true) }}><Plus size={16} /> Un producto</button><button className="primary-button px-5" onClick={() => setLoteOpen(true)}><Layers size={17} /> Compra en conjunto</button></div></div>
    {(() => {
      // Vendidas o apartadas que la tienda sigue mostrando como Entrega inmediata (y no queda otra
      // compra disponible de ese código): se quitan con un toque.
      const enTienda = new Set((ei ?? []).map((p) => p.codigo.toUpperCase()))
      const cod = (x: Inversion) => (x.codigo ?? '').trim().toUpperCase()
      const sobran = items.filter((x) => (x.estado === 'vendido' || x.estado === 'reservado') && cod(x) && enTienda.has(cod(x))
        && !items.some((y) => y.id !== x.id && cod(y) === cod(x) && y.estado === 'en_inventario'))
        .filter((x, i, arr) => arr.findIndex((y) => cod(y) === cod(x)) === i)
      if (!sobran.length) return null
      return <section className="mt-4 rounded-2xl border border-amber-400/40 bg-amber-400/[.06] p-4">
        <p className="text-sm font-semibold text-amber-100">Vendidas, pero la tienda las sigue mostrando en Entrega inmediata</p>
        <div className="mt-2 space-y-1.5">{sobran.map((x) => <div key={x.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-white/85"><b className="font-mono text-accent">{cod(x)}</b> · {x.producto}{x.talla_color ? ` · ${x.talla_color}` : ''} · <span className="text-muted">{x.estado === 'vendido' ? 'vendida' : 'apartada'}</span></span>
          <button type="button" className="subtle-button px-3 text-xs text-amber-100" disabled={quitandoEI === (x.codigo ?? '').trim()} onClick={() => void quitarEI((x.codigo ?? '').trim(), x.producto)}>{quitandoEI === (x.codigo ?? '').trim() ? 'Quitando…' : 'Quitar de la tienda'}</button>
        </div>)}</div>
      </section>
    })()}
    <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Metric icon={Boxes} label={`En mercadería · ${metrics.units} ud`} value={usdTxt(metrics.costActive)} hint="Lo que costó lo que tenés o viene" />
      <Metric icon={ShoppingBag} label="Si lo vendés todo" value={usdTxt(metrics.potential)} hint={`Ganarías ${usdTxt(Math.max(0, metrics.potential - metrics.costActive))}`} />
      <Metric icon={CircleDollarSign} label={`Vendido · ${metrics.soldCount}`} value={usdTxt(metrics.sold)} hint="Lo que ya cobraste" />
      <Metric icon={TrendingUp} label="Ganancia ganada" value={usdTxt(metrics.earned)} hint="Venta − costo, comisión y envío" accent />
      <Metric icon={Wallet} label={`Por pagar · ${metrics.debtCount}`} value={usdTxt(metrics.debt)} hint={metrics.debtCount ? 'Tocá para pagarlas juntas' : 'Todo pagado'} warn={metrics.debt > 0} onClick={metrics.debtCount ? () => setPagandoVarias(deben) : undefined} />
    </div>
    <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="sin-barra -mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:flex-wrap" role="tablist" aria-label="Filtrar compras">
        {([['activos', 'Activas', items.filter((i) => activo(i.estado)).length], ['en_inventario', 'Disponibles', counts.en_inventario ?? 0], ['en_transito', 'En camino', counts.en_transito ?? 0], ['reservado', 'Apartadas', counts.reservado ?? 0], ['por_pagar', 'Por pagar', deben.length], ['vendido', 'Vendidas', counts.vendido ?? 0], ['todos', 'Todas', items.length]] as [Filtro, string, number][]).map(([valor, texto, n]) =>
          <button key={valor} role="tab" aria-selected={filter === valor} onClick={() => setFilter(valor)} className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${filter === valor ? 'border-accent bg-accent text-app' : 'border-line text-muted hover:border-white/25 hover:text-white'}`}>{texto}<span className={`rounded-full px-1.5 text-[10px] ${filter === valor ? 'bg-black/15' : 'bg-white/[.06]'}`}>{n}</span></button>)}
      </div>
      <div className="relative lg:w-80"><Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" size={18} /><input className="search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Producto, código, marca, talla o tracking" /></div>
    </div>
    <div className="mt-4 space-y-2">
      <div className="hidden grid-cols-[56px_minmax(0,2.2fr)_130px_minmax(0,1.4fr)_minmax(0,1.6fr)_auto] gap-4 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted md:grid"><button type="button" className="text-left hover:text-white" onClick={() => setSeleccion(seleccion.size === visible.length && visible.length ? new Set() : new Set(visible.map((i) => i.id)))}>{seleccion.size && seleccion.size === visible.length ? 'Ninguna' : 'Todas'}</button><span>Producto</span><span>Estado</span><span>Etiquetas</span><span className="text-right">Costo · Venta · Ganancia</span><span className="w-[110px]" /></div>
      {visible.map((item) => {
        const cod = (item.codigo ?? '').trim().toUpperCase()
        const lote = loteDe(item.notas)
        return <CompraFila key={item.id} item={item} costo={totalCost(item)} fotos={fotosCount[item.id] ?? 0}
          enEI={!!cod && (ei ?? []).some((p) => p.codigo.toUpperCase() === cod)} enCaminoPublicado={!!cod && enCaminoTienda.has(cod)}
          seleccionado={seleccion.has(item.id)} onSeleccionar={() => alternar(item.id)}
          lote={lote ? lotes.get(lote) : undefined} onLote={lote ? () => elegirLote(lote) : undefined}
          onDetalles={() => setDetalleId(item.id)} />
      })}
    </div>
    {/* Barra de acciones de la selección: pagar juntas (con comisión) o repartir el envío del paquete. */}
    {seleccion.size > 0 && <div className="reveal-up fixed inset-x-3 bottom-20 z-30 mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-2xl border border-accent/40 bg-panel/95 p-3 shadow-2xl backdrop-blur-xl lg:bottom-5 lg:left-[300px]">
      <span className="mr-auto px-1 text-sm"><b>{seleccion.size}</b> {seleccion.size === 1 ? 'seleccionada' : 'seleccionadas'} <span className="text-xs text-muted">· costo {usdTxt(seleccionadas.reduce((s, i) => s + totalCost(i), 0))}</span></span>
      <button className="subtle-button" onClick={() => setEnviando(seleccionadas)}><Truck size={15} /> Repartir envío</button>
      <button className="subtle-button text-amber-100!" disabled={!seleccionadas.some((i) => porPagar(i))} onClick={() => setPagandoVarias(seleccionadas.filter((i) => porPagar(i)))}><Wallet size={15} /> Pagar juntas</button>
      <button className="icon-button" onClick={() => setSeleccion(new Set())} aria-label="Quitar selección"><X size={16} /></button>
    </div>}
    {detalle && !preview && !fotosDe && !fichaDe && !linkDe && !poniendoEI && !selling && !paying && !open && (() => {
      const item = detalle
      const cod = (item.codigo ?? '').trim().toUpperCase()
      // Las ventanas que se abren desde aquí tapan la ficha; al cerrarlas se vuelve a Detalles.
      const luego = (fn: () => void) => () => fn()
      const saliendo = (fn: () => void) => () => { setDetalleId(null); fn() }
      return <Modal open ancho="amplio" onClose={() => setDetalleId(null)} title="Detalles de la compra" description={`${item.codigo ? `${item.codigo} · ` : ''}comprada el ${new Date(item.fecha + 'T12:00:00').toLocaleDateString('es-NI', { day: 'numeric', month: 'short', year: 'numeric' })}`}>
        {Number(item.cantidad) > 1 && activo(item.estado) && <div className="mb-3 flex flex-col gap-2 rounded-xl border border-amber-300/30 bg-amber-300/[.06] p-3 text-xs sm:flex-row sm:items-center sm:justify-between"><span className="text-amber-100">Esta compra tiene <b>{item.cantidad} pares</b> en un solo registro: si vendés o apartás uno, se marcan todos. Separala para manejar cada par aparte.</span><button className="subtle-button shrink-0" onClick={() => void separar(item)}><Scissors size={14} /> Separar por talla</button></div>}
        <CompraCard enModal item={item} costo={totalCost(item)} pendiente={porPagarInversion(item, totalCost(item) - linkedExpenses(item))} gastosAsociados={linkedExpenses(item)}
          enEI={!!cod && (ei ?? []).some((p) => p.codigo.toUpperCase() === cod)} enCaminoPublicado={!!cod && enCaminoTienda.has(cod)}
          fotos={fotosCount[item.id] ?? 0} quitandoEI={quitandoEI === (item.codigo ?? '').trim()} imprimiendo={printingId === item.id}
          onEstado={(estado) => void updateStatus(item, estado)} onVer={luego(() => setPreview(item))} onEditar={luego(() => { setEditing(item); setOpen(true) })}
          onEliminar={luego(() => void remove(item))} onPagar={luego(() => setPaying(item))} onFotos={luego(() => setFotosDe(item))} onEntregaInmediata={luego(() => setPoniendoEI(item))}
          onQuitarEI={() => void quitarEI((item.codigo ?? '').trim(), item.producto)} onVender={luego(() => setSelling(item))} onApartar={saliendo(() => apartar(item))}
          onVerPedido={saliendo(() => navigate(`/pedidos/${item.pedido_id}`))} onImprimir={() => void imprimirVendido(item)} onFicha={luego(() => setFichaDe(item))} onLinkPago={luego(() => setLinkDe(item))} onMostrarTienda={(mostrar) => void mostrarTienda(item, mostrar)} />
      </Modal>
    })()}
    {!items.length && <div className="mt-6 rounded-2xl border border-dashed border-line p-10 text-center text-sm text-muted">Todavía no hay compras libres. Registrá lo que compraste por tu cuenta para vender, esté pagado o no.</div>}
    {items.length > 0 && !visible.length && <div className="mt-6 rounded-2xl border border-dashed border-line p-10 text-center text-sm text-muted">Ningún producto coincide con esta búsqueda.</div>}
    <ProductModal open={open} item={editing} inicial={inicial} products={products} onClose={() => { setOpen(false); setEditing(null); setInicial(null) }} onSaved={(guardadas) => { setItems((all) => editing ? all.map((current) => guardadas.find((g) => g.id === current.id) ?? current) : [...guardadas, ...all]); setOpen(false); setEditing(null); setInicial(null) }} />
    <CompraLoteModal open={loteOpen} products={products} onClose={() => setLoteOpen(false)} onSaved={(creadas) => { setItems((all) => [...creadas, ...all]); setLoteOpen(false); setFilter('activos'); load() }} />
    <RepartirEnvioModal items={enviando} onClose={() => setEnviando(null)} onListo={() => { setEnviando(null); setSeleccion(new Set()); load() }} />
    <PagarVariasModal items={pagandoVarias} onClose={() => setPagandoVarias(null)} onPagadas={(pagadas) => { setItems((all) => all.map((c) => pagadas.find((p) => p.id === c.id) ?? c)); setPagandoVarias(null); setSeleccion(new Set()) }} />
    <SellModal item={selling} onClose={() => setSelling(null)} onSold={(item) => { setItems((all) => all.map((current) => current.id === item.id ? item : current)); setSelling(null); void listarVentasStock().then(setVentas).catch(() => undefined) }} />
    <PayModal item={paying} items={items} onClose={() => setPaying(null)} onPaid={(pagadas) => { setItems((all) => all.map((current) => pagadas.find((p) => p.id === current.id) ?? current)); setPaying(null) }} />
    <ClientPreview item={preview} onClose={() => setPreview(null)} />
    {fichaDe && <FichaClienteModal item={fichaDe} onClose={() => setFichaDe(null)} />}
    {linkDe && <LinkPagoModal item={linkDe} onClose={() => setLinkDe(null)} onMarcada={(nuevo) => { setItems((all) => all.map((x) => x.id === nuevo.id ? nuevo : x)); setLinkDe(nuevo) }} />}
    {fotosDe && <FotosCompraModal item={fotosDe} onClose={() => setFotosDe(null)} onCambio={(n) => setFotosCount((c) => ({ ...c, [fotosDe.id]: n }))} />}
    <EntregaInmediataModal key={poniendoEI?.id ?? 'ninguna'} item={poniendoEI} enTienda={(ei ?? []).find((p) => p.codigo.toUpperCase() === (poniendoEI?.codigo ?? '').trim().toUpperCase()) ?? null} coloresProducto={coloresTienda[(poniendoEI?.codigo ?? '').trim().toUpperCase()] ?? []} onClose={() => setPoniendoEI(null)} onListo={() => { setPoniendoEI(null); setTimeout(cargarEI, 2500) }} />
  </div>
}

// Pago al proveedor de una compra que se registró "por pagar": sale de la cuenta elegida ahora.
function PayModal({ item, items, onClose, onPaid }: { item: Inversion | null; items: Inversion[]; onClose: () => void; onPaid: (items: Inversion[]) => void }) {
  const [conHermanas, setConHermanas] = useState(true)
  // Vacío = se paga todo lo que falta; un número menor = abono parcial (cuota).
  const [parcial, setParcial] = useState('')
  const [form, setForm] = useState({ fecha: new Date().toISOString().slice(0, 10), metodo: 'Transferencia' })
  const [destino, setDestino] = useState<DestinoPago>({ cuentaId: null, montoCuenta: 0 })
  const [tipoCambio, setTipoCambio] = useState(37)
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (item) { setForm({ fecha: new Date().toISOString().slice(0, 10), metodo: 'Transferencia' }); setDestino({ cuentaId: null, montoCuenta: 0 }); setParcial(''); void obtenerTipoCambio().then(setTipoCambio).catch(() => undefined) } }, [item])
  if (!item) return null
  // Los otros pares de la MISMA compra (mismo código, fecha y costo) que también están por pagar.
  const hermanas = items.filter((x) => x.id !== item.id && x.pagado === false && x.estado !== 'descartado' && (x.codigo ?? '') === (item.codigo ?? '') && x.fecha === item.fecha && Number(x.costo_unitario) === Number(item.costo_unitario))
  const aPagar = [item, ...(conHermanas ? hermanas : [])]
  const faltaDe = (x: Inversion) => porPagarInversion(x, Number(x.costo_unitario) * Number(x.cantidad) + Number(x.gastos_adicionales))
  const monto = Math.round(aPagar.reduce((s, x) => s + faltaDe(x), 0) * 100) / 100
  const abonado = pagadoInversion(item, totalCost(item))
  const pagaAhora = parcial.trim() ? Math.min(monto, Math.max(0, Number(parcial) || 0)) : monto
  const esParcial = pagaAhora < monto - 0.005
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!destino.cuentaId && !window.confirm('No elegiste de qué cuenta salió. ¿Registrar el pago sin descontarlo de ninguna cuenta?')) return
    if (pagaAhora <= 0.005) return toast.error('Escribí cuánto le pagás ahora.')
    setSaving(true)
    try {
      // Lo pagado cubre los pares en orden (completos primero); si sobra una parte, queda abonada al
      // siguiente. Lo que sale de la cuenta se reparte en la misma proporción.
      const ratio = pagaAhora > 0 ? destino.montoCuenta / pagaAhora : 1
      let restante = pagaAhora
      let salido = 0
      const enCuenta = (usd: number) => { const v = restante - usd <= 0.005 ? Math.round((destino.montoCuenta - salido) * 100) / 100 : Math.round(usd * ratio * 100) / 100; salido += v; return v }
      const pagadas: Inversion[] = []
      for (const x of aPagar) {
        const falta = faltaDe(x)
        if (restante <= 0.005) break
        if (restante >= falta - 0.005) { pagadas.push(await pagarInversion(x, form, { cuentaId: destino.cuentaId, montoCuenta: enCuenta(falta) })); restante -= falta }
        else { pagadas.push(await abonarInversion(x, Math.round(restante * 100) / 100, form, { cuentaId: destino.cuentaId, montoCuenta: enCuenta(restante) })); restante = 0 }
      }
      onPaid(pagadas)
      toast.success(esParcial ? `Abono de USD ${pagaAhora.toFixed(2)} registrado. Quedan USD ${(monto - pagaAhora).toFixed(2)} por pagar.` : pagadas.length > 1 ? `Pago registrado: ${pagadas.length} pares de esta compra quedaron pagados.` : 'Pago al proveedor registrado.')
    } catch { toast.error('No se pudo registrar el pago.') } finally { setSaving(false) }
  }
  return <Modal open={Boolean(item)} onClose={onClose} title={`Pagar al proveedor · ${item.producto}`} description="La compra quedó por pagar. Registrá el pago cuando se lo hagas al proveedor.">
    <form className="form-grid" onSubmit={(event) => void submit(event)}>
      <Field label="Fecha del pago"><input type="date" value={form.fecha} onChange={(event) => setForm({ ...form, fecha: event.target.value })} /></Field>
      <Field label="Método de pago"><input value={form.metodo} onChange={(event) => setForm({ ...form, metodo: event.target.value })} /></Field>
      <label className="form-field col-span-full"><span>¿Cuánto le pagás ahora? (US$)</span><input type="number" min="0" step=".01" value={parcial} onChange={(event) => setParcial(event.target.value)} placeholder={`Todo lo que falta: ${monto.toFixed(2)}`} /></label>
      <CuentaSelect proposito="comprar" montoUsd={pagaAhora} tipoCambio={tipoCambio} value={destino} onChange={setDestino} modo="resta" />
      {hermanas.length > 0 && <label className="col-span-full flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-white/[.02] p-3"><input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-accent" checked={conHermanas} onChange={(event) => setConHermanas(event.target.checked)} /><span className="flex flex-col"><span className="text-sm font-medium">Pagar también los otros {hermanas.length} {hermanas.length === 1 ? 'par' : 'pares'} de esta compra</span><span className="text-[11px] text-muted">{hermanas.map((x) => x.talla_color || 's/t').join(', ')} · comprados el mismo día</span></span></label>}
      <div className="col-span-full rounded-xl border border-accent/20 bg-accent/[.05] p-4 text-sm">{abonado > 0.005 && <span className="mb-1 block text-xs text-muted">De este par ya adelantaste USD {abonado.toFixed(2)}.</span>}Se descontarán <strong className="text-accent">USD {pagaAhora.toFixed(2)}</strong> de la cuenta elegida{esParcial ? <> como abono; quedan <strong className="text-accent">USD {(monto - pagaAhora).toFixed(2)}</strong> por pagar.</> : <> y {aPagar.length > 1 ? `los ${aPagar.length} pares quedarán como pagados` : 'la compra quedará como pagada'}.</>}</div>
      <div className="col-span-full flex justify-end gap-2"><button type="button" className="subtle-button" onClick={onClose}>Cancelar</button><button className="primary-button px-5" disabled={saving}>{saving ? 'Registrando…' : 'Registrar pago'}</button></div>
    </form>
  </Modal>
}

function SellModal({ item, onClose, onSold }: { item: Inversion | null; onClose: () => void; onSold: (item: Inversion) => void }) {
  const [form, setForm] = useState({ fecha: new Date().toISOString().slice(0, 10), cliente: '', correo: '', whatsapp: '', precio_venta: '', monto_recibido: '', metodo: 'Transferencia', observaciones: '' })
  const [destino, setDestino] = useState<DestinoPago>({ cuentaId: null, montoCuenta: 0 })
  const [tipoCambio, setTipoCambio] = useState(37)
  const [saving, setSaving] = useState(false)
  const [printing, setPrinting] = useState(false)
  useEffect(() => { if (item) { const precio = (Number(item.precio_venta_estimado) * Number(item.cantidad)).toFixed(2); setForm({ fecha: new Date().toISOString().slice(0, 10), cliente: '', correo: '', whatsapp: '', precio_venta: precio, monto_recibido: precio, metodo: 'Transferencia', observaciones: '' }); setDestino({ cuentaId: null, montoCuenta: 0 }); void obtenerTipoCambio().then(setTipoCambio).catch(() => undefined) } }, [item])
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
      // Con correo o WhatsApp se liga al cliente: queda como pedido entregado a su nombre (le
      // aparece en su cuenta y cuenta como compra). Sin datos del cliente, venta suelta como antes.
      const ficha = (correoValido || form.whatsapp.trim()) ? await clienteParaVenta({ nombre: form.cliente, correo: correoValido ? correo : '', whatsapp: form.whatsapp }).catch(() => null) : null
      if (ficha) {
        const pedido = await venderInmediatoComoPedido(item, { clienteId: ficha.id, fecha: form.fecha, precioTotal: precio, recibido, metodo: form.metodo, observaciones: form.observaciones }, destino)
        onSold({ ...item, estado: 'vendido', precio_venta_estimado: precio / Number(item.cantidad), pedido_id: pedido.id, pedidos: { codigo: pedido.codigo } })
        toast.success(`Venta registrada como compra de ${ficha.nombre} (pedido ${pedido.codigo}). Ya le aparece en su cuenta.`)
      } else {
        if (correoValido || form.whatsapp.trim()) toast.message('No encontré la ficha del cliente: para guardarla como su compra, poné su nombre y WhatsApp.', { duration: 8000 })
        const sold = await venderStockInmediato(item, { fecha: form.fecha, precio_venta: precio / Number(item.cantidad), monto_recibido: Math.max(0, recibido), metodo: form.metodo, cliente: form.cliente, observaciones: form.observaciones }, destino)
        onSold(sold)
        toast.success('Venta registrada. El producto salió del inventario.')
      }
      // Factura al correo del cliente (si lo dio). La venta ya quedó guardada aunque el correo falle.
      if (correoValido) void enviarReciboStockCorreo(item, { cliente: form.cliente, precioTotal: precio, montoRecibido: Math.max(0, recibido), fecha: form.fecha, metodo: form.metodo }, correo)
        .then(() => toast.success(`Factura enviada a ${correo}.`))
        .catch((e) => toast.error(`La venta quedó guardada, pero no se pudo enviar la factura: ${e instanceof Error ? e.message : 'error'}`, { duration: 10000 }))
    } catch { toast.error('No se pudo registrar la venta.') } finally { setSaving(false) }
  }
  return <Modal open={Boolean(item)} onClose={onClose} title={`Vender · ${item.producto}`} description="Con el correo o WhatsApp del cliente queda como su compra (le aparece en su cuenta). Sin datos, es una venta suelta.">
    <form className="form-grid" onSubmit={(event) => void submit(event)}>
      <Field label="Fecha de venta"><input type="date" value={form.fecha} onChange={(event) => setForm({ ...form, fecha: event.target.value })} /></Field>
      <Field label="Cliente (opcional)"><input value={form.cliente} onChange={(event) => setForm({ ...form, cliente: event.target.value })} placeholder="Nombre del cliente" /></Field>
      <Field label="WhatsApp del cliente"><input type="tel" inputMode="tel" autoComplete="off" value={form.whatsapp} onChange={(event) => setForm({ ...form, whatsapp: event.target.value })} placeholder="8888 8888" /></Field>
      <Field label="Correo del cliente (para enviarle la factura)"><input type="email" inputMode="email" autoComplete="off" value={form.correo} onChange={(event) => setForm({ ...form, correo: event.target.value })} placeholder="cliente@gmail.com" />{sugerenciaCorreo(form.correo) && <button type="button" className="mt-1.5 text-left text-[11px] font-semibold text-amber-300 hover:underline" onClick={() => setForm({ ...form, correo: sugerenciaCorreo(form.correo)! })}>¿Quiso decir {sugerenciaCorreo(form.correo)}? Tocá para corregir</button>}</Field>
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

function ProductModal({ open, item, inicial, products, onClose, onSaved }: { open: boolean; item: Inversion | null; inicial?: Partial<typeof empty> | null; products: Producto[]; onClose: () => void; onSaved: (items: Inversion[]) => void }) {
  const [form, setForm] = useState(empty)
  const [file, setFile] = useState<File | null>(null)
  const [destino, setDestino] = useState<DestinoPago>({ cuentaId: null, montoCuenta: 0 })
  const [tipoCambio, setTipoCambio] = useState(37)
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (!open) return; setFile(null); setDestino({ cuentaId: null, montoCuenta: 0 }); void obtenerTipoCambio().then(setTipoCambio).catch(() => undefined); setForm(item ? { fecha: item.fecha.slice(0, 10), producto_id: item.producto_id ?? '', codigo: item.codigo ?? '', producto: item.producto, marca: item.marca ?? '', talla_color: item.talla_color ?? '', cantidad: String(item.cantidad), costo_unitario: String(item.costo_unitario), gastos_adicionales: String(item.gastos_adicionales), precio_venta_estimado: String(item.precio_venta_estimado), metodo: 'Transferencia', notas: item.notas ?? '', tracking: item.tracking ?? '', transportista: item.transportista ?? '', url_tracking: item.url_tracking ?? '', llega_aprox: item.llega_aprox ?? '', mostrar_tienda: item.mostrar_tienda !== false, preparando: false, pago: porPagar(item) ? 'pendiente' : 'antes', adelanto: '', porTalla: false, estado: item.estado } : { ...empty, ...(inicial ?? {}) }) }, [item, open, inicial])

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
    const descuenta = !item && (form.pago === 'ahora' || form.pago === 'parte')
    const adelanto = Number(form.adelanto) || 0
    if (!item && form.pago === 'parte' && (adelanto <= 0 || adelanto >= cantidad * costoUnitario + gastosAdicionales)) return toast.error('Escribí cuánto le adelantaste (menos que el total de la compra).')
    if (descuenta && !destino.cuentaId && !window.confirm('No elegiste de qué cuenta salió. ¿Registrar la compra sin descontarla de ninguna cuenta?')) return
    // Varios pares: una compra por talla (las tallas separadas por coma, una por par).
    const tallas = tallasDeTexto(form.talla_color)
    const separar = !item && form.porTalla && cantidad > 1
    if (separar && tallas.length > 1 && tallas.length !== cantidad) return toast.error(`Pusiste ${tallas.length} tallas para ${cantidad} pares: poné una talla por par, separadas por coma.`)
    setSaving(true)
    try {
      // Al editar no se toca el pago (se registra con "Registrar pago al proveedor" en la tarjeta).
      const pagoCampos = item ? {} : { pagado: form.pago !== 'pendiente', pagado_at: form.pago === 'pendiente' ? null : new Date().toISOString() }
      const input = { fecha: form.fecha, producto_id: form.producto_id || null, codigo: form.codigo || null, producto: form.producto.trim(), marca: form.marca || null, talla_color: form.talla_color || null, cantidad, costo_unitario: costoUnitario, gastos_adicionales: gastosAdicionales, precio_venta_estimado: precioVenta, estado: item?.estado ?? form.estado, notas: form.notas || null, tracking: form.tracking || null, transportista: form.transportista || null, url_tracking: form.url_tracking || null, ...(form.llega_aprox ? { llega_aprox: form.llega_aprox } : item?.llega_aprox ? { llega_aprox: null } : {}), estado_tracking: form.tracking ? (item?.estado_tracking ?? 'Registrado') : null, pedido_id: item?.pedido_id ?? null, ...pagoCampos,
        // Solo se manda si cambia o si la columna ya existe (así no falla antes de aplicar el SQL).
        ...((item && item.mostrar_tienda !== undefined) || !form.mostrar_tienda ? { mostrar_tienda: form.mostrar_tienda } : {}),
        // En preparación: al poner el tracking por primera vez pasa sola a En camino.
        // Compra nueva que viene en camino: arranca En preparación o En tránsito (según lo elegido).
        ...(!item && form.estado === 'en_transito' ? { etapa: form.preparando ? 'en_preparacion' : 'transito_internacional' } : {}) }
      if (item) {
        let saved = await actualizarInversion(item.id, input)
        if (file) saved = await actualizarInversion(saved.id, { imagen: await subirImagenCatalogo('inversiones', saved.id, file) })
        else if (!saved.imagen && catalogImagen) saved = await actualizarInversion(saved.id, { imagen: catalogImagen })
        onSaved([saved])
        toast.success('Compra actualizada.')
        return
      }
      // Filas a crear: una sola, o una por par (con su talla y su parte del envío/otros gastos).
      const n = separar ? cantidad : 1
      const gastoPar = Math.floor((gastosAdicionales / n) * 100) / 100
      const inputs = Array.from({ length: n }, (_, i) => separar
        ? { ...input, cantidad: 1, talla_color: tallas.length === cantidad ? tallas[i] : (form.talla_color || null), gastos_adicionales: i === n - 1 ? Math.round((gastosAdicionales - gastoPar * (n - 1)) * 100) / 100 : gastoPar }
        : input)
      let creadas = await registrarCompraLibre(inputs, { modo: form.pago, adelanto, metodo: form.metodo, destino })
      // Foto: la subida (una vez) o la del catálogo, para todas las filas.
      const foto = file ? await subirImagenCatalogo('inversiones', creadas[0].id, file) : (!creadas[0].imagen && catalogImagen ? catalogImagen : null)
      if (foto) creadas = await Promise.all(creadas.map((c) => actualizarInversion(c.id, { imagen: foto })))
      onSaved(creadas)
      const cuantas = creadas.length > 1 ? `${creadas.length} compras (una por talla)` : 'Compra'
      toast.success(form.pago === 'ahora' ? `${cuantas} registrada${creadas.length > 1 ? 's' : ''} y descontada${creadas.length > 1 ? 's' : ''} de Mi cuenta.` : form.pago === 'antes' ? `${cuantas} registrada${creadas.length > 1 ? 's' : ''} sin descontarla otra vez.` : form.pago === 'parte' ? `${cuantas} registrada${creadas.length > 1 ? 's' : ''}: adelanto de US$ ${adelanto.toFixed(2)} descontado; el resto queda por pagar.` : `${cuantas} registrada${creadas.length > 1 ? 's' : ''} como por pagar al proveedor.`)
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
    {(item?.estado ?? form.estado) === 'en_transito' && <label className="col-span-full flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-white/[.02] p-3"><input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-accent" checked={form.mostrar_tienda} onChange={(event) => setForm({ ...form, mostrar_tienda: event.target.checked })} /><span className="flex flex-col"><span className="text-sm font-medium">Mostrar en la tienda</span><span className="text-[11px] text-muted">Sale en la web para que la aparten. En el panel la compra sigue en su estado real (En preparación o En camino).</span></span></label>}{form.estado === 'en_transito' && <Field label="Llega aprox. (opcional)"><input type="date" value={form.llega_aprox} onChange={(event) => setForm({ ...form, llega_aprox: event.target.value })} title="La tienda le dice al cliente cuándo llega (sin fecha: compra + 15 a 25 días)" /></Field>}<Field label="Transportista (opcional)"><input value={form.transportista} onChange={(event) => setForm({ ...form, transportista: event.target.value })} placeholder="DHL, Everest…" /></Field><Field label="Tracking (opcional)"><input value={form.tracking} onChange={(event) => setForm({ ...form, tracking: event.target.value })} /></Field>
    <label className="form-field col-span-full"><span>Enlace de tracking (opcional)</span><input value={form.url_tracking} onChange={(event) => setForm({ ...form, url_tracking: event.target.value })} /></label>
    <Field label="Método de pago"><input value={form.metodo} onChange={(event) => setForm({ ...form, metodo: event.target.value })} /></Field><Field label="Notas"><input value={form.notas} onChange={(event) => setForm({ ...form, notas: event.target.value })} /></Field>
    <label className="form-field col-span-full"><span>Foto del producto</span><span className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-line p-4 text-sm text-muted">{previewSrc ? <img src={previewSrc} alt="" className="size-10 shrink-0 rounded-lg object-cover" /> : <ImagePlus size={20} className="text-accent" />}{file ? file.name : usaCatalogo ? 'Foto de la web (automática por código) · toca para reemplazar' : item?.imagen ? 'Cambiar foto actual' : 'Escribe el código y saldrá la foto de la web, o selecciónala'}<input className="hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></span></label>
    {!item && <Opciones label="¿Dónde está?" value={form.estado === 'en_transito' && form.preparando ? 'en_preparacion' : form.estado} onChange={(estado) => setForm({ ...form, estado: (estado === 'en_preparacion' ? 'en_transito' : estado) as Inversion['estado'], preparando: estado === 'en_preparacion' })} options={[['en_inventario', 'Ya lo tengo', 'Disponible para vender o entregar'], ['en_preparacion', 'En preparación', 'Pagado, el proveedor lo está preparando'], ['en_transito', 'Viene en camino', 'Ya lo enviaron, todavía no llega']]} />}
    {!item && Number(form.cantidad) > 1 && <label className="col-span-full flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-white/[.02] p-3"><input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-accent" checked={form.porTalla} onChange={(event) => setForm({ ...form, porTalla: event.target.checked })} /><span className="flex flex-col"><span className="text-sm font-medium">Registrar un par por talla (recomendado)</span><span className="text-[11px] text-muted">{(() => { const t = tallasDeTexto(form.talla_color); const n = Number(form.cantidad); return t.length === n ? `Se crean ${n} compras de 1 par: ${t.join(', ')}. Cada una se vende o se aparta por separado.` : t.length > 1 ? `Pusiste ${t.length} tallas para ${n} pares: poné una talla por par, separadas por coma.` : `Se crean ${n} compras de 1 par${t[0] ? ` (talla ${t[0]})` : ''}. Cada una se vende o se aparta por separado.` })()}</span></span></label>}
    {!item && <Opciones label="¿Ya se lo pagaste al proveedor?" value={form.pago} onChange={(pago) => setForm({ ...form, pago: pago as Pago })} options={[['ahora', 'Sí, todo ahora', 'Se descuenta de la cuenta que elijas'], ['parte', 'Pagué una parte', 'Un adelanto ahora; el resto queda por pagar'], ['antes', 'Sí, ya estaba pagado', 'Ya salió de caja; no se descuenta otra vez'], ['pendiente', 'Todavía no', 'Queda "por pagar"; lo pagás después desde la tarjeta']]} />}
    {!item && form.pago === 'parte' && <Field label="¿Cuánto le adelantaste? (US$)"><input type="number" min="0" step=".01" value={form.adelanto} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setForm({ ...form, adelanto: event.target.value })} placeholder="Ej: 150" /></Field>}
    {!item && (form.pago === 'ahora' || form.pago === 'parte') && <CuentaSelect proposito="comprar" montoUsd={form.pago === 'parte' ? (Number(form.adelanto) || 0) : total} tipoCambio={tipoCambio} value={destino} onChange={setDestino} modo="resta" />}
    <div className="col-span-full rounded-xl border border-accent/20 bg-accent/[.05] p-4 text-sm">{item ? 'Se actualizará esta compra sin registrar un pago nuevo.' : <>Compra de <strong className="text-accent">USD {total.toFixed(2)}</strong>{form.pago === 'ahora' ? ': se descontará de Mi cuenta.' : form.pago === 'antes' ? ': no se descuenta otra vez de Mi cuenta.' : form.pago === 'parte' ? <>: ahora salen <strong className="text-accent">USD {(Number(form.adelanto) || 0).toFixed(2)}</strong> de adelanto y quedan <strong className="text-accent">USD {Math.max(0, total - (Number(form.adelanto) || 0)).toFixed(2)}</strong> por pagar.{form.porTalla && Number(form.cantidad) > 1 && Number(form.costo_unitario) > 0 ? ` El adelanto cubre ${Math.floor((Number(form.adelanto) || 0) / (Number(form.costo_unitario) + (Number(form.gastos_adicionales) || 0) / Number(form.cantidad)))} par(es) completos; el resto queda por pagar.` : ''}</> : ': queda por pagar al proveedor (no sale de caja todavía).'}</>}</div>
    <div className="col-span-full flex justify-end gap-2"><button type="button" className="subtle-button" onClick={onClose}>Cancelar</button><button className="primary-button px-5" disabled={saving}>{saving ? 'Guardando…' : item ? 'Guardar cambios' : 'Registrar compra'}</button></div>
  </form></Modal>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="form-field"><span>{label}</span>{children}</label> }
function Metric({ icon: Icon, label, value, hint, accent, warn, onClick }: { icon: typeof Boxes; label: string; value: string; hint?: string; accent?: boolean; warn?: boolean; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'article'
  return <Tag type={onClick ? 'button' : undefined} onClick={onClick} className={`metric-card min-w-0 text-left ${onClick ? 'cursor-pointer hover:border-amber-300/40' : ''} ${warn ? 'border-amber-300/25!' : ''}`}>
    <div className="flex items-center justify-between gap-2"><p className="truncate text-[11px] font-medium text-muted">{label}</p><Icon size={16} className={warn ? 'shrink-0 text-amber-200' : 'shrink-0 text-accent'} /></div>
    <strong className={`mt-2 block truncate text-xl tabular-nums sm:text-2xl ${accent ? 'text-accent' : warn ? 'text-amber-200' : ''}`}>{value}</strong>
    {hint && <p className="mt-1 truncate text-[11px] text-muted">{hint}</p>}
  </Tag>
}
// Grupo de opciones tipo tarjeta (una sola elegida): [valor, título, ayuda].
function Opciones({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: [string, string, string][] }) {
  return <fieldset className="col-span-full"><legend className="mb-2 text-xs font-semibold text-muted">{label}</legend><div className={`grid gap-2 ${options.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>{options.map(([valor, titulo, ayuda]) => <label key={valor} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition ${value === valor ? 'border-accent/50 bg-accent/[.07]' : 'border-line hover:border-white/25'}`}><input type="radio" className="mt-0.5 size-4 accent-accent" checked={value === valor} onChange={() => onChange(valor)} /><span><strong className="block">{titulo}</strong><small className="mt-0.5 block text-muted">{ayuda}</small></span></label>)}</div></fieldset>
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
    <section className="relative w-full max-w-[400px] overflow-y-auto rounded-[26px] border border-white/15 bg-[#080a08] shadow-2xl" style={{ maxHeight: 'calc(100dvh - 32px)' }}>
      <header className="flex items-center justify-between border-b border-white/10 px-5 py-4"><div><strong className="block text-lg font-black tracking-[.24em] text-white">HAUSLINE</strong><span className="block text-[9px] font-bold tracking-[.42em] text-accent">NICARAGUA</span></div><span className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-accent">Entrega inmediata</span></header>
      <div className="relative mx-auto aspect-square w-full overflow-hidden bg-white" style={{ maxHeight: 'min(400px, 42dvh)', maxWidth: 'min(400px, 42dvh)' }}>{item.imagen ? <ProductoImg src={resolverImagenCatalogo(item.imagen)} alt={item.producto} className="size-full" /> : <div className="grid size-full place-items-center bg-[#111511] text-muted"><PackageCheck size={58} /><span className="sr-only">Sin foto</span></div>}</div>
      <div className="p-5"><p className="text-[11px] font-bold uppercase tracking-[.2em] text-accent">{item.codigo || 'Disponible'}</p><h2 className="mt-1.5 text-2xl font-black leading-tight text-white">{item.producto}</h2>{item.marca && <p className="mt-2 text-sm uppercase tracking-wider text-white/55">{item.marca}</p>}
        <div className="mt-6 grid grid-cols-2 gap-3"><div className="rounded-2xl border border-white/10 bg-white/[.035] p-4"><span className="text-[10px] font-bold uppercase tracking-wider text-white/45">Talla / color</span><strong className="mt-2 block text-xl text-white">{item.talla_color || 'Consultar'}</strong></div><div className="rounded-2xl border border-white/10 bg-white/[.035] p-4"><span className="text-[10px] font-bold uppercase tracking-wider text-white/45">Disponibles</span><strong className="mt-2 block text-xl text-white">{item.cantidad}</strong></div></div>
        <div className="mt-4 flex items-end justify-between rounded-2xl border border-accent/30 bg-accent/[.08] p-5"><div><span className="text-[10px] font-bold uppercase tracking-wider text-white/50">Precio</span><strong className="mt-1 block text-3xl font-black text-accent">USD {Number(item.precio_venta_estimado).toFixed(2)}</strong></div><span className="pb-1 text-xs font-semibold text-white/55">Disponible ahora</span></div>
        <p className="mt-5 text-center text-[10px] uppercase tracking-[.18em] text-white/35">Sneakers · Ropa · Accesorios</p>
        <button type="button" className="subtle-button mt-5 min-h-12 w-full justify-center" onClick={onClose}><X size={17} /> Cerrar vista previa</button>
      </div>
    </section>
  </div>
}

type ProductoEI = { codigo: string; nombre: string; marca: string | null; imagen: string | null; precio_venta: number; precio_entrega_inmediata: number; tallas_entrega_inmediata: string[]; colores_entrega_inmediata: string[]; cantidad_disponible: number; entrega_inmediata: boolean; en_camino?: boolean; tallas_en_camino?: string[]; colores?: string[] }

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
