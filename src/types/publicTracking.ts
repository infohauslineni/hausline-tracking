import type { EstadoPedido, EstadoTrayecto } from './domain'

export type PublicProduct = { producto: string; codigo: string | null; marca: string | null; categoria: string | null; talla: string | null; color: string | null; cantidad: number; imagen: string | null }
export type PublicHistory = { estado: string; nota: string | null; ubicacion: string | null; fecha: string }
export type PublicEvent = { descripcion: string; ubicacion: string | null; fecha: string }
export type PublicJourney = { tipo: string; origen: string | null; destino: string | null; transportista: string | null; tracking: string | null; url_tracking: string | null; estado: EstadoTrayecto; ultima_ubicacion: string | null; ultimo_evento: string | null; fecha_estimada: string | null; eventos: PublicEvent[] }
export type PublicImage = { tipo: 'producto' | 'control_calidad' | 'comprobante' | 'entrega' | 'recepcion_miami' | 'recibido_local'; nombre: string; storage_path: string; orden: number; url?: string }
export type PublicOrder = { codigo: string; estado: string; estado_codigo: EstadoPedido; fecha_pedido: string; fecha_estimada: string | null; fecha_entrega: string | null; ultima_actualizacion: string; imagen_principal: string | null; notas_publicas: string | null; productos: PublicProduct[]; historial: PublicHistory[]; trayectos: PublicJourney[]; imagenes: PublicImage[] }
