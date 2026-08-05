import { supabase } from '../lib/supabase'
import type { Alerta } from '../types/domain'

export type ConfiguracionAlertas = { dias_sin_actualizacion: number; dias_atraso: number }
const DEFAULT_CONFIG: ConfiguracionAlertas = { dias_sin_actualizacion: 7, dias_atraso: 1 }
function requireSupabase() { if (!supabase) throw new Error('Supabase no está configurado.'); return supabase }

export async function listarAlertas() {
  const { data, error } = await requireSupabase().from('alertas').select('*, pedidos!inner(id,codigo,estado,fecha_estimada,updated_at,clientes(nombre))').order('resuelta').order('created_at', { ascending: false })
  if (error) throw error
  return data as unknown as Alerta[]
}
export async function resolverAlerta(id: string, resuelta: boolean) {
  const { data, error } = await requireSupabase().from('alertas').update({ resuelta, fecha_resuelta: resuelta ? new Date().toISOString() : null }).eq('id', id).select('*, pedidos!inner(id,codigo,estado,fecha_estimada,updated_at,clientes(nombre))').single()
  if (error) throw error
  return data as unknown as Alerta
}
export async function generarAlertas() { const { data, error } = await requireSupabase().rpc('generar_alertas_operativas'); if (error) throw error; return Number(data ?? 0) }
export async function obtenerConfiguracionAlertas() { const { data, error } = await requireSupabase().from('configuracion').select('valor_json').eq('clave', 'alertas').maybeSingle(); if (error) throw error; return { ...DEFAULT_CONFIG, ...((data?.valor_json as Partial<ConfiguracionAlertas> | null) ?? {}) } }
export async function guardarConfiguracionAlertas(config: ConfiguracionAlertas) { const { error } = await requireSupabase().from('configuracion').upsert({ clave: 'alertas', valor_json: config }, { onConflict: 'clave' }); if (error) throw error }
export function suscribirAlertas(onChange: () => void) { const client = supabase; if (!client) return () => undefined; const channel = client.channel('alertas-panel').on('postgres_changes', { event: '*', schema: 'public', table: 'alertas' }, onChange).subscribe(); return () => { void client.removeChannel(channel) } }
