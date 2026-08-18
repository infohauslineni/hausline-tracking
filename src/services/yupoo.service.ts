import { supabase } from '../lib/supabase'
import type { LinkYupoo } from '../types/domain'
import { cachedQuery, invalidateCache } from '../utils/queryCache'

export type LinkYupooInput = Omit<LinkYupoo, 'id' | 'created_at' | 'updated_at'>

function requireSupabase() {
  if (!supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

export async function listarLinksYupoo(onFresh?: (value: LinkYupoo[]) => void) {
  return cachedQuery('yupoo', async () => {
    const { data, error } = await requireSupabase()
      .from('catalogo_yupoo')
      .select('*')
      .order('marca', { ascending: true })
      .order('modelo', { ascending: true })
    if (error) throw error
    return data as LinkYupoo[]
  }, 45_000, onFresh)
}

export async function guardarLinkYupoo(input: LinkYupooInput, id?: string) {
  const client = requireSupabase()
  const query = id
    ? client.from('catalogo_yupoo').update(input).eq('id', id)
    : client.from('catalogo_yupoo').insert(input)
  const { data, error } = await query.select().single()
  if (error) throw error
  invalidateCache('yupoo')
  return data as LinkYupoo
}

export async function eliminarLinkYupoo(id: string) {
  const { error } = await requireSupabase().from('catalogo_yupoo').delete().eq('id', id)
  if (error) throw error
  invalidateCache('yupoo')
}
