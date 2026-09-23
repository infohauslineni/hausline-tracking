import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, Images, MessageCircle, Package, Search, Share2, X } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { PortalShell, Wordmark } from '../../components/public/PortalChrome'
import { isSupabaseConfigured } from '../../lib/supabase'
import { buscarPedidoPublico } from '../../services/publicTracking.service'
import type { EstadoPedido } from '../../types/domain'
import type { PublicOrder } from '../../types/publicTracking'
import { estimateAfterArrival, postponeToMinFuture, postponeUntilFuture } from '../../utils/estimates'
import { whatsappUrl } from '../../utils/whatsapp'
import { resolverImagenCatalogo } from '../../utils/catalogoImagen'
import { pedidosGuardados, recordarPedido } from '../../utils/pedidosLocales'
import { etapaBase, notaPublicaEstado } from '../../constants/orders'

// Base monocromo (negro/gris). Los indicadores de progreso llevan color:
// barra + "En curso" del resumen = VERDE; lista de etapas ("Estado del pedido") = AZUL.
const ACCENT = '#1a1a1a'
const SOFT_BG = '#faf8f3'     // fondo cálido de tarjetas destacadas (entrega, ayuda)
const GREEN = '#16a34a'; const GREEN_BG = '#e7f6ec'
const BLUE = '#2563eb'; const BLUE_BG = '#e8eefc'

// Las 8 etapas que ve el cliente.
const STEPS = [
  'Pedido recibido', 'Pedido confirmado', 'Preparación', 'Control de calidad',
  'En tránsito', 'Llegó a Nicaragua', 'Listo para entregar', 'Entregado',
]
// Estado real del pedido (colapsado) → índice de etapa mostrada.
const STEP_INDEX: Partial<Record<EstadoPedido, number>> = {
  pedido_confirmado: 1, en_preparacion: 2, control_calidad: 3, transito_internacional: 4,
  llego_nicaragua: 5, disponible_entrega: 6, empaquetado: 6, pagado: 6, entregado: 7,
}
const indiceActual = (estado: EstadoPedido) => STEP_INDEX[etapaBase(estado)] ?? 0

export function TrackingPage() {
  const { codigo } = useParams()
  const navigate = useNavigate()
  const [input, setInput] = useState(codigo?.toUpperCase() ?? '')
  const [order, setOrder] = useState<PublicOrder | null>(null)
  const [loading, setLoading] = useState(Boolean(codigo))
  const [notFound, setNotFound] = useState(false)
  const load = useCallback(async (code: string, silent = false) => {
    if (!silent) { setLoading(true); setNotFound(false); setOrder(null) }
    const inicio = Date.now()
    try {
      const data = await buscarPedidoPublico(code)
      // La animación "Buscando tu pedido" se muestra al menos un momento (evita el parpadeo).
      if (!silent) { const resto = 900 - (Date.now() - inicio); if (resto > 0) await new Promise((r) => setTimeout(r, resto)) }
      setOrder(data); setNotFound(!data); if (data) recordarPedido(data.codigo)
    }
    catch { if (!silent) setNotFound(true) }
    finally { if (!silent) setLoading(false) }
  }, [])

  useEffect(() => { if (codigo) void Promise.resolve().then(() => load(codigo)) }, [codigo, load])
  useEffect(() => { if (!codigo || !order || !isSupabaseConfigured) return; const timer = window.setInterval(() => void load(codigo, true), 60_000); return () => window.clearInterval(timer) }, [codigo, load, order])
  const submit = (event: FormEvent) => { event.preventDefault(); const code = input.replace(/[^A-Za-z0-9]/g, '').toUpperCase(); if (!/^HS\d{6}$/.test(code)) { setNotFound(true); setOrder(null); return } navigate(`/pedido/${code}`) }

  return <PortalShell>
    {!codigo
      ? <Landing input={input} setInput={setInput} submit={submit} notFound={notFound} />
      : <ResultArea order={order} loading={loading} notFound={notFound} />}
  </PortalShell>
}

