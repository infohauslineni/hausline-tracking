import { AlertCircle, ArrowLeft, ArrowRight, CalendarDays, Check, Clock3, Images, MapPin, MessageCircle, Package, PackageCheck, PartyPopper, Plane, Search, ShieldCheck, Truck } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Brand } from '../../components/ui/Brand'
import { HauslineLogo } from '../../components/ui/HauslineLogo'
import { isSupabaseConfigured } from '../../lib/supabase'
import { buscarPedidoPublico } from '../../services/publicTracking.service'
import type { EstadoPedido } from '../../types/domain'
import type { PublicOrder } from '../../types/publicTracking'
import { estimateAfterArrival, postponeUntilFuture } from '../../utils/estimates'
import { whatsappUrl } from '../../utils/whatsapp'
import { DELIVERY_OPCIONES } from '../../constants/pagos'

const STEPS: { code: EstadoPedido; label: string }[] = [
  { code: 'pedido_confirmado', label: 'Orden confirmada' }, { code: 'en_preparacion', label: 'En preparación' },
  { code: 'control_calidad', label: 'Control de calidad' }, { code: 'despachado', label: 'Despachado' },
  { code: 'transito_internacional', label: 'En tránsito internacional' },
  { code: 'llego_nicaragua', label: 'País de destino' }, { code: 'disponible_entrega', label: 'Disponible para entrega' },
  { code: 'entregado', label: 'Entregado' },
]
const aliases: Partial<Record<EstadoPedido, EstadoPedido>> = {
  etiqueta_creada: 'despachado',
  recibido_estados_unidos: 'transito_internacional',
  transito_nicaragua: 'transito_internacional',
}
// Índice canónico de una etapa según su etiqueta pública (para limpiar el historial).
const indiceEtapa = (label: string) => STEPS.findIndex((step) => step.label === label)

export function TrackingPage() {
  const { codigo } = useParams()
  const navigate = useNavigate()
  const [input, setInput] = useState(codigo?.toUpperCase() ?? '')
  const [order, setOrder] = useState<PublicOrder | null>(null)
  const [loading, setLoading] = useState(Boolean(codigo))
  const [notFound, setNotFound] = useState(false)
  const load = useCallback(async (code: string, silent = false) => {
    if (!silent) { setLoading(true); setNotFound(false); setOrder(null) }
    try { const data = await buscarPedidoPublico(code); setOrder(data); setNotFound(!data) }
    catch { if (!silent) setNotFound(true) }
    finally { if (!silent) setLoading(false) }
  }, [])

  useEffect(() => { if (codigo) void Promise.resolve().then(() => load(codigo)) }, [codigo, load])
  useEffect(() => { if (!codigo || !order || !isSupabaseConfigured) return; const timer = window.setInterval(() => void load(codigo, true), 60_000); return () => window.clearInterval(timer) }, [codigo, load, order])
  const submit = (event: FormEvent) => { event.preventDefault(); const code = input.trim().toUpperCase(); if (!/^HS\d{6}$/.test(code)) { setNotFound(true); setOrder(null); return } navigate(`/tracking/${code}`) }

  return <main className="relative min-h-screen overflow-hidden bg-app text-white">
    <div className="tracking-glow" />
    <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-6 sm:px-8"><Link to="/tracking" aria-label="Inicio de rastreo"><Brand /></Link><Link to="/login" className="subtle-button"><span className="hidden sm:inline">Acceso administrativo</span><ArrowRight size={16} /></Link></header>
    {!codigo ? <Landing input={input} setInput={setInput} submit={submit} notFound={notFound} /> : <ResultArea order={order} loading={loading} input={input} setInput={setInput} submit={submit} notFound={notFound} />}
    <footer className="relative mx-auto flex w-full max-w-6xl flex-col gap-2 border-t border-line px-5 py-5 text-center text-xs text-muted sm:flex-row sm:justify-between sm:px-8"><span>© 2026 Hausline</span><span>Los tiempos pueden variar por logística internacional.</span></footer>
  </main>
}

