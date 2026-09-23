import { Box, ChevronRight, Crown, Heart, MapPin, Settings, ShoppingBag, UserRound } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CuentaShell, useCuenta } from '../../components/cuenta/CuentaShell'
import { EstadoPedidoTag, FotoProducto, MiniProgreso } from '../../components/cuenta/piezas'
import { disponibleParaEntrega, etapaCliente, formatoFecha, listarMisPedidos, TIENDA_URL, type PedidoCuenta } from '../../services/cuentaCliente.service'

const diasHasta = (fecha: string | null) => {
  if (!fecha) return null
  const ms = new Date(`${fecha}T12:00:00`).getTime() - Date.now()
  return Math.max(1, Math.ceil(ms / 86_400_000))
}

export function CuentaInicioPage() {
  const { cuenta } = useCuenta()
  const [pedidos, setPedidos] = useState<PedidoCuenta[] | null>(null)
  useEffect(() => { void listarMisPedidos().then(setPedidos).catch(() => setPedidos([])) }, [])

  const primerNombre = (cuenta?.nombre || 'Cliente').trim().split(/\s+/)[0]
  const activos = useMemo(() => (pedidos ?? []).filter((p) => { const e = etapaCliente(p.estado_codigo); return e === 'proceso' || e === 'enviado' }), [pedidos])
  const disponibles = activos.filter((p) => disponibleParaEntrega(p.estado_codigo) && !p.entrega_solicitada_at)
  const recientes = (pedidos ?? []).slice(0, 2)

  return <CuentaShell inicio={<header className="relative flex h-16 items-center justify-center">
    <span className="hsc-logo">HAUSLINE</span>
    <Link to="/cuenta/datos" className="hsc-iconbtn absolute right-0" aria-label="Configuración de la cuenta"><Settings size={20} strokeWidth={1.7} /></Link>
  </header>}>
    <section className="hsp-rise pt-3">
      <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Hola, {primerNombre}</h1>
      <p className="hsp-muted mt-1 text-[13px]">Gracias por confiar en HAUSLINE.</p>
    </section>

    {/* Tarjeta destacada de pedidos */}
    <section className="hsp-rise mt-5" style={{ animationDelay: '40ms' }}>
      {pedidos === null
        ? <div className="hsc-hero animate-pulse" style={{ height: 96 }} />
        : <TarjetaDestacada activos={activos} disponibles={disponibles} />}
    </section>

    {/* Accesos */}
    <section className="hsp-rise mt-4 grid grid-cols-4 gap-2.5" style={{ animationDelay: '80ms' }}>
      <Acceso to="/cuenta/pedidos" icono={<ShoppingBag size={22} strokeWidth={1.5} />} texto="Mis pedidos" />
      <Acceso to="/cuenta/favoritos" icono={<Heart size={22} strokeWidth={1.5} />} texto="Lista de deseos" />
      <Acceso to="/cuenta/datos" icono={<UserRound size={22} strokeWidth={1.5} />} texto="Datos personales" />
      <Acceso to="/cuenta/direcciones" icono={<MapPin size={22} strokeWidth={1.5} />} texto="Direcciones" />
    </section>

    {/* Pedidos recientes */}
    <section className="hsp-rise mt-7" style={{ animationDelay: '120ms' }}>
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="text-[16px] font-semibold">Pedidos recientes</h2>
        <Link to="/cuenta/pedidos" className="hsc-link inline-flex items-center gap-0.5">Ver todos <ChevronRight size={14} /></Link>
      </div>
      {pedidos === null
        ? <div className="hsp-card h-28 animate-pulse" />
        : recientes.length === 0
          ? <div className="hsp-card p-6 text-center">
              <p className="text-[14px] font-semibold">Todavía no hay pedidos en tu cuenta</p>
              <p className="hsp-muted mx-auto mt-1 max-w-xs text-[12px] leading-5">Si ya compraste, agregá tu pedido con su código (HS…) desde Mis pedidos.</p>
              <Link to="/cuenta/pedidos" className="hsp-btn hsp-btn--line mt-4 inline-flex h-10 min-h-0 text-[13px]">Agregar un pedido</Link>
            </div>
          : <div className="space-y-2.5">{recientes.map((p) => <Link key={p.codigo} to={`/cuenta/pedidos/${p.codigo}`} className="hsp-card hsc-press flex items-center gap-3.5 p-3.5">
              <FotoProducto src={p.imagen} tam={76} />
              <div className="min-w-0 flex-1">
                <strong className="block text-[14px]">Pedido #{p.codigo}</strong>
                <span className="hsp-muted block text-[12px]">{formatoFecha(p.fecha_pedido)}</span>
                <div className="mt-2.5"><MiniProgreso estado={p.estado_codigo} /></div>
                {etapaCliente(p.estado_codigo) === 'cancelado' && <div className="mt-1"><EstadoPedidoTag estado={p.estado_codigo} /></div>}
              </div>
              <ChevronRight size={17} className="hsp-faint shrink-0" />
            </Link>)}</div>}
    </section>

    {/* Club */}
    <a href={TIENDA_URL} className="hsc-club hsp-rise mt-5 flex items-center gap-4 p-4" style={{ animationDelay: '160ms' }}>
      <Crown size={28} strokeWidth={1.3} className="shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="hsp-eyebrow block">HAUSLINE Club</span>
        <strong className="mt-0.5 block text-[15px]">Sé el primero en descubrir</strong>
        <span className="hsp-muted block text-[12px]">Nuevas colecciones, lanzamientos y más.</span>
      </span>
      <ChevronRight size={17} className="hsp-faint shrink-0" />
    </a>
  </CuentaShell>
}

