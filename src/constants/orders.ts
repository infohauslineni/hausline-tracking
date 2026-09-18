import type { EstadoItem, EstadoPedido } from '../types/domain'
import { cuentasTexto } from './pagos'
import { esManagua, tieneUbicacion } from './nicaragua'

// Las 7 etapas que se seleccionan manualmente (mismas que ve el cliente). Antes había
// 10 con sub-etapas de bodega; ahora todo se agrupa en estas 7 para que el panel, el
// selector y el seguimiento público muestren exactamente lo mismo. "Control de calidad"
// es un paso propio entre preparación y tránsito (con su aviso al cliente).
export const ESTADOS_PEDIDO: { value: EstadoPedido; label: string }[] = [
  { value: 'pedido_confirmado', label: 'Orden confirmada' },
  { value: 'en_preparacion', label: 'En preparación' },
  { value: 'control_calidad', label: 'Control de calidad' },
  { value: 'transito_internacional', label: 'En tránsito' },
  { value: 'llego_nicaragua', label: 'País de destino' },
  { value: 'disponible_entrega', label: 'Disponible para entrega' },
  { value: 'pagado', label: 'Pagado' },
  { value: 'empaquetado', label: 'Empaquetado, listo para envío' },
  { value: 'entregado', label: 'Entregado' },
]

// Etapas de UN producto dentro del pedido (seguimiento por producto). "recibido" = llegó a
// HAUSLINE y pasó control de calidad; "enviado" = salió al cliente (puede ir en su propio paquete).
export const ESTADOS_ITEM: { value: EstadoItem; label: string; tone: string }[] = [
  { value: 'pendiente', label: 'Por llegar', tone: 'neutral' },
  { value: 'recibido', label: 'Recibido / revisado', tone: 'calidad' },
  { value: 'enviado', label: 'Enviado', tone: 'transito' },
  { value: 'entregado', label: 'Entregado', tone: 'entregado' },
]
export const estadoItemLabel = (estado?: EstadoItem | null) => ESTADOS_ITEM.find((item) => item.value === (estado ?? 'pendiente'))?.label ?? 'Por llegar'

