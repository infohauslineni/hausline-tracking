import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { isSupabaseConfigured } from '../../lib/supabase'

// Protege las rutas de solo-admin (finanzas, productos, reportes, configuración, etc.). Un
// operador que intente entrar por URL es redirigido a Pedidos. La seguridad real está en el
// servidor (RLS): esto solo evita que el operador vea pantallas vacías o que fallan.
export function AdminRoute() {
  const { esAdmin, rol, loading } = useAuth()
  // En preview local sin Supabase no hay perfil: se deja pasar para poder revisar el diseño.
  const localPreview = import.meta.env.DEV && !isSupabaseConfigured
  if (localPreview) return <Outlet />
  // Mientras se resuelve la sesión o el rol, mostramos el loader (evita parpadeos).
  if (loading || rol === null) return <div className="grid min-h-screen place-items-center bg-app"><div className="loader" /></div>
  if (!esAdmin) return <Navigate to="/pedidos" replace />
  return <Outlet />
}
