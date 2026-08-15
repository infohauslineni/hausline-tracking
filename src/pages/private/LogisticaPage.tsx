import { zodResolver } from '@hookform/resolvers/zod'
import { CheckCircle2, ChevronDown, ChevronUp, Edit3, ExternalLink, Package, Plus, Search, Trash2, Truck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { Modal } from '../../components/ui/Modal'
import { DEMO_PEDIDOS } from '../../data/demo'
import { DEMO_TRANSPORTISTAS, DEMO_TRAYECTOS } from '../../data/demoLogistics'
import { isSupabaseConfigured } from '../../lib/supabase'
import { actualizarInversion, listarInversiones } from '../../services/comercial.service'
import { eliminarTrayecto, guardarTrayecto, listarTransportistas, listarTrayectos, marcarTrayectoEntregado, reabrirTrayecto, type TrayectoInput } from '../../services/logistica.service'
import { listarPedidos } from '../../services/pedidos.service'
import type { Inversion, Pedido, Transportista, Trayecto } from '../../types/domain'
import { construirUrlTransportista, consultarEnEverest, consultarEnUsps } from '../../utils/externalTracking'

const trackingSchema = z.object({
  destino_tipo: z.enum(['pedido', 'stock']),
  destino_id: z.string().uuid('Selecciona un pedido o producto de stock.'),
  transportista_id: z.string(),
  tracking: z.string().trim().min(1, 'Ingresa el número de tracking.'),
})
type TrackingForm = z.infer<typeof trackingSchema>
type EditingTarget = { kind: 'pedido'; value: Trayecto } | { kind: 'stock'; value: Inversion } | null

export function LogisticaPage() {
  const [trayectos, setTrayectos] = useState<Trayecto[]>(isSupabaseConfigured ? [] : DEMO_TRAYECTOS)
  const [stock, setStock] = useState<Inversion[]>([])
  const [pedidos, setPedidos] = useState<Pedido[]>(isSupabaseConfigured ? [] : DEMO_PEDIDOS)
  const [transportistas, setTransportistas] = useState<Transportista[]>(isSupabaseConfigured ? [] : DEMO_TRANSPORTISTAS)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<EditingTarget>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [mostrarEntregados, setMostrarEntregados] = useState(false)

  useEffect(() => {
    if (!isSupabaseConfigured) return
    void Promise.all([listarTrayectos(), listarPedidos(setPedidos), listarTransportistas(), listarInversiones(setStock)])
      .then(([routes, orders, carriers, inventory]) => { setTrayectos(routes); setPedidos(orders); setTransportistas(carriers); setStock(inventory) })
      .catch(() => toast.error('No se pudo cargar la información logística.'))
  }, [])

  const filteredRoutes = useMemo(() => {
    const term = search.toLowerCase().trim()
    return trayectos.filter((route) => [route.tracking, route.pedidos?.codigo, route.pedidos?.clientes?.nombre, route.transportistas?.nombre].some((value) => value?.toLowerCase().includes(term))).sort((a, b) => Number(a.estado === 'entregado') - Number(b.estado === 'entregado') || b.updated_at.localeCompare(a.updated_at))
  }, [search, trayectos])

  const filteredStock = useMemo(() => {
    const term = search.toLowerCase().trim()
    return stock.filter((item) => item.tracking && item.estado !== 'descartado' && [item.tracking, item.codigo, item.producto, item.transportista].some((value) => value?.toLowerCase().includes(term))).sort((a, b) => Number(a.estado_tracking === 'Entregado') - Number(b.estado_tracking === 'Entregado') || b.created_at.localeCompare(a.created_at))
  }, [search, stock])

  const stockConTracking = stock.filter((item) => item.tracking && item.estado !== 'descartado')
  const activos = trayectos.filter((item) => item.activo).length + stockConTracking.filter((item) => item.estado_tracking !== 'Entregado').length
  const entregados = trayectos.filter((item) => item.estado === 'entregado').length + stockConTracking.filter((item) => item.estado_tracking === 'Entregado').length
  const activeRoutes = filteredRoutes.filter((item) => item.estado !== 'entregado')
  const deliveredRoutes = filteredRoutes.filter((item) => item.estado === 'entregado')
  const activeStock = filteredStock.filter((item) => item.estado_tracking !== 'Entregado')
  const deliveredStock = filteredStock.filter((item) => item.estado_tracking === 'Entregado')

  const saveRoute = (saved: Trayecto) => { setTrayectos((current) => editing?.kind === 'pedido' ? current.map((item) => item.id === saved.id ? { ...item, ...saved } : item) : [saved, ...current]); setModalOpen(false); setEditing(null) }
  const saveStock = (saved: Inversion) => { setStock((current) => current.map((item) => item.id === saved.id ? { ...item, ...saved } : item)); setModalOpen(false); setEditing(null) }
  const removeRoute = async (route: Trayecto) => { if (!window.confirm(`¿Eliminar el tracking ${route.tracking || 'sin número'}?`)) return; try { if (isSupabaseConfigured) await eliminarTrayecto(route.id); setTrayectos((current) => current.filter((item) => item.id !== route.id)); toast.success('Tracking eliminado.') } catch { toast.error('No se pudo eliminar el tracking.') } }
  const removeStockTracking = async (item: Inversion) => { if (!window.confirm(`¿Quitar el tracking de ${item.producto}?`)) return; try { const saved = isSupabaseConfigured ? await actualizarInversion(item.id, { tracking: null, transportista: null, url_tracking: null, estado_tracking: null }) : { ...item, tracking: null, transportista: null, url_tracking: null, estado_tracking: null }; setStock((all) => all.map((current) => current.id === item.id ? saved : current)); toast.success('Tracking quitado del producto de stock.') } catch { toast.error('No se pudo quitar el tracking.') } }
  const deliverRoute = async (route: Trayecto) => { if (!window.confirm('¿Confirmas que este paquete ya fue recibido en Nicaragua?')) return; try { if (isSupabaseConfigured) await marcarTrayectoEntregado(route.id); setTrayectos((current) => current.map((item) => item.id === route.id ? { ...item, estado: 'entregado', activo: false, fecha_entrega: new Date().toISOString(), updated_at: new Date().toISOString() } : item)); toast.success('Marcado como entregado y movido al apartado inferior.') } catch { toast.error('No se pudo actualizar el tracking.') } }
  const deliverStock = async (item: Inversion) => { if (!window.confirm('¿Confirmas que este producto ya fue recibido en Nicaragua?')) return; try { const saved = isSupabaseConfigured ? await actualizarInversion(item.id, { estado_tracking: 'Entregado' }) : { ...item, estado_tracking: 'Entregado' }; setStock((all) => all.map((current) => current.id === item.id ? saved : current)); toast.success('Marcado como recibido y movido al apartado inferior.') } catch { toast.error('No se pudo actualizar el tracking.') } }
  const reopenRoute = async (route: Trayecto) => { if (!window.confirm('¿Deshacer “Entregado” y devolver este tracking a los activos?')) return; try { if (isSupabaseConfigured) await reabrirTrayecto(route.id); setTrayectos((current) => current.map((item) => item.id === route.id ? { ...item, estado: 'en_transito', activo: true, fecha_entrega: null, updated_at: new Date().toISOString() } : item)); toast.success('El tracking volvió a activos.') } catch { toast.error('No se pudo corregir el tracking.') } }
  const reopenStock = async (item: Inversion) => { if (!window.confirm('¿Deshacer “Entregado” y devolver este tracking a los activos?')) return; try { const saved = isSupabaseConfigured ? await actualizarInversion(item.id, { estado_tracking: 'En tránsito' }) : { ...item, estado_tracking: 'En tránsito' }; setStock((all) => all.map((current) => current.id === item.id ? saved : current)); toast.success('El tracking volvió a activos.') } catch { toast.error('No se pudo corregir el tracking.') } }

  return <div>
    {!isSupabaseConfigured && <div className="preview-banner"><strong>Vista previa local:</strong> datos de demostración.</div>}
    <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Cadena de suministro</p><h1 className="page-title">Logística</h1><p className="page-subtitle">Asocia cada tracking a un pedido o a un producto de stock.</p></div><button className="primary-button px-5" onClick={() => { setEditing(null); setModalOpen(true) }}><Plus size={18} /> Agregar tracking</button></div>
    <section className="mt-7 max-w-sm"><Metric label="Trackings activos" value={activos} /></section>
    <div className="mt-6"><div className="relative max-w-lg"><Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} className="search-input" placeholder="Pedido, stock, tracking o paquetería" /></div></div>
    <h2 className="mt-6 text-sm font-semibold text-accent">Trackings activos</h2>
    <div className="mt-3 grid gap-4 xl:grid-cols-2">
      {activeRoutes.map((route) => <RouteCard key={route.id} route={route} onEdit={() => { setEditing({ kind: 'pedido', value: route }); setModalOpen(true) }} onDelete={() => void removeRoute(route)} onDelivered={() => void deliverRoute(route)} onReopen={() => void reopenRoute(route)} />)}
      {activeStock.map((item) => <StockRouteCard key={`stock-${item.id}`} item={item} carriers={transportistas} onEdit={() => { setEditing({ kind: 'stock', value: item }); setModalOpen(true) }} onDelete={() => void removeStockTracking(item)} onDelivered={() => void deliverStock(item)} onReopen={() => void reopenStock(item)} />)}
    </div>
    {entregados > 0 && (() => { const expandido = mostrarEntregados || Boolean(search.trim()); return <><button type="button" onClick={() => setMostrarEntregados((value) => !value)} className="mt-10 flex w-full items-center gap-2 rounded-xl border border-line bg-white/[0.02] px-4 py-3 text-sm font-semibold text-emerald-300 transition hover:border-emerald-300/30 hover:bg-emerald-300/[0.04]"><CheckCircle2 size={17} /> Trackings entregados ({entregados}) <span className="ml-auto flex items-center gap-1.5 text-xs font-medium text-muted">{expandido ? 'Ocultar' : 'Ver'} {expandido ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span></button>{expandido && <div className="mt-3 grid gap-4 xl:grid-cols-2">{deliveredRoutes.map((route) => <RouteCard key={route.id} route={route} onEdit={() => { setEditing({ kind: 'pedido', value: route }); setModalOpen(true) }} onDelete={() => void removeRoute(route)} onDelivered={() => void deliverRoute(route)} onReopen={() => void reopenRoute(route)} />)}{deliveredStock.map((item) => <StockRouteCard key={`stock-${item.id}`} item={item} carriers={transportistas} onEdit={() => { setEditing({ kind: 'stock', value: item }); setModalOpen(true) }} onDelete={() => void removeStockTracking(item)} onDelivered={() => void deliverStock(item)} onReopen={() => void reopenStock(item)} />)}</div>}</> })()}
    {filteredRoutes.length + filteredStock.length === 0 && <div className="mt-6 grid min-h-64 place-items-center rounded-2xl border border-dashed border-line text-center"><div><Truck className="mx-auto text-muted" /><h2 className="mt-3 font-semibold">No hay trackings</h2><p className="mt-1 text-sm text-muted">Agrega el tracking de un pedido o producto de stock.</p></div></div>}
    <TrackingModal open={modalOpen} editing={editing} pedidos={pedidos} stock={stock} carriers={transportistas} onClose={() => { setModalOpen(false); setEditing(null) }} onRouteSaved={saveRoute} onStockSaved={saveStock} />
  </div>
}

function TrackingButtons({ tracking, carrierName, carrierUrl }: { tracking: string; carrierName: string; carrierUrl?: string | null }) {
  const normalized = carrierName.toLowerCase()
  const standardUrl = construirUrlTransportista(carrierUrl ?? null, tracking)
  const openEverest = () => { try { consultarEnEverest(tracking) } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo abrir Everest.') } }
  const openUsps = () => { try { consultarEnUsps(tracking) } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo abrir USPS.') } }
  return <><button className="subtle-button text-[#d8ff78]" onClick={openEverest}><ExternalLink size={15} /> Everest</button>{normalized.includes('usps') ? <button className="subtle-button text-[#9ed0ff]" onClick={openUsps}><ExternalLink size={15} /> USPS</button> : !normalized.includes('everest') && standardUrl && <a className="subtle-button text-[#9ed0ff]" href={standardUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} /> {carrierName}</a>}</>
}

function RouteCard({ route, onEdit, onDelete, onDelivered, onReopen }: { route: Trayecto; onEdit: () => void; onDelete: () => void; onDelivered: () => void; onReopen: () => void }) {
  const carrierName = route.transportistas?.nombre ?? 'Sin paquetería'
  return <article className={`rounded-2xl border bg-panel p-4 sm:p-5 ${route.estado === 'entregado' ? 'border-emerald-300/20' : 'border-line'}`}><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><strong className="tracking-wide">{route.pedidos?.codigo}</strong>{route.estado === 'entregado' && <span className="status-badge status-success">Entregado</span>}</div><p className="mt-1 text-xs">Pedido · <span className="font-semibold text-sky-300">{route.pedidos?.clientes?.nombre}</span></p></div><CardActions onEdit={onEdit} onDelete={onDelete} /></div><TrackingBox tracking={route.tracking ?? ''} carrier={carrierName} /><div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4"><TrackingButtons tracking={route.tracking ?? ''} carrierName={carrierName} carrierUrl={route.transportistas?.url_tracking ?? route.url_tracking} />{route.estado !== 'entregado' ? <DeliveredButton onClick={onDelivered} label="Entregado" /> : <button className="subtle-button ml-auto text-amber-200" onClick={onReopen}>Corregir entrega</button>}</div></article>
}

function StockRouteCard({ item, carriers, onEdit, onDelete, onDelivered, onReopen }: { item: Inversion; carriers: Transportista[]; onEdit: () => void; onDelete: () => void; onDelivered: () => void; onReopen: () => void }) {
  const delivered = item.estado_tracking === 'Entregado'
  const carrier = carriers.find((value) => value.nombre === item.transportista || value.codigo?.toLowerCase() === item.transportista?.toLowerCase())
  const carrierName = item.transportista || 'Sin paquetería'
  return <article className={`rounded-2xl border bg-panel p-4 sm:p-5 ${delivered ? 'border-emerald-300/20' : 'border-accent/20'}`}><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><strong className="tracking-wide">{item.codigo || 'STOCK'}</strong>{delivered && <span className="status-badge status-success">Entregado</span>}</div><p className="mt-1 text-xs text-muted">Stock inmediato · {item.producto} · {item.talla_color || 'Sin talla'}</p></div><CardActions onEdit={onEdit} onDelete={onDelete} /></div><TrackingBox tracking={item.tracking ?? ''} carrier={carrierName} stock /><div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4"><TrackingButtons tracking={item.tracking ?? ''} carrierName={carrierName} carrierUrl={item.url_tracking ?? carrier?.url_tracking} />{!delivered ? <DeliveredButton onClick={onDelivered} label="Recibido" /> : <button className="subtle-button ml-auto text-amber-200" onClick={onReopen}>Corregir entrega</button>}</div></article>
}

function TrackingModal({ open, editing, pedidos, stock, carriers, onClose, onRouteSaved, onStockSaved }: { open: boolean; editing: EditingTarget; pedidos: Pedido[]; stock: Inversion[]; carriers: Transportista[]; onClose: () => void; onRouteSaved: (value: Trayecto) => void; onStockSaved: (value: Inversion) => void }) {
  const { register, handleSubmit, reset, watch, formState: { errors, isSubmitting } } = useForm<TrackingForm>({ resolver: zodResolver(trackingSchema), defaultValues: { destino_tipo: 'pedido', destino_id: '', transportista_id: '', tracking: '' } })
  const targetType = watch('destino_tipo')
  useEffect(() => {
    const everest = carriers.find((item) => item.codigo === 'EVEREST')
    if (editing?.kind === 'pedido') reset({ destino_tipo: 'pedido', destino_id: editing.value.pedido_id, transportista_id: editing.value.transportista_id ?? '', tracking: editing.value.tracking ?? '' })
    else if (editing?.kind === 'stock') { const carrier = carriers.find((item) => item.nombre === editing.value.transportista || item.codigo === editing.value.transportista); reset({ destino_tipo: 'stock', destino_id: editing.value.id, transportista_id: carrier?.id ?? '', tracking: editing.value.tracking ?? '' }) }
    else reset({ destino_tipo: 'pedido', destino_id: '', transportista_id: everest?.id ?? '', tracking: '' })
  }, [carriers, editing, open, reset])

  const submit = async (values: TrackingForm) => {
    const carrier = carriers.find((item) => item.id === values.transportista_id) ?? null
    try {
      if (values.destino_tipo === 'stock') {
        const item = stock.find((value) => value.id === values.destino_id)
        if (!item) throw new Error('Selecciona un producto de stock.')
        const changes = { tracking: values.tracking.trim(), transportista: carrier?.nombre ?? null, url_tracking: carrier?.url_tracking ?? null, estado_tracking: item.estado_tracking === 'Entregado' ? 'Entregado' : 'Etiqueta creada' }
        const saved = isSupabaseConfigured ? await actualizarInversion(item.id, changes) : { ...item, ...changes }
        onStockSaved(saved)
        toast.success(editing ? 'Tracking de stock actualizado.' : 'Tracking asociado al producto de stock.')
        return
      }
      const order = pedidos.find((item) => item.id === values.destino_id)
      if (!order) throw new Error('Selecciona un pedido.')
      const existing = editing?.kind === 'pedido' ? editing.value : null
      const input: TrayectoInput = { pedido_id: order.id, transportista_id: carrier?.id ?? null, tipo_trayecto: 'China → Nicaragua vía Estados Unidos', pais_origen: 'China', pais_destino: 'Nicaragua', tracking: values.tracking.trim(), url_tracking: carrier?.url_tracking ?? null, estado: existing?.estado ?? 'etiqueta_creada', ultima_ubicacion: existing?.ultima_ubicacion ?? null, ultimo_evento: existing?.ultimo_evento ?? 'Etiqueta creada por el proveedor', fecha_envio: existing?.fecha_envio ?? null, fecha_estimada: existing?.fecha_estimada ?? null, peso: existing?.peso ?? null, costo_envio: existing?.costo_envio ?? null, numero_paquete: existing?.numero_paquete ?? 'Caja', notas_internas: existing?.notas_internas ?? null, visible_cliente: existing?.visible_cliente ?? true, orden: existing?.orden ?? 1 }
      const saved = isSupabaseConfigured ? await guardarTrayecto(input, existing?.id) : { ...input, id: existing?.id ?? crypto.randomUUID(), fecha_entrega: null, activo: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), pedidos: { codigo: order.codigo, estado: order.estado, clientes: order.clientes ? { nombre: order.clientes.nombre } : null }, transportistas: carrier, tracking_eventos: [] }
      onRouteSaved(saved)
      toast.success(existing ? 'Tracking actualizado.' : 'Tracking agregado al pedido.')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo guardar el tracking.') }
  }

  return <Modal open={open} onClose={onClose} title={editing ? 'Editar tracking' : 'Agregar tracking'} description="Asócialo a un pedido de cliente o a un producto comprado para inventario."><form onSubmit={handleSubmit(submit)} className="form-grid">
    <Field label="¿A qué pertenece?"><select {...register('destino_tipo')} disabled={Boolean(editing)}><option value="pedido">Pedido de cliente</option><option value="stock">Producto de stock / inventario</option></select></Field>
    <Field label={targetType === 'stock' ? 'Producto de stock' : 'Pedido'} error={errors.destino_id?.message}><select {...register('destino_id')} disabled={Boolean(editing)}><option value="">Selecciona</option>{targetType === 'stock' ? stock.filter((item) => item.estado !== 'descartado' && (!item.tracking || editing?.kind === 'stock' && editing.value.id === item.id)).map((item) => <option key={item.id} value={item.id}>{item.codigo || 'SIN CÓDIGO'} · {item.producto} · {item.talla_color || 'Sin talla'}</option>) : pedidos.filter((item) => item.estado !== 'entregado' && item.estado !== 'cancelado').map((item) => <option key={item.id} value={item.id}>{item.codigo} · {item.clientes?.nombre}</option>)}</select></Field>
    <Field label="Paquetería"><select {...register('transportista_id')}><option value="">Sin paquetería</option>{carriers.map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}</select></Field>
    <Field label="Número de tracking" error={errors.tracking?.message}><input placeholder="Tracking enviado por el proveedor" {...register('tracking')} /></Field>
    <div className="col-span-full flex justify-end gap-2"><button type="button" className="subtle-button px-4" onClick={onClose}>Cancelar</button><button className="primary-button px-5" disabled={isSubmitting}>{isSubmitting ? 'Guardando…' : 'Guardar tracking'}</button></div>
  </form></Modal>
}

function TrackingBox({ tracking, carrier, stock = false }: { tracking: string; carrier: string; stock?: boolean }) { return <div className="mt-5 flex items-center gap-3 rounded-xl border border-line bg-black/15 p-3"><span className="grid size-10 shrink-0 place-items-center rounded-lg bg-white/[0.04] text-muted">{stock ? <Package size={19} /> : <Truck size={19} />}</span><div className="min-w-0 flex-1"><strong className="block truncate text-sm">{tracking}</strong><p className="mt-1 truncate text-xs text-muted">{carrier}</p></div></div> }
function CardActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) { return <div className="flex"><button className="table-action" onClick={onEdit} aria-label="Editar tracking"><Edit3 size={16} /></button><button className="table-action hover:text-red-300" onClick={onDelete} aria-label="Eliminar tracking"><Trash2 size={16} /></button></div> }
function DeliveredButton({ onClick, label }: { onClick: () => void; label: string }) { return <button className="subtle-button ml-auto text-[#62eaa0]" onClick={onClick}><CheckCircle2 size={15} /> {label}</button> }
function Metric({ label, value, danger }: { label: string; value: number; danger?: boolean }) { return <div className="metric-card"><strong className={`text-2xl ${danger && value ? 'text-red-300' : ''}`}>{value}</strong><p className="mt-1 text-xs text-muted">{label}</p></div> }
function Field({ label, children, error }: { label: string; children: React.ReactNode; error?: string }) { return <label className="form-field"><span>{label}</span>{children}{error && <small>{error}</small>}</label> }
