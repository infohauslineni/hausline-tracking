import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { isSupabaseConfigured } from '../../lib/supabase'

export function ProtectedRoute() {
  const { user, loading, personal } = useAuth()
  const location = useLocation()
  if (loading) return <div className="grid min-h-screen place-items-center bg-app"><div className="loader" /></div>
  // Solo en desarrollo local permite revisar el diseño sin credenciales.
  const localPreview = import.meta.env.DEV && !isSupabaseConfigured
  if (!user && !localPreview) return <Navigate to="/login" replace state={{ from: location }} />
  // Una cuenta de CLIENTE que entró por el login interno va a su panel, no al del personal.
  if (user && isSupabaseConfigured && personal === null) return <div className="grid min-h-screen place-items-center bg-app"><div className="loader" /></div>
  if (user && isSupabaseConfigured && personal === false) return <Navigate to="/cuenta" replace />
  return <Outlet />
}
