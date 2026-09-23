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
