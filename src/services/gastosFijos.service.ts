import { supabase } from '../lib/supabase'
import type { Gasto, Moneda } from '../types/domain'
import { listarCuentas } from './cuentas.service'
import { obtenerTipoCambio, registrarGasto } from './comercial.service'
import { observacionesConMarca } from '../utils/marcaGanancia'

// GASTOS FIJOS: lo que se paga todos los meses (publicidad, suscripciones, internet…). Se define
// una vez y el panel lo registra solo cuando llega el día: sale de la cuenta elegida y, si se
// marcó, se resta de la ganancia del dueño. La lista vive en `configuracion` (clave gastos_fijos),
// sin tabla propia. Cada gasto registrado lleva la marca [FIJO:<id>:<AAAA-MM>] para no repetirse.

export type GastoFijo = {
  id: string
  descripcion: string
  categoria: string
  monto: number // en `moneda`
  moneda: Moneda
  dia: number // día del mes en que se registra (1–28)
  cuentaId: string
  deGanancia: boolean // "lo tomo de mi ganancia"
  activo: boolean
  ultimo: string | null // último mes ya registrado (AAAA-MM); null = todavía ninguno
  desde: string // primer mes que cuenta (AAAA-MM)
}

const CLAVE = 'gastos_fijos'
const MAX_MESES_ATRASADOS = 3 // si no se abrió el panel en un tiempo, se pone al día hasta 3 meses

function db() { if (!supabase) throw new Error('Supabase no está configurado.'); return supabase }
const dos = (n: number) => String(n).padStart(2, '0')
// Hoy en Nicaragua (UTC−6), como AAAA-MM-DD.
const hoyNicaragua = () => new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10)
export const mesDe = (fecha: string) => fecha.slice(0, 7)
const mesSiguiente = (mes: string) => { const [y, m] = mes.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${dos(m + 1)}` }
export const marcaFijo = (id: string, mes: string) => `[FIJO:${id}:${mes}]`

export async function listarGastosFijos(): Promise<GastoFijo[]> {
  const { data, error } = await db().from('configuracion').select('valor_json').eq('clave', CLAVE).maybeSingle()
  if (error) throw error
  return Array.isArray(data?.valor_json) ? (data.valor_json as GastoFijo[]) : []
}

export async function guardarGastosFijos(lista: GastoFijo[]) {
  const { error } = await db().from('configuracion').upsert({ clave: CLAVE, valor_json: lista }, { onConflict: 'clave' })
  if (error) throw error
}

// Meses que le toca registrar a un gasto fijo hoy (normalmente uno; más si hubo atraso).
export function mesesPendientes(g: GastoFijo, hoy: string = hoyNicaragua()): string[] {
  if (!g.activo) return []
  const mesHoy = mesDe(hoy)
  const diaHoy = Number(hoy.slice(8, 10))
  // El mes en curso solo cuenta cuando ya llegó su día.
  const tope = diaHoy >= g.dia ? mesHoy : (() => { const [y, m] = mesHoy.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${dos(m - 1)}` })()
  let mes = g.ultimo ? mesSiguiente(g.ultimo) : g.desde
  const meses: string[] = []
  while (mes <= tope) { meses.push(mes); mes = mesSiguiente(mes) }
  return meses.slice(-MAX_MESES_ATRASADOS)
}

// Próxima fecha en que se va a registrar (para mostrarla en la lista).
export function proximoRegistro(g: GastoFijo, hoy: string = hoyNicaragua()): string | null {
  if (!g.activo) return null
  const pendientes = mesesPendientes(g, hoy)
  const mes = pendientes[0] ?? (g.ultimo ? mesSiguiente(g.ultimo) : g.desde)
  return `${mes}-${dos(g.dia)}`
}

let enCurso: Promise<Gasto[]> | null = null
// Registra los gastos fijos que ya tocan. Se llama al abrir el panel (admin). Es seguro llamarla
// varias veces: revisa la marca en `gastos` antes de registrar y avanza `ultimo` al terminar.
export function procesarGastosFijos(): Promise<Gasto[]> {
  if (enCurso) return enCurso
  enCurso = (async () => {
    const lista = await listarGastosFijos()
    const hoy = hoyNicaragua()
    if (!lista.some((g) => mesesPendientes(g, hoy).length)) return []
    const [tipoCambio, cuentas] = await Promise.all([obtenerTipoCambio().catch(() => 37), listarCuentas().catch(() => [])])
    const tc = tipoCambio > 0 ? tipoCambio : 37
    const registrados: Gasto[] = []
    let cambio = false
    for (const g of lista) {
      const cuenta = cuentas.find((c) => c.id === g.cuentaId)
      for (const mes of mesesPendientes(g, hoy)) {
        if (!cuenta) break // la cuenta ya no existe: no se registra hasta que se corrija
        const marca = marcaFijo(g.id, mes)
        const { data: ya } = await db().from('gastos').select('id').ilike('observaciones', `%${marca}%`).limit(1)
        if (!ya?.length) {
          const montoUsd = g.moneda === 'NIO' ? Math.round((g.monto / tc) * 100) / 100 : g.monto
          // Lo que sale de la cuenta va en la moneda de ESA cuenta.
          const montoCuenta = cuenta.moneda === g.moneda ? g.monto : cuenta.moneda === 'NIO' ? Math.round(montoUsd * tc) : montoUsd
          const gasto = await registrarGasto({
            fecha: `${mes}-${dos(g.dia)}`, categoria: g.categoria, descripcion: g.descripcion, monto: montoUsd, moneda: g.moneda,
            monto_original: g.monto, tipo_cambio: g.moneda === 'NIO' ? tc : null, pedido_id: null, inversion_id: null, proveedor_id: null,
            metodo_pago: 'Gasto fijo', observaciones: observacionesConMarca(`${marca} Gasto fijo mensual`, g.deGanancia),
          }, { cuentaId: g.cuentaId, montoCuenta })
          registrados.push(gasto)
        }
        g.ultimo = mes; cambio = true
      }
    }
    if (cambio) await guardarGastosFijos(lista)
    return registrados
  })().finally(() => { enCurso = null })
  return enCurso
}
