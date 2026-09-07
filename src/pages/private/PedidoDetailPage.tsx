import { AlertTriangle, ArrowLeft, Ban, Boxes, CalendarDays, Check, CheckCircle2, Clipboard, FileText, ImageUp, MessageCircle, Package, PackageCheck, Pencil, Share2, Truck, UserRound, X, Zap } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { PedidoArchivos } from '../../components/pedidos/PedidoArchivos'
import { EditarPedidoModal } from '../../components/pedidos/EditarPedidoModal'
import { FacturaModal } from '../../components/pedidos/FacturaModal'
import { HistoriaModal } from '../../components/pedidos/HistoriaModal'
import { PedidoLogistica } from '../../components/pedidos/PedidoLogistica'
import { CuentaSelect, type DestinoPago } from '../../components/finanzas/CuentaSelect'
import { IngresoEnCuenta, INGRESO_VACIO, type Ingreso } from '../../components/finanzas/IngresoEnCuenta'
import { Modal } from '../../components/ui/Modal'
import { ESTADOS_PEDIDO, estadoLabel, etapaBase, mensajeWhatsAppEstado, mensajeWhatsAppReaparicion, motivoCancelacionLabel } from '../../constants/orders'
import { CancelarPedidoModal } from '../../components/pedidos/CancelarPedidoModal'
import { DEMO_PEDIDOS } from '../../data/demo'
import { isSupabaseConfigured } from '../../lib/supabase'
import { actualizarEstadoPedido, actualizarPedidoCompleto, agregarEnvioPedido, cobrarPedido, obtenerDisponibleDesde, obtenerPedido, pasarPedidoAStock } from '../../services/pedidos.service'
import { useAuth } from '../../contexts/AuthContext'
import type { FacturaData } from '../../services/factura.service'
import { obtenerTipoCambio, registrarGasto } from '../../services/comercial.service'
import { archivarComprobanteDrive } from '../../services/archivos.service'
import { MoneyField } from '../../components/ui/MoneyField'
import { aUsd } from '../../utils/money'
import type { EstadoPedido, Moneda, Pedido } from '../../types/domain'
import { costoRealPedido, envioClientePasaLargo } from '../../utils/pedidoCosto'
import { resolverImagenCatalogo } from '../../utils/catalogoImagen'
import { whatsappUrl } from '../../utils/whatsapp'
import { CARGO_BODEGA_DIARIO, DIAS_GRACIA_BODEGA, calcularCargoBodega, type CargoBodega } from '../../utils/bodega'
import { Status } from './PedidosPage'

// Arma las líneas de la factura desde los ítems del pedido. Si el TOTAL del pedido es
// mayor que la suma de los ítems (típico en encargos web con envío rápido: el recargo va
// en el total pero no como línea), agrega una línea "Envío rápido" por la diferencia para
// que la factura cuadre y muestre el envío.
function facturaItemsDePedido(pedido: Pedido): FacturaData['items'] {
  const items = (pedido.pedido_items ?? []).map((item) => ({ producto: item.producto, detalle: [item.marca, item.talla, item.color].filter(Boolean).join(' · ') || undefined, cantidad: Number(item.cantidad || 1), precio: Number(item.precio_unitario || 0), codigo: item.codigo_producto, imagen: item.imagen }))
  const suma = items.reduce((total, item) => total + item.precio * item.cantidad, 0)
  const diferencia = Math.round((Number(pedido.total || 0) - suma) * 100) / 100
  const yaTieneEnvio = items.some((item) => /env[íi]o r[áa]pido/i.test(item.producto))
  if (diferencia > 0.01 && !yaTieneEnvio) items.push({ producto: 'Envío rápido (14–17 días)', detalle: undefined, cantidad: 1, precio: diferencia, codigo: undefined, imagen: null })
  return items
}

