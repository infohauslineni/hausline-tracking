// Política de bodega. El cliente tiene DIAS_GRACIA_BODEGA días para confirmar o
// cancelar sin costo desde que su pedido queda "Disponible para entrega". Después de
// esos días se cobra CARGO_BODEGA_DIARIO (USD) por cada día EXTRA (los que pasan de la
// gracia), no los de gracia. Ejemplos:
//   2 días → US$0 (aún en gracia); 3 días → US$5; 4 días → US$10; 5 días → US$15.
// El conteo se congela cuando el pedido pasa a "Pagado" (ver `hasta`): a partir de ahí
// no sigue subiendo. Esta lógica la comparten el seguimiento público (aviso al
// cliente), el panel (aviso al admin) y el cobro (línea en la factura).
export const CARGO_BODEGA_DIARIO = 5
export const DIAS_GRACIA_BODEGA = 2

export type CargoBodega = {
  dias: number // días totales desde que quedó disponible (hasta hoy o hasta que pagó)
  diasCobrados: number // días que se cobran (dias − gracia, nunca negativo)
  cargo: number // USD acumulados
  limite: string // fecha ISO hasta la que puede confirmar sin costo
  activo: boolean // true cuando ya hay días extra cobrados (cargo > 0)
}

// Calcula el cargo acumulado desde que el pedido quedó disponible. Si `hasta` viene
// (fecha en que se marcó "Pagado"), el conteo se congela ahí; si no, corre hasta hoy.
// Devuelve null si no hay fecha válida (todavía no está disponible).
export function calcularCargoBodega(disponibleDesde: string | null | undefined, hasta?: string | null, ahora: Date = new Date()): CargoBodega | null {
  if (!disponibleDesde) return null
  const inicio = new Date(disponibleDesde.includes('T') ? disponibleDesde : `${disponibleDesde}T12:00:00`)
  if (Number.isNaN(inicio.getTime())) return null
  const fin = hasta ? new Date(hasta.includes('T') ? hasta : `${hasta}T12:00:00`) : ahora
  const corte = Number.isNaN(fin.getTime()) ? ahora : fin
  const dias = Math.max(0, Math.floor((corte.getTime() - inicio.getTime()) / 86_400_000))
  const diasCobrados = Math.max(0, dias - DIAS_GRACIA_BODEGA)
  const cargo = Math.round(diasCobrados * CARGO_BODEGA_DIARIO * 100) / 100
  const limite = new Date(inicio.getTime() + DIAS_GRACIA_BODEGA * 86_400_000).toISOString()
  return { dias, diasCobrados, cargo, limite, activo: diasCobrados > 0 }
}

// Etiqueta de la línea de factura / pedido para el cargo por bodega.
export function etiquetaCargoBodega(diasCobrados: number) {
  return `Cargo por bodega (${diasCobrados} ${diasCobrados === 1 ? 'día' : 'días'})`
}
