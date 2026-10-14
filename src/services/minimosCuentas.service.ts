import { supabase } from '../lib/supabase'
import type { CuentaBancaria } from '../types/domain'

// MÍNIMO POR CUENTA: lo que siempre tiene que quedar en cada cuenta (colchón, no se toca). Ej:
// BAC dólares US$ 200, BAC córdobas C$ 2,500. Va en `configuracion` (clave minimos_cuentas) como
// { [cuentaId]: monto en la moneda de la cuenta }, sin tabla propia.
// Con esto, el fondo de gastos fijos y "tu ganancia ahora" se calculan con DINERO REAL: solo lo que
// hay en las cuentas por encima de su mínimo. Espejo en el servidor: api/_fondo.js.
const CLAVE = 'minimos_cuentas'
export type MinimosCuentas = Record<string, number>

export async function listarMinimos(): Promise<MinimosCuentas> {
  if (!supabase) return {}
  const { data } = await supabase.from('configuracion').select('valor_json').eq('clave', CLAVE).maybeSingle()
  const v = data?.valor_json
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as MinimosCuentas) : {}
}

export async function guardarMinimo(cuentaId: string, monto: number | null) {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const actual = await listarMinimos()
  if (monto == null || !(monto > 0)) delete actual[cuentaId]; else actual[cuentaId] = Math.round(monto * 100) / 100
  const { error } = await supabase.from('configuracion').upsert({ clave: CLAVE, valor_json: actual }, { onConflict: 'clave' })
  if (error) throw error
  return actual
}

export type LibreCuenta = { cuenta: CuentaBancaria; saldo: number; minimo: number; libre: number; debajo: boolean }
// Dinero libre de verdad: por cuenta, lo que hay por encima de su mínimo; y el total en US$.
export function dineroLibre(cuentas: CuentaBancaria[], minimos: MinimosCuentas, tipoCambio: number) {
  const tc = tipoCambio > 0 ? tipoCambio : 37
  const porCuenta: LibreCuenta[] = cuentas.filter((c) => c.activo !== false).map((c) => {
    const saldo = Number(c.saldo || 0)
    const minimo = Number(minimos[c.id] || 0)
    return { cuenta: c, saldo, minimo, libre: Math.max(0, saldo - minimo), debajo: minimo > 0 && saldo < minimo }
  })
  const libreUsd = Math.round(porCuenta.reduce((s, x) => s + (x.cuenta.moneda === 'NIO' ? x.libre / tc : x.libre), 0) * 100) / 100
  return { libreUsd, porCuenta }
}
