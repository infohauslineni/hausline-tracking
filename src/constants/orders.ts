import type { EstadoPedido } from '../types/domain'
import { cuentasTexto } from './pagos'

// Las 6 etapas que se seleccionan manualmente (mismas que ve el cliente). Antes había
// 10 con sub-etapas de bodega; ahora todo se agrupa en estas 6 para que el panel, el
// selector y el seguimiento público muestren exactamente lo mismo.
export const ESTADOS_PEDIDO: { value: EstadoPedido; label: string }[] = [
  { value: 'pedido_confirmado', label: 'Orden confirmada' },
  { value: 'en_preparacion', label: 'En preparación' },
  { value: 'transito_internacional', label: 'En tránsito' },
  { value: 'llego_nicaragua', label: 'País de destino' },
  { value: 'disponible_entrega', label: 'Disponible para entrega' },
  { value: 'entregado', label: 'Entregado' },
]

// Colapsa CUALQUIER estado (incluidas las etapas viejas de bodega que aún puedan tener
// pedidos en curso, o las que setea 17TRACK / la foto de Miami) a una de las 6 etapas
// canónicas. Así nada se rompe aunque un pedido siga guardado como 'despachado' o
// 'recibido_estados_unidos': se muestra como "En tránsito".
export const etapaBase = (estado: EstadoPedido): EstadoPedido => (({
  pedido_confirmado: 'pedido_confirmado',
  en_preparacion: 'en_preparacion',
  control_calidad: 'en_preparacion',
  etiqueta_creada: 'transito_internacional',
  despachado: 'transito_internacional',
  transito_internacional: 'transito_internacional',
  recibido_estados_unidos: 'transito_internacional',
  transito_nicaragua: 'transito_internacional',
  llego_nicaragua: 'llego_nicaragua',
  disponible_entrega: 'disponible_entrega',
  entregado: 'entregado',
  cancelado: 'cancelado',
  incidencia: 'incidencia',
} as Record<EstadoPedido, EstadoPedido>)[estado] ?? estado)

// Etiqueta de cada estado (colapsado a una de las 6 etapas). Igual en panel y cliente.
export const estadoLabel = (estado: EstadoPedido) => {
  if (estado === 'cancelado') return 'Cancelado'
  if (estado === 'incidencia') return 'Requiere atención'
  const base = etapaBase(estado)
  return ESTADOS_PEDIDO.find((item) => item.value === base)?.label ?? estado
}

// El cliente ve la misma etiqueta que el panel (ya todo colapsado a 6 etapas).
export const estadoLabelPublico = (estado: EstadoPedido) => estadoLabel(estado)

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

// Cada etapa tiene su propio color para reconocerla de un vistazo en toda la app.
export const estadoTone = (estado: EstadoPedido) => {
  switch (etapaBase(estado)) {
    case 'pedido_confirmado': return 'confirmada'
    case 'en_preparacion': return 'preparacion'
    case 'transito_internacional': return 'transito'
    case 'llego_nicaragua': return 'destino'
    case 'disponible_entrega': return 'disponible'
    case 'entregado': return 'entregado'
    case 'incidencia': return 'incidencia'
    case 'cancelado': return 'cancelado'
    default: return 'neutral'
  }
}

// Color hex por tono (para puntos/acentos que no usan las clases .status-*).
export const TONE_COLOR: Record<string, string> = {
  confirmada: '#94a3b8', preparacion: '#fbbf24', calidad: '#c4b5fd', despachado: '#fb923c',
  transito: '#7dd3fc', destino: '#5eead4', disponible: '#b7ff00', entregado: '#34d399',
  incidencia: '#ffb08a', cancelado: '#f87171', neutral: '#8c948f', success: '#62eaa0', info: '#76b4ff', danger: '#ff9696',
}
export const estadoColor = (estado: EstadoPedido) => TONE_COLOR[estadoTone(estado)] ?? '#8c948f'
