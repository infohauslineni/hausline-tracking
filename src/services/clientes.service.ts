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

// Fotos de perfil de "Mi cuenta" (tienda) para mostrarlas en el panel (migración 202610030005).
// porCliente: id de la ficha → URL · porUsuario: id de la cuenta (auth) → URL.
export type AvataresClientes = { porCliente: Record<string, string>; porUsuario: Record<string, string> }
export async function listarAvataresClientes(): Promise<AvataresClientes> {
  return cachedQuery('avatares-clientes', async () => {
    const client = requireSupabase()
    const { data, error } = await client.rpc('avatares_clientes')
    if (error) throw error
    const out: AvataresClientes = { porCliente: {}, porUsuario: {} }
    for (const r of (data ?? []) as { cliente_id: string; user_id: string; avatar_path: string }[]) {
      const url = client.storage.from('avatares').getPublicUrl(r.avatar_path).data.publicUrl
      out.porCliente[r.cliente_id] = url
      if (r.user_id) out.porUsuario[r.user_id] = url
    }
    return out
  }, 120_000)
}

// "Managua, Managua" → "Managua": junta ciudad y departamento sin repetir.
export function lugarCliente(c: Pick<Cliente, 'ciudad' | 'departamento'>): string {
  const partes = [c.ciudad, c.departamento].map((v) => String(v ?? '').trim()).filter(Boolean)
  return partes.filter((v, i) => partes.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i).join(', ')
}
