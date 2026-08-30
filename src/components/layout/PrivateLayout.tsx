import { ArrowUpRight, BarChart3, Bell, Boxes, CircleGauge, CreditCard, HandCoins, Inbox, LogOut, Menu, MoreHorizontal, PackagePlus, PackageSearch, Plus, ReceiptText, Settings, ShoppingBag, Star, Truck, UserPlus, Users, Wallet, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '../../contexts/AuthContext'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { prefetchRoute, warmDashboard } from '../../utils/prefetchDashboard'
import { playEncargoChime } from '../../utils/notify'
import { calcularAlertas, contarUrgentes, type Alerta } from '../../utils/alertas'
import { Brand } from '../ui/Brand'

type Badges = Record<string, number>
// Contadores de "requiere atención" del menú + alertas para la campana. Se calculan de
// una sola carga de pedidos (se recalculan en cada navegación).
async function calcularEstado(): Promise<{ badges: Badges; alertas: Alerta[] }> {
  const { listarPedidos } = await import('../../services/pedidos.service')
  const pedidos = await listarPedidos()
  // Encargos web pendientes de confirmar. Aislado en try/catch por si la tabla aún no existe.
  let solicitudes = 0
  try {
    const { listarSolicitudes } = await import('../../services/solicitudes.service')
    solicitudes = (await listarSolicitudes()).filter((s) => s.estado === 'pendiente').length
  } catch { /* la tabla solicitudes puede no estar creada todavía */ }
  const badges: Badges = {
    '/pedidos': pedidos.filter((p) => p.estado === 'disponible_entrega').length,
    '/solicitudes': solicitudes,
    '/pagos': pedidos.filter((p) => (p.estado === 'disponible_entrega' || p.estado === 'entregado') && Number(p.saldo) > 0.01).length,
    '/logistica': pedidos.filter((p) => p.estado === 'incidencia').length,
  }
  // Trayectos para las alertas de "tracking sin novedad" (best-effort).
  const trayectos = await (async () => { try { const { listarTrayectos } = await import('../../services/logistica.service'); return await listarTrayectos() } catch { return [] } })()
  return { badges, alertas: calcularAlertas(pedidos, trayectos) }
}

type NavItem = { to: string; label: string; icon: typeof CircleGauge; nuevo?: boolean }
// Operaciones del día a día. "Encargos web" recibe los pedidos que llegan del sitio.
const operaciones: NavItem[] = [
  { to: '/dashboard', label: 'Resumen', icon: CircleGauge },
  { to: '/pedidos', label: 'Pedidos', icon: Boxes },
  { to: '/ventas', label: 'Ventas', icon: ShoppingBag },
  { to: '/solicitudes', label: 'Encargos web', icon: Inbox },
]
const clientesProductos: NavItem[] = [
  { to: '/clientes', label: 'Clientes', icon: Users },
  { to: '/resenas', label: 'Reseñas', icon: Star },
  { to: '/productos', label: 'Productos', icon: PackageSearch },
  { to: '/stock', label: 'Stock e inversiones', icon: HandCoins },
]
// "Mi cuenta" es el hub de dinero: gastos, ingresos, salidas, estado de cuenta y saldo.
// Por eso "Gastos" ya no es una entrada aparte (se registran desde Mi cuenta).
const finanzas: NavItem[] = [
  { to: '/pagos', label: 'Pagos', icon: CreditCard },
  { to: '/cuenta', label: 'Mi cuenta', icon: Wallet },
  { to: '/reportes', label: 'Reportes', icon: BarChart3, nuevo: true },
]
const logistica: NavItem[] = [
  { to: '/logistica', label: 'Logística', icon: Truck },
]
// Opciones administrativas (agrupadas aparte; se pueden ocultar por rol más adelante).
const administracion: NavItem[] = [
  { to: '/configuracion', label: 'Configuración', icon: Settings },
]
const navGroups = [
  { title: 'Operaciones', items: operaciones },
  { title: 'Clientes y productos', items: clientesProductos },
  { title: 'Finanzas', items: finanzas },
  { title: 'Logística', items: logistica },
  { title: 'Administración', items: administracion },
]
// Barra inferior en móvil: Resumen · Pedidos · (+) · Ventas · Más.
const mobileLinks = [operaciones[0], operaciones[1], operaciones[2]]
// Accesos rápidos del botón central "+" en móvil.
const quickActions: NavItem[] = [
  { to: '/pedidos/nuevo', label: 'Nuevo pedido', icon: PackagePlus },
  { to: '/pagos', label: 'Registrar pago', icon: CreditCard },
  { to: '/clientes', label: 'Nuevo cliente', icon: UserPlus },
  { to: '/gastos', label: 'Registrar gasto', icon: ReceiptText },
]

export function PrivateLayout() {
  const [open, setOpen] = useState(false)
  const [fabOpen, setFabOpen] = useState(false)
  const [badges, setBadges] = useState<Badges>({})
  const [alertas, setAlertas] = useState<Alerta[]>([])
  const [bellOpen, setBellOpen] = useState(false)
  const { user, signOut } = useAuth()
  const location = useLocation()
  useEffect(() => { warmDashboard() }, [])
  // Refresca los contadores y las alertas al cambiar de página (datos del caché de pedidos).
  useEffect(() => { if (!isSupabaseConfigured) return; let vivo = true; void calcularEstado().then((next) => { if (vivo) { setBadges(next.badges); setAlertas(next.alertas) } }).catch(() => undefined); return () => { vivo = false } }, [location.pathname])
  useEffect(() => { setBellOpen(false) }, [location.pathname])

  // Aviso en vivo cuando cae un encargo nuevo desde la web: suena una campanita
  // (tipo Shopify), sale un toast y se marca el contador de "Encargos web".
  useEffect(() => {
    const client = supabase
    if (!isSupabaseConfigured || !client) return
    const channel = client.channel('encargos-alerta').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'solicitudes' }, () => {
      playEncargoChime()
      toast.success('🛍️ Nuevo encargo web — revisalo en "Encargos web".')
      void calcularEstado().then((next) => { setBadges(next.badges); setAlertas(next.alertas) }).catch(() => undefined)
    }).subscribe()
    return () => { void client.removeChannel(channel) }
  }, [])

  const handleSignOut = async () => {
    try { await signOut() } catch { toast.error('No se pudo cerrar la sesión.') }
  }

  return (
    <div className="min-h-screen bg-app text-white">
      {open && <button aria-label="Cerrar menú" className="fixed inset-0 z-30 bg-black/70 lg:hidden" onClick={() => setOpen(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[280px] flex-col border-r border-line bg-panel p-5 transition-transform lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between">
          <Brand />
          <button className="icon-button lg:hidden!" onClick={() => setOpen(false)} aria-label="Cerrar menú"><X size={20} /></button>
        </div>
        <nav className="mt-7 flex flex-1 flex-col gap-5 overflow-y-auto pr-1">
          {navGroups.map((group) => (
            <div key={group.title}>
              <p className="nav-group-title">{group.title}</p>
              <div className="mt-1.5 flex flex-col gap-0.5">
                {group.items.map(({ to, label, icon: Icon, nuevo }) => (
                  <NavLink key={to} to={to} onPointerEnter={() => prefetchRoute(to)} onFocus={() => prefetchRoute(to)} onClick={() => setOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}>
                    <Icon size={18} /><span>{label}</span>
                    {badges[to] > 0
                      ? <span className="ml-auto grid min-w-5 place-items-center rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-app">{badges[to]}</span>
                      : nuevo ? <span className="ml-auto rounded-full bg-accent/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-accent">Nuevo</span> : null}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="mt-4 flex items-center gap-3 rounded-2xl border border-line bg-white/[0.03] p-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent/15 text-sm font-bold text-accent">{(user?.email ?? 'A').charAt(0).toUpperCase()}</span>
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{user?.email ?? 'Administrador'}</p><p className="text-[11px] text-muted">Administrador</p></div>
          <button className="icon-button" onClick={handleSignOut} title="Cerrar sesión" aria-label="Cerrar sesión"><LogOut size={16} /></button>
        </div>
      </aside>
      <div className="lg:pl-[280px]">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-line bg-app/90 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
          <button className="icon-button lg:hidden!" onClick={() => setOpen(true)} aria-label="Abrir menú"><Menu size={21} /></button>
          <span className="hidden text-xs font-semibold uppercase tracking-[0.2em] text-muted lg:block">Panel de operaciones</span>
          <div className="ml-auto flex items-center gap-3">
            <div className="relative">
              <button type="button" className="icon-button relative" onClick={() => setBellOpen((v) => !v)} title="Alertas" aria-label="Alertas"><Bell size={18} />{contarUrgentes(alertas) > 0 && <span className="absolute -right-1 -top-1 grid min-w-[16px] place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold leading-none text-white">{contarUrgentes(alertas)}</span>}</button>
              {bellOpen && <>
                <button className="fixed inset-0 z-40 cursor-default" aria-label="Cerrar alertas" onClick={() => setBellOpen(false)} />
                <div className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
                  <div className="flex items-center justify-between border-b border-line px-4 py-3"><strong className="text-sm">Alertas</strong><span className="text-[11px] text-muted">{alertas.length} {alertas.length === 1 ? 'activa' : 'activas'}</span></div>
                  <div className="max-h-[70vh] overflow-y-auto">
                    {alertas.length === 0 ? <p className="px-4 py-8 text-center text-xs text-muted">Todo en orden. Sin alertas. ✅</p>
                      : alertas.map((a) => <Link key={a.id} to={a.to} onClick={() => setBellOpen(false)} className="flex gap-3 border-b border-line px-4 py-3 transition last:border-0 hover:bg-white/[.03]"><span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg text-sm ${a.prioridad === 'alta' ? 'bg-red-400/12' : a.prioridad === 'media' ? 'bg-amber-400/12' : 'bg-sky-400/12'}`}>{a.icono}</span><span className="min-w-0 flex-1"><strong className="block text-xs">{a.titulo}</strong><span className="block text-[11px] leading-4 text-muted">{a.descripcion}</span></span><ArrowUpRight size={14} className="mt-1 shrink-0 text-muted" /></Link>)}
                  </div>
                </div>
              </>}
            </div>
            <span className="status-dot" /> <span className="hidden text-xs text-muted sm:inline">Sistema operativo</span>
          </div>
        </header>
        <main className="mx-auto max-w-[1500px] p-4 pb-24 sm:p-6 lg:p-8"><Outlet /></main>
      </div>
      {/* Hoja de accesos rápidos del botón central "+" (solo móvil). */}
      {fabOpen && <>
        <button aria-label="Cerrar" className="fixed inset-0 z-40 bg-black/70 lg:hidden" onClick={() => setFabOpen(false)} />
        <div className="reveal-up fixed inset-x-3 bottom-24 z-50 rounded-2xl border border-line bg-panel p-3 shadow-2xl lg:hidden">
          <p className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">Crear rápido</p>
          <div className="grid grid-cols-2 gap-2">
            {quickActions.map(({ to, label, icon: Icon }) => <Link key={label} to={to} onClick={() => setFabOpen(false)} className="flex items-center gap-3 rounded-xl border border-line bg-white/[0.02] px-3 py-3 text-sm font-semibold transition hover:border-accent/50 hover:bg-accent/[0.04]"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent"><Icon size={18} /></span>{label}</Link>)}
          </div>
        </div>
      </>}
      <nav className="fixed inset-x-3 bottom-3 z-30 grid grid-cols-5 items-center rounded-2xl border border-line bg-panel/95 p-1.5 shadow-2xl backdrop-blur-xl lg:hidden" aria-label="Navegación móvil">
        <MobileTab to={mobileLinks[0].to} label={mobileLinks[0].label} Icon={mobileLinks[0].icon} badge={badges[mobileLinks[0].to]} />
        <MobileTab to={mobileLinks[1].to} label={mobileLinks[1].label} Icon={mobileLinks[1].icon} badge={badges[mobileLinks[1].to]} />
        <button type="button" className="mobile-fab" onClick={() => setFabOpen(true)} aria-label="Crear rápido"><Plus size={24} /></button>
        <MobileTab to={mobileLinks[2].to} label={mobileLinks[2].label} Icon={mobileLinks[2].icon} badge={badges[mobileLinks[2].to]} />
        <button type="button" className="mobile-tab text-muted" onClick={() => setOpen(true)} aria-label="Más opciones"><MoreHorizontal size={18} /><span className="max-w-full truncate">Más</span></button>
      </nav>
    </div>
  )
}

function MobileTab({ to, label, Icon, badge }: { to: string; label: string; Icon: typeof CircleGauge; badge?: number }) {
  return <NavLink to={to} onPointerDown={() => prefetchRoute(to)} className={({ isActive }) => `mobile-tab ${isActive ? 'is-active' : 'text-muted'}`}>
    <span className="relative"><Icon size={18} />{badge != null && badge > 0 && <span className="absolute -right-2 -top-1.5 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[9px] font-bold text-app ring-2 ring-panel">{badge}</span>}</span>
    <span className="max-w-full truncate">{label}</span>
  </NavLink>
}