// Colapsa CUALQUIER estado (incluidas las etapas viejas de bodega que aún puedan tener
// pedidos en curso, o las que setea 17TRACK / la foto de Miami) a una de las 6 etapas
// canónicas. Así nada se rompe aunque un pedido siga guardado como 'despachado' o
// 'recibido_estados_unidos': se muestra como "En tránsito".
export const etapaBase = (estado: EstadoPedido): EstadoPedido => (({
  pedido_confirmado: 'pedido_confirmado',
  en_preparacion: 'en_preparacion',
  control_calidad: 'control_calidad',
  etiqueta_creada: 'transito_internacional',
  despachado: 'transito_internacional',
  transito_internacional: 'transito_internacional',
  recibido_estados_unidos: 'transito_internacional',
  transito_nicaragua: 'transito_internacional',
  llego_nicaragua: 'llego_nicaragua',
  disponible_entrega: 'disponible_entrega',
  pagado: 'pagado',
  empaquetado: 'empaquetado',
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
  pagado: 'Confirmamos el pago de tu pedido.',
  empaquetado: 'Tu pedido está empaquetado y listo para envío.',
  entregado: 'Tu pedido fue entregado.',
  cancelado: 'El pedido fue cancelado.',
  incidencia: 'Estamos gestionando una incidencia con tu pedido.',
}[estado])

export function mensajeWhatsAppEstado(estado: EstadoPedido, data: { nombre?: string | null; codigo: string; url: string; saldo: number; fotosCalidad?: boolean; tipoCambio?: number; departamento?: string | null; ciudad?: string | null }) {
  const saludo = `Hola${data.nombre ? `, ${data.nombre}` : ''}.`
  const seguimiento = `Consulta tu seguimiento aquí: ${data.url}`
  const saldoUsd = Math.max(0, data.saldo)
  const tc = data.tipoCambio && data.tipoCambio > 0 ? data.tipoCambio : 37
  // Redondeamos el equivalente en córdobas a la decena más cercana para que nunca
  // quede un número raro (ej. 2928 → 2930).
  const cordobas = Math.round((saldoUsd * tc) / 10) * 10
  const saldoLinea = `US$ ${saldoUsd.toFixed(2)} (≈ C$ ${cordobas})`
  // Si el pedido ya está pagado por completo (saldo 0), NO mandamos números de cuenta:
  // lo único pendiente es el envío, así que solo pedimos que nos digan a dónde lo quieren.
  const pagado = saldoUsd <= 0.01
  // El texto de envío se adapta a la ubicación del cliente: en Managua ofrecemos
  // delivery a domicilio; fuera de Managua, bus o Cargotrans; si no sabemos dónde
  // está, mostramos todas las opciones como antes.
  const envioTexto = esManagua(data.departamento, data.ciudad)
    ? 'Como estás en *Managua*, podemos llevártelo con *delivery a domicilio* (el costo depende de la zona). Compartinos tu dirección y coordinamos la entrega.'
    : tieneUbicacion(data.departamento, data.ciudad)
      ? 'Para tu departamento el envío es por *bus* (C$160) o por *Cargotrans* (C$100 + la tarifa según el peso y tu departamento). Decinos cuál preferís y compartinos tu dirección.'
      : 'Opciones de envío:\n• Bus / departamento: C$160.\n• Cargotrans: C$100 + la tarifa según el peso y tu departamento.\n• Managua: delivery a domicilio con costo adicional.\nDecinos a dónde querés el envío y compartinos tu dirección para calcularlo.'
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
    disponible_entrega: pagado
      ? `${saludo} Tu pedido ${data.codigo} ya está *disponible para entrega*.\n\nTu pedido *ya está pagado por completo* ✅. Lo único que faltaría es el *costo del envío*; decinos a dónde lo querés y coordinamos la entrega.\n\n${envioTexto}`
      : `${saludo} Tu pedido ${data.codigo} ya está *disponible para entrega*.\n\n*Saldo pendiente: ${saldoLinea}*\n\n*Tienes 2 días* para confirmar o cancelar tu pedido sin costo. Después de esos 2 días se cobra *US$ 5 por cada día* que el pedido permanezca en bodega.\n\n${envioTexto}\n\nCuentas para el pago:\n\n${cuentasTexto()}\n\nCuando deposités, mandanos el comprobante por aquí.`,
    pagado: `${saludo} Confirmamos el pago de tu pedido ${data.codigo}. ✅ Ya no se acumula ningún cargo por bodega. Coordinamos la entrega y te avisamos. ${seguimiento}`,
    empaquetado: `${saludo} ¡Buenas noticias! Tu pedido ${data.codigo} ya está *empaquetado y listo para envío*. ${esManagua(data.departamento, data.ciudad) ? 'Sale con nuestro delivery a domicilio.' : 'Ya va en camino a tu departamento.'} Te enviamos una foto de tu paquete para que lo tengas presente. ${seguimiento}`,
    entregado: `${saludo} Tu pedido ${data.codigo} fue entregado. Gracias por comprar en Hausline.`,
    cancelado: `${saludo} El pedido ${data.codigo} fue cancelado. Escríbenos si necesitas ayuda.`,
    incidencia: `${saludo} Estamos revisando una novedad con tu pedido ${data.codigo}. Te avisaremos pronto. ${seguimiento}`,
  }
  return mensajes[estado]
}

// Motivos por los que se cancela un pedido. Los que llevan `devolucion: true` implican
// devolverle el dinero al cliente (reembolso): producto que ya no está disponible con el
// proveedor, producto que dejamos de vender, o el paquete que la agencia no entregó/perdió.
export type MotivoCancelacion = 'no_disponible' | 'sin_venta' | 'no_entregado' | 'cliente_cancelo' | 'otro'
export const MOTIVOS_CANCELACION: { value: MotivoCancelacion; label: string; devolucion: boolean }[] = [
  { value: 'no_disponible', label: 'El producto ya no está disponible — devolución', devolucion: true },
  { value: 'sin_venta', label: 'Ya no lo tenemos a la venta — devolución', devolucion: true },
  { value: 'no_entregado', label: 'Paquete no entregado / pérdida — devolución', devolucion: true },
  { value: 'cliente_cancelo', label: 'El cliente canceló', devolucion: false },
  { value: 'otro', label: 'Otro motivo', devolucion: false },
]
export const motivoCancelacionLabel = (motivo?: string | null) =>
  MOTIVOS_CANCELACION.find((item) => item.value === motivo)?.label ?? (motivo || null)

