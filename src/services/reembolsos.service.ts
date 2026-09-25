import { supabase } from '../lib/supabase'
import { registrarReembolso } from './comercial.service'
import { cancelarPedido, enviarCorreoCancelacion } from './pedidos.service'
import type { DestinoPago } from '../components/finanzas/CuentaSelect'

// Solicitudes de cancelación / reembolso que el cliente deja desde Mi cuenta (tienda).
// NADA se cancela solo: el admin revisa si el motivo es real y aprueba (cancela el pedido +
// registra el reembolso) o rechaza (el cliente elige seguir con el pedido o perder lo pagado).
export type EstadoReembolso = 'pendiente' | 'aprobada' | 'rechazada' | 'retirada' | 'cancelada_sin_reembolso'
export type SolicitudReembolso = {
  id: string
  pedido_id: string
  codigo: string
  correo_cliente: string | null
  nombre_cliente: string | null
  whatsapp_cliente: string | null
  etapa: 'antes_envio' | 'calidad' | 'transito' | 'disponible'
  estado_pedido: string
  motivo: string
  motivo_label: string
  detalle: string
  banco: string
  numero_cuenta: string
  titular: string
  monto_pagado: number
  moneda: string | null
  estado: EstadoReembolso
  respuesta: string | null
  monto_reembolso: number | null
  resuelto_at: string | null
  decision_cliente_at: string | null
  created_at: string
  pedidos?: { id: string; estado: string; cliente_id: string; abono: number; total: number } | null
}

function client() { if (!supabase) throw new Error('Supabase no está configurado.'); return supabase }

export const ETAPA_REEMBOLSO_LABEL: Record<SolicitudReembolso['etapa'], string> = {
  antes_envio: 'Antes del envío (en preparación)',
  calidad: 'Dentro de las 24 h de control de calidad',
  transito: 'En tránsito / ya pasó control de calidad',
  disponible: 'Ya en Nicaragua',
}

export async function listarReembolsos() {
  const { data, error } = await client().from('solicitudes_reembolso')
    .select('*, pedidos(id, estado, cliente_id, abono, total)')
    .order('created_at', { ascending: false }).limit(200)
  if (error) throw error
  return data as SolicitudReembolso[]
}

// Cuántas esperan revisión (pendientes) o esperan que el admin cancele (el cliente ya
// eligió cancelar sin reembolso). Para el contador del menú.
export const porAtender = (s: SolicitudReembolso) =>
  s.estado === 'pendiente' || (s.estado === 'cancelada_sin_reembolso' && s.pedidos?.estado !== 'cancelado')
export async function contarReembolsosPorAtender() {
  const { data, error } = await client().from('solicitudes_reembolso')
    .select('estado, pedidos(estado)').in('estado', ['pendiente', 'cancelada_sin_reembolso']).limit(200)
  if (error) throw error
  return (data as unknown as SolicitudReembolso[]).filter(porAtender).length
}

async function marcar(id: string, cambios: Partial<SolicitudReembolso>) {
  const { data: sesion } = await client().auth.getSession()
  const { error } = await client().from('solicitudes_reembolso')
    .update({ ...cambios, resuelto_por: sesion.session?.user.id ?? null, resuelto_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

// APROBAR: cancela el pedido (motivo "El cliente canceló"), registra el reembolso (sale de la
// caja y de la cuenta elegida) y le manda al cliente el correo de "reembolso aprobado".
export async function aprobarReembolso(s: SolicitudReembolso, opts: { monto: number; destino: DestinoPago; respuesta: string }) {
  const pedido = s.pedidos
  if (!pedido) throw new Error('No se encontró el pedido.')
  const monto = Math.round(Math.max(0, Number(opts.monto || 0)) * 100) / 100
  if (monto > 0 && !opts.destino.cuentaId) throw new Error('Elegí de qué cuenta sale el reembolso.')
  if (pedido.estado !== 'cancelado') await cancelarPedido(pedido.id, 'cliente_cancelo')
  if (monto > 0) {
    await registrarReembolso({
      pedido_id: pedido.id, cliente_id: pedido.cliente_id, codigo: s.codigo, fecha: new Date().toISOString().slice(0, 10), monto,
      metodo_pago: 'Transferencia', observaciones: `Reembolso aprobado · ${s.codigo} · a ${s.banco} ${s.numero_cuenta} (${s.titular})`,
    }, opts.destino)
  }
  await marcar(s.id, { estado: 'aprobada', monto_reembolso: monto, respuesta: opts.respuesta.trim() || null })
  return avisarCliente(s.id, 'aprobada')
}

// Correo al cliente con la resolución (aprobada / rechazada). Devuelve si salió.
async function avisarCliente(id: string, tipo: 'aprobada' | 'rechazada') {
  const { data: sesion } = await client().auth.getSession()
  const token = sesion.session?.access_token
  if (!token) return false
  const res = await fetch('/api/notificar-estado', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ reembolso: tipo, id }),
  }).catch(() => null)
  const json = res ? await res.json().catch(() => ({})) : {}
  return !!(res && res.ok && json.ok)
}

// RECHAZAR: el motivo no es real / no se puede verificar. El cliente lo ve en Mi cuenta y le
// llega un correo para elegir: seguir con el pedido o cancelarlo sin reembolso.
export async function rechazarReembolso(s: SolicitudReembolso, respuesta: string) {
  if (respuesta.trim().length < 10) throw new Error('Explicale al cliente por qué no se aprueba (mínimo 10 caracteres).')
  await marcar(s.id, { estado: 'rechazada', respuesta: respuesta.trim() })
  return avisarCliente(s.id, 'rechazada')
}

// El cliente eligió cancelar SIN reembolso tras el rechazo: el admin cancela el pedido.
export async function cancelarSinReembolso(s: SolicitudReembolso) {
  const pedido = s.pedidos
  if (!pedido) throw new Error('No se encontró el pedido.')
  if (pedido.estado !== 'cancelado') await cancelarPedido(pedido.id, 'cliente_cancelo')
  try { await enviarCorreoCancelacion(s.codigo, { motivo: 'cliente_cancelo', monto: 0 }) } catch { /* sin correo */ }
}
