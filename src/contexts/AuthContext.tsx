import type { Session, User } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

type AuthContextValue = {
  user: User | null
  loading: boolean
  configured: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)

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

    async function validateStoredSession() {
      try {
        const { data: stored } = await client.auth.getSession()
        let validSession = stored.session

        if (validSession) {
          const { data: currentUser, error: userError } = await client.auth.getUser()

          if (userError || !currentUser.user) {
            const { data: refreshed, error: refreshError } = await client.auth.refreshSession()

            if (!refreshError && refreshed.session) {
              validSession = refreshed.session
            } else {
              // Evita que un token viejo guardado en un navegador siga mostrando
              // al usuario como conectado mientras todas las consultas son rechazadas.
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
        if (active) setLoading(false)
      }
    }

    void validateStoredSession()

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    user: session?.user ?? null,
    loading,
    configured: isSupabaseConfigured,
    async signIn(email, password) {
      if (!supabase) throw new Error('Supabase aún no está configurado.')
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
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
  }), [loading, session])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// El hook comparte archivo con el Provider para mantener la API de autenticación agrupada.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider.')
  return context
}
