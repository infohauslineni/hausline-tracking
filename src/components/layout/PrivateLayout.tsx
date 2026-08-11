import { BarChart3, Boxes, CircleGauge, Clapperboard, CreditCard, HandCoins, LogOut, Menu, PackageSearch, ReceiptText, Settings, ShoppingBag, Target, Truck, Users, Wallet, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '../../contexts/AuthContext'
import { isSupabaseConfigured } from '../../lib/supabase'
import { prefetchRoute, warmDashboard } from '../../utils/prefetchDashboard'
import { Brand } from '../ui/Brand'

type Badges = Record<string, number>
// Contadores de "requiere atención" que se muestran junto a los enlaces del menú.
async function calcularBadges(): Promise<Badges> {
  const { listarPedidos } = await import('../../services/pedidos.service')
  const pedidos = await listarPedidos()
  return {
    '/pedidos': pedidos.filter((p) => p.estado === 'disponible_entrega').length,
    '/pagos': pedidos.filter((p) => (p.estado === 'disponible_entrega' || p.estado === 'entregado') && Number(p.saldo) > 0.01).length,
    '/logistica': pedidos.filter((p) => p.estado === 'incidencia').length,
  }
}

const links = [
  { to: '/dashboard', label: 'Resumen', icon: CircleGauge },
  { to: '/ventas', label: 'Ventas', icon: ShoppingBag },
  { to: '/pedidos', label: 'Pedidos', icon: Boxes },
  { to: '/clientes', label: 'Clientes', icon: Users },
  { to: '/productos', label: 'Productos', icon: PackageSearch },
  { to: '/stock', label: 'Stock e inversiones', icon: HandCoins },
  { to: '/pagos', label: 'Pagos', icon: CreditCard },
  { to: '/gastos', label: 'Gastos', icon: ReceiptText },
  { to: '/cuenta', label: 'Mi cuenta', icon: Wallet },
  { to: '/metas', label: 'Fondos para compras', icon: Target },
  { to: '/contenido', label: 'Contenido privado', icon: Clapperboard },
  { to: '/reportes', label: 'Ganancias y reportes', icon: BarChart3 },
  { to: '/logistica', label: 'Logística', icon: Truck },
  { to: '/configuracion', label: 'Configuración', icon: Settings },
]
const mobileLinks = ['/dashboard', '/ventas', '/pedidos', '/pagos', '/logistica'].map((route) => links.find((link) => link.to === route)!)

export function PrivateLayout() {
  const [open, setOpen] = useState(false)
  const [badges, setBadges] = useState<Badges>({})
  const { user, signOut } = useAuth()
  const location = useLocation()
  useEffect(() => { warmDashboard() }, [])
  // Refresca los contadores al cambiar de página (los datos vienen del caché de pedidos).
  useEffect(() => { if (!isSupabaseConfigured) return; let vivo = true; void calcularBadges().then((next) => { if (vivo) setBadges(next) }).catch(() => undefined); return () => { vivo = false } }, [location.pathname])

  const handleSignOut = async () => {
    try { await signOut() } catch { toast.error('No se pudo cerrar la sesión.') }
  }

  return (
    <div className="min-h-screen bg-app text-white">
      {open && <button aria-label="Cerrar menú" className="fixed inset-0 z-30 bg-black/70 lg:hidden" onClick={() => setOpen(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[280px] flex-col border-r border-line bg-panel p-5 transition-transform lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between">
          <Brand />
          <button className="icon-button lg:hidden" onClick={() => setOpen(false)} aria-label="Cerrar menú"><X size={20} /></button>
        </div>
        <nav className="mt-8 flex flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} onPointerEnter={() => prefetchRoute(to)} onFocus={() => prefetchRoute(to)} onClick={() => setOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}>
              <Icon size={19} /><span>{label}</span>{badges[to] > 0 && <span className="ml-auto grid min-w-5 place-items-center rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-app">{badges[to]}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="rounded-2xl border border-line bg-white/[0.03] p-3">
          <p className="truncate text-sm font-medium">{user?.email ?? 'Administrador'}</p>
          <button className="mt-2 flex items-center gap-2 text-xs text-muted transition hover:text-white" onClick={handleSignOut}><LogOut size={15} /> Cerrar sesión</button>
        </div>
      </aside>
      <div className="lg:pl-[280px]">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-line bg-app/90 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
          <button className="icon-button lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menú"><Menu size={21} /></button>
          <span className="hidden text-xs font-semibold uppercase tracking-[0.2em] text-muted lg:block">Panel de operaciones</span>
          <div className="ml-auto flex items-center gap-3"><span className="status-dot" /> <span className="text-xs text-muted">Sistema operativo</span></div>
        </header>
        <main className="mx-auto max-w-[1500px] p-4 pb-24 sm:p-6 lg:p-8"><Outlet /></main>
      </div>
      <nav className="fixed inset-x-3 bottom-3 z-30 grid grid-cols-5 rounded-2xl border border-line bg-panel/95 p-1.5 shadow-2xl backdrop-blur-xl lg:hidden" aria-label="Navegación móvil">
        {mobileLinks.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} onPointerDown={() => prefetchRoute(to)} className={({ isActive }) => `relative flex min-w-0 flex-col items-center gap-1 rounded-xl px-1 py-2 text-[9px] font-semibold transition ${isActive ? 'bg-accent text-app' : 'text-muted'}`}><span className="relative"><Icon size={18} />{badges[to] > 0 && <span className="absolute -right-2 -top-1.5 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[9px] font-bold text-app ring-2 ring-panel">{badges[to]}</span>}</span><span className="max-w-full truncate">{label}</span></NavLink>)}
      </nav>
    </div>
  )
}
