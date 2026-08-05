import type { EstadoTrayecto } from '../types/domain'

export const ESTADOS_TRAYECTO: { value: EstadoTrayecto; label: string }[] = [
  { value: 'pendiente', label: 'Pendiente' }, { value: 'etiqueta_creada', label: 'Etiqueta creada' },
  { value: 'en_transito', label: 'En tránsito' }, { value: 'aduana', label: 'En aduana' },
  { value: 'entrega_fallida', label: 'Entrega fallida' }, { value: 'entregado', label: 'Entregado' },
  { value: 'cancelado', label: 'Cancelado' }, { value: 'incidencia', label: 'Con incidencia' },
]
export const estadoTrayectoLabel = (value: EstadoTrayecto) => ESTADOS_TRAYECTO.find((item) => item.value === value)?.label ?? value
export const estadoTrayectoTone = (value: EstadoTrayecto) => value === 'entregado' ? 'success' : ['entrega_fallida','incidencia','cancelado'].includes(value) ? 'danger' : value === 'pendiente' ? 'neutral' : 'info'

export const TIPOS_TRAYECTO = ['China → Estados Unidos', 'Estados Unidos → Nicaragua', 'Entrega nacional']
