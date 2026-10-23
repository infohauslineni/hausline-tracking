import { CreditCard, HandCoins, Link2, Star, Users, Wallet } from 'lucide-react'
import { NavLink } from 'react-router-dom'

// Pestañas de un apartado del menú: páginas distintas que comparten una sola entrada.
type Pestana = { to: string; label: string; icon: typeof Users }
function SeccionTabs({ tabs }: { tabs: Pestana[] }) {
  const tab = ({ isActive }: { isActive: boolean }) => `inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${isActive ? 'bg-accent text-app' : 'text-muted hover:bg-white/[.05] hover:text-white'}`
  return <div className="mb-6 inline-flex gap-1 rounded-xl border border-line bg-white/[.02] p-1">
    {tabs.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end className={tab}><Icon size={15} /> {label}</NavLink>)}
  </div>
}

// "Compras y ventas libres": Compras libres / Venta libre.
export function LibresTabs() { return <SeccionTabs tabs={[{ to: '/stock', label: 'Compras libres', icon: HandCoins }, { to: '/venta-libre', label: 'Venta libre', icon: Link2 }]} /> }
// "Clientes": el directorio y sus reseñas, juntos.
export function ClientesTabs() { return <SeccionTabs tabs={[{ to: '/clientes', label: 'Clientes', icon: Users }, { to: '/resenas', label: 'Reseñas', icon: Star }]} /> }
// "Mi cuenta": el dinero (cuentas, movimientos) y los pagos de clientes.
export function CuentaTabs() { return <SeccionTabs tabs={[{ to: '/cuenta', label: 'Mi cuenta', icon: Wallet }, { to: '/pagos', label: 'Pagos', icon: CreditCard }]} /> }
