import type { EstadoPedido, Inversion } from '../types/domain'

// ETAPAS DE UNA COMPRA LIBRE que viene en camino, iguales a las de un pedido normal. Para la base
// y la tienda la compra sigue en estado 'en_transito'; `inversiones.etapa` dice en qué parte va.
// Al apartarla o venderla por adelantado, el pedido del cliente arranca en esa misma etapa.
// Si sale en la tienda o no lo decide aparte `mostrar_tienda`.
export const ETAPAS_COMPRA = [
  ['en_preparacion', 'En preparación'],
  ['control_calidad', 'Control de calidad'],
  ['transito_internacional', 'En tránsito internacional'],
  ['recibido_estados_unidos', 'Recibido en Miami'],
  ['transito_nicaragua', 'En tránsito a Nicaragua'],
] as const
export type EtapaCompra = (typeof ETAPAS_COMPRA)[number][0]
export const esEtapaCompra = (v: string): v is EtapaCompra => ETAPAS_COMPRA.some(([k]) => k === v)
const ORDEN: string[] = ETAPAS_COMPRA.map(([k]) => k)

// Etapa de una compra en camino. Las viejas sin etapa: con tracking ya van en tránsito; sin, en preparación.
export function etapaDeCompra(item: Pick<Inversion, 'estado' | 'tracking' | 'etapa'>): EtapaCompra | null {
  if (item.estado !== 'en_transito') return null
  if (item.etapa && esEtapaCompra(item.etapa)) return item.etapa
  return (item.tracking ?? '').trim() ? 'transito_internacional' : 'en_preparacion'
}
export const nombreEtapa = (etapa: EtapaCompra) => ETAPAS_COMPRA.find(([k]) => k === etapa)?.[1] ?? 'En camino'

// La más atrasada de varias (un pedido con varias compras arranca donde va la más lenta).
export const etapaMasAtrasada = (etapas: EtapaCompra[]) => etapas.slice().sort((a, b) => ORDEN.indexOf(a) - ORDEN.indexOf(b))[0] ?? null

// Estado con el que arranca el pedido del cliente. En preparación / control de calidad: con fotos de
// calidad va a Control de calidad (así le llega el correo con las fotos), sin fotos a En preparación.
// Más adelante: la misma etapa de la compra.
export function estadoPedidoDesdeEtapa(etapa: EtapaCompra | null, fotos: number): EstadoPedido {
  if (!etapa || etapa === 'en_preparacion' || etapa === 'control_calidad') return fotos > 0 ? 'control_calidad' : 'en_preparacion'
  return etapa
}