// Frase (dirigida al cliente) que explica por qué se canceló, según el motivo. Se usa tanto
// en el WhatsApp como en el correo de cancelación para que el mensaje diga el motivo real.
export const MOTIVO_CANCELACION_RAZON: Record<MotivoCancelacion, string> = {
  no_disponible: 'el producto que elegiste ya no está disponible con el proveedor',
  sin_venta: 'el producto que elegiste ya no lo tenemos a la venta',
  no_entregado: 'tu paquete no pudo entregarse',
  cliente_cancelo: 'nos pediste cancelarlo',
  otro: 'no pudimos completarlo',
}

// Política de devolución que se le comunica al cliente: 1 a 3 días hábiles y a la misma
// cuenta desde la que pagó. Igual texto en el panel, el WhatsApp y el correo.
export const POLITICA_DEVOLUCION = 'El reembolso se procesa en un plazo de 1 a 3 días hábiles y se devuelve a la misma cuenta desde la que realizaste el pago.'

// Mensaje para avisar al cliente que su paquete (que se daba por no entregado) apareció,
// y preguntarle si todavía le interesa.
export function mensajeWhatsAppReaparicion(data: { nombre?: string | null; codigo: string }) {
  return `Hola${data.nombre ? `, ${data.nombre}` : ''}. ¡Buenas noticias! Tu paquete del pedido ${data.codigo} apareció y ya lo tenemos. ¿Todavía te interesa recibirlo? Si nos confirmás, coordinamos la entrega; si preferís, no hay problema y queda cerrado.`
}

// Mensaje para avisarle al cliente que su orden se canceló. Explica el motivo y, si hubo
// pago que se devuelve (monto > 0), agrega la devolución y la política de 1 a 3 días.
export function mensajeWhatsAppCancelacion(data: { nombre?: string | null; codigo: string; motivo: MotivoCancelacion; monto?: number }) {
  const razon = MOTIVO_CANCELACION_RAZON[data.motivo] ?? MOTIVO_CANCELACION_RAZON.otro
  const monto = Math.max(0, Number(data.monto || 0))
  const partes = [`Hola${data.nombre ? `, ${data.nombre}` : ''}. Lamentamos informarte que tu pedido ${data.codigo} fue cancelado porque ${razon}.`]
  if (monto > 0) partes.push(`Ya iniciamos la *devolución de US$ ${monto.toFixed(2)}* que habías pagado. ${POLITICA_DEVOLUCION}`)
  partes.push('Cualquier duda quedamos a la orden y gracias por tu comprensión.')
  return partes.join('\n\n')
}

// Cada etapa tiene su propio color para reconocerla de un vistazo en toda la app.
export const estadoTone = (estado: EstadoPedido) => {
  switch (etapaBase(estado)) {
    case 'pedido_confirmado': return 'confirmada'
    case 'en_preparacion': return 'preparacion'
    case 'control_calidad': return 'calidad'
    case 'transito_internacional': return 'transito'
    case 'llego_nicaragua': return 'destino'
    case 'disponible_entrega': return 'disponible'
    case 'pagado': return 'pagado'
    case 'empaquetado': return 'empaquetado'
    case 'entregado': return 'entregado'
    case 'incidencia': return 'incidencia'
    case 'cancelado': return 'cancelado'
    default: return 'neutral'
  }
}

// Color hex por tono (para puntos/acentos que no usan las clases .status-*).
export const TONE_COLOR: Record<string, string> = {
  confirmada: '#94a3b8', preparacion: '#fbbf24', calidad: '#c4b5fd', despachado: '#fb923c',
  transito: '#7dd3fc', destino: '#5eead4', disponible: '#b7ff00', pagado: '#4ade80', empaquetado: '#2dd4bf', entregado: '#34d399',
  incidencia: '#ffb08a', cancelado: '#f87171', neutral: '#8c948f', success: '#62eaa0', info: '#76b4ff', danger: '#ff9696',
}
export const estadoColor = (estado: EstadoPedido) => TONE_COLOR[estadoTone(estado)] ?? '#8c948f'