/* ----------------------------------- Landing ----------------------------------- */
function Landing({ input, setInput, submit, notFound }: SearchProps & { notFound: boolean }) {
  const recientes = useMemo(() => pedidosGuardados().slice(0, 4), [])
  return <section className="mx-auto w-full max-w-xl px-5 pb-10 pt-10 text-center sm:pt-20">
    <p className="hsp-eyebrow hsp-rise">Seguimiento de pedidos</p>
    <h1 className="hsp-display hsp-rise mt-4 text-4xl font-semibold leading-[1.05] sm:text-6xl" style={{ animationDelay: '40ms' }}>¿Dónde está<br />tu pedido?</h1>
    <p className="hsp-muted hsp-rise mx-auto mt-5 max-w-md text-[15px] leading-7" style={{ animationDelay: '80ms' }}>Ingresá el código que recibiste al confirmar tu compra y seguí tu pedido paso a paso. Sin cuenta, sin contraseñas.</p>
    <div className="hsp-rise mt-8" style={{ animationDelay: '120ms' }}><TrackingSearch input={input} setInput={setInput} submit={submit} /></div>
    {notFound && <NotFound />}
    <p className="hsp-faint mt-4 text-xs">Tu código empieza con <span className="hsp-mono font-semibold">HS</span> y tiene 6 números.</p>

    {recientes.length > 0 && <div className="hsp-rise mx-auto mt-10 max-w-md text-left" style={{ animationDelay: '160ms' }}>
      <p className="hsp-eyebrow mb-2.5">Tus pedidos en este dispositivo</p>
      <div className="hsp-card hsp-divide overflow-hidden">
        {recientes.map((item) => <Link key={item.codigo} to={`/pedido/${item.codigo}`} className="hsp-row px-4 py-3.5 transition-colors hover:bg-black/[0.02]">
          <span className="hsp-mono text-sm font-bold">{item.codigo}</span>
          <ChevronRight size={16} className="hsp-faint" />
        </Link>)}
      </div>
      <Link to="/mis-pedidos" className="hsp-muted mt-2.5 inline-flex items-center gap-1 text-xs font-semibold hover:text-black">Ver todos mis pedidos <ArrowRight size={13} /></Link>
    </div>}

    <TrustFooter />
  </section>
}

/* --------------------------------- Result area --------------------------------- */
function ResultArea({ order, loading, notFound }: { order: PublicOrder | null; loading: boolean; notFound: boolean }) {
  if (loading) return <SearchingLoader />
  if (!order || notFound) return <section className="mx-auto max-w-xl px-5 py-16 text-center">
    <NotFound />
    <Link to="/pedido" className="hsp-btn hsp-btn--line mt-6 inline-flex"><ArrowLeft size={16} /> Consultar otro pedido</Link>
  </section>

  const isCancelled = order.estado_codigo === 'cancelado'
  const isDelivered = order.estado_codigo === 'entregado'
  const currentIndex = indiceActual(order.estado_codigo)

  return <section key={order.codigo} className="mx-auto w-full max-w-xl px-4 pb-4 sm:px-6">
    <Link to="/pedido" className="hsp-muted hsp-rise inline-flex items-center gap-1.5 text-xs font-semibold hover:text-black"><ArrowLeft size={14} /> Consultar otro pedido</Link>

    <div className="mt-4 space-y-3">
      {/* 1 · Pedido + producto */}
      <div className="hsp-rise"><OrderHero order={order} /></div>

      {/* 2 · Seguimiento (resumen) */}
      <div className="hsp-rise" style={{ animationDelay: '60ms' }}><TrackerCard order={order} currentIndex={currentIndex} isCancelled={isCancelled} isDelivered={isDelivered} /></div>

      {/* 3 · Fotos de control de calidad (van ARRIBA del estado del pedido) */}
      {!isCancelled && <div className="hsp-rise" style={{ animationDelay: '110ms' }}><OrderPhotos order={order} /></div>}

      {/* 4 · Estado del pedido (8 etapas) */}
      {!isCancelled && <div className="hsp-rise" style={{ animationDelay: '150ms' }}><StagesCard currentIndex={currentIndex} isDelivered={isDelivered} /></div>}

      {/* 5 · Detalle del pedido (montos ocultos hasta iniciar sesión) */}
      <div className="hsp-rise" style={{ animationDelay: '190ms' }}><DetailCard order={order} /></div>

      {/* 6 · Ayuda */}
      <div className="hsp-rise" style={{ animationDelay: '230ms' }}><HelpCard codigo={order.codigo} /></div>
    </div>

    <TrustFooter />
  </section>
}

