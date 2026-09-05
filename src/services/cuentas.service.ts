import { supabase } from '../lib/supabase'
import type { CuentaBancaria } from '../types/domain'
import { cachedQuery, invalidateCache } from '../utils/queryCache'

function client() { if (!supabase) throw new Error('Supabase no está configurado.'); return supabase }

// Lista las cuentas activas, en el orden definido (y por nombre). Cacheada como el resto.
export async function listarCuentas(onFresh?: (value: CuentaBancaria[]) => void) {
  return cachedQuery('cuentas', async () => {
    const { data, error } = await client().from('cuentas_bancarias').select('*').eq('activo', true).order('orden').order('created_at')
    if (error) throw error
    return data as CuentaBancaria[]
  }, 45_000, onFresh)
}

// Cuánto ENTRÓ a cada cuenta en el MES CALENDARIO actual (suma de los movimientos con
// monto_cuenta positivo, en la moneda de la cuenta). Alimenta la barra de "límite mensual
// de recepción" (LAFISE), que se reinicia sola a 0 el 1 de cada mes. Devuelve
// { cuenta_id: recibido_en_el_mes }.
export async function recibidoPorCuentaMes(onFresh?: (value: Record<string, number>) => void) {
  return cachedQuery('recibido-mes', async () => {
    const ahora = new Date()
    const inicio = new Date(ahora.getFullYear(), ahora.getMonth(), 1).toISOString()
    const map: Record<string, number> = {}
    // 1) Cobros/ingresos/reembolsos que entraron a cada cuenta este mes.
    const { data, error } = await client().from('movimientos_cuenta')
      .select('cuenta_id, monto_cuenta')
      .gte('fecha', inicio)
      .gt('monto_cuenta', 0)
      .not('cuenta_id', 'is', null)
      .limit(1000)
    if (error) throw error
    for (const row of (data as Array<{ cuenta_id: string; monto_cuenta: number }>)) {
      map[row.cuenta_id] = (map[row.cuenta_id] || 0) + Number(row.monto_cuenta || 0)
    }
    // 2) Transferencias recibidas de otras cuentas propias este mes (también cuentan como
    //    dinero que ENTRÓ a la cuenta, así que suman al tope mensual de recepción).
    const { data: transf, error: errT } = await client().from('transferencias_cuenta')
      .select('destino_id, monto_destino')
      .gte('fecha', inicio)
      .not('destino_id', 'is', null)
      .limit(1000)
    if (errT) throw errT
    for (const row of (transf as Array<{ destino_id: string; monto_destino: number }>)) {
      map[row.destino_id] = (map[row.destino_id] || 0) + Number(row.monto_destino || 0)
    }
    return map
  }, 45_000, onFresh)
}

export type CuentaInput = Pick<CuentaBancaria, 'nombre' | 'banco' | 'numero' | 'titular' | 'moneda' | 'emoji' | 'saldo' | 'orden' | 'proposito' | 'limite'>

export async function guardarCuenta(input: CuentaInput, id?: string) {
  const query = id ? client().from('cuentas_bancarias').update(input).eq('id', id) : client().from('cuentas_bancarias').insert(input)
  const { data, error } = await query.select('*').single()
  if (error) throw error
  invalidateCache('cuentas')
  return data as CuentaBancaria
}

// Baja lógica: la cuenta desaparece de las tarjetas pero no se pierde el historial.
export async function eliminarCuenta(id: string) {
  const { error } = await client().from('cuentas_bancarias').update({ activo: false }).eq('id', id)
  if (error) throw error
  invalidateCache('cuentas')
}

// Suma (delta > 0) o resta (delta < 0) al saldo de una cuenta de forma atómica. delta va
// en la MONEDA de la cuenta. Devuelve el saldo nuevo. Silencioso si p_id es null.
export async function ajustarSaldoCuenta(id: string, delta: number) {
  const { data, error } = await client().rpc('ajustar_saldo_cuenta', { p_id: id, p_delta: delta })
  if (error) throw error
  invalidateCache('cuentas')
  return Number(data ?? 0)
}

// Fija el saldo exacto (corrección manual para cuadrar con el banco): calcula el delta
// contra el saldo actual y lo aplica.
export async function fijarSaldoCuenta(cuenta: CuentaBancaria, nuevoSaldo: number) {
  const delta = Math.round((Number(nuevoSaldo) - Number(cuenta.saldo)) * 100) / 100
  if (delta === 0) return Number(cuenta.saldo)
  return ajustarSaldoCuenta(cuenta.id, delta)
}

// Mueve dinero de una cuenta a otra: resta del origen y suma al destino. Los montos van en
// la moneda de cada cuenta (si son distintas monedas, montoDestino es el equivalente que
// llega). NO toca la caja (es plata que ya tenías, solo cambia de cuenta).
export async function transferirEntreCuentas(origenId: string, destinoId: string, montoOrigen: number, montoDestino: number, nota?: string) {
  if (!origenId || !destinoId) throw new Error('Elegí la cuenta de origen y la de destino.')
  if (origenId === destinoId) throw new Error('Elegí dos cuentas distintas.')
  if (!(montoOrigen > 0) || !(montoDestino > 0)) throw new Error('Indicá un monto válido.')
  // Atómico en el servidor: baja el origen, sube el destino y deja registro (para que la barra
  // de "recibido este mes" del destino lo cuente). No afecta la caja.
  const { error } = await client().rpc('transferir_entre_cuentas', { p_origen: origenId, p_destino: destinoId, p_monto_origen: Math.abs(montoOrigen), p_monto_destino: Math.abs(montoDestino), p_nota: nota ?? null })
  if (error) throw error
  invalidateCache('cuentas')
  invalidateCache('recibido-mes')
}