export function PedidoDetailPage() {
  const { esAdmin } = useAuth()
  const { id = '' } = useParams()
  const [pedido, setPedido] = useState<Pedido | null>(DEMO_PEDIDOS.find((item) => item.id === id) ?? DEMO_PEDIDOS[0])
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [estadoSeleccionado, setEstadoSeleccionado] = useState<EstadoPedido>(pedido?.estado ?? 'pedido_confirmado')
  const [savingStatus, setSavingStatus] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState('Transferencia')
  const [comprobante, setComprobante] = useState<File | null>(null)
  // Cobro: la cuenta manda la moneda (el cliente transfiere en C$ o US$). `montoUsd` es lo
  // que reduce el saldo del pedido (siempre en dólares); `montoCuenta` es lo que entró a la tarjeta.
  const [ingresoCobro, setIngresoCobro] = useState<Ingreso>(INGRESO_VACIO)
  const [factura, setFactura] = useState<FacturaData | null>(null)
  const [qualityPhotosReady, setQualityPhotosReady] = useState(false)
  const [tipoCambio, setTipoCambio] = useState(37)
  const [disponibleDesde, setDisponibleDesde] = useState<string | null>(null)
  const [cobrarBodega, setCobrarBodega] = useState(true)
  const [cobrarDestino, setCobrarDestino] = useState<EstadoPedido>('pagado')
  const [envioOpen, setEnvioOpen] = useState(false)
  const [envioMonto, setEnvioMonto] = useState('')
  const [envioNota, setEnvioNota] = useState('')
  const [cancelOpen, setCancelOpen] = useState(false)
  const [stockSaving, setStockSaving] = useState(false)
  const [verFactura, setVerFactura] = useState<FacturaData | null>(null)
  const [historiaOpen, setHistoriaOpen] = useState(false)
  const [gastoOpen, setGastoOpen] = useState(false)
  useEffect(() => { if (isSupabaseConfigured) void obtenerPedido(id).then(setPedido).catch(() => toast.error('No se pudo cargar el pedido.')).finally(() => setLoading(false)) }, [id])
  useEffect(() => { if (isSupabaseConfigured) void obtenerTipoCambio().then(setTipoCambio).catch(() => undefined) }, [])
  useEffect(() => { if (pedido) setEstadoSeleccionado(pedido.estado) }, [pedido])
  // Solo mientras el pedido está disponible para entrega tiene sentido el cargo por
  // bodega: buscamos en el historial desde cuándo lo está para calcular lo acumulado.
  useEffect(() => { if (isSupabaseConfigured && pedido?.estado === 'disponible_entrega') void obtenerDisponibleDesde(pedido.id).then(setDisponibleDesde).catch(() => undefined); else setDisponibleDesde(null) }, [pedido?.id, pedido?.estado])
  if (loading) return <div className="h-96 animate-pulse rounded-2xl border border-line bg-panel" />
  if (!pedido) return <div className="grid min-h-96 place-items-center text-muted">Pedido no encontrado.</div>
  const copy = async (text: string, message: string) => { await navigator.clipboard.writeText(text); toast.success(message) }
  // Lo que se cobra en dólares (reduce el saldo). Sale del bloque de cuenta del cobro.
  const paymentAmount = ingresoCobro.montoUsd
  // Fija el monto del cobro por su valor en dólares (al abrir el modal y al sumar/quitar la
  // bodega), reconvirtiéndolo a la moneda de la cuenta ya elegida para que el campo cuadre.
  const fijarCobroUsd = (usd: number) => setIngresoCobro((cur) => {
    const tc = tipoCambio > 0 ? tipoCambio : 37
    const montoCuenta = cur.moneda === 'NIO' ? Math.ceil((usd * tc) / 10) * 10 : Math.round(usd * 100) / 100
    return { ...cur, montoUsd: Math.round(usd * 100) / 100, montoCuenta }
  })
  const updateStatus = async () => {
    if (estadoSeleccionado === pedido.estado) return toast.info('Selecciona una etapa diferente.')
    // El cobro y la entrega registran dinero (pagos/caja): solo el administrador. El operador
    // mueve las etapas operativas hasta "disponible para entrega".
    if (!esAdmin && (estadoSeleccionado === 'pagado' || estadoSeleccionado === 'entregado')) {
      return toast.error('El pago y la entrega los registra el administrador.')
    }
    // "Pagado" (o "Entregado" con saldo pendiente) abre la pantalla de cobro: suma el
    // cargo por bodega y el envío al saldo. "Pagado" además congela la bodega.
    if (estadoSeleccionado === 'pagado' || estadoSeleccionado === 'entregado') {
      const c = calcularCargoBodega(disponibleDesde)?.cargo ?? 0
      const saldoPend = Math.max(0, Number(pedido.saldo))
      if (!(estadoSeleccionado === 'entregado' && saldoPend <= 0.01 && c <= 0.01)) {
        setCobrarDestino(estadoSeleccionado); setCobrarBodega(c > 0); const totalUsd = Math.max(0, saldoPend + c); setIngresoCobro({ cuentaId: null, moneda: 'USD', montoUsd: totalUsd, montoCuenta: totalUsd }); setComprobante(null); setPaymentOpen(true); return
      }
    }
    setSavingStatus(true)
    try {
      const updated = isSupabaseConfigured ? await actualizarEstadoPedido(pedido.id, estadoSeleccionado) : { ...pedido, estado: estadoSeleccionado, updated_at: new Date().toISOString() }
      setPedido((current) => current ? { ...current, ...updated } : updated)
      toast.success(estadoSeleccionado === 'disponible_entrega' ? 'Pedido disponible. El mensaje de WhatsApp está listo.' : estadoSeleccionado === 'control_calidad' && qualityPhotosReady ? 'Control de calidad actualizado. El mensaje de WhatsApp está listo.' : 'Etapa del pedido actualizada.')
    } catch { toast.error('No se pudo actualizar la etapa.') }
    finally { setSavingStatus(false) }
  }
  const confirmarCobro = async () => {
    if (paymentAmount > 0 && !ingresoCobro.cuentaId) return toast.error('Elegí a qué cuenta entra el pago.')
    if (paymentAmount > 0 && !comprobante) return toast.error('Subí la foto del comprobante de la transferencia para registrar el pago.')
    setSavingStatus(true)
    try {
      const info = calcularCargoBodega(disponibleDesde)
      const cargo = cobrarBodega ? info?.cargo ?? 0 : 0
      // El monto en córdobas entra tal cual a la tarjeta. Pero lo que CANCELA el saldo (en
      // dólares) lo ajustamos al pendiente exacto cuando la diferencia es solo el redondeo de
      // córdobas (< US$0.50), para que el saldo quede en cero y no se invente una línea de
      // "delivery" por unos centavos. Si recibiste claramente de más, se respeta como delivery.
      const pendiente = Math.round((Math.max(0, Number(pedido.saldo)) + cargo) * 100) / 100
      const montoUsdCobro = Math.abs(paymentAmount - pendiente) < 0.5 ? pendiente : paymentAmount
      await cobrarPedido(pedido.id, montoUsdCobro, paymentMethod, cobrarDestino, cargo, info?.diasCobrados ?? 0, { cuentaId: ingresoCobro.cuentaId, montoCuenta: ingresoCobro.montoCuenta })
      const refreshed = await obtenerPedido(pedido.id)
      setPedido(refreshed)
      setEstadoSeleccionado(cobrarDestino)
      setPaymentOpen(false)
      toast.success(cobrarDestino === 'pagado' ? 'Pago registrado. El cargo por bodega quedó congelado.' : 'Pedido entregado y pago registrado.')
      // Archiva el comprobante de la transferencia en la carpeta de Drive del pedido
      // (junto a la factura). Best-effort: si falla, el pago ya quedó registrado igual.
      if (comprobante) {
        try { await archivarComprobanteDrive(refreshed.codigo, comprobante, refreshed.fecha_pedido); toast.success('Comprobante archivado en Drive.') }
        catch { toast.error('El pago se registró, pero no se pudo archivar el comprobante en Drive.') }
        setComprobante(null)
      }
      setFactura({
        codigo: refreshed.codigo,
        cliente: refreshed.clientes?.nombre ?? 'Cliente',
        whatsapp: refreshed.clientes?.whatsapp ?? null,
        fecha: new Date().toISOString().slice(0, 10),
        items: facturaItemsDePedido(refreshed),
        total: Number(refreshed.total || 0),
        abono: Number(refreshed.abono || 0),
        saldo: Number(refreshed.saldo || 0),
        variante: 'pago',
        metodoPago: paymentMethod || null,
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo registrar el cobro.')
    } finally { setSavingStatus(false) }
  }
  const guardarEnvio = async () => {
    setSavingStatus(true)
    try {
      const refreshed = await agregarEnvioPedido(pedido.id, Number(envioMonto) || 0, envioNota)
      setPedido(refreshed)
      setEnvioOpen(false)
      toast.success(Number(envioMonto) > 0 ? 'Envío agregado al pedido. Ya aparece en el total y la factura.' : 'Envío quitado del pedido.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo agregar el envío.')
    } finally { setSavingStatus(false) }
  }
  const pasarAStock = async () => {
    if (!window.confirm(`¿Pasar los productos de ${pedido.codigo} al inventario / stock? Quedarán disponibles para venta directa.`)) return
    setStockSaving(true)
    try { const n = await pasarPedidoAStock(pedido.id); toast.success(`${n} ${n === 1 ? 'producto pasó' : 'productos pasaron'} a stock. Los ves en Inventario.`) }
    catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo pasar a stock.') }
    finally { setStockSaving(false) }
  }
  // Abre la MISMA factura/comprobante que se le envía al cliente, para descargarla o
  // reenviarla desde el panel cuando haga falta (no solo al momento de cobrar).
  const abrirFactura = () => setVerFactura({
    codigo: pedido.codigo,
    cliente: pedido.clientes?.nombre ?? 'Cliente',
    whatsapp: pedido.clientes?.whatsapp ?? null,
    fecha: pedido.fecha_pedido || new Date().toISOString().slice(0, 10),
    items: facturaItemsDePedido(pedido),
    total: Number(pedido.total || 0),
    abono: Number(pedido.abono || 0),
    saldo: Number(pedido.saldo || 0),
    variante: Number(pedido.saldo || 0) <= 0.01 ? 'pago' : 'compra',
    metodoPago: pedido.metodo_pago ?? null,
  })
  const publicUrl = `${import.meta.env.VITE_PUBLIC_APP_URL ?? window.location.origin}/tracking/${pedido.codigo}`
  const qualityMessageReady = pedido.estado === 'control_calidad' && qualityPhotosReady
  const whatsappMessage = mensajeWhatsAppEstado(pedido.estado, { nombre: pedido.clientes?.nombre, codigo: pedido.codigo, url: publicUrl, saldo: Number(pedido.saldo), fotosCalidad: qualityMessageReady, tipoCambio, departamento: pedido.clientes?.departamento, ciudad: pedido.clientes?.ciudad })
  const costoReal = costoRealPedido(pedido)
  // El envío que paga el cliente no es ganancia (se le entrega al mensajero): se descuenta.
  const envioCliente = envioClientePasaLargo(pedido)
  const gananciaEstimada = pedido.total - costoReal - envioCliente
  const cargoBodega = calcularCargoBodega(disponibleDesde)
  const cordobasBodega = cargoBodega ? Math.round((cargoBodega.cargo * (tipoCambio > 0 ? tipoCambio : 37)) / 5) * 5 : 0
  const recordatorioBodega = cargoBodega?.activo
    ? `Hola${pedido.clientes?.nombre ? `, ${pedido.clientes.nombre}` : ''}. Te recordamos que tu pedido ${pedido.codigo} está *disponible para entrega* desde hace ${cargoBodega.dias} días. Como superó los ${DIAS_GRACIA_BODEGA} días de gracia, se acumula un cargo por bodega de *US$ ${cargoBodega.cargo.toFixed(2)} (≈ C$ ${cordobasBodega})* — US$ ${CARGO_BODEGA_DIARIO} por cada día extra que sigue en bodega. Coordinemos tu entrega y pago para que no siga subiendo. Rastrea tu pedido aquí: ${publicUrl}`
    : ''
  return <div>
    <Link to="/pedidos" className="mb-5 inline-flex items-center gap-2 text-xs text-muted hover:text-white"><ArrowLeft size={16} /> Volver a pedidos</Link>
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
      <div><div className="flex flex-wrap items-center gap-3"><h1 className="text-3xl font-semibold tracking-tight">{pedido.codigo}</h1><Status estado={pedido.estado} />{pedido.envio_rapido && <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2.5 py-1 text-[11px] font-semibold text-accent"><Zap size={12} /> Envío rápido</span>}</div><p className="mt-2 text-sm text-muted">Creado el {new Intl.DateTimeFormat('es-NI', { dateStyle: 'long' }).format(new Date(pedido.fecha_pedido + 'T12:00:00'))}</p></div>
      <div className="flex flex-wrap gap-2"><button className="subtle-button" onClick={() => void copy(pedido.codigo, 'Código copiado.')}><Clipboard size={16} /> Copiar código</button><button className="subtle-button" onClick={() => void copy(publicUrl, 'Enlace público copiado.')}><Check size={16} /> Copiar enlace</button>{pedido.clientes?.whatsapp && <a className="primary-button px-4" href={whatsappUrl(pedido.clientes.whatsapp, whatsappMessage)} target="_blank" rel="noreferrer"><MessageCircle size={17} /> {pedido.estado === 'disponible_entrega' ? 'Avisar disponibilidad' : qualityMessageReady ? 'Avisar control de calidad' : 'WhatsApp'}</a>}{pedido.estado === 'entregado' && <button className="subtle-button px-4" onClick={() => setHistoriaOpen(true)}><Share2 size={16} /> Compartir en historia</button>}{esAdmin && pedido.estado !== 'cancelado' && pedido.estado !== 'entregado' && <button className="subtle-button px-4 text-red-300 hover:text-red-200" onClick={() => setCancelOpen(true)}><Ban size={16} /> Cancelar</button>}</div>
    </div>
    {pedido.estado === 'cancelado' && <ReaparicionPanel pedido={pedido} whatsapp={pedido.clientes?.whatsapp} stockSaving={stockSaving} onStock={() => void pasarAStock()} />}
    {pedido.estado === 'disponible_entrega' && cargoBodega && <BodegaAviso info={cargoBodega} cordobas={cordobasBodega} whatsapp={pedido.clientes?.whatsapp} mensaje={recordatorioBodega} />}
    <div className="mt-7 grid gap-5 xl:grid-cols-[1.5fr_.75fr]">
      <div className="min-w-0 space-y-5">
        <section className="form-section"><div><h2 className="flex items-center gap-2 font-semibold"><CheckCircle2 size={18} className="text-accent" /> Actualizar etapa</h2><p className="mt-2 text-xs leading-5 text-muted">Toca una etapa para seleccionarla y confirma el cambio. Las etapas de transporte también pueden avanzar desde Logística.</p></div>
          <EtapaTracker actual={pedido.estado} seleccionado={estadoSeleccionado} onSelect={setEstadoSeleccionado} />
          <div className="mt-5 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted">{estadoSeleccionado === pedido.estado ? 'Selecciona una etapa diferente para actualizar.' : <>Cambiarás de <strong className="text-white">{estadoLabel(pedido.estado)}</strong> a <strong className="text-accent">{estadoLabel(estadoSeleccionado)}</strong>.</>}</p>
            <button className="primary-button px-5" onClick={() => void updateStatus()} disabled={savingStatus || estadoSeleccionado === pedido.estado}>{savingStatus ? 'Guardando…' : estadoSeleccionado === 'pagado' ? 'Registrar pago' : estadoSeleccionado === 'entregado' ? 'Confirmar entrega' : 'Confirmar etapa'}</button>
          </div>
        </section>
        <section className="form-section"><div className="flex items-center justify-between"><h2 className="flex items-center gap-2 font-semibold"><Package size={18} className="text-accent" /> Productos</h2>{esAdmin && <button className="table-action" aria-label="Editar pedido" onClick={() => setEditOpen(true)}><Pencil size={16} /></button>}</div><div className="mt-4 divide-y divide-line">{pedido.pedido_items?.map((item, index) => <div className="flex items-center gap-3 py-4" key={`${item.producto}-${index}`}><ProductoThumb imagen={item.imagen} cantidad={item.cantidad} alt={item.producto} /><div className="min-w-0 flex-1"><strong className="block truncate text-sm">{item.producto}</strong><span className="block truncate text-xs text-muted">{[item.marca, item.talla, item.color].filter(Boolean).join(' · ')}</span>{item.codigo_producto && <span className="mt-0.5 block font-mono text-[11px] text-accent">Cód. {item.codigo_producto}</span>}</div><strong className="text-sm">${(item.cantidad * item.precio_unitario).toFixed(2)}</strong></div>)}</div></section>
        <PedidoArchivos pedidoId={pedido.id} codigo={pedido.codigo} estadoPedido={pedido.estado} onQualityReady={setQualityPhotosReady} onEstadoAvanzado={(updated) => setPedido((current) => current ? { ...current, ...updated } : updated)} />
        <PedidoLogistica pedidoId={pedido.id} />
        <section className="form-section"><h2 className="flex items-center gap-2 font-semibold"><CalendarDays size={18} className="text-accent" /> Fechas</h2><div className="mt-5 grid gap-4 sm:grid-cols-3"><Info label="Pedido" value={pedido.fecha_pedido} /><Info label="Llegada estimada" value={pedido.fecha_estimada ?? 'Sin definir'} /><Info label="Actualización" value={new Intl.DateTimeFormat('es-NI').format(new Date(pedido.updated_at))} /></div></section>
      </div>
      <aside className="min-w-0 space-y-5"><section className="form-section"><h2 className="flex items-center gap-2 font-semibold"><UserRound size={18} className="text-accent" /> Cliente</h2><div className="mt-4"><strong>{pedido.clientes?.nombre}</strong><p className="mt-1 text-sm text-muted">{pedido.clientes?.whatsapp}</p></div></section>{esAdmin && <><section className="form-section"><h2 className="font-semibold">Resumen de pago</h2><div className="mt-4 space-y-3 text-sm"><PayRow label="Total" value={pedido.total} /><PayRow label="Abono" value={pedido.abono} /><PayRow label="Costo real" value={costoReal} />{envioCliente > 0 && <PayRow label="Envío del cliente (no es ganancia)" value={envioCliente} />}<PayRow label="Ganancia estimada" value={gananciaEstimada} /><div className="border-t border-line pt-3"><PayRow label="Saldo pendiente" value={pedido.saldo} accent /></div></div>{pedido.estado !== 'entregado' && pedido.estado !== 'cancelado' && <button className="subtle-button mt-4 w-full" onClick={() => { const actual = pedido.pedido_items?.find((it) => it.producto === 'Envío / delivery'); setEnvioMonto(actual ? String(actual.precio_unitario) : ''); setEnvioNota(actual?.talla ?? ''); setEnvioOpen(true) }}><Truck size={16} /> {pedido.pedido_items?.some((it) => it.producto === 'Envío / delivery') ? 'Editar envío' : 'Agregar envío'}</button>}<button className="subtle-button mt-2 w-full" onClick={abrirFactura}><FileText size={16} /> Descargar factura</button></section><section className="form-section"><h2 className="font-semibold">Gastos asociados</h2><div className="mt-4 space-y-3">{pedido.gastos?.length ? pedido.gastos.map((gasto) => <div className="flex justify-between gap-3 text-xs" key={gasto.id}><span className="text-muted">{gasto.categoria}</span><strong>${Number(gasto.monto).toFixed(2)}</strong></div>) : <p className="text-xs text-muted">Todavía no hay gastos registrados para este pedido.</p>}</div>{pedido.estado !== 'cancelado' && <button className="subtle-button mt-4 w-full" onClick={() => setGastoOpen(true)}><Truck size={16} /> Agregar costo de envío</button>}</section></>}</aside>
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
    <Modal open={paymentOpen} onClose={() => setPaymentOpen(false)} title={cobrarDestino === 'pagado' ? 'Registrar pago del cliente' : 'Confirmar entrega y pago'}><div className="space-y-4"><p className="text-sm leading-6 text-muted">{cobrarDestino === 'pagado' ? 'Registra lo que pagó el cliente. Al confirmar, el cargo por bodega deja de subir. La entrega física la marcas después.' : 'El saldo pendiente aparece automáticamente. Si recibiste más por delivery, escribe el total recibido; la diferencia se añadirá a la venta.'}</p>
      {cargoBodega?.activo && <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-red-400/25 bg-red-400/[0.05] p-3"><input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-accent" checked={cobrarBodega} onChange={(e) => { const on = e.target.checked; setCobrarBodega(on); fijarCobroUsd(Math.max(0, Number(pedido.saldo) + (on ? cargoBodega.cargo : 0))) }} /><span className="flex flex-col"><span className="text-sm font-medium text-red-100">Cobrar cargo por bodega · US$ {cargoBodega.cargo.toFixed(2)}</span><span className="text-[11px] text-red-100/70">{cargoBodega.diasCobrados} {cargoBodega.diasCobrados === 1 ? 'día' : 'días'} × US$ {CARGO_BODEGA_DIARIO} (≈ C$ {cordobasBodega}). Se agrega como línea a la factura.</span></span></label>}
      <label className="form-field"><span>Método de pago</span><input value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} /></label><IngresoEnCuenta tipoCambio={tipoCambio} value={ingresoCobro} onChange={setIngresoCobro} label="Monto recibido" /><ComprobanteUploader value={comprobante} onChange={setComprobante} requerido={paymentAmount > 0} />{(() => { const cargoAplicado = cobrarBodega ? cargoBodega?.cargo ?? 0 : 0; const extra = paymentAmount - Number(pedido.saldo) - cargoAplicado; return extra > 0.5 ? <div className="rounded-xl border border-accent/20 bg-accent/[.05] p-3 text-xs text-accent">Incluye USD {extra.toFixed(2)} adicionales por delivery.</div> : null })()}<div className="flex justify-end gap-2"><button className="subtle-button" onClick={() => setPaymentOpen(false)}>Cancelar</button><button className="primary-button px-5" disabled={savingStatus || (paymentAmount > 0 && !comprobante)} onClick={() => void confirmarCobro()}>{savingStatus ? 'Guardando…' : cobrarDestino === 'pagado' ? 'Registrar pago' : 'Confirmar entrega'}</button></div></div></Modal>
    <Modal open={envioOpen} onClose={() => setEnvioOpen(false)} title="Agregar envío / delivery"><div className="space-y-4"><p className="text-sm leading-6 text-muted">Calcula el envío con la agencia y escríbelo aquí. Se suma al total del pedido y sale como una línea en la factura, así le das al cliente el total ya con envío. Déjalo en 0 para quitarlo.</p><label className="form-field"><span>Costo del envío (USD)</span><input type="number" min="0" step=".01" value={envioMonto} onChange={(e) => setEnvioMonto(e.target.value)} placeholder="Ej: 4.00" autoFocus /></label><label className="form-field"><span>Detalle (opcional)</span><input value={envioNota} onChange={(e) => setEnvioNota(e.target.value)} placeholder="Ej: Cargotrans a Estelí / delivery zona 5" /></label>{Number(envioMonto) > 0 && <div className="rounded-xl border border-accent/20 bg-accent/[.05] p-3 text-xs text-accent">Nuevo saldo del cliente: USD {(Number(pedido.saldo) + (Number(envioMonto) || 0) - (Number(pedido.pedido_items?.find((it) => it.producto === 'Envío / delivery')?.precio_unitario) || 0)).toFixed(2)}</div>}<div className="flex justify-end gap-2"><button className="subtle-button" onClick={() => setEnvioOpen(false)}>Cancelar</button><button className="primary-button px-5" disabled={savingStatus} onClick={() => void guardarEnvio()}>{savingStatus ? 'Guardando…' : 'Guardar envío'}</button></div></div></Modal>
    <FacturaModal factura={factura} onClose={() => setFactura(null)} title={cobrarDestino === 'pagado' ? 'Pago registrado' : 'Entrega confirmada'} description="Comparte el comprobante de pago con el cliente." codeLabel="Código del pedido" note="El comprobante confirma el pago recibido e incluye el detalle del pedido. La imagen es ideal para WhatsApp y el PDF para archivarlo." closeLabel="Cerrar" />
    {cancelOpen && <CancelarPedidoModal pedido={pedido} open onClose={() => setCancelOpen(false)} onDone={(updated) => setPedido((current) => current ? { ...current, ...updated } : updated)} />}
    <FacturaModal factura={verFactura} onClose={() => setVerFactura(null)} title={verFactura?.variante === 'pago' ? 'Comprobante de pago' : 'Factura del pedido'} description="Descárgala en PDF o reenvíala al cliente por WhatsApp." codeLabel="Código del pedido" note="Es la misma factura/comprobante que recibe el cliente por correo, con el detalle y los totales del pedido." closeLabel="Cerrar" />
    {historiaOpen && <HistoriaModal pedido={pedido} open onClose={() => setHistoriaOpen(false)} />}
    <GastoEnvioModal pedido={pedido} tipoCambio={tipoCambio} open={gastoOpen} onClose={() => setGastoOpen(false)} onSaved={async () => { setGastoOpen(false); if (isSupabaseConfigured) { try { const refreshed = await obtenerPedido(pedido.id); setPedido(refreshed) } catch { /* la lista se refresca al recargar */ } } }} />
  </div>
}
// Zona de carga del comprobante de la transferencia. Antes era un <input type="file"> gris
// que pasaba desapercibido y se olvidaba. Ahora es una caja destacada (borde punteado
// acento, ícono y texto claros) que además acepta arrastrar y soltar y muestra una vista
// previa de la imagen elegida, para que quede claro que SÍ se subió el comprobante.
function ComprobanteUploader({ value, onChange, requerido = false }: { value: File | null; onChange: (file: File | null) => void; requerido?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => {
    if (!value) { setPreview(null); return }
    const url = URL.createObjectURL(value)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [value])
  const aceptar = (file: File | undefined | null) => {
    if (!file) return
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { toast.error('El comprobante debe ser una imagen JPG, PNG o WebP.'); return }
    onChange(file)
  }
  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium">Comprobante de la transferencia {requerido ? <span className="font-normal text-accent">(obligatorio · se guarda en el Drive del pedido)</span> : <span className="font-normal text-muted">(opcional · se guarda en el Drive del pedido)</span>}</span>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => aceptar(e.target.files?.[0])} />
      {value ? (
        <div className="flex items-center gap-3 rounded-xl border border-accent/40 bg-accent/[.06] p-3">
          {preview && <img src={preview} alt="Comprobante" className="size-14 shrink-0 rounded-lg object-cover" />}
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1 text-sm font-medium text-accent"><Check size={15} /> Comprobante listo para subir</p>
            <p className="truncate text-[11px] text-muted">{value.name}</p>
          </div>
          <button type="button" onClick={() => inputRef.current?.click()} className="subtle-button shrink-0 px-3 py-1.5 text-xs">Cambiar</button>
          <button type="button" onClick={() => onChange(null)} aria-label="Quitar comprobante" className="shrink-0 rounded-lg p-1.5 text-muted transition hover:bg-white/10 hover:text-white"><X size={16} /></button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); aceptar(e.dataTransfer.files?.[0]) }}
          className={`flex w-full flex-col items-center gap-1.5 rounded-xl border-2 border-dashed p-5 text-center transition ${dragOver ? 'border-accent bg-accent/10' : requerido ? 'border-accent/50 bg-accent/[.04] hover:border-accent hover:bg-accent/[.08]' : 'border-line bg-white/[.02] hover:border-accent/60 hover:bg-accent/[.04]'}`}
        >
          <ImageUp size={26} className="text-accent" />
          <span className="text-sm font-medium text-white">Subir foto del comprobante</span>
          <span className="text-[11px] text-muted">Toca para elegir o arrastra la imagen aquí · JPG, PNG o WebP</span>
        </button>
      )}
    </div>
  )
}
// Modal enfocado para sumar el COSTO DE ENVÍO (u otro gasto) directamente al pedido desde
// su detalle. Usa registrarGasto, así queda ligado al pedido, entra al "Costo real" y baja
// el saldo de la cuenta elegida (como cualquier gasto). Por defecto es "Envío internacional".
function GastoEnvioModal({ pedido, tipoCambio, open, onClose, onSaved }: { pedido: Pedido; tipoCambio: number; open: boolean; onClose: () => void; onSaved: () => void }) {
  const [categoria, setCategoria] = useState('Envío internacional')
  const [moneda, setMoneda] = useState<Moneda>('USD')
  const [monto, setMonto] = useState(0)
  const [metodo, setMetodo] = useState('Transferencia')
  const [destino, setDestino] = useState<DestinoPago>({ cuentaId: null, montoCuenta: 0 })
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (open) { setCategoria('Envío internacional'); setMoneda('USD'); setMonto(0); setMetodo('Transferencia'); setDestino({ cuentaId: null, montoCuenta: 0 }) } }, [open])
  const montoUsd = aUsd(monto, moneda, tipoCambio)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (montoUsd <= 0) return toast.error('Indica el monto del gasto.')
    if (!destino.cuentaId) return toast.error('Elegí de qué cuenta sale el gasto.')
    setSaving(true)
    try {
      await registrarGasto({ fecha: new Date().toISOString().slice(0, 10), categoria, descripcion: `${categoria} · ${pedido.codigo}`, monto: montoUsd, moneda, monto_original: monto, tipo_cambio: moneda === 'NIO' ? tipoCambio : null, pedido_id: pedido.id, inversion_id: null, proveedor_id: null, metodo_pago: metodo || null, observaciones: null }, destino)
      toast.success('Costo agregado al pedido. Ya está en el costo real.')
      onSaved()
    } catch { toast.error('No se pudo agregar el gasto.') } finally { setSaving(false) }
  }
  return <Modal open={open} onClose={onClose} title={`Agregar costo · ${pedido.codigo}`} description="Suma el costo de envío (u otro gasto) al pedido. Entra al costo real y sale de la cuenta que elijas.">
    <form onSubmit={(e) => void submit(e)} className="form-grid">
      <label className="form-field"><span>Categoría</span><select value={categoria} onChange={(e) => setCategoria(e.target.value)}><option>Envío internacional</option><option>Delivery</option><option>Empaque</option><option>Proveedor</option><option>Otro</option></select></label>
      <MoneyField moneda={moneda} montoOriginal={monto} tipoCambio={tipoCambio} onMoneda={setMoneda} onMonto={setMonto} />
      <label className="form-field"><span>Método</span><input value={metodo} onChange={(e) => setMetodo(e.target.value)} /></label>
      <CuentaSelect requerido montoUsd={montoUsd} tipoCambio={tipoCambio} value={destino} onChange={setDestino} modo="resta" />
      <div className="col-span-full flex justify-end gap-2"><button type="button" className="subtle-button" onClick={onClose}>Cancelar</button><button className="primary-button px-5" disabled={saving}>{saving ? 'Guardando…' : 'Agregar costo'}</button></div>
    </form>
  </Modal>
}
// Panel para pedidos cancelados: si el paquete apareció después, deja avisarle al cliente
// (por si aún lo quiere) o pasar los productos al inventario/stock.
function ReaparicionPanel({ pedido, whatsapp, stockSaving, onStock }: { pedido: Pedido; whatsapp?: string | null; stockSaving: boolean; onStock: () => void }) {
  const motivo = motivoCancelacionLabel(pedido.motivo_cancelacion)
  return <div className="mt-5 rounded-2xl border border-amber-300/25 bg-amber-300/[0.06] p-4">
    <div className="flex items-start gap-3">
      <PackageCheck size={18} className="mt-0.5 shrink-0 text-amber-300" />
      <div className="flex-1">
        <strong className="text-sm text-amber-200">Pedido cancelado{motivo ? ` · ${motivo}` : ''}</strong>
        <p className="mt-1 text-xs leading-5 text-amber-100/80">Si el paquete aparece después, preguntale al cliente si aún le interesa; si no, pasalo a stock para venderlo. También podés reactivarlo eligiendo una etapa abajo.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {whatsapp && <a className="subtle-button px-4" href={whatsappUrl(whatsapp, mensajeWhatsAppReaparicion({ nombre: pedido.clientes?.nombre, codigo: pedido.codigo }))} target="_blank" rel="noreferrer"><MessageCircle size={16} /> Preguntar al cliente</a>}
          <button className="subtle-button px-4" disabled={stockSaving} onClick={onStock}><Boxes size={16} /> {stockSaving ? 'Pasando…' : 'Pasar a stock'}</button>
        </div>
      </div>
    </div>
  </div>
}
function EtapaTracker({ actual, seleccionado, onSelect }: { actual: EstadoPedido; seleccionado: EstadoPedido; onSelect: (estado: EstadoPedido) => void }) {
  // "Pagado" ya NO es un paso de la barra: el pago se registra al ENTREGAR. Un pedido que
  // esté en 'pagado' (de antes) se ubica en "Disponible para entrega".
  const pasos = ESTADOS_PEDIDO.filter((step) => step.value !== 'pagado')
  const baseVisible = (estado: EstadoPedido) => { const base = etapaBase(estado); return base === 'pagado' ? 'disponible_entrega' : base }
  const actualIndex = Math.max(0, pasos.findIndex((step) => step.value === baseVisible(actual)))
  return <div className="mt-5 flex gap-1 overflow-x-auto pb-2">
    {pasos.map((step, index) => {
      const reached = index <= actualIndex
      const isSelected = step.value === seleccionado
      const isTarget = isSelected && step.value !== actual
      return <button key={step.value} type="button" onClick={() => onSelect(step.value)} title={step.label} className="flex min-w-[3.9rem] flex-1 shrink-0 flex-col items-center text-center outline-none">
        <div className="flex w-full items-center"><span className={`h-px flex-1 ${index === 0 ? 'opacity-0' : index <= actualIndex ? 'bg-accent/60' : 'bg-line'}`} /><span className={`step-dot size-8 transition ${reached ? 'step-done' : 'step-todo'} ${index === actualIndex ? 'step-current' : ''} ${isTarget ? 'ring-2 ring-accent ring-offset-2 ring-offset-[#0d100e]' : ''}`}>{reached ? <Check size={15} /> : <span className="text-[11px] font-semibold">{index + 1}</span>}</span><span className={`h-px flex-1 ${index === pasos.length - 1 ? 'opacity-0' : index < actualIndex ? 'bg-accent/60' : 'bg-line'}`} /></div>
        <span className={`mt-2 text-[9px] font-medium leading-3 ${isSelected ? 'text-accent' : reached ? 'text-white' : 'text-muted'}`}>{step.label}</span>
      </button>
    })}
  </div>
}
// Miniatura del producto. Si no hay imagen —o si la URL está rota/no carga (p. ej.
// el producto aún no existe en el catálogo)— cae al cuadrito limpio "N×" en vez de
// mostrar el ícono de imagen rota.
function ProductoThumb({ imagen, cantidad, alt }: { imagen?: string | null; cantidad: number; alt: string }) {
  const [error, setError] = useState(false)
  const foto = resolverImagenCatalogo(imagen)
  if (foto && !error) {
    return <span className="relative size-11 shrink-0 overflow-hidden rounded-xl bg-white/[0.04]">
      <img src={foto} alt={alt} className="size-full object-cover" onError={() => setError(true)} />
      <span className="absolute bottom-0 right-0 rounded-tl-md bg-app/85 px-1 text-[10px] font-semibold text-white">{cantidad}×</span>
    </span>
  }
  return <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white/[0.04] text-sm font-semibold text-muted">{cantidad}×</span>
}
// Aviso de bodega en el panel: recuerda al admin los días que el pedido lleva
// disponible y el cargo acumulado, con un botón para recordárselo al cliente.
function BodegaAviso({ info, cordobas, whatsapp, mensaje }: { info: CargoBodega; cordobas: number; whatsapp?: string | null; mensaje: string }) {
  const limite = new Intl.DateTimeFormat('es-NI', { dateStyle: 'long' }).format(new Date(info.limite))
  if (!info.activo) return <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-amber-300/25 bg-amber-300/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
    <div className="flex items-start gap-3"><CalendarDays size={18} className="mt-0.5 shrink-0 text-amber-300" /><div><strong className="text-sm text-amber-200">En bodega · {info.dias} {info.dias === 1 ? 'día' : 'días'} (aún sin cargo)</strong><p className="mt-1 text-xs leading-5 text-amber-100/80">El cliente puede confirmar sin costo hasta el <strong>{limite}</strong>. Después se cobran US$ {CARGO_BODEGA_DIARIO} por día.</p></div></div>
  </div>
  return <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-red-400/30 bg-red-400/[0.07] p-4 sm:flex-row sm:items-center sm:justify-between">
    <div className="flex items-start gap-3"><AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-300" /><div><strong className="text-sm text-red-200">Cargo por bodega activo · {info.dias} días</strong><p className="mt-1 text-xs leading-5 text-red-100/80">Acumulado <strong className="text-red-100">US$ {info.cargo.toFixed(2)} (≈ C$ {cordobas})</strong> — {info.diasCobrados} {info.diasCobrados === 1 ? 'día' : 'días'} × US$ {CARGO_BODEGA_DIARIO}. Se sumará a la factura al entregar (puedes quitarlo al cobrar).</p></div></div>
    {whatsapp && <a className="primary-button shrink-0 px-4" href={whatsappUrl(whatsapp, mensaje)} target="_blank" rel="noreferrer"><MessageCircle size={16} /> Recordar al cliente</a>}
  </div>
}
function Info({ label, value }: { label: string; value: string }) { return <div><span className="block text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</span><strong className="mt-1 block text-sm">{value}</strong></div> }
function PayRow({ label, value, accent }: { label: string; value: number; accent?: boolean }) { return <div className="flex justify-between gap-3"><span className="text-muted">{label}</span><strong className={accent ? value > 0 ? 'text-amber-300' : 'text-accent' : ''}>${Number(value).toFixed(2)}</strong></div> }