/* --------------------------- 1 · Pedido + producto ----------------------------- */
function OrderHero({ order }: { order: PublicOrder }) {
  const productos = order.productos ?? []
  const principal = productos[0]
  const foto = principal ? resolverImagenCatalogo(principal.imagen) : null
  const extra = productos.length - 1
  return <section className="hsp-card p-4">
    <div className="flex items-center justify-between gap-2">
      <span className="hsp-eyebrow">Pedido</span>
      <span className="hsp-chip">{order.codigo}</span>
    </div>
    <div className="mt-3 flex items-center gap-3.5">
      <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl" style={{ background: 'var(--chip)', color: 'var(--faint)' }}>{foto ? <img src={foto} alt="" className="size-full object-cover" /> : <Package size={22} />}</span>
      <div className="min-w-0 flex-1">
        <strong className="block truncate text-[15px] leading-tight">{principal?.producto ?? 'Tu pedido'}</strong>
        <span className="hsp-muted mt-0.5 block text-xs">{[principal?.talla && `Talla ${principal.talla}`, principal ? `×${principal.cantidad}` : null, principal?.color].filter(Boolean).join(' · ')}{extra > 0 ? ` · +${extra} más` : ''}</span>
        <span className="hsp-faint mt-1 block text-[11px]">Pedido realizado: {formatDate(order.fecha_pedido)}</span>
      </div>
    </div>
  </section>
}

