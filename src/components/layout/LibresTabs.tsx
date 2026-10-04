import { HandCoins, Link2 } from 'lucide-react'
import { NavLink } from 'react-router-dom'

// Pestañas del apartado "Compras y ventas libres": son dos páginas distintas (no se unen),
// solo comparten la entrada del menú.
export function LibresTabs() {
  const tab = ({ isActive }: { isActive: boolean }) => `inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${isActive ? 'bg-accent text-app' : 'text-muted hover:bg-white/[.05] hover:text-white'}`
  return <div className="mb-6 inline-flex gap-1 rounded-xl border border-line bg-white/[.02] p-1">
    <NavLink to="/stock" className={tab}><HandCoins size={15} /> Compras libres</NavLink>
    <NavLink to="/venta-libre" className={tab}><Link2 size={15} /> Venta libre</NavLink>
  </div>
}
