import { supabase } from '../lib/supabase'

// "Salud de clientes": cuentas creadas en la tienda (Mi cuenta) + lo que la tienda, el
// checkout y el seguimiento anotan solos cuando a un cliente le falla algo
// (tabla eventos_cliente, migración 202609260001).
export type CuentaCliente = {
  user_id: string
  nombre: string
  correo: string
  telefono: string | null
  creada_at: string
  confirmada_at: string | null
  ultimo_ingreso_at: string | null
  pedidos: number
}

export type EventoCliente = {
  id: number
  created_at: string
  origen: 'tienda' | 'cuenta' | 'checkout' | 'seguimiento'
  tipo: 'error' | 'evento'
  nombre: string
  pagina: string | null
  mensaje: string | null
  detalle: Record<string, unknown> | null
  visita: string | null
  dispositivo: string | null
  user_id: string | null
  revisado_at?: string | null
}

export type MotivoAyuda = 'sin_confirmar' | 'sin_pedidos'
export type CuentaRevisada = { user_id: string; motivo: MotivoAyuda; revisado_at: string }

export async function listarCuentasClientes(): Promise<CuentaCliente[]> {
  if (!supabase) return []
  const { data, error } = await supabase.rpc('cuentas_clientes_resumen')
  if (error) throw error
  return (data ?? []) as CuentaCliente[]
}

export async function listarEventosClientes(dias: number): Promise<EventoCliente[]> {
  if (!supabase) return []
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString()
  const { data, error } = await supabase.from('eventos_cliente').select('*').gte('created_at', desde).order('created_at', { ascending: false }).limit(5000)
  if (error) throw error
  return (data ?? []) as EventoCliente[]
}

// Para el contador del menú: errores de clientes en las últimas 24 h.
export async function contarErroresClientes24h(): Promise<number> {
  if (!supabase) return 0
  const desde = new Date(Date.now() - 86_400_000).toISOString()
  const { count, error } = await supabase.from('eventos_cliente').select('id', { count: 'exact', head: true }).eq('tipo', 'error').is('revisado_at', null).gte('created_at', desde)
  if (error) throw error
  return count ?? 0
}

// "Marcar como revisado": sale de la lista, del contador y del correo diario, pero queda guardado
// (migración 202609260003). Con revisado=false vuelve a aparecer.
export async function marcarEventosRevisados(ids: number[], revisado = true): Promise<void> {
  if (!supabase || !ids.length) return
  const { error } = await supabase.rpc('marcar_eventos_revisados', { p_ids: ids, p_revisado: revisado })
  if (error) throw error
}

// "Ya lo contacté" en las listas de cuentas que necesitan ayuda.
export async function listarCuentasRevisadas(): Promise<CuentaRevisada[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from('salud_cuentas_revisadas').select('user_id, motivo, revisado_at')
  if (error) throw error
  return (data ?? []) as CuentaRevisada[]
}
export async function marcarCuentaRevisada(userId: string, motivo: MotivoAyuda): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('salud_cuentas_revisadas').upsert({ user_id: userId, motivo }, { onConflict: 'user_id,motivo', ignoreDuplicates: true })
  if (error) throw error
}
