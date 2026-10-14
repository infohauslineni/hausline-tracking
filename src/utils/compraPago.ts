import type { Inversion } from '../types/domain'

// PAGO AL PROVEEDOR de una compra libre. Una compra "por pagar" puede tener abonos parciales
// (un adelanto): son los movimientos de caja tipo "inversion" ligados a ella.
const r2 = (n: number) => Math.round(n * 100) / 100

// Cuánto ya se le pagó al proveedor por esta compra. Si está marcada pagada, todo.
export function pagadoInversion(item: Pick<Inversion, 'pagado' | 'movimientos_cuenta'>, costo: number) {
  if (item.pagado !== false) return r2(costo)
  return r2((item.movimientos_cuenta ?? []).filter((m) => m.tipo === 'inversion').reduce((s, m) => s + Number(m.monto || 0), 0))
}
// Lo que falta pagarle al proveedor (0 si ya está pagada).
export function porPagarInversion(item: Pick<Inversion, 'pagado' | 'movimientos_cuenta'>, costo: number) {
  return item.pagado === false ? Math.max(0, r2(costo - pagadoInversion(item, costo))) : 0
}

// Tallas escritas en "Talla / color" separadas por coma: "39,40,41" → ['39','40','41'].
export function tallasDeTexto(texto: string | null | undefined) {
  return String(texto ?? '').split(/[,;]+/).map((t) => t.trim()).filter(Boolean)
}
