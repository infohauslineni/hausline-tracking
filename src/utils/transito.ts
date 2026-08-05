import type { Trayecto } from '../types/domain'

const MS_DIA = 86_400_000

function aFecha(value?: string | null) {
  if (!value) return null
  const date = new Date(value.includes('T') ? value : `${value}T12:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Día de despacho del pedido: el envío más temprano entre sus trayectos. */
export function fechaDespacho(trayectos: Trayecto[]) {
  const envios = trayectos.map((t) => aFecha(t.fecha_envio)).filter((d): d is Date => d != null)
  return envios.length ? new Date(Math.min(...envios.map((d) => d.getTime()))) : null
}

/** Día en que llegó al país: la entrega más reciente entre sus trayectos. */
export function fechaLlegada(trayectos: Trayecto[]) {
  const entregas = trayectos.map((t) => aFecha(t.fecha_entrega)).filter((d): d is Date => d != null)
  return entregas.length ? new Date(Math.max(...entregas.map((d) => d.getTime()))) : null
}

/**
 * Días en tránsito de un pedido: desde que se despachó hasta que llegó al país.
 * Si todavía no llega, cuenta hasta hoy (contador en vivo). Devuelve null si aún no
 * hay fecha de despacho registrada.
 */
export function diasEnTransito(trayectos: Trayecto[], now = new Date()) {
  const despacho = fechaDespacho(trayectos)
  if (!despacho) return null
  const llegada = fechaLlegada(trayectos)
  const fin = llegada ?? now
  const dias = Math.max(0, Math.round((fin.getTime() - despacho.getTime()) / MS_DIA))
  return { dias, enCurso: !llegada, despacho, llegada }
}

/**
 * Promedio de días en tránsito ("lo normal") sobre los pedidos ya completados,
 * es decir, los que tienen fecha de despacho y de llegada al país. Agrupa los
 * trayectos por pedido para medir el trayecto completo, no cada tramo por separado.
 */
export function promedioDiasTransito(trayectos: Trayecto[]) {
  const porPedido = new Map<string, Trayecto[]>()
  for (const t of trayectos) {
    const grupo = porPedido.get(t.pedido_id) ?? []
    grupo.push(t)
    porPedido.set(t.pedido_id, grupo)
  }
  const dias: number[] = []
  for (const grupo of porPedido.values()) {
    const despacho = fechaDespacho(grupo)
    const llegada = fechaLlegada(grupo)
    if (despacho && llegada) dias.push(Math.max(0, Math.round((llegada.getTime() - despacho.getTime()) / MS_DIA)))
  }
  if (!dias.length) return null
  const promedio = Math.round(dias.reduce((sum, d) => sum + d, 0) / dias.length)
  return { promedio, muestra: dias.length, min: Math.min(...dias), max: Math.max(...dias) }
}
