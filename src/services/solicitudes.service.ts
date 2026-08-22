import { supabase } from '../lib/supabase'

// Encargos hechos por clientes desde el catálogo público. Viven aparte de los pedidos:
// se confirman (→ crean el pedido HS real) o se descartan; si no, se vencen solas.
export type EstadoSolicitud = 'pendiente' | 'confirmada' | 'descartada' | 'vencida'
export type Solicitud = {
  id: string
  codigo: string
  cliente_nombre: string
  cliente_whatsapp: string
  cliente_correo: string | null
  cliente_ciudad: string | null
  cliente_direccion: string | null
  producto: string
  producto_codigo: string | null
  marca: string | null
  talla: string | null
  color: string | null
  cantidad: number
  precio_unitario: number
  total: number
  tipo_cambio: number | null
  total_nio: number | null
  envio: string
  recargo: number
  pago_tipo: string
  abono: number
  comprobante_url: string | null
  estado: EstadoSolicitud
  notas: string | null
  vence_at: string
  pedido_id: string | null
  created_at: string
  updated_at: string
  imagen?: string | null
}

function requireSupabase() { if (!supabase) throw new Error('Supabase no está configurado.'); return supabase }

export async function listarSolicitudes() {
  const { data, error } = await requireSupabase().from('solicitudes').select('*').order('created_at', { ascending: false })
  if (error) throw error
  const solicitudes = data as unknown as Solicitud[]
  await adjuntarFotos(solicitudes)
  return solicitudes
}

// Resuelve la foto de cada encargo desde el catálogo (tabla productos), por código.
async function adjuntarFotos(items: Solicitud[]) {
  if (!supabase || !items.length) return
  const norm = (v: unknown) => String(v ?? '').trim().toUpperCase()
  const codigos = [...new Set(items.map((s) => norm(s.producto_codigo)).filter(Boolean))]
  if (!codigos.length) return
  const { data } = await supabase.from('productos').select('codigo, imagen').in('codigo', codigos)
  if (!data) return
  const porCodigo = new Map<string, string>()
  for (const p of data as { codigo: string; imagen: string | null }[]) if (p.imagen) porCodigo.set(norm(p.codigo), p.imagen)
  for (const s of items) { const foto = porCodigo.get(norm(s.producto_codigo)); if (foto) s.imagen = foto }
}

// Confirma la solicitud: crea el pedido HS real (cliente + ítem) y devuelve su código.
// `abono` = monto REAL pagado por el cliente (opcional; si no se pasa, usa el de la solicitud).
export async function confirmarSolicitud(id: string, abono?: number) {
  const { data, error } = await requireSupabase().rpc('confirmar_solicitud', { p_id: id, p_abono: abono ?? null })
  if (error) throw error
  return String(data)
}

export async function descartarSolicitud(id: string) {
  const { error } = await requireSupabase().from('solicitudes').update({ estado: 'descartada' }).eq('id', id)
  if (error) throw error
}

export async function eliminarSolicitud(id: string) {
  const { error } = await requireSupabase().from('solicitudes').delete().eq('id', id)
  if (error) throw error
}

// Realtime: refresca la bandeja cuando entra un encargo nuevo desde la web.
export function suscribirSolicitudes(onChange: () => void) {
  const client = supabase
  if (!client) return () => undefined
  const channel = client.channel('solicitudes-panel').on('postgres_changes', { event: '*', schema: 'public', table: 'solicitudes' }, onChange).subscribe()
  return () => { void client.removeChannel(channel) }
}
