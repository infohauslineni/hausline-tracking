import { supabase } from '../lib/supabase'
import type { Cupon, CuponValidacion } from '../types/domain'
import { cachedQuery, invalidateCache } from '../utils/queryCache'

function client() { if (!supabase) throw new Error('Supabase no está configurado.'); return supabase }

export type CuponInput = Pick<Cupon, 'codigo' | 'tipo' | 'valor' | 'cliente_id' | 'usos_max' | 'vence_el' | 'nota'> & { activo?: boolean }

// Lista los cupones (con el nombre del cliente si es un cupón personal), del más nuevo al más viejo.
export async function listarCupones(onFresh?: (value: Cupon[]) => void) {
  return cachedQuery('cupones', async () => {
    const { data, error } = await client().from('cupones').select('*, clientes(nombre, whatsapp)').order('created_at', { ascending: false })
    if (error) throw error
    return data as unknown as Cupon[]
  }, 30_000, onFresh)
}

export async function guardarCupon(input: CuponInput, id?: string) {
  const payload = { ...input, codigo: input.codigo.trim().toUpperCase(), valor: Number(input.valor), usos_max: input.usos_max && input.usos_max > 0 ? Number(input.usos_max) : null, vence_el: input.vence_el || null, nota: input.nota?.trim() || null }
  const query = id ? client().from('cupones').update(payload).eq('id', id) : client().from('cupones').insert(payload)
  const { data, error } = await query.select('*, clientes(nombre, whatsapp)').single()
  if (error) throw error
  invalidateCache('cupones')
  return data as unknown as Cupon
}

// Activa / desactiva un cupón (para "apagarlo" sin borrarlo).
export async function cambiarActivoCupon(id: string, activo: boolean) {
  const { error } = await client().from('cupones').update({ activo }).eq('id', id)
  if (error) throw error
  invalidateCache('cupones')
}

export async function eliminarCupon(id: string) {
  const { error } = await client().from('cupones').delete().eq('id', id)
  if (error) throw error
  invalidateCache('cupones')
}

// Cupón personal ACTIVO de un cliente (para ofrecerlo al registrar su próxima compra).
// Devuelve null si no tiene, o si ya venció / se agotó.
export async function cuponActivoDeCliente(clienteId: string): Promise<Cupon | null> {
  const hoy = new Date().toISOString().slice(0, 10)
  const { data, error } = await client().from('cupones').select('*, clientes(nombre, whatsapp)')
    .eq('cliente_id', clienteId).eq('activo', true)
    .or(`vence_el.is.null,vence_el.gte.${hoy}`)
    .order('created_at', { ascending: false }).limit(5)
  if (error) throw error
  const cupones = (data as unknown as Cupon[]) ?? []
  // Descarta los que ya llegaron a su tope de usos.
  return cupones.find((c) => c.usos_max == null || c.usos_confirmados < c.usos_max) ?? null
}

// Valida un código para un total dado (no lo consume). Sirve en el panel y en la tienda.
export async function validarCupon(codigo: string, total: number): Promise<CuponValidacion> {
  const { data, error } = await client().rpc('validar_cupon', { p_codigo: codigo.trim(), p_total: Number(total) || 0 })
  if (error) throw error
  return data as CuponValidacion
}

// Marca un uso confirmado (cuando el cliente ya pagó). Se llama una vez por pedido.
export async function registrarUsoCupon(cuponId: string) {
  const { error } = await client().rpc('registrar_uso_cupon', { p_cupon_id: cuponId })
  if (error) throw error
  invalidateCache('cupones')
}

// Genera un código corto y legible (evita caracteres confusos como 0/O, 1/I).
export function generarCodigo(prefijo = 'HAUS'): string {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 5; i++) s += abc[Math.floor(Math.random() * abc.length)]
  return `${prefijo.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'HAUS'}-${s}`
}
