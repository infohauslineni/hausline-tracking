import { supabase } from '../lib/supabase'

function client() { if (!supabase) throw new Error('Supabase no está configurado.'); return supabase }

export interface Suscriptor {
  correo: string
  nombre: string | null
  consentimiento: boolean
  fuente: string | null
  activo: boolean
  ultima_compra: string | null
  created_at: string
}

// Campaña "síganos en Instagram y TikTok" (api/notificar-estado, solo admin):
//   'estado' = cómo va · 'prueba' = solo a mi correo · 'iniciar' = lanzarla a los suscriptores.
export type EstadoCampanaRedes = { suscriptores: number; prueba?: string; campana: { id: string; activa: boolean; completa: boolean; creada?: string; completada?: string; enviados?: number; total?: number } | null }
export async function campanaRedes(accion: 'estado' | 'prueba' | 'iniciar'): Promise<EstadoCampanaRedes> {
  const { data: sessionData } = await client().auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) throw new Error('Sesión no disponible.')
  const res = await fetch('/api/notificar-estado', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify({ campanaRedes: accion }) })
  const j = await res.json().catch(() => ({})) as Partial<EstadoCampanaRedes> & { ok?: boolean; error?: string }
  if (!res.ok || !j.ok) throw new Error(j.error || 'No se pudo (HTTP ' + res.status + ').')
  return { suscriptores: j.suscriptores ?? 0, prueba: j.prueba, campana: j.campana ?? null }
}

// Suscriptores ACTIVOS y con consentimiento: los que aceptaron recibir promociones y no se
// dieron de baja. Es la lista que se exporta para las campañas de Brevo. Del más nuevo al viejo.
export async function listarSuscriptores(): Promise<Suscriptor[]> {
  const { data, error } = await client().from('suscriptores')
    .select('correo, nombre, consentimiento, fuente, activo, ultima_compra, created_at')
    .eq('activo', true).eq('consentimiento', true)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data as Suscriptor[]) ?? []
}
