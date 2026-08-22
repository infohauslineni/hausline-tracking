import type { Solicitud } from '../services/solicitudes.service'

// Encargos de demostración para la vista previa local (sin Supabase).
const ahora = Date.now()
const enHoras = (h: number) => new Date(ahora + h * 3_600_000).toISOString()
const haceHoras = (h: number) => new Date(ahora - h * 3_600_000).toISOString()

export const DEMO_SOLICITUDES: Solicitud[] = [
  {
    id: 'sol-demo-1', codigo: 'SOL-0014', cliente_nombre: 'María Gómez', cliente_whatsapp: '+505 8890 1122',
    cliente_correo: 'maria@correo.com', cliente_ciudad: 'León', cliente_direccion: null,
    producto: 'Tenis retro', producto_codigo: 'NB-0044', marca: 'New Balance', talla: '38', color: 'Gris',
    cantidad: 1, precio_unitario: 95, total: 95, tipo_cambio: 37, total_nio: 3520, envio: 'estandar', recargo: 0, pago_tipo: '50', abono: 47.5, comprobante_url: null,
    estado: 'pendiente', notas: null, vence_at: enHoras(18), pedido_id: null, created_at: haceHoras(6), updated_at: haceHoras(6),
  },
  {
    id: 'sol-demo-2', codigo: 'SOL-0013', cliente_nombre: 'José Rivas', cliente_whatsapp: '+505 8712 3344',
    cliente_correo: 'jrivas@correo.com', cliente_ciudad: 'Managua', cliente_direccion: null,
    producto: 'Camiseta básica', producto_codigo: 'UQ-0012', marca: 'Uniqlo', talla: 'M', color: 'Negro',
    cantidad: 2, precio_unitario: 22.5, total: 75, tipo_cambio: 37, total_nio: 2780, envio: 'rapido', recargo: 30, pago_tipo: 'total', abono: 75, comprobante_url: null,
    estado: 'pendiente', notas: null, vence_at: enHoras(21), pedido_id: null, created_at: haceHoras(3), updated_at: haceHoras(3),
  },
  {
    id: 'sol-demo-3', codigo: 'SOL-0012', cliente_nombre: 'Ana Torres', cliente_whatsapp: '+505 8990 5566',
    cliente_correo: null, cliente_ciudad: 'Masaya', cliente_direccion: null,
    producto: 'Bolso bandolera', producto_codigo: 'CO-0007', marca: 'Coach', talla: null, color: null,
    cantidad: 1, precio_unitario: 85, total: 85, tipo_cambio: 37, total_nio: 3150, envio: 'estandar', recargo: 0, pago_tipo: 'total', abono: 85, comprobante_url: null,
    estado: 'pendiente', notas: null, vence_at: enHoras(2), pedido_id: null, created_at: haceHoras(22), updated_at: haceHoras(22),
  },
]