/* --------------------------- 2 · Seguimiento + etapas -------------------------- */
function TrackerCard({ order, currentIndex, isCancelled, isDelivered }: { order: PublicOrder; currentIndex: number; isCancelled: boolean; isDelivered: boolean }) {
  const [copiado, setCopiado] = useState(false)
  const nota = order.notas_publicas ?? notaPublicaEstado(order.estado_codigo)

  if (isCancelled) return <section className="hsp-card p-4">
    <div className="flex items-center gap-2.5">
      <span className="size-2.5 rounded-full" style={{ background: '#dc2626' }} />
      <h2 className="hsp-display text-xl font-semibold">Pedido cancelado</h2>
    </div>
    <p className="hsp-muted mt-1.5 text-xs leading-5">{nota}</p>
  </section>

  const etapaNum = currentIndex + 1
  const progreso = isDelivered ? 100 : Math.round((etapaNum / STEPS.length) * 100)
  const fechaClave = calcularFechaClave(order)
  const dias = fechaClave && !isDelivered && currentIndex >= 4 ? diasRestantes(fechaClave) : null

  const compartir = async () => {
    const url = `${window.location.origin}/pedido/${order.codigo}`
    try {
      if (navigator.share) { await navigator.share({ title: `Pedido ${order.codigo} · HAUSLINE`, text: 'Seguí mi pedido HAUSLINE', url }) }
      else { await navigator.clipboard.writeText(url); setCopiado(true); window.setTimeout(() => setCopiado(false), 2000) }
    } catch { /* el usuario canceló el compartir */ }
  }

  return <section className="hsp-card p-4">
    {/* Estado actual */}
    <div className="flex items-center gap-2">
      <h2 className="hsp-display text-xl font-semibold">{STEPS[currentIndex]}</h2>
      {isDelivered
        ? <span className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: '#16a34a', background: '#e7f6ec' }}><Check size={11} /> Entregado</span>
        : <span className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: GREEN, background: GREEN_BG }}><span className="hsp-livedot" style={{ ['--tone' as string]: GREEN, width: '.5rem', height: '.5rem' }}><i /></span> En curso</span>}
    </div>
    <p className="hsp-muted mt-1 text-xs leading-5">{nota}</p>

    {/* Barra + etapa */}
    <div className="mt-3">
      <div className="hsp-progress"><div className="hsp-progress__bar" style={{ width: `${Math.max(6, progreso)}%`, background: GREEN }} /></div>
      <p className="hsp-faint mt-1.5 text-[11px]">Etapa {etapaNum} de {STEPS.length} · {progreso}% del proceso</p>
    </div>

    {/* Entrega estimada */}
    <div className="mt-3 flex items-end justify-between gap-3 rounded-xl px-3.5 py-3" style={{ background: SOFT_BG, border: '1px solid var(--hair)' }}>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: ACCENT }}>{isDelivered ? 'Entregado el' : 'Entrega estimada'}</p>
        <strong className="hsp-display mt-0.5 block text-lg font-semibold leading-none">{fechaClave ? formatDate(fechaClave) : 'Por confirmar'}</strong>
        <span className="hsp-muted mt-1 block text-[11px]">{isDelivered ? '¡Gracias por tu compra!' : dias != null ? (dias > 1 ? `Faltan aproximadamente ${dias} días` : dias === 1 ? 'Llega mañana' : dias === 0 ? 'Llega hoy' : 'En camino, muy pronto') : 'La fecha es estimada y puede variar.'}</span>
      </div>
      {dias != null && dias >= 0 && !isDelivered && <span className="grid size-12 shrink-0 place-items-center rounded-xl text-center text-white" style={{ background: ACCENT }}><strong className="text-lg font-bold leading-none" style={{ color: '#fff' }}>{dias === 0 ? '¡Hoy!' : dias}</strong>{dias > 0 && <span className="text-[8px] font-bold uppercase tracking-wide opacity-90">{dias === 1 ? 'día' : 'días'}</span>}</span>}
    </div>
    <p className="hsp-faint mt-2 text-[10px] leading-4">Las fechas son estimadas y pueden variar por la logística internacional.</p>

    {/* Compartir */}
    <button type="button" onClick={compartir} className="hsp-btn hsp-btn--line mt-3 h-11 w-full text-sm">{copiado ? <><Check size={16} /> Enlace copiado</> : <><Share2 size={16} /> Compartir seguimiento</>}</button>
  </section>
}

// Lista de las 8 etapas (tarjeta propia; va DEBAJO de las fotos de control de calidad).
function StagesCard({ currentIndex, isDelivered }: { currentIndex: number; isDelivered: boolean }) {
  return <section className="hsp-card p-4">
    <p className="hsp-eyebrow mb-1">Estado del pedido</p>
    <ol>
      {STEPS.map((label, i) => {
        const done = i < currentIndex || (isDelivered && i === currentIndex), current = i === currentIndex && !isDelivered
        return <li key={label} className="flex items-center gap-3 py-1.5">
          <span className="grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-bold" style={done ? { background: BLUE, color: '#fff' } : current ? { background: BLUE_BG, color: BLUE, border: `1.5px solid ${BLUE}` } : { background: 'var(--chip)', color: 'var(--faint)' }}>{done ? <Check size={12} /> : String(i + 1).padStart(2, '0')}</span>
          <span className={`text-[13px] ${i <= currentIndex ? 'font-semibold text-black' : 'hsp-faint'}`}>{label}</span>
          {current && <span className="ml-auto text-[9px] font-bold uppercase tracking-wide" style={{ color: BLUE }}>En curso</span>}
        </li>
      })}
    </ol>
  </section>
}

