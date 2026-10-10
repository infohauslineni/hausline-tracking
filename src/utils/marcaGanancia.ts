import type { Gasto } from '../types/domain'

// Gasto que el dueño tomó de SU ganancia (se le resta de lo que le toca). Va como marca en
// `gastos.observaciones` para no depender de una migración.
export const MARCA_GASTO_GANANCIA = '[DE_MI_GANANCIA]'
export const esGastoDeGanancia = (g: Pick<Gasto, 'observaciones'>) => (g.observaciones ?? '').includes(MARCA_GASTO_GANANCIA)
export const observacionesSinMarca = (v: string | null | undefined) => (v ?? '').split(MARCA_GASTO_GANANCIA).join('').trim()
export const observacionesConMarca = (texto: string | null | undefined, deGanancia: boolean) => {
  const limpio = observacionesSinMarca(texto)
  return deGanancia ? `${MARCA_GASTO_GANANCIA} ${limpio}`.trim() : (limpio || null)
}