function TarjetaDestacada({ activos, disponibles }: { activos: PedidoCuenta[]; disponibles: PedidoCuenta[] }) {
  // Prioridad: un pedido listo para entregar (acción del cliente) > pedidos en camino.
  if (disponibles.length > 0) {
    const p = disponibles[0]
    return <Link to={`/cuenta/pedidos/${p.codigo}`} className="hsc-hero hsc-press">
      <Box size={30} strokeWidth={1.3} className="shrink-0" />
      <span className="hsc-hero__sep" />
      <span className="min-w-0 flex-1">
        <span className="hsc-hero__eyebrow">Tus pedidos</span>
        <strong className="block text-[15px] text-white">{disponibles.length === 1 ? '1 pedido disponible para entrega' : `${disponibles.length} pedidos disponibles para entrega`}</strong>
        <span className="mt-0.5 flex items-center gap-1.5 text-[12px]" style={{ color: '#86efac' }}><span className="hsc-dot" style={{ background: '#22c55e' }} />Ya está en Nicaragua · solicitá tu envío</span>
      </span>
      <span className="hsc-hero__btn">Ver detalles <ChevronRight size={13} /></span>
    </Link>
  }
  if (activos.length === 0) return <a href={TIENDA_URL} className="hsc-hero hsc-press">
    <Box size={30} strokeWidth={1.3} className="shrink-0" />
    <span className="hsc-hero__sep" />
    <span className="min-w-0 flex-1">
      <span className="hsc-hero__eyebrow">Tus pedidos</span>
      <strong className="block text-[15px] text-white">No tenés pedidos en camino</strong>
      <span className="block text-[12px] text-white/60">Descubrí lo nuevo en la tienda.</span>
    </span>
    <span className="hsc-hero__btn">Ir a la tienda <ChevronRight size={13} /></span>
  </a>
  const proximo = [...activos].filter((p) => p.fecha_estimada).sort((a, b) => (a.fecha_estimada ?? '').localeCompare(b.fecha_estimada ?? ''))[0]
  const dias = diasHasta(proximo?.fecha_estimada ?? null)
  const destino = activos.length === 1 ? `/cuenta/pedidos/${activos[0].codigo}` : '/cuenta/pedidos'
  return <Link to={destino} className="hsc-hero hsc-press">
    <Box size={30} strokeWidth={1.3} className="shrink-0" />
    <span className="hsc-hero__sep" />
    <span className="min-w-0 flex-1">
      <span className="hsc-hero__eyebrow">Tus pedidos</span>
      <strong className="block text-[15px] text-white">{activos.length === 1 ? '1 pedido en tránsito' : `${activos.length} pedidos en tránsito`}</strong>
      <span className="block text-[12px] text-white/60">{dias ? `Llegará en aproximadamente ${dias} ${dias === 1 ? 'día' : 'días'}` : 'Te avisamos en cada etapa'}</span>
    </span>
    <span className="hsc-hero__btn">Ver detalles <ChevronRight size={13} /></span>
  </Link>
}

function Acceso({ to, icono, texto }: { to: string; icono: ReactNode; texto: string }) {
  return <Link to={to} className="hsc-tile hsc-press">
    {icono}
    <span>{texto}</span>
  </Link>
}