/* ----------------------------- 3 · Detalle del pedido -------------------------- */
function DetailCard({ order }: { order: PublicOrder }) {
  const productos = order.productos ?? []
  const principal = productos[0]
  return <section className="hsp-card p-4">
    <h2 className="text-sm font-semibold">Detalle del pedido</h2>
    <div className="mt-3 space-y-2.5 text-[13px]">
      {principal && <Row label="Producto" value={principal.producto} />}
      {principal && <Row label="Talla / cantidad" value={[principal.talla && `Talla ${principal.talla}`, `×${principal.cantidad}`].filter(Boolean).join(' · ')} />}
      <Row label="Pedido" value={order.codigo} mono />
      <Row label="Fecha de compra" value={formatDate(order.fecha_pedido)} />
      <Row label="Método de pago" value="Transferencia" />
    </div>
  </section>
}
function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return <div className="hsp-row gap-3"><span className="hsp-muted shrink-0">{label}</span><strong className={`text-right ${mono ? 'hsp-mono' : ''}`}>{value}</strong></div>
}

/* --------------------------------- 4 · Ayuda ---------------------------------- */
function HelpCard({ codigo }: { codigo: string }) {
  const whatsapp = import.meta.env.VITE_WHATSAPP_NUMBER
  return <section className="hsp-card p-4" style={{ background: SOFT_BG, borderColor: 'var(--hair)' }}>
    <div className="flex items-start gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl text-white" style={{ background: ACCENT }}><MessageCircle size={17} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">¿Necesitás ayuda con tu pedido?</p>
        <p className="hsp-muted mt-0.5 text-xs leading-5">Nuestro equipo está listo para ayudarte.</p>
      </div>
    </div>
    {whatsapp && <a href={whatsappUrl(whatsapp, `Hola, necesito ayuda con mi pedido ${codigo}.`)} target="_blank" rel="noopener noreferrer" className="hsp-btn mt-3 h-11 w-full text-sm" style={{ background: ACCENT, borderColor: ACCENT }}><MessageCircle size={16} /> WhatsApp HAUSLINE <ArrowRight size={15} /></a>}
  </section>
}

/* --------------------------------- 5 · Fotos ---------------------------------- */
const FOTO_LABEL: Record<string, string> = { control_calidad: 'Control de calidad', recibido_hausline: 'Tu producto', producto: 'Producto', empaque: 'Empaquetado', recibido_local: 'Recibido' }
function OrderPhotos({ order }: { order: PublicOrder }) {
  // Control de calidad primero (es lo que más quiere ver el cliente), luego el resto.
  const orden = ['control_calidad', 'recibido_hausline', 'producto', 'empaque', 'recibido_local']
  const fotos = orden.flatMap((tipo) => (order.imagenes ?? []).filter((i) => i.url && i.tipo === tipo).map((i) => ({ url: i.url as string, label: FOTO_LABEL[tipo] })))
  const [visor, setVisor] = useState<number | null>(null)
  // Sin fotos, la sección NO aparece (recién sale cuando se suben las fotos del pedido).
  if (fotos.length === 0) return null
  return <section className="hsp-card p-4">
    <h2 className="flex items-center gap-2 text-sm font-semibold"><Images size={16} /> Fotos de tu pedido</h2>
    <p className="hsp-muted mt-1 text-xs">Fotos reales de tu producto en control de calidad y cada etapa. Tocá una para verla en grande.</p>
    {fotos.length === 1
      ? // Una sola foto: se ve completa (sin recorte) y ocupa todo el ancho.
        <button type="button" onClick={() => setVisor(0)} className="relative mt-3 block w-full overflow-hidden rounded-xl border" style={{ borderColor: 'var(--hair)', background: 'var(--chip)' }}>
          <img src={fotos[0].url} alt={fotos[0].label} className="mx-auto block max-h-[70vh] w-full object-contain" />
          <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-black backdrop-blur">{fotos[0].label}</span>
        </button>
      : // Varias fotos: galería de miniaturas; al tocar se abre el visor.
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {fotos.map((f, i) => <button key={i} type="button" onClick={() => setVisor(i)} className="relative aspect-square overflow-hidden rounded-lg border" style={{ borderColor: 'var(--hair)' }}>
            <img src={f.url} alt={f.label} className="size-full object-cover" />
          </button>)}
        </div>}
    {visor !== null && <Lightbox fotos={fotos} index={visor} onIndex={setVisor} onClose={() => setVisor(null)} />}
  </section>
}

