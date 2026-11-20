import { supabase } from '../lib/supabase'
import { invalidateComercial } from '../utils/queryCache'
import { ajustarSaldoCuenta } from './cuentas.service'

// PAGO AL PROVEEDOR EN PARTES (p. ej. 50 % ahora y el resto cuando el paquete está listo) para
// los PEDIDOS de clientes. El pedido tiene su gasto "Proveedor" con el costo completo (la ganancia
// se calcula bien desde el principio), pero de la cuenta solo sale lo que se mandó. Lo que falta
// queda anotado en ese gasto con la marca [SALDO_PROVEEDOR:monto] y vuelve a salir en
// Pedidos → Pagar al proveedor hasta que se pague.
// (Las Compras libres ya llevan sus adelantos como abonos: ver abonarInversion.)

const MARCA = /\[SALDO_PROVEEDOR:([\d.]+)\]\s*/
const r2 = (n: number) => Math.round(n * 100) / 100
const db = () => { if (!supabase) throw new Error('Supabase no está configurado.'); return supabase }

export const saldoDeObservaciones = (obs: string | null | undefined) => { const m = MARCA.exec(String(obs ?? '')); return m ? r2(Number(m[1]) || 0) : 0 }
const conSaldo = (obs: string | null | undefined, saldo: number) => {
  const limpio = String(obs ?? '').replace(MARCA, '').trim()
  return saldo > 0.005 ? `[SALDO_PROVEEDOR:${saldo.toFixed(2)}] ${limpio}`.trim() : (limpio || null)
}

export type SaldoProveedor = { gastoId: string; pedidoId: string; saldo: number; monto: number }

// Pedidos con una parte del proveedor todavía por pagar.
export async function listarSaldosProveedor(): Promise<SaldoProveedor[]> {
  const { data, error } = await db().from('gastos').select('id, pedido_id, monto, observaciones').ilike('categoria', '%proveedor%').like('observaciones', '%[SALDO_PROVEEDOR:%')
  if (error) throw error
  return (data ?? []).map((g) => ({ gastoId: g.id as string, pedidoId: g.pedido_id as string, saldo: saldoDeObservaciones(g.observaciones as string), monto: Number(g.monto || 0) })).filter((s) => s.pedidoId && s.saldo > 0.005)
}

// Después de registrar el pago del pedido (gasto con el costo completo): se anota lo que falta y el
// movimiento de la cuenta pasa a decir lo que se mandó de verdad (el adelanto).
export async function marcarAdelantoPedido(pedidoId: string, saldo: number) {
  const { data: gasto, error } = await db().from('gastos').select('id, monto, observaciones').eq('pedido_id', pedidoId).ilike('categoria', '%proveedor%').maybeSingle()
  if (error) throw error
  if (!gasto) return
  const { error: e1 } = await db().from('gastos').update({ observaciones: conSaldo(gasto.observaciones as string, r2(saldo)) }).eq('id', gasto.id)
  if (e1) throw e1
  const { data: mov } = await db().from('movimientos_cuenta').select('id, descripcion').eq('gasto_id', gasto.id).maybeSingle()
  if (mov) await db().from('movimientos_cuenta').update({ monto: r2(Number(gasto.monto || 0) - saldo), descripcion: String(mov.descripcion ?? '').replace(/^Pago a proveedor/, 'Adelanto a proveedor') }).eq('id', mov.id)
  invalidateComercial()
}

// Pagar (todo o otra parte) del saldo de un pedido.
//   pago: lo que se cubre del saldo (sin comisión) · comision: lo que costó de más el envío del
//   dinero (sube el costo del pedido) · montoCuenta: lo que sale de la cuenta (en su moneda).
export async function pagarSaldoProveedor(gastoId: string, opts: { pago: number; comision: number; cuentaId: string | null; montoCuenta: number; metodo: string }) {
  const { data: gasto, error } = await db().from('gastos').select('id, monto, observaciones, pedido_id, pedidos(codigo)').eq('id', gastoId).single()
  if (error) throw error
  const saldo = saldoDeObservaciones(gasto.observaciones as string)
  const pago = r2(Math.min(saldo, Math.max(0, opts.pago)))
  const comision = r2(Math.max(0, opts.comision))
  const queda = r2(saldo - pago)
  const { error: e1 } = await db().from('gastos').update({ monto: r2(Number(gasto.monto || 0) + comision), observaciones: conSaldo(gasto.observaciones as string, queda) }).eq('id', gastoId)
  if (e1) throw e1
  const enviado = r2(pago + comision)
  const delta = opts.cuentaId ? -Math.abs(Number(opts.montoCuenta) || 0) : 0
  const codigo = (gasto.pedidos as { codigo?: string } | null)?.codigo ?? ''
  const { data: mov } = await db().from('movimientos_cuenta').select('id, monto, monto_cuenta, cuenta_id').eq('gasto_id', gastoId).maybeSingle()
  // Misma cuenta que el adelanto (o el adelanto no salió de ninguna): se suma al mismo movimiento,
  // así editar el pago desde la ficha del pedido sigue funcionando igual.
  if (mov && (!opts.cuentaId || !mov.cuenta_id || mov.cuenta_id === opts.cuentaId)) {
    const { error: e2 } = await db().from('movimientos_cuenta').update({
      monto: r2(Number(mov.monto || 0) + enviado), cuenta_id: mov.cuenta_id ?? opts.cuentaId, monto_cuenta: delta ? r2(Number(mov.monto_cuenta || 0) + delta) : mov.monto_cuenta,
      descripcion: `${queda > 0.005 ? 'Adelanto a proveedor' : 'Pago a proveedor'} · ${codigo}`,
    }).eq('id', mov.id)
    if (e2) throw e2
  } else {
    const { error: e3 } = await db().from('movimientos_cuenta').insert({ fecha: new Date().toISOString(), tipo: 'pago_proveedor', descripcion: `Saldo a proveedor · ${codigo}`, monto: enviado, moneda: 'USD', monto_original: enviado, metodo: opts.metodo || null, cuenta_id: opts.cuentaId, monto_cuenta: delta || null, pedido_id: gasto.pedido_id })
    if (e3) throw e3
  }
  if (delta) await ajustarSaldoCuenta(opts.cuentaId!, delta)
  invalidateComercial()
  return queda
}
