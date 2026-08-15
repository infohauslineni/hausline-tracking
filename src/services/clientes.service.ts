import { supabase } from '../lib/supabase'
import type { Cliente } from '../types/domain'
import { normalizarTelefonoNicaragua } from '../utils/whatsapp'
import { cachedQuery, invalidateCache } from '../utils/queryCache'

export type ClienteInput = Omit<Cliente, 'id' | 'created_at' | 'updated_at'>

function requireSupabase() {
  if (!supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

export async function listarClientes(onFresh?: (value: Cliente[]) => void) {
  return cachedQuery('clientes', async () => {
    const { data, error } = await requireSupabase().from('clientes').select('*').order('created_at', { ascending: false })
    if (error) throw error
    return data as Cliente[]
  }, 45_000, onFresh)
}

export async function guardarCliente(input: ClienteInput, id?: string) {
  const client = requireSupabase()
  const normalized = { ...input, whatsapp: normalizarTelefonoNicaragua(input.whatsapp) }
  const query = id ? client.from('clientes').update(normalized).eq('id', id) : client.from('clientes').insert(normalized)
  const { data, error } = await query.select().single()
  if (error) throw error
  invalidateCache('clientes')
  return data as Cliente
}

export async function eliminarCliente(id: string) {
  const { error } = await requireSupabase().from('clientes').delete().eq('id', id)
  if (error) throw error
  invalidateCache('clientes')
}