function Landing({ input, setInput, submit, notFound }: SearchProps & { notFound: boolean }) {
  return <section className="relative mx-auto flex min-h-[calc(100vh-170px)] w-full max-w-2xl flex-col items-center justify-center px-5 py-16 text-center"><HauslineLogo size={72} glow className="rounded-2xl shadow-accent" /><p className="eyebrow mt-7">Seguimiento de pedidos</p><h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] sm:text-6xl">¿Dónde está tu pedido?</h1><p className="mt-5 max-w-lg text-sm leading-6 text-muted sm:text-base">Ingresa el código Hausline que recibiste al confirmar tu compra.</p><TrackingSearch input={input} setInput={setInput} submit={submit} />{notFound && <NotFound />}<p className="mt-5 text-xs text-muted">Tu código comienza con HS y contiene 6 números.</p></section>
}

function ResultArea({ order, loading, input, setInput, submit, notFound }: SearchProps & { order: PublicOrder | null; loading: boolean; notFound: boolean }) {
  if (loading) return <TrackingSkeleton />
  if (!order || notFound) return <section className="relative mx-auto min-h-[calc(100vh-170px)] max-w-2xl px-5 py-14"><Link to="/tracking" className="inline-flex items-center gap-2 text-xs text-muted hover:text-white"><ArrowLeft size={15} /> Nueva búsqueda</Link><div className="mt-20 text-center"><NotFound /><TrackingSearch input={input} setInput={setInput} submit={submit} /></div></section>
  const statusCode = aliases[order.estado_codigo] ?? order.estado_codigo
  const stepIndex = STEPS.findIndex((step) => step.code === statusCode)
  const currentIndex = Math.max(0, stepIndex)
  // La cuenta regresiva ("faltan X días") solo aparece cuando el pedido ya fue despachado.
  // Antes de eso mostramos solo la fecha estimada para no asustar al cliente con "faltan muchos días".
  const mostrarCuenta = stepIndex >= STEPS.findIndex((step) => step.code === 'despachado')
  const isDelivered = order.estado_codigo === 'entregado'
  const isIssue = order.estado_codigo === 'incidencia' || order.estado_codigo === 'cancelado'
  // Tope del historial: nunca mostramos una etapa más avanzada que la actual.
  // Así, si un pedido se adelantó por error y luego se regresó, el cliente solo ve el avance real.
  const capIndex = stepIndex >= 0 ? currentIndex : STEPS.length - 1
  const progress = isDelivered ? 100 : isIssue ? Math.max(8, currentIndex * (100 / (STEPS.length - 1))) : (currentIndex / (STEPS.length - 1)) * 100
  const whatsapp = import.meta.env.VITE_WHATSAPP_NUMBER
  const llegadaPais = [...order.historial].reverse().find((entry) => entry.estado === 'País de destino')
  // Momento en que el pedido quedó disponible para entrega (para la política de bodega).
  const disponibleDesde = order.historial.find((entry) => entry.estado === 'Disponible para entrega')?.fecha ?? order.ultima_actualizacion
  // Despacho = primer registro de "Despachado"; si no existe, el primer "En tránsito internacional".
  const despachoEntry = order.historial.find((entry) => entry.estado === 'Despachado') ?? order.historial.find((entry) => entry.estado === 'En tránsito internacional')
  // Días en tránsito visibles para el cliente: del despacho a la llegada al país (o hasta hoy si sigue en camino).
  const transitoDias = despachoEntry ? Math.max(0, Math.round(((llegadaPais ? new Date(llegadaPais.fecha) : new Date()).getTime() - new Date(despachoEntry.fecha).getTime()) / 86_400_000)) : null
  const entregaRegistrada = order.fecha_entrega ?? [...order.historial].reverse().find((entry) => entry.estado === 'Entregado')?.fecha
  // Fecha clave que ve el cliente. Si ya llegó al país pero no se marcó "disponible",
  // la estimación se recalcula agregando días hábiles (ver estimateAfterArrival).
  const fechaClave = entregaRegistrada
    ? entregaRegistrada
    : order.estado_codigo === 'disponible_entrega'
      ? order.fecha_estimada
      : llegadaPais && order.estado_codigo === 'llego_nicaragua'
        ? estimateAfterArrival(llegadaPais.fecha)
        : order.fecha_estimada ? postponeUntilFuture(order.fecha_estimada, 3) : null
  const estimacion: Estimacion = {
    label: entregaRegistrada ? 'Entregado' : order.estado_codigo === 'disponible_entrega' ? 'Disponible desde' : 'Entrega estimada',
    value: fechaClave ? formatDate(fechaClave) : 'Por confirmar',
    date: fechaClave,
    delivered: Boolean(entregaRegistrada),
  }

  return <section key={order.codigo} className="tracking-result relative mx-auto min-h-[calc(100vh-170px)] w-full max-w-6xl px-5 py-7 sm:px-8 sm:py-12">
    <div className="reveal-up flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between" style={{ animationDelay: '0ms' }}><div><Link to="/tracking" className="inline-flex items-center gap-2 text-xs text-muted hover:text-white"><ArrowLeft size={15} /> Consultar otro pedido</Link><p className="eyebrow mt-6">Pedido {order.codigo}</p><div className="mt-2 flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold tracking-tight sm:text-4xl">{order.estado}</h1>{order.estado_codigo === 'incidencia' && <span className="status-badge status-danger"><AlertCircle size={13} /> Requiere atención</span>}</div><p className="mt-2 flex items-center gap-2 text-xs text-muted sm:text-sm"><Clock3 size={15} /> Actualizado {formatDateTime(order.ultima_actualizacion)}</p></div><div className="w-full max-w-sm"><TrackingSearch input={input} setInput={setInput} submit={submit} compact /></div></div>

    <div className="reveal-up" style={{ animationDelay: '90ms' }}><ProgressCard steps={STEPS} currentIndex={currentIndex} progress={progress} isDelivered={isDelivered} estimacion={estimacion} mostrarCuenta={mostrarCuenta} /></div>

    <div className="mt-5 grid gap-5 lg:grid-cols-[1.45fr_.75fr]">
      <div className="reveal-up space-y-5" style={{ animationDelay: '180ms' }}><Products order={order} /><OrderImages order={order} type="producto" title="Fotos del producto" description="Imágenes de los artículos confirmados para tu pedido." fallback={order.productos.filter((product) => product.imagen).map((product, index) => ({ url: product.imagen as string, storage_path: `catalogo-${index}` }))} /><OrderImages order={order} type="control_calidad" title="Control de calidad" description="Fotos de revisión y preparación de tu pedido." /><OrderImages order={order} type="recepcion_miami" title="Recibido en bodega Miami" description="Foto del paquete al llegar a la bodega de nuestra agencia." /><OrderImages order={order} type="recibido_local" title="Recibido por Hausline" description="Confirmación de que recibimos tu paquete físicamente." /><Timeline order={order} capIndex={capIndex} /><Journeys order={order} /></div>
      <aside className="reveal-up space-y-5 lg:sticky lg:top-6 lg:self-start" style={{ animationDelay: '270ms' }}>{order.estado_codigo === 'disponible_entrega' && <DeliveryCard codigo={order.codigo} whatsapp={whatsapp} disponibleDesde={disponibleDesde} />}<section className="public-card"><h2 className="flex items-center gap-2 text-sm font-semibold"><CalendarDays size={17} className="text-accent" /> Fechas importantes</h2>{transitoDias != null && <div className="mt-4 flex items-center gap-3 rounded-xl border border-accent/25 bg-accent/[0.06] p-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent"><Plane size={17} /></span><div><strong className="block text-lg leading-none text-white">{transitoDias} {transitoDias === 1 ? 'día' : 'días'} en tránsito</strong><span className="mt-1 block text-[11px] text-muted">{llegadaPais ? 'Desde el despacho hasta que llegó al país' : 'Desde el despacho, tu pedido sigue en camino'}</span></div></div>}<div className="mt-5 space-y-4"><DateRow label="Pedido realizado" value={formatDate(order.fecha_pedido)} />{llegadaPais && <DateRow label="Llegó al país" value={formatDate(llegadaPais.fecha)} />}<DateRow label={estimacion.label} value={estimacion.value} highlight /><DateRow label="Última actualización" value={formatDate(order.ultima_actualizacion)} /></div></section>{order.notas_publicas && <section className="public-card"><h2 className="text-sm font-semibold">Nota sobre tu pedido</h2><p className="mt-3 text-sm leading-6 text-muted">{order.notas_publicas}</p></section>}<section className="public-card"><ShieldCheck size={20} className="text-accent" /><h2 className="mt-3 text-sm font-semibold">Información segura</h2><p className="mt-2 text-xs leading-5 text-muted">Esta página solo muestra información pública de tu pedido. Las fechas son estimadas y pueden variar por la logística internacional.</p>{whatsapp && <a href={whatsappUrl(whatsapp, `Hola, necesito ayuda con mi pedido ${order.codigo}.`)} target="_blank" rel="noopener noreferrer" className="primary-button mt-5 w-full"><MessageCircle size={17} /> Contactar por WhatsApp</a>}</section></aside>
    </div>
  </section>
}

