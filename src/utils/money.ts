export type Moneda = 'USD' | 'NIO'

export const MONEDA_SIMBOLO: Record<Moneda, string> = { USD: 'US$', NIO: 'C$' }
export const MONEDA_LABEL: Record<Moneda, string> = { USD: 'Dólares (US$)', NIO: 'Córdobas (C$)' }

/** Convierte un monto en la moneda indicada a su valor en dólares. */
export function aUsd(montoOriginal: number, moneda: Moneda, tipoCambio: number): number {
  const monto = Number(montoOriginal) || 0
  if (moneda === 'NIO') {
    const tc = Number(tipoCambio) || 0
    return tc > 0 ? Number((monto / tc).toFixed(2)) : 0
  }
  return Number(monto.toFixed(2))
}

export function formatMoneda(monto: number, moneda: Moneda = 'USD') {
  return `${MONEDA_SIMBOLO[moneda]} ${Number(monto || 0).toFixed(2)}`
}