// Visor de fotos a pantalla completa: flechas para cambiar, ✕ para cerrar, teclado y swipe.
function Lightbox({ fotos, index, onIndex, onClose }: { fotos: { url: string; label: string }[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const n = fotos.length
  const ir = useCallback((d: number) => onIndex((index + d + n) % n), [index, n, onIndex])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); else if (e.key === 'ArrowLeft') ir(-1); else if (e.key === 'ArrowRight') ir(1) }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [ir, onClose])
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(10,10,12,.95)' }} onClick={onClose} role="dialog" aria-modal="true">
      <button type="button" onClick={onClose} aria-label="Cerrar" className="absolute right-3 top-3 grid size-11 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"><X size={22} /></button>
      {n > 1 && <button type="button" onClick={(e) => { e.stopPropagation(); ir(-1) }} aria-label="Anterior" className="absolute left-2 grid size-11 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20 sm:left-4"><ChevronLeft size={24} /></button>}
      <figure className="flex max-h-full max-w-full flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
        <img src={fotos[index].url} alt={fotos[index].label} className="max-h-[82vh] max-w-full rounded-xl object-contain" />
        <figcaption className="flex items-center gap-2 text-xs font-medium text-white/80">
          <span className="rounded-full bg-white/15 px-2.5 py-0.5">{fotos[index].label}</span>
          {n > 1 && <span>{index + 1} / {n}</span>}
        </figcaption>
      </figure>
      {n > 1 && <button type="button" onClick={(e) => { e.stopPropagation(); ir(1) }} aria-label="Siguiente" className="absolute right-2 grid size-11 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20 sm:right-4"><ChevronRight size={24} /></button>}
    </div>,
    document.body,
  )
}

