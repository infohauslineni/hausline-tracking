import { supabase } from '../lib/supabase'
import type { EstadoPedido } from '../types/domain'

export type DiasPorEstado = Partial<Record<EstadoPedido, number>>
export type ConfiguracionEstimaciones = { activo: boolean; dias_margen: 1 | 2; dias_por_estado: DiasPorEstado }
export const DEFAULT_ESTIMACIONES: ConfiguracionEstimaciones = {
  activo: true,
  dias_margen: 2,
  dias_por_estado: { pedido_confirmado: 28, en_preparacion: 24, control_calidad: 20, etiqueta_creada: 18, despachado: 16, transito_internacional: 12, recibido_estados_unidos: 8, transito_nicaragua: 4, llego_nicaragua: 1, incidencia: 5 },
}
function requireSupabase() { if (!supabase) throw new Error('Supabase no está configurado.'); return supabase }
export async function obtenerConfiguracionEstimaciones() { const { data, error } = await requireSupabase().from('configuracion').select('valor_json').eq('clave', 'estimaciones').maybeSingle(); if (error) throw error; const saved = data?.valor_json as Partial<ConfiguracionEstimaciones> | null; return { ...DEFAULT_ESTIMACIONES, ...saved, dias_por_estado: { ...DEFAULT_ESTIMACIONES.dias_por_estado, ...(saved?.dias_por_estado ?? {}) } } }
export async function guardarConfiguracionEstimaciones(config: ConfiguracionEstimaciones) { const { error } = await requireSupabase().from('configuracion').upsert({ clave: 'estimaciones', valor_json: config }, { onConflict: 'clave' }); if (error) throw error }
export async function recalcularEstimaciones() { const { data, error } = await requireSupabase().rpc('recalcular_fechas_estimadas'); if (error) throw error; return Number(data ?? 0) }
