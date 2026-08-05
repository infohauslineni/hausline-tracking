import type { Alerta } from '../types/domain'
import { DEMO_PEDIDOS } from './demo'

const pedido = (index: number) => ({ id: DEMO_PEDIDOS[index].id, codigo: DEMO_PEDIDOS[index].codigo, estado: DEMO_PEDIDOS[index].estado, fecha_estimada: DEMO_PEDIDOS[index].fecha_estimada, updated_at: DEMO_PEDIDOS[index].updated_at, clientes: { nombre: DEMO_PEDIDOS[index].clientes?.nombre ?? 'Cliente' } })

export const DEMO_ALERTAS: Alerta[] = [
  { id: '60000000-0000-4000-8000-000000000001', pedido_id: DEMO_PEDIDOS[3].id, trayecto_id: '40000000-0000-4000-8000-000000000004', tipo: 'entrega_fallida', titulo: 'Entrega fallida', descripcion: 'Evento registrado manualmente: no se pudo completar la entrega en Miami.', prioridad: 'critica', resuelta: false, fecha_resuelta: null, created_at: '2026-07-13T10:00:00Z', updated_at: '2026-07-13T10:00:00Z', pedidos: pedido(3) },
  { id: '60000000-0000-4000-8000-000000000002', pedido_id: DEMO_PEDIDOS[3].id, trayecto_id: null, tipo: 'pedido_atrasado', titulo: 'Pedido atrasado', descripcion: 'La fecha estimada ya fue superada.', prioridad: 'alta', resuelta: false, fecha_resuelta: null, created_at: '2026-07-12T10:00:00Z', updated_at: '2026-07-12T10:00:00Z', pedidos: pedido(3) },
  { id: '60000000-0000-4000-8000-000000000003', pedido_id: DEMO_PEDIDOS[0].id, trayecto_id: null, tipo: 'falta_control_calidad', titulo: 'Falta control de calidad', descripcion: 'El pedido avanzó sin fotografías de control de calidad.', prioridad: 'media', resuelta: false, fecha_resuelta: null, created_at: '2026-07-14T15:00:00Z', updated_at: '2026-07-14T15:00:00Z', pedidos: pedido(0) },
  { id: '60000000-0000-4000-8000-000000000004', pedido_id: DEMO_PEDIDOS[2].id, trayecto_id: null, tipo: 'sin_tracking', titulo: 'Pedido sin tracking', descripcion: 'El pedido todavía no tiene un trayecto activo.', prioridad: 'media', resuelta: true, fecha_resuelta: '2026-07-14T18:00:00Z', created_at: '2026-07-11T12:00:00Z', updated_at: '2026-07-14T18:00:00Z', pedidos: pedido(2) },
]
