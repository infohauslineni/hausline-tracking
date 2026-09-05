import type { EstadoPedido } from '../types/domain'

const DAYS_BY_STATE: Partial<Record<EstadoPedido, number>> = { pedido_confirmado: 28, en_preparacion: 24, control_calidad: 20, etiqueta_creada: 18, despachado: 16, transito_internacional: 12, recibido_estados_unidos: 8, transito_nicaragua: 4, llego_nicaragua: 1, incidencia: 5 }
export function estimateDateForPreview(estado: EstadoPedido, margin = 2) {
  if (estado === 'cancelado') return null
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() + (estado === 'disponible_entrega' || estado === 'pagado' || estado === 'entregado' ? 0 : (DAYS_BY_STATE[estado] ?? 7) + margin))
  return toISODate(date)
}

function toISODate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Suma días hábiles (lun-vie) a una fecha, saltando fines de semana. */
export function addBusinessDays(from: Date, days: number) {
  const date = new Date(from)
  date.setHours(12, 0, 0, 0)
  let added = 0
  while (added < days) {
    date.setDate(date.getDate() + 1)
    const weekday = date.getDay()
    if (weekday !== 0 && weekday !== 6) added += 1
  }
  return date
}

/**
 * Entrega estimada para el cliente cuando el pedido ya llegó al país pero aún no
 * se marca "disponible para entrega". Base = llegada + 2 días hábiles; si ese plazo
 * ya venció y sigue sin actualizarse, se agregan 2 días hábiles más (hasta quedar a futuro).
 */
export function estimateAfterArrival(arrivalISO: string, now = new Date()) {
  const arrival = new Date(arrivalISO.includes('T') ? arrivalISO : `${arrivalISO}T12:00:00`)
  let estimate = addBusinessDays(arrival, 2)
  let guard = 0
  while (estimate.getTime() < now.getTime() && guard < 20) {
    estimate = addBusinessDays(estimate, 2)
    guard += 1
  }
  return toISODate(estimate)
}

/**
 * Si la fecha estimada ya venció y el pedido sigue sin actualizarse, la va posponiendo
 * en pasos (por defecto 3 días) hasta que vuelva a quedar a futuro. Así el cliente nunca
 * ve una fecha de entrega que ya pasó.
 */
export function postponeUntilFuture(estimateISO: string, stepDays = 3, now = new Date()) {
  const estimate = new Date(estimateISO.includes('T') ? estimateISO : `${estimateISO}T12:00:00`)
  estimate.setHours(12, 0, 0, 0)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  let guard = 0
  while (estimate.getTime() < today.getTime() && guard < 200) {
    estimate.setDate(estimate.getDate() + stepDays)
    guard += 1
  }
  return toISODate(estimate)
}

/**
 * Como postponeUntilFuture, pero garantiza que la fecha quede al menos `minDays` días en
 * el futuro (no solo "a futuro"). Se usa mientras el pedido sigue EN TRÁNSITO: un paquete
 * en camino no puede entregarse mañana, así que si la estimación cae dentro de esos días
 * se empuja en pasos de `stepDays` hasta quedar a varios días vista. Así nunca se muestra
 * "llega hoy/mañana" cuando el paquete todavía está en tránsito.
 */
export function postponeToMinFuture(estimateISO: string, minDays = 3, stepDays = 3, now = new Date()) {
  const estimate = new Date(estimateISO.includes('T') ? estimateISO : `${estimateISO}T12:00:00`)
  estimate.setHours(12, 0, 0, 0)
  const floor = new Date(now)
  floor.setHours(0, 0, 0, 0)
  floor.setDate(floor.getDate() + minDays)
  let guard = 0
  while (estimate.getTime() < floor.getTime() && guard < 200) {
    estimate.setDate(estimate.getDate() + stepDays)
    guard += 1
  }
  return toISODate(estimate)
}
