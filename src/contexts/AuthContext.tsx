import type { Session, User } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

export type RolUsuario = 'admin' | 'operador'

type AuthContextValue = {
  user: User | null
  loading: boolean
  configured: boolean
  // Rol del usuario (de la tabla perfiles). null mientras se resuelve. `esAdmin` decide qué
  // ve cada quien: el operador (empleado) no ve finanzas, costos ni configuración.
  rol: RolUsuario | null
  esAdmin: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

// Corre `promesa` pero, si no responde en `ms`, resuelve con `fallback` (un centinela)
// para no quedarse esperando una llamada de red que se colgó. Se usa al validar la sesión
// para que la app nunca se quede en la pantalla negra por un getUser/refresh que no vuelve.
function conTiempoLimite<T, F>(promesa: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  return Promise.race([promesa, new Promise<F>((resolve) => setTimeout(() => resolve(fallback), ms))])
}
const TIMEOUT = Symbol('timeout')

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [rol, setRol] = useState<RolUsuario | null>(null)

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    const client = supabase
    let active = true
    let initialized = false

    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return
      setSession(nextSession)
      if (initialized) setLoading(false)
    })

    // Red de seguridad absoluta: pase lo que pase (incluso si getSession se cuelga), a los
    // 12 s dejamos de mostrar el spinner. Con sesión guardada, la app entra; sin ella, al login.
    const failsafe = setTimeout(() => { if (active && !initialized) { initialized = true; setLoading(false) } }, 12_000)

    async function validateStoredSession() {
      try {
        const sesionGuardada = await conTiempoLimite(client.auth.getSession(), 8_000, TIMEOUT)
        let validSession = sesionGuardada === TIMEOUT ? null : sesionGuardada.data.session

        if (validSession) {
          // Validamos el token, pero con límite de tiempo. Si la red se cuelga (getUser o
          // refresh no vuelven), CONFIAMOS en la sesión guardada en vez de bloquear la app:
          // el listener de abajo y la revalidación al volver al primer plano corrigen luego.
          const currentUser = await conTiempoLimite(client.auth.getUser(), 8_000, TIMEOUT)

          if (currentUser !== TIMEOUT && (currentUser.error || !currentUser.data.user)) {
            const refreshed = await conTiempoLimite(client.auth.refreshSession(), 8_000, TIMEOUT)

            if (refreshed !== TIMEOUT && !refreshed.error && refreshed.data.session) {
              validSession = refreshed.data.session
            } else if (refreshed !== TIMEOUT) {
              // El token ya no sirve (no fue un timeout): evita que un token viejo siga
              // mostrando al usuario como conectado mientras todas las consultas se rechazan.
              await client.auth.signOut({ scope: 'local' })
              validSession = null
            }
          }
        }

        if (active) setSession(validSession)
      } catch {
        // Si el almacenamiento local quedó dañado, volvemos al inicio de sesión
        // en lugar de dejar la aplicación con paneles vacíos.
        await client.auth.signOut({ scope: 'local' }).catch(() => undefined)
        if (active) setSession(null)
      } finally {
        initialized = true
        clearTimeout(failsafe)
        if (active) setLoading(false)
      }
    }

    void validateStoredSession()

    // Mantiene la app siempre activa cuando la pestaña vuelve al primer plano o se
    // recupera la conexión (segundo plano, equipo dormido). Si el token está por
    // vencer lo renovamos en silencio para que nada falle. Si ya se había vencido
    // —que es justo cuando quedan los paneles vacíos y hoy toca recargar a mano—
    // recargamos la página automáticamente para que todo cargue fresco. Si ya no se
    // puede renovar del todo, mandamos al login en vez de dejar la app colgada.
    let revalidando = false
    async function revalidarSesion() {
      if (revalidando || !active || document.visibilityState !== 'visible') return
      revalidando = true
      try {
        const { data: stored } = await client.auth.getSession()
        const current = stored.session
        if (!current) return
        const expiraEnMs = (current.expires_at ?? 0) * 1000 - Date.now()
        if (expiraEnMs > 60_000) return
        const yaVencido = expiraEnMs <= 0
        const { data: refreshed, error } = await client.auth.refreshSession()
        if (error || !refreshed.session) {
          await client.auth.signOut({ scope: 'local' }).catch(() => undefined)
          if (active) setSession(null)
          return
        }
        if (active) setSession(refreshed.session)
        // El token había expirado: algunas consultas ya pudieron fallar, así que
        // recargamos para volver a traer todos los datos sin intervención manual.
        if (yaVencido) window.location.reload()
      } catch {
        // Sin conexión o error temporal: no tocamos la sesión, se reintenta al volver.
      } finally {
        revalidando = false
      }
    }

    document.addEventListener('visibilitychange', revalidarSesion)
    window.addEventListener('online', revalidarSesion)

    return () => {
      active = false
      clearTimeout(failsafe)
      data.subscription.unsubscribe()
      document.removeEventListener('visibilitychange', revalidarSesion)
      window.removeEventListener('online', revalidarSesion)
    }
  }, [])

  // Resuelve el rol del usuario desde `perfiles` cada vez que cambia la sesión. La política
  // `perfiles_leer` permite a cada quien leer su propio perfil. Ante cualquier error se asume
  // 'operador' (lo más restrictivo): preferimos ocultar finanzas de más que filtrarlas.
  useEffect(() => {
    const uid = session?.user?.id
    if (!supabase || !uid) { setRol(null); return }
    const client = supabase
    let vivo = true
    void (async () => {
      try {
        const { data } = await client.from('perfiles').select('rol').eq('id', uid).maybeSingle()
        if (vivo) setRol((data?.rol as RolUsuario) ?? 'operador')
      } catch {
        if (vivo) setRol('operador')
      }
    })()
    return () => { vivo = false }
  }, [session?.user?.id])

  const value = useMemo<AuthContextValue>(() => ({
    user: session?.user ?? null,
    loading,
    configured: isSupabaseConfigured,
    rol,
    // En preview local sin Supabase no hay perfil: se trata como admin para poder revisar
    // todo el panel. Con Supabase, admin solo si el perfil lo dice.
    esAdmin: !isSupabaseConfigured || rol === 'admin',
    async signIn(email, password) {
      if (!supabase) throw new Error('Supabase aún no está configurado.')
      // Límite de tiempo: si la red se cuelga, signInWithPassword nunca vuelve y el
      // botón se queda en "Ingresando…" para siempre. Con el tope, falla claro y el
      // usuario puede reintentar en vez de quedarse mirando el spinner.
      const resultado = await conTiempoLimite(
        supabase.auth.signInWithPassword({ email, password }),
        15_000,
        TIMEOUT,
      )
      if (resultado === TIMEOUT) {
        throw new Error('La conexión tardó demasiado. Revisá tu internet e intentá de nuevo.')
      }
      if (resultado.error) throw resultado.error
    },
    async signOut() {
      if (!supabase) return
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    },
    async resetPassword(email) {
      if (!supabase) throw new Error('Supabase aún no está configurado.')
      const redirectTo = `${import.meta.env.VITE_PUBLIC_APP_URL ?? window.location.origin}/login`
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
      if (error) throw error
    },
  }), [loading, session, rol])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// El hook comparte archivo con el Provider para mantener la API de autenticación agrupada.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider.')
  return context
}
