import { supabase } from '../lib/supabase'
import type { Promocion, PromocionInput } from '../types/domain'
import { cachedQuery, invalidateCache } from '../utils/queryCache'

function client() { if (!supabase) throw new Error('Supabase no está configurado.'); return supabase }

// Lista las promociones automáticas, de la más nueva a la más vieja.
export async function listarPromociones(onFresh?: (value: Promocion[]) => void) {
  return cachedQuery('promociones', async () => {
    const { data, error } = await client().from('promociones').select('*').order('created_at', { ascending: false })
    if (error) throw error
    return data as unknown as Promocion[]
  }, 30_000, onFresh)
}

export async function guardarPromocion(input: PromocionInput, id?: string) {
  const payload = {
    nombre: input.nombre.trim(),
    condicion_tipo: input.condicion_tipo,
    condicion_valor: Number(input.condicion_valor),
    tipo: input.tipo,
    valor: Number(input.valor),
    vence_el: input.vence_el || null,
    nota: input.nota?.trim() || null,
    ...(input.activo === undefined ? {} : { activo: input.activo }),
  }
  const query = id ? client().from('promociones').update(payload).eq('id', id) : client().from('promociones').insert(payload)
  const { data, error } = await query.select('*').single()
  if (error) throw error
  invalidateCache('promociones')
  return data as unknown as Promocion
}

export async function cambiarActivoPromocion(id: string, activo: boolean) {
  const { error } = await client().from('promociones').update({ activo }).eq('id', id)
  if (error) throw error
  invalidateCache('promociones')
}

export async function eliminarPromocion(id: string) {
  const { error } = await client().from('promociones').delete().eq('id', id)
  if (error) throw error
  invalidateCache('promociones')
}
