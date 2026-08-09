import type { EstadoPedido } from '../types/domain'
import { cuentasTexto } from './pagos'

// Estas son las únicas etapas que se pueden seleccionar manualmente.
export const ESTADOS_PEDIDO: { value: EstadoPedido; label: string }[] = [
  { value: 'pedido_confirmado', label: 'Orden confirmada' },
  { value: 'en_preparacion', label: 'En preparación' },
  { value: 'control_calidad', label: 'Control de calidad' },
  { value: 'despachado', label: 'Despachado' },
  { value: 'transito_internacional', label: 'En tránsito internacional' },
  { value: 'llego_nicaragua', label: 'País de destino' },
  { value: 'disponible_entrega', label: 'Disponible para entrega' },
  { value: 'entregado', label: 'Entregado' },
]

// Agrupa estados logísticos anteriores sin romper pedidos ya guardados.
export const estadoLabel = (estado: EstadoPedido) => {
  if (estado === 'etiqueta_creada') return 'Despachado'
  if (estado === 'recibido_estados_unidos' || estado === 'transito_nicaragua') return 'En tránsito internacional'
  if (estado === 'cancelado') return 'Cancelado'
  if (estado === 'incidencia') return 'Requiere atención'
  return ESTADOS_PEDIDO.find((item) => item.value === estado)?.label ?? estado
}

export const notaPublicaEstado = (estado: EstadoPedido) => ({
  pedido_confirmado: 'Recibimos y confirmamos tu orden.',
  en_preparacion: 'Estamos preparando tu pedido.',
  control_calidad: 'Tu pedido está pasando por control de calidad.',
  etiqueta_creada: 'Tu pedido fue despachado y va en camino.',
  despachado: 'Tu pedido fue despachado y va en camino.',
  transito_internacional: 'Tu pedido está en tránsito internacional.',
  recibido_estados_unidos: 'Tu pedido está en tránsito internacional.',
  transito_nicaragua: 'Tu pedido está en tránsito internacional.',
  llego_nicaragua: 'Tu pedido llegó al país de destino.',
  disponible_entrega: 'Tu pedido está disponible para entrega.',
  entregado: 'Tu pedido fue entregado.',
  cancelado: 'El pedido fue cancelado.',
  incidencia: 'Estamos gestionando una incidencia con tu pedido.',
}[estado])

export function mensajeWhatsAppEstado(estado: EstadoPedido, data: { nombre?: string | null; codigo: string; url: string; saldo: number; fotosCalidad?: boolean; tipoCambio?: number }) {
  const saludo = `Hola${data.nombre ? `, ${data.nombre}` : ''}.`
  const seguimiento = `Consulta tu seguimiento aquí: ${data.url}`
  const saldoUsd = Math.max(0, data.saldo)
  const tc = data.tipoCambio && data.tipoCambio > 0 ? data.tipoCambio : 37
  // Redondeamos el equivalente en córdobas a la decena más cercana para que nunca
  // quede un número raro (ej. 2928 → 2930).
  const cordobas = Math.round((saldoUsd * tc) / 10) * 10
  const saldoLinea = `US$ ${saldoUsd.toFixed(2)} (≈ C$ ${cordobas})`
  const mensajes: Record<EstadoPedido, string> = {
    pedido_confirmado: `${saludo} Confirmamos tu orden ${data.codigo}. Ya quedó registrada y te avisaremos cada avance. ${seguimiento}`,
    en_preparacion: `${saludo} Tu pedido ${data.codigo} está en preparación. Estamos coordinando el producto antes de enviarlo. ${seguimiento}`,
    control_calidad: `${saludo} Tu pedido ${data.codigo} está en control de calidad.${data.fotosCalidad ? ' Ya puedes ver las fotos de revisión.' : ' Te avisaremos cuando estén listas.'} ${seguimiento}`,
    etiqueta_creada: `${saludo} Tu pedido ${data.codigo} ya fue despachado y va en camino. ${seguimiento}`,
    despachado: `${saludo} Tu pedido ${data.codigo} ya fue despachado y va en camino. ${seguimiento}`,
    transito_internacional: `${saludo} Tu pedido ${data.codigo} está en tránsito internacional. ${seguimiento}`,
    recibido_estados_unidos: `${saludo} Tu pedido ${data.codigo} está en tránsito internacional. ${seguimiento}`,
    transito_nicaragua: `${saludo} Tu pedido ${data.codigo} está en tránsito internacional. ${seguimiento}`,
    llego_nicaragua: `${saludo} Tu pedido ${data.codigo} ya llegó al país de destino y está siendo procesado. ${seguimiento}`,
    disponible_entrega: `${saludo} Tu pedido ${data.codigo} ya está *disponible para entrega*.\n\n*Saldo pendiente: ${saldoLinea}*\n\n*Tienes 2 días* para confirmar o cancelar tu pedido sin costo. Después de esos 2 días se cobra *US$ 5 por cada día* que el pedido permanezca en bodega.\n\nOpciones de envío:\n• Bus / departamento: C$160.\n• Cargotrans: C$100 + la tarifa según el peso y tu departamento.\n• Managua: delivery a domicilio con costo adicional.\nDecinos a dónde querés el envío y compartinos tu dirección para calcularlo.\n\nCuentas para el pago:\n\n${cuentasTexto()}\n\nCuando deposités, mandanos el comprobante por aquí.`,
    entregado: `${saludo} Tu pedido ${data.codigo} fue entregado. Gracias por comprar en Hausline.`,
    cancelado: `${saludo} El pedido ${data.codigo} fue cancelado. Escríbenos si necesitas ayuda.`,
    incidencia: `${saludo} Estamos revisando una novedad con tu pedido ${data.codigo}. Te avisaremos pronto. ${seguimiento}`,
  }
  return mensajes[estado]
}

export const estadoTone = (estado: EstadoPedido) => {
  if (estado === 'entregado' || estado === 'disponible_entrega') return 'success'
  if (estado === 'incidencia' || estado === 'cancelado') return 'danger'
  if (estado === 'pedido_confirmado' || estado === 'en_preparacion' || estado === 'control_calidad' || estado === 'etiqueta_creada') return 'neutral'
  return 'info'
}