/* -------------------------------- Pie de confianza ----------------------------- */
function TrustFooter() {
  const items = ['100% Confiable', 'Compras seguras', 'Envíos a todo el país']
  return <footer className="mt-8 flex flex-col items-center gap-3 border-t pt-6 text-center" style={{ borderColor: 'var(--hair)' }}>
    <Wordmark />
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
      {items.map((t) => <span key={t} className="inline-flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: 'var(--ink-soft)' }}><Check size={13} style={{ color: ACCENT }} /> {t}</span>)}
    </div>
  </footer>
}

/* --------------------------------- Buscador ----------------------------------- */
type SearchProps = { input: string; setInput: (value: string) => void; submit: (event: FormEvent) => void }
function TrackingSearch({ input, setInput, submit }: SearchProps) {
  return <form onSubmit={submit} className="hsp-search">
    <Search size={18} className="hsp-faint shrink-0" />
    <input value={input} onChange={(event) => setInput(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))} placeholder="Ej: HS483682" aria-label="Código del pedido" inputMode="text" autoCapitalize="characters" />
    <button disabled={input.replace(/[^A-Z0-9]/g, '').length < 8} className="hsp-btn shrink-0 rounded-xl px-4" aria-label="Rastrear pedido"><ArrowRight size={18} /></button>
  </form>
}
function NotFound() {
  return <div className="mx-auto mt-5 max-w-md rounded-xl px-4 py-3.5 text-left text-sm" style={{ background: '#fdecec', border: '1px solid #f3c4c4', color: '#b91c1c' }}>
    <strong className="block">No encontramos un pedido con ese código.</strong>
    <span className="text-xs" style={{ color: '#c05656' }}>Verificá que esté bien escrito o contactanos por WhatsApp.</span>
  </div>
}

/* ------------------------- Animación "Buscando tu pedido" ---------------------- */
// Caja de zapatos con color + un tenis con color, para que se reconozca claramente.
function SearchingLoader() {
  return <section className="grid min-h-[calc(100vh-240px)] place-items-center px-5">
    <div className="hsp-loader">
      <svg className="hsp-shoebox" viewBox="0 0 200 176" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Buscando tu pedido">
        <defs>
          <linearGradient id="gg-gold" x1="0" y1="-11" x2="0" y2="11" gradientUnits="userSpaceOnUse">
            <stop stopColor="#f0d585" /><stop offset="1" stopColor="#bd8722" />
          </linearGradient>
        </defs>
        <ellipse className="hsp-shadow" cx="100" cy="158" rx="52" ry="8" fill="#b9b3a4" />
        {/* Caja de zapatos con la estrella dorada Golden Goose (la tapa se levanta) */}
        <g className="hsp-box2">
          {/* cuerpo */}
          <rect x="50" y="64" width="100" height="66" rx="9" fill="#f5eeda" stroke="#3a352b" strokeWidth="3" />
          {/* estrella dorada grande al frente (firma Golden Goose) */}
          <g transform="translate(100 94) scale(2.6)"><path d="M0,-10 L2.94,-4.05 L9.51,-3.09 L4.76,1.55 L5.88,8.09 L0,5 L-5.88,8.09 L-4.76,1.55 L-9.51,-3.09 L-2.94,-4.05 Z" fill="url(#gg-gold)" stroke="#8a6a1e" strokeWidth="0.9" strokeLinejoin="round" /></g>
          {/* nombre en la caja */}
          <rect x="82" y="118" width="36" height="4" rx="2" fill="#cbbd97" />
        </g>
        {/* tapa (se levanta) */}
        <g className="hsp-lid2">
          <rect x="44" y="44" width="112" height="24" rx="8" fill="#eae3d1" stroke="#3a352b" strokeWidth="3" />
          <rect x="62" y="54" width="76" height="4" rx="2" fill="#c99a3a" />
        </g>
        {/* destellos dorados */}
        <g fill="#dcae44">
          <path className="hsp-spark hsp-spark-1" d="M60 40 C60.6 44 61 44.4 65 45 C61 45.6 60.6 46 60 50 C59.4 46 59 45.6 55 45 C59 44.4 59.4 44 60 40 Z" />
          <path className="hsp-spark hsp-spark-2" d="M146 52 C146.5 55 146.8 55.3 150 56 C146.8 56.7 146.5 57 146 60 C145.5 57 145.2 56.7 142 56 C145.2 55.3 145.5 55 146 52 Z" />
          <path className="hsp-spark hsp-spark-3" d="M150 30 C150.4 32.4 150.6 32.6 153 33 C150.6 33.4 150.4 33.6 150 36 C149.6 33.6 149.4 33.4 147 33 C149.4 32.6 149.6 32.4 150 30 Z" />
        </g>
      </svg>
      <div className="text-center">
        <p className="text-sm font-semibold">Buscando tu pedido<span className="hsp-dots"><i /><i /><i /></span></p>
        <p className="hsp-faint mt-1 text-xs">Un momento…</p>
      </div>
    </div>
  </section>
}

/* ---------------------------------- Utilidades --------------------------------- */
function calcularFechaClave(order: PublicOrder): string | null {
  const base = etapaBase(order.estado_codigo)
  const llegadaPais = [...order.historial].reverse().find((entry) => entry.estado === 'País de destino')
  const entregaRegistrada = order.fecha_entrega ?? [...order.historial].reverse().find((entry) => entry.estado === 'Entregado')?.fecha
  if (entregaRegistrada) return entregaRegistrada
  if (base === 'disponible_entrega' || base === 'empaquetado' || base === 'pagado') return order.fecha_estimada
  if (llegadaPais && base === 'llego_nicaragua') return estimateAfterArrival(llegadaPais.fecha)
  if (order.fecha_estimada) return base === 'transito_internacional' ? postponeToMinFuture(order.fecha_estimada, 3) : postponeUntilFuture(order.fecha_estimada, 3)
  return null
}
function diasRestantes(dateStr: string) {
  const target = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T12:00:00`)
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0); target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - hoy.getTime()) / 86_400_000)
}
function formatDate(value: string) { return new Intl.DateTimeFormat('es-NI', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value.includes('T') ? value : `${value}T12:00:00`)) }
