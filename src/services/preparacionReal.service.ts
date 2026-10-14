import { supabase } from '../lib/supabase'

// PREPARACIÓN REAL que promete la tienda, por marca o por producto (días). Vive en
// configuracion.preparacion_tienda y la lee la tienda (RPC pública preparacion_tienda) y la fecha
// estimada de los pedidos (SQL ajuste_preparacion). Gana sobre la "Preparación aprox." del admin.
const CLAVE = 'preparacion_tienda'
export type Rango = { min: number; max: number }
export type PreparacionReal = { marcas: Record<string, Rango>; productos: Record<string, Rango> }

export async function obtenerPreparacionReal(): Promise<PreparacionReal> {
  if (!supabase) return { marcas: {}, productos: {} }
  const { data } = await supabase.from('configuracion').select('valor_json').eq('clave', CLAVE).maybeSingle()
  const v = (data?.valor_json ?? {}) as Partial<PreparacionReal>
  return { marcas: v.marcas ?? {}, productos: v.productos ?? {} }
}

// rango null = quitarlo (vuelve a lo del admin de la tienda o a la general).
export async function guardarPreparacionReal(tipo: keyof PreparacionReal, clave: string, rango: Rango | null) {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const actual = await obtenerPreparacionReal()
  const k = clave.trim().toUpperCase()
  if (rango) { const min = Math.max(1, Math.round(rango.min)); actual[tipo][k] = { min, max: Math.max(min, Math.round(rango.max)) } } else delete actual[tipo][k]
  const { error } = await supabase.from('configuracion').upsert({ clave: CLAVE, valor_json: actual }, { onConflict: 'clave' })
  if (error) throw error
  return actual
}