type Estimacion = { label: string; value: string; date: string | null; delivered: boolean }

// Días de calendario que faltan para la fecha estimada (positivo = futuro, 0 = hoy, negativo = pasó).
function diasRestantes(dateStr: string) {
  const target = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T12:00:00`)
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - hoy.getTime()) / 86_400_000)
}

function EtaHero({ estimacion, mostrarCuenta = true }: { estimacion: Estimacion; mostrarCuenta?: boolean }) {
  // Antes del despacho solo mostramos la fecha estimada, sin cuenta regresiva de días.
  const dias = mostrarCuenta && !estimacion.delivered && estimacion.date ? diasRestantes(estimacion.date) : null
  const cuenta = dias == null ? null : dias > 1 ? { big: String(dias), small: 'días' } : dias === 1 ? { big: '1', small: 'día' } : dias === 0 ? { big: 'Hoy', small: '¡llega!' } : { big: 'Ya', small: 'muy pronto' }
  const subtitulo = dias == null ? null : dias > 1 ? `Faltan ${dias} días` : dias === 1 ? 'Llega mañana' : dias === 0 ? 'Llega hoy' : 'En camino, muy pronto'
  return <div className={`eta-hero mt-4 flex items-center justify-between gap-4 rounded-2xl border p-4 sm:p-5 ${estimacion.delivered ? 'border-[#62eaa0]/30 bg-[#62eaa0]/[0.08]' : 'border-accent/30 bg-accent/[0.08]'}`}>
    <div className="min-w-0">
      <p className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[.15em] ${estimacion.delivered ? 'text-[#7af0ae]' : 'text-accent'}`}><CalendarDays size={14} /> {estimacion.label}</p>
      <strong className="mt-1.5 block text-2xl font-black leading-none tracking-tight text-white sm:text-4xl">{estimacion.value}</strong>
      {subtitulo && <span className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-muted"><Clock3 size={13} className="text-accent" /> {subtitulo}</span>}
    </div>
    {estimacion.delivered
      ? <span className="eta-badge grid size-16 shrink-0 place-items-center rounded-2xl border border-[#62eaa0]/30 bg-[#62eaa0]/12 text-[#7af0ae] sm:size-20"><PartyPopper size={30} /></span>
      : cuenta && <span className="eta-badge grid size-16 shrink-0 place-items-center rounded-2xl border border-accent/30 bg-accent/12 text-center sm:size-20"><strong className="text-2xl font-black leading-none text-accent sm:text-3xl">{cuenta.big}</strong><span className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-accent/80 sm:text-[10px]">{cuenta.small}</span></span>}
  </div>
}

function ProgressCard({ steps, currentIndex, progress, isDelivered, estimacion, mostrarCuenta }: { steps: typeof STEPS; currentIndex: number; progress: number; isDelivered: boolean; estimacion: Estimacion; mostrarCuenta: boolean }) {
  return <section className={`public-card mt-6 sm:mt-8 ${isDelivered ? 'border-[#62eaa0]/25' : ''}`}>
    <div className="flex items-center justify-between gap-3">
      <div><p className="text-xs font-semibold">Progreso del pedido</p><p className="mt-1 text-[11px] text-muted">{Math.round(progress)}% completado</p></div>
      <span className={`relative grid size-10 shrink-0 place-items-center rounded-xl ${isDelivered ? 'bg-[#62eaa0]/12 text-[#7af0ae]' : 'bg-accent/10 text-accent'}`}>{isDelivered ? <PartyPopper size={19} /> : <PackageCheck size={19} />}{isDelivered && <Confetti />}</span>
    </div>
    {isDelivered && <div className="delivered-banner mt-4 flex items-center gap-3 rounded-xl border border-[#62eaa0]/25 bg-[#62eaa0]/[0.07] p-3.5"><span className="step-dot step-done step-delivered size-9"><Check size={18} /></span><div><strong className="block text-sm text-[#7af0ae]">¡Tu pedido fue entregado!</strong><span className="text-[11px] text-muted">Gracias por comprar con Hausline.</span></div></div>}
    <EtaHero estimacion={estimacion} mostrarCuenta={mostrarCuenta} />
    <div className="mt-5">
      <div className="progress-track"><div className={`progress-fill ${isDelivered ? 'is-complete' : ''}`} style={{ width: `${progress}%` }} /></div>
    </div>
    {/* Móvil: stepper vertical (más legible en pantalla pequeña) */}
    <ol className="mt-6 space-y-0 sm:hidden">
      {steps.map((step, index) => {
        const state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo'
        const deliveredStep = isDelivered && index === steps.length - 1
        return <li key={step.code} className="flex gap-3">
          <div className="flex flex-col items-center"><span className={`step-dot size-8 ${state === 'todo' ? 'step-todo' : 'step-done'} ${state === 'current' && !isDelivered ? 'step-current' : ''} ${deliveredStep ? 'step-delivered' : ''}`}>{state === 'todo' ? <span className="text-[11px] font-semibold">{index + 1}</span> : <Check size={15} />}</span>{index < steps.length - 1 && <span className={`my-1 w-px flex-1 ${index < currentIndex ? 'bg-accent/60' : 'bg-line'}`} style={{ minHeight: '1.1rem' }} />}</div>
          <span className={`pb-4 pt-1 text-sm ${index <= currentIndex ? 'font-medium text-white' : 'text-muted'}`}>{step.label}{state === 'current' && !isDelivered && <span className="ml-2 align-middle text-[10px] font-semibold uppercase tracking-wide text-accent">En curso</span>}</span>
        </li>
      })}
    </ol>
    {/* Escritorio: stepper horizontal */}
    <div className="mt-7 hidden gap-1 sm:flex">
      {steps.map((step, index) => {
        const state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo'
        const deliveredStep = isDelivered && index === steps.length - 1
        return <div key={step.code} className="flex min-w-0 flex-1 flex-col items-center text-center">
          <div className="flex w-full items-center"><span className={`h-px flex-1 ${index === 0 ? 'opacity-0' : index <= currentIndex ? 'bg-accent/60' : 'bg-line'}`} /><span className={`step-dot size-7 shrink-0 ${state === 'todo' ? 'step-todo' : 'step-done'} ${state === 'current' && !isDelivered ? 'step-current' : ''} ${deliveredStep ? 'step-delivered' : ''}`}>{state === 'todo' ? <span className="text-[10px] font-semibold">{index + 1}</span> : <Check size={13} />}</span><span className={`h-px flex-1 ${index === steps.length - 1 ? 'opacity-0' : index < currentIndex ? 'bg-accent/60' : 'bg-line'}`} /></div>
          <span className={`mt-2 text-[10px] font-medium leading-3 ${index <= currentIndex ? 'text-white' : 'text-muted'}`}>{step.label}</span>
        </div>
      })}
    </div>
  </section>
}

function Confetti() {
  const colors = ['#b7ff00', '#62eaa0', '#76b4ff', '#ffd467', '#b98cff']
  return <span aria-hidden className="pointer-events-none absolute inset-0 overflow-visible">{Array.from({ length: 10 }).map((_, index) => <span key={index} className="confetti-piece" style={{ left: `${8 + index * 9}%`, background: colors[index % colors.length], animationDelay: `${(index % 5) * 0.09}s` }} />)}</span>
}

function Products({ order }: { order: PublicOrder }) { return <section className="public-card"><h2 className="flex items-center gap-2 text-sm font-semibold"><Package size={17} className="text-accent" /> Tu pedido</h2><div className="mt-4 divide-y divide-line">{order.productos.map((product, index) => <div className="flex items-center gap-3 py-4" key={`${product.producto}-${index}`}><span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-white/[0.04] text-muted">{product.imagen ? <img src={product.imagen} alt="" className="size-full object-cover" /> : <Package size={19} />}</span><div className="min-w-0 flex-1"><strong className="block truncate text-sm">{product.producto}</strong><span className="mt-1 block text-xs text-muted">{[product.marca, product.talla, product.color].filter(Boolean).join(' · ') || 'Producto confirmado'}</span></div><span className="text-xs font-semibold">×{product.cantidad}</span></div>)}</div></section> }
function OrderImages({ order, type, title, description, fallback }: { order: PublicOrder; type: 'producto' | 'control_calidad' | 'recepcion_miami' | 'recibido_local'; title: string; description: string; fallback?: { url: string; storage_path: string }[] }) { const uploaded = (order.imagenes ?? []).filter((image) => image.tipo === type && image.url).map((image) => ({ url: image.url as string, storage_path: image.storage_path })); const images = uploaded.length ? uploaded : (fallback ?? []); if (!images.length) return null; return <section className="public-card"><h2 className="flex items-center gap-2 text-sm font-semibold"><Images size={17} className="text-accent" /> {title}</h2><p className="mt-2 text-xs leading-5 text-muted">{description}</p><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">{images.map((image, index) => <button type="button" key={`${image.storage_path}-${index}`} className="group aspect-square overflow-hidden rounded-xl border border-line bg-white/[0.025]" onClick={() => image.url && window.open(image.url, '_blank', 'noopener,noreferrer')}><img src={image.url} alt={`${title} ${index + 1}`} className="size-full object-cover transition duration-300 group-hover:scale-[1.03]" /></button>)}</div></section> }
// Limpia el historial: descarta retrocesos, etapas repetidas y cualquier etapa
// posterior a la actual (errores de avance corregidos). Devuelve el avance real.
function historialLimpio(historial: PublicOrder['historial'], capIndex: number) {
  const forward: PublicOrder['historial'] = []
  let ultimo = -1
  for (const entry of historial) { // el historial viene del más antiguo al más reciente
    const idx = indiceEtapa(entry.estado)
    if (idx === -1) { forward.push(entry); continue } // estados especiales (incidencia, etc.)
    if (idx > capIndex || idx <= ultimo) continue
    ultimo = idx
    forward.push(entry)
  }
  return forward
}
function Timeline({ order, capIndex }: { order: PublicOrder; capIndex: number }) { const entries = [...historialLimpio(order.historial, capIndex)].reverse(); return <section className="public-card"><h2 className="flex items-center gap-2 text-sm font-semibold"><Clock3 size={17} className="text-accent" /> Historial</h2><div className="relative mt-5 space-y-5 before:absolute before:bottom-3 before:left-[13px] before:top-3 before:w-px before:bg-line">{entries.map((entry, index) => <div className="relative flex gap-3" key={`${entry.fecha}-${index}`}><span className={`relative z-10 mt-0.5 size-7 shrink-0 rounded-full border-4 border-panel ${index === 0 ? 'bg-accent shadow-accent' : 'bg-[#48504b]'}`} /><div><strong className="block text-xs">{entry.estado}</strong>{entry.nota && <p className="mt-1 text-xs leading-5 text-muted">{entry.nota}</p>}<p className="mt-1 text-[10px] text-muted">{entry.ubicacion ? `${entry.ubicacion} · ` : ''}{formatDateTime(entry.fecha)}</p></div></div>)}</div></section> }
function Journeys({ order }: { order: PublicOrder }) { if (!order.trayectos.length) return null; return <section className="public-card"><h2 className="flex items-center gap-2 text-sm font-semibold"><Truck size={17} className="text-accent" /> Trayectos visibles</h2><div className="mt-4 grid gap-3 sm:grid-cols-2">{order.trayectos.map((route, index) => <article className="rounded-xl border border-line bg-black/10 p-4" key={`${route.tracking}-${index}`}><span className="text-[10px] font-semibold uppercase tracking-wider text-accent">Trayecto {index + 1}</span><strong className="mt-2 block text-sm">{route.tipo}</strong><p className="mt-1 text-xs text-muted">{[route.origen, route.destino].filter(Boolean).join(' → ')}</p>{route.ultima_ubicacion && <p className="mt-3 flex items-center gap-1.5 text-xs text-muted"><MapPin size={13} /> {route.ultima_ubicacion}</p>}<p className="mt-2 text-[11px] text-muted">{route.ultimo_evento}</p></article>)}</div></section> }

// Política de bodega: 2 días para confirmar o cancelar sin costo; después, USD 5 por cada día.
const CARGO_BODEGA_DIARIO = 5
const DIAS_GRACIA_BODEGA = 2
function StoragePolicy({ disponibleDesde }: { disponibleDesde: string }) {
  const inicio = new Date(disponibleDesde)
  const dias = Math.max(0, Math.floor((new Date().getTime() - inicio.getTime()) / 86_400_000))
  const diasCobrados = Math.max(0, dias - DIAS_GRACIA_BODEGA)
  const cargo = diasCobrados * CARGO_BODEGA_DIARIO
  const limite = new Date(inicio.getTime() + DIAS_GRACIA_BODEGA * 86_400_000)
  if (diasCobrados > 0) return <div className="mt-4 rounded-xl border border-red-400/30 bg-red-400/[0.06] p-3.5">
    <strong className="flex items-center gap-1.5 text-xs text-red-200"><AlertCircle size={14} /> Cargo por bodega activo</strong>
    <p className="mt-1.5 text-[11px] leading-5 text-red-100/80">Pasaron {dias} días desde que tu pedido quedó disponible. Se aplica un cargo de USD {CARGO_BODEGA_DIARIO} por día después de los primeros {DIAS_GRACIA_BODEGA} días.</p>
    <p className="mt-2 text-[11px] text-muted">Acumulado: <strong className="text-red-200">USD {cargo.toFixed(2)}</strong> ({diasCobrados} {diasCobrados === 1 ? 'día' : 'días'} × USD {CARGO_BODEGA_DIARIO})</p>
  </div>
  return <div className="mt-4 rounded-xl border border-amber-300/25 bg-amber-300/[0.06] p-3.5">
    <strong className="flex items-center gap-1.5 text-xs text-amber-200"><CalendarDays size={14} /> Tienes {DIAS_GRACIA_BODEGA} días para confirmar</strong>
    <p className="mt-1.5 text-[11px] leading-5 text-amber-100/80">Puedes confirmar o cancelar sin costo hasta el <strong>{formatDate(limite.toISOString())}</strong>. Después se cobran USD {CARGO_BODEGA_DIARIO} por cada día que el pedido siga en bodega.</p>
  </div>
}
function DeliveryCard({ codigo, whatsapp, disponibleDesde }: { codigo: string; whatsapp?: string; disponibleDesde: string }) {
  const mensaje = `Hola, mi pedido ${codigo} ya está disponible para entrega. Quiero coordinar el envío y el pago. Mi dirección es: `
  return <section className="public-card border-accent/25 bg-accent/[0.04]">
    <h2 className="flex items-center gap-2 text-sm font-semibold text-accent"><Truck size={17} /> Coordina tu entrega</h2>
    <p className="mt-2 text-xs leading-5 text-muted">Tu pedido está listo. Elegí cómo querés recibirlo:</p>
    <div className="mt-4 space-y-2.5">
      {DELIVERY_OPCIONES.map((opcion) => <div key={opcion.nombre} className="flex items-start justify-between gap-3 rounded-xl border border-line bg-black/10 p-3"><div><strong className="block text-xs">{opcion.nombre}</strong><span className="text-[11px] text-muted">{opcion.detalle}</span></div><strong className="shrink-0 text-xs text-accent">{opcion.costo}</strong></div>)}
    </div>
    <StoragePolicy disponibleDesde={disponibleDesde} />
    <p className="mt-3 text-[11px] leading-5 text-muted">Escribinos por WhatsApp con tu dirección: te confirmamos tu saldo pendiente y te enviamos los números de cuenta para el pago.</p>
    {whatsapp && <a href={whatsappUrl(whatsapp, mensaje)} target="_blank" rel="noopener noreferrer" className="primary-button mt-4 w-full"><MessageCircle size={17} /> Coordinar por WhatsApp</a>}
  </section>
}

type SearchProps = { input: string; setInput: (value: string) => void; submit: (event: FormEvent) => void }
function TrackingSearch({ input, setInput, submit, compact }: SearchProps & { compact?: boolean }) { return <form onSubmit={submit} className={`flex w-full gap-2 rounded-2xl border border-line bg-panel p-2 shadow-2xl ${compact ? '' : 'mt-9 flex-col sm:flex-row'}`}><label className="flex min-w-0 flex-1 items-center gap-3 px-3"><Search size={18} className="shrink-0 text-muted" /><input value={input} onChange={(event) => setInput(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0,8))} className="h-11 min-w-0 flex-1 bg-transparent text-sm font-semibold uppercase tracking-widest outline-none placeholder:font-normal placeholder:tracking-normal placeholder:text-muted" placeholder="Ejemplo: HS483682" aria-label="Código del pedido" /></label><button disabled={input.length < 8} className="primary-button min-h-11 shrink-0 px-4" aria-label="Rastrear pedido"><span className={compact ? 'hidden' : ''}>Rastrear</span><ArrowRight size={17} /></button></form> }
function NotFound() { return <div className="mx-auto mt-5 w-full rounded-xl border border-red-400/15 bg-red-400/[0.05] p-4 text-left text-sm leading-6 text-red-100"><strong className="block">No encontramos un pedido con ese código.</strong><span className="text-xs text-red-100/70">Verifica que esté escrito correctamente o contáctanos por WhatsApp.</span></div> }
function TrackingSkeleton() { return <section className="relative mx-auto min-h-[calc(100vh-170px)] w-full max-w-6xl animate-pulse px-5 py-12 sm:px-8"><div className="h-7 w-48 rounded bg-white/[0.06]" /><div className="mt-4 h-12 w-80 max-w-full rounded bg-white/[0.06]" /><div className="mt-8 h-56 rounded-2xl border border-line bg-panel" /><div className="mt-5 grid gap-5 lg:grid-cols-2"><div className="h-72 rounded-2xl border border-line bg-panel" /><div className="h-72 rounded-2xl border border-line bg-panel" /></div></section> }
function DateRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) { return <div className="flex items-center justify-between gap-3"><span className="text-xs text-muted">{label}</span><strong className={`text-xs ${highlight ? 'text-accent' : ''}`}>{value}</strong></div> }
function formatDate(value: string) { return new Intl.DateTimeFormat('es-NI', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value.includes('T') ? value : `${value}T12:00:00`)) }
function formatDateTime(value: string) { return new Intl.DateTimeFormat('es-NI', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) }
