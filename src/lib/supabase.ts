import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

// fetch con límite de tiempo: en redes móviles flojas una petición podía quedarse colgada
// para siempre y dejaba la app en la pantalla negra con el spinner ("no funciona para nada").
// Con esto, si a los 20 s no respondió, la petición se cancela y falla (mostramos error/toast
// y el usuario reintenta) en vez de colgarse. Respeta un AbortSignal que ya venga del caller.
const FETCH_TIMEOUT_MS = 20_000
function fetchConTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  if (init?.signal) init.signal.addEventListener('abort', () => controller.abort(), { once: true })
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeout))
}

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      global: { fetch: fetchConTimeout },
    })
  : null
