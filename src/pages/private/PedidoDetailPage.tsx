import { ArrowLeft, CalendarDays, Check, CheckCircle2, Clipboard, MessageCircle, Package, Pencil, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { PedidoArchivos } from '../../components/pedidos/PedidoArchivos'
import { EditarPedidoModal } from '../../components/pedidos/EditarPedidoModal'
import { FacturaModal } from '../../components/pedidos/FacturaModal'
import { PedidoLogistica } from '../../components/pedidos/PedidoLogistica'
import { Modal } from '../../components/ui/Modal'
import { ESTADOS_PEDIDO, estadoLabel, mensajeWhatsAppEstado } from '../../constants/orders'
import { DEMO_PEDIDOS } from '../../data/demo'
import { isSupabaseConfigured } from '../../lib/supabase'
import { actualizarEstadoPedido, actualizarPedidoCompleto, entregarPedidoConPago, obtenerPedido } from '../../services/pedidos.service'
import type { FacturaData } from '../../services/factura.service'
import { obtenerTipoCambio } from '../../services/comercial.service'
import type { EstadoPedido, Pedido } from '../../types/domain'
import { costoRealPedido } from '../../utils/pedidoCosto'
import { whatsappUrl } from '../../utils/whatsapp'
import { Status } from './PedidosPage'

export function PedidoDetailPage() {
  const { id = '' } = useParams()
  const [pedido, setPedido] = useState<Pedido | null>(DEMO_PEDIDOS.find((item) => item.id === id) ?? DEMO_PEDIDOS[0])
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [estadoSeleccionado, setEstadoSeleccionado] = useState<EstadoPedido>(pedido?.estado ?? 'pedido_confirmado')
  const [savingStatus, setSavingStatus] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [paymentAmount, setPaymentAmount] = useState(0)
  const [paymentMethod, setPaymentMethod] = useState('Transferencia')
  const [factura, setFactura] = useState<FacturaData | null>(null)
  const [qualityPhotosReady, setQualityPhotosReady] = useState(false)
  const [tipoCambio, setTipoCambio] = useState(37)
  useEffect(() => { if (isSupabaseConfigured) void obtenerPedido(id).then(setPedido).catch(() => toast.error('No se pudo cargar el pedido.')).finally(() => setLoading(false)) }, [id])
  useEffect(() => { if (isSupabaseConfigured) void obtenerTipoCambio().then(setTipoCambio).catch(() => undefined) }, [])
  useEffect(() => { if (pedido) setEstadoSeleccionado(pedido.estado) }, [pedido])
  if (loading) return <div className="h-96 animate-pulse rounded-2xl border border-line bg-panel" />
  if (!pedido) return <div className="grid min-h-96 place-items-center text-muted">Pedido no encontrado.</div>
  const copy = async (text: string, message: string) => { await navigator.clipboard.writeText(text); toast.success(message) }
  const updateStatus = async () => {
    if (estadoSeleccionado === pedido.estado) return toast.info('Selecciona una etapa diferente.')
    if (estadoSeleccionado === 'entregado') { setPaymentAmount(Math.max(0, Number(pedido.saldo))); setPaymentOpen(true); return }
    setSavingStatus(true)
    try {
      const updated = isSupabaseConfigured ? await actualizarEstadoPedido(pedido.id, estadoSeleccionado) : { ...pedido, estado: estadoSeleccionado, updated_at: new Date().toISOString() }
      setPedido((current) => current ? { ...current, ...updated } : updated)
      toast.success(estadoSeleccionado === 'disponible_entrega' ? 'Pedido disponible. El mensaje de WhatsApp está listo.' : estadoSeleccionado === 'control_calidad' && qualityPhotosReady ? 'Control de calidad actualizado. El mensaje de WhatsApp está listo.' : 'Etapa del pedido actualizada.')
    } catch { toast.error('No se pudo actualizar la etapa.') }
    finally { setSavingStatus(false) }
  }
  const confirmarEntrega = async () => {
    setSavingStatus(true)
    try {
      await entregarPedidoConPago(pedido.id, paymentAmount, paymentMethod)
      const refreshed = await obtenerPedido(pedido.id)
      setPedido(refreshed)
      setEstadoSeleccionado('entregado')
      setPaymentOpen(false)
      toast.success('Pedido entregado y pago registrado.')
      setFactura({
        codigo: refreshed.codigo,
        cliente: refreshed.clientes?.nombre ?? 'Cliente',
        whatsapp: refreshed.clientes?.whatsapp ?? null,
        fecha: new Date().toISOString().slice(0, 10),
        items: (refreshed.pedido_items ?? []).map((item) => ({ producto: item.producto, detalle: [item.marca, item.talla].filter(Boolean).join(' · ') || undefined, cantidad: Number(item.cantidad || 1), precio: Number(item.precio_unitario || 0) })),
        total: Number(refreshed.total || 0),
        abono: Number(refreshed.abono || 0),
        saldo: Number(refreshed.saldo || 0),
        variante: 'pago',
        metodoPago: paymentMethod || null,
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo completar la entrega.')
    } finally { setSavingStatus(false) }
  }
  const publicUrl = `${import.meta.env.VITE_PUBLIC_APP_URL ?? window.location.origin}/tracking/${pedido.codigo}`
  const qualityMessageReady = pedido.estado === 'control_calidad' && qualityPhotosReady
  const whatsappMessage = mensajeWhatsAppEstado(pedido.estado, { nombre: pedido.clientes?.nombre, codigo: pedido.codigo, url: publicUrl, saldo: Number(pedido.saldo), fotosCalidad: qualityMessageReady, tipoCambio })
  const costoReal = costoRealPedido(pedido)
  return <div>
    <Link to="/pedidos" className="mb-5 inline-flex items-center gap-2 text-xs text-muted hover:text-white"><ArrowLeft size={16} /> Volver a pedidos</Link>
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
      <div><div className="flex flex-wrap items-center gap-3"><h1 className="text-3xl font-semibold tracking-tight">{pedido.codigo}</h1><Status estado={pedido.estado} /></div><p className="mt-2 text-sm text-muted">Creado el {new Intl.DateTimeFormat('es-NI', { dateStyle: 'long' }).format(new Date(pedido.fecha_pedido + 'T12:00:00'))}</p></div>
      <div className="flex flex-wrap gap-2"><button className="subtle-button" onClick={() => void copy(pedido.codigo, 'Código copiado.')}><Clipboard size={16} /> Copiar código</button><button className="subtle-button" onClick={() => void copy(publicUrl, 'Enlace público copiado.')}><Check size={16} /> Copiar enlace</button>{pedido.clientes?.whatsapp && <a className="primary-button px-4" href={whatsappUrl(pedido.clientes.whatsapp, whatsappMessage)} target="_blank" rel="noreferrer"><MessageCircle size={17} /> {pedido.estado === 'disponible_entrega' ? 'Avisar disponibilidad' : qualityMessageReady ? 'Avisar control de calidad' : 'WhatsApp'}</a>}</div>
    </div>
    <div className="mt-7 grid gap-5 xl:grid-cols-[1.5fr_.75fr]">
      <div className="space-y-5">
        <section className="form-section"><div><h2 className="flex items-center gap-2 font-semibold"><CheckCircle2 size={18} className="text-accent" /> Actualizar etapa</h2><p className="mt-2 text-xs leading-5 text-muted">Toca una etapa para seleccionarla y confirma el cambio. Las etapas de transporte también pueden avanzar desde Logística.</p></div>
          <EtapaTracker actual={pedido.estado} seleccionado={estadoSeleccionado} onSelect={setEstadoSeleccionado} />
          <div className="mt-5 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted">{estadoSeleccionado === pedido.estado ? 'Selecciona una etapa diferente para actualizar.' : <>Cambiarás de <strong className="text-white">{estadoLabel(pedido.estado)}</strong> a <strong className="text-accent">{estadoLabel(estadoSeleccionado)}</strong>.</>}</p>
            <button className="primary-button px-5" onClick={() => void updateStatus()} disabled={savingStatus || estadoSeleccionado === pedido.estado}>{savingStatus ? 'Guardando…' : estadoSeleccionado === 'entregado' ? 'Confirmar entrega' : 'Confirmar etapa'}</button>
          </div>
        </section>
        <section className="form-section"><div className="flex items-center justify-between"><h2 className="flex items-center gap-2 font-semibold"><Package size={18} className="text-accent" /> Productos</h2><button className="table-action" aria-label="Editar pedido" onClick={() => setEditOpen(true)}><Pencil size={16} /></button></div><div className="mt-4 divide-y divide-line">{pedido.pedido_items?.map((item, index) => <div className="flex items-center gap-3 py-4" key={`${item.producto}-${index}`}>{item.imagen ? <span className="relative size-11 shrink-0 overflow-hidden rounded-xl bg-white/[0.04]"><img src={item.imagen} alt={item.producto} className="size-full object-cover" /><span className="absolute bottom-0 right-0 rounded-tl-md bg-app/85 px-1 text-[10px] font-semibold text-white">{item.cantidad}×</span></span> : <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white/[0.04] text-sm font-semibold text-muted">{item.cantidad}×</span>}<div className="min-w-0 flex-1"><strong className="block truncate text-sm">{item.producto}</strong><span className="text-xs text-muted">{[item.marca, item.talla, item.color].filter(Boolean).join(' · ')}</span></div><strong className="text-sm">${(item.cantidad * item.precio_unitario).toFixed(2)}</strong></div>)}</div></section>
        <PedidoArchivos pedidoId={pedido.id} codigo={pedido.codigo} onQualityReady={setQualityPhotosReady} />
        <PedidoLogistica pedidoId={pedido.id} />
        <section className="form-section"><h2 className="flex items-center gap-2 font-semibold"><CalendarDays size={18} className="text-accent" /> Fechas</h2><div className="mt-5 grid gap-4 sm:grid-cols-3"><Info label="Pedido" value={pedido.fecha_pedido} /><Info label="Llegada estimada" value={pedido.fecha_estimada ?? 'Sin definir'} /><Info label="Actualización" value={new Intl.DateTimeFormat('es-NI').format(new Date(pedido.updated_at))} /></div></section>
      </div>
      <aside className="space-y-5"><section className="form-section"><h2 className="flex items-center gap-2 font-semibold"><UserRound size={18} className="text-accent" /> Cliente</h2><div className="mt-4"><strong>{pedido.clientes?.nombre}</strong><p className="mt-1 text-sm text-muted">{pedido.clientes?.whatsapp}</p></div></section><section className="form-section"><h2 className="font-semibold">Resumen de pago</h2><div className="mt-4 space-y-3 text-sm"><PayRow label="Total" value={pedido.total} /><PayRow label="Abono" value={pedido.abono} /><PayRow label="Costo real" value={costoReal} /><PayRow label="Ganancia estimada" value={pedido.total - costoReal} /><div className="border-t border-line pt-3"><PayRow label="Saldo pendiente" value={pedido.saldo} accent /></div></div></section>{Boolean(pedido.gastos?.length) && <section className="form-section"><h2 className="font-semibold">Gastos asociados</h2><div className="mt-4 space-y-3">{pedido.gastos?.map((gasto) => <div className="flex justify-between gap-3 text-xs" key={gasto.id}><span className="text-muted">{gasto.categoria}</span><strong>${Number(gasto.monto).toFixed(2)}</strong></div>)}</div></section>}</aside>
    </div>
    <EditarPedidoModal pedido={pedido} open={editOpen} onClose={() => setEditOpen(false)} onSave={async (input) => {
      try {
        const updated = await actualizarPedidoCompleto(pedido.id, input)
        setPedido(updated)
        toast.success('Pedido actualizado correctamente.')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'No se pudo actualizar el pedido.')
        throw error
      }
    }} />
    <Modal open={paymentOpen} onClose={() => setPaymentOpen(false)} title="Confirmar entrega y pago"><div className="space-y-4"><p className="text-sm leading-6 text-muted">El saldo pendiente aparece automáticamente. Si recibiste más por delivery, escribe el total recibido; la diferencia se añadirá a la venta.</p><label className="form-field"><span>Monto recibido</span><input type="number" min="0" step=".01" value={paymentAmount} onChange={(e) => setPaymentAmount(Number(e.target.value))} /></label><label className="form-field"><span>Método de pago</span><input value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} /></label>{paymentAmount > Number(pedido.saldo) && <div className="rounded-xl border border-accent/20 bg-accent/[.05] p-3 text-xs text-accent">Incluye USD {(paymentAmount - Number(pedido.saldo)).toFixed(2)} adicionales por delivery.</div>}<div className="flex justify-end gap-2"><button className="subtle-button" onClick={() => setPaymentOpen(false)}>Cancelar</button><button className="primary-button px-5" disabled={savingStatus} onClick={() => void confirmarEntrega()}>{savingStatus ? 'Guardando…' : 'Confirmar entrega'}</button></div></div></Modal>
    <FacturaModal factura={factura} onClose={() => setFactura(null)} title="Entrega confirmada" description="Comparte el comprobante de pago con el cliente." codeLabel="Código del pedido" note="El comprobante confirma el pago recibido e incluye el detalle del pedido. La imagen es ideal para WhatsApp y el PDF para archivarlo." closeLabel="Cerrar" />
  </div>
}
function EtapaTracker({ actual, seleccionado, onSelect }: { actual: EstadoPedido; seleccionado: EstadoPedido; onSelect: (estado: EstadoPedido) => void }) {
  const actualIndex = Math.max(0, ESTADOS_PEDIDO.findIndex((step) => step.value === actual))
  return <div className="mt-5 flex gap-1 overflow-x-auto pb-2">
    {ESTADOS_PEDIDO.map((step, index) => {
      const reached = index <= actualIndex
      const isSelected = step.value === seleccionado
      const isTarget = isSelected && step.value !== actual
      return <button key={step.value} type="button" onClick={() => onSelect(step.value)} title={step.label} className="flex min-w-[3.9rem] flex-1 shrink-0 flex-col items-center text-center outline-none">
        <div className="flex w-full items-center"><span className={`h-px flex-1 ${index === 0 ? 'opacity-0' : index <= actualIndex ? 'bg-accent/60' : 'bg-line'}`} /><span className={`step-dot size-8 transition ${reached ? 'step-done' : 'step-todo'} ${index === actualIndex ? 'step-current' : ''} ${isTarget ? 'ring-2 ring-accent ring-offset-2 ring-offset-[#0d100e]' : ''}`}>{reached ? <Check size={15} /> : <span className="text-[11px] font-semibold">{index + 1}</span>}</span><span className={`h-px flex-1 ${index === ESTADOS_PEDIDO.length - 1 ? 'opacity-0' : index < actualIndex ? 'bg-accent/60' : 'bg-line'}`} /></div>
        <span className={`mt-2 text-[9px] font-medium leading-3 ${isSelected ? 'text-accent' : reached ? 'text-white' : 'text-muted'}`}>{step.label}</span>
      </button>
    })}
  </div>
}
function Info({ label, value }: { label: string; value: string }) { return <div><span className="block text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</span><strong className="mt-1 block text-sm">{value}</strong></div> }
function PayRow({ label, value, accent }: { label: string; value: number; accent?: boolean }) { return <div className="flex justify-between gap-3"><span className="text-muted">{label}</span><strong className={accent ? value > 0 ? 'text-amber-300' : 'text-accent' : ''}>${Number(value).toFixed(2)}</strong></div> }
