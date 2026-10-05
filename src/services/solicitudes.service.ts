import { supabase } from '../lib/supabase'
import { invalidateComercial } from '../utils/queryCache'

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
  pago_reportado_at?: string | null
  estado: EstadoSolicitud
  notas: string | null
  vence_at: string
  pedido_id: string | null
  grupo_codigo?: string | null
  created_at: string
  updated_at: string
  imagen?: string | null
  cupon_codigo?: string | null
  descuento?: number | null
}

function requireSupabase() { if (!supabase) throw new Error('Supabase no está configurado.'); return supabase }

export async function listarSolicitudes() {
  // Antes de listar, vence los encargos de +24 h sin confirmar (pendiente → vencida)
  // para que salgan solos de la bandeja "por confirmar" apenas se abre la página, sin
  // esperar al cron diario. Si falla, seguimos igual (no es crítico).
  try { await requireSupabase().rpc('vencer_solicitudes') } catch { /* no crítico */ }
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
// `cuentaId`/`montoCuenta`: cuenta donde entró el abono y cuánto tocó a esa tarjeta (en su
// moneda). Van al RPC para que el abono sume a la cuenta elegida (antes entraba sin cuenta).
export async function confirmarSolicitud(id: string, abono?: number, cuentaId?: string | null, montoCuenta?: number | null) {
  const { data, error } = await requireSupabase().rpc('confirmar_solicitud', {
    p_id: id,
    p_abono: abono ?? null,
    p_cuenta_id: cuentaId ?? null,
    p_monto_cuenta: montoCuenta ?? null,
  })
  if (error) throw error
  // El RPC creó el pedido HS real (+ abono en caja): limpiamos la caché comercial para que
  // el pedido aparezca al instante en Pedidos/Pagos/Mi cuenta/Resumen sin recargar la web.
  invalidateComercial()
  return String(data)
}

// Confirma VARIOS encargos del mismo cliente como UN solo pedido HS (todas las líneas, el
// total sumado y un solo abono). Devuelve el código del pedido creado. Ver el RPC
// confirmar_solicitudes_grupo (migración 202609070001).
export async function confirmarSolicitudesGrupo(ids: string[], abono?: number, cuentaId?: string | null, montoCuenta?: number | null, descuento?: number) {
  const { data, error } = await requireSupabase().rpc('confirmar_solicitudes_grupo', {
    p_ids: ids,
    p_abono: abono ?? null,
    p_cuenta_id: cuentaId ?? null,
    p_monto_cuenta: montoCuenta ?? null,
    p_descuento: descuento ?? null,
  })
  if (error) throw error
  invalidateComercial()
  return String(data)
}

// Comprobante que el cliente subió desde el checkout: se guarda como RUTA dentro del
// bucket privado `comprobantes` (el sitio solo puede escribir, no leer). El admin lo abre
// con una URL firmada de corta duración. Si por compatibilidad `ruta` ya es una URL, se
// devuelve tal cual.
export async function urlComprobanteSolicitud(ruta: string | null | undefined): Promise<string | null> {
  if (!ruta) return null
  if (/^https?:\/\//i.test(ruta)) return ruta
  const client = supabase
  if (!client) return null
  const { data } = await client.storage.from('comprobantes').createSignedUrl(ruta, 3600)
  return data?.signedUrl ?? null
}

export async function descartarSolicitud(id: string) {
  const { error } = await requireSupabase().from('solicitudes').update({ estado: 'descartada' }).eq('id', id)
  if (error) throw error
}

// Descarta VARIOS encargos de una vez (todo el grupo de un cliente) en una sola llamada.
export async function descartarSolicitudes(ids: string[]) {
  if (!ids.length) return
  const { error } = await requireSupabase().from('solicitudes').update({ estado: 'descartada' }).in('id', ids)
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

// "Compra directa": el equipo le arma el encargo al cliente desde el panel y le manda el link
// de pago de la tienda por WhatsApp (migración 202610030002). Devuelve el código SOL-####.
export type EncargoPanelInput = {
  nombre: string; whatsapp: string; correo?: string | null; ciudad?: string | null; direccion?: string | null
  producto: string; productoCodigo?: string | null; marca?: string | null; talla?: string | null; color?: string | null
  cantidad: number; precioUnitario: number; envio: 'estandar' | 'rapido'; recargo: number; pago: '50' | 'total'
  imagen?: string | null; clienteId?: string | null
}
export async function crearEncargoPanel(i: EncargoPanelInput): Promise<string> {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const { data, error } = await supabase.rpc('crear_encargo_panel', {
    p_nombre: i.nombre, p_whatsapp: i.whatsapp, p_correo: i.correo ?? null, p_ciudad: i.ciudad ?? null, p_direccion: i.direccion ?? null,
    p_producto: i.producto, p_producto_codigo: i.productoCodigo ?? null, p_marca: i.marca ?? null, p_talla: i.talla ?? null, p_color: i.color ?? null,
    p_cantidad: i.cantidad, p_precio_unitario: i.precioUnitario, p_envio: i.envio, p_recargo: i.recargo, p_pago: i.pago,
    p_imagen: i.imagen ?? null, p_cliente_id: i.clienteId ?? null,
  })
  if (error) throw error
  return String(data)
}

// Link de la tienda donde el cliente ve las cuentas y sube el comprobante.
export const linkPagoEncargo = (codigo: string) => `https://hauslineshopni.es/checkout/?c=${encodeURIComponent(codigo)}&paso=pago`

// ── "En camino · Apártelo ya" ──────────────────────────────────────────────────────────────
// Un encargo web de un producto que ya viene en camino (Compras libres en tránsito, mismo
// código y talla) se convierte solo: la compra queda vendida y ligada al pedido, el pedido
// arranca en "En tránsito internacional" con el costo real de la compra y le pasan las fotos
// de control de calidad. Así no hay que volver a comprarlo ni pagarle al proveedor.
type CompraEnCamino = { id: string; codigo: string | null; talla_color: string | null; cantidad: number; costo_unitario: number; gastos_adicionales: number }

// "42", "M BLACK" → "M", "S · Negro" → "S"
export function tallaDeCompra(t: string | null | undefined) {
  const base = String(t ?? '').split('·')[0].trim()
  return (/^(xxs|xs|s|m|l|xl|xxl|xxxl|\d{1,2}(\.5)?)\s+\S/i.test(base) ? base.split(/\s+/)[0] : base).toUpperCase()
}

export async function comprasEnCamino(): Promise<CompraEnCamino[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from('inversiones').select('id, codigo, talla_color, cantidad, costo_unitario, gastos_adicionales').eq('estado', 'en_transito')
  if (error) throw error
  return (data ?? []) as CompraEnCamino[]
}

// Busca para cada encargo su compra en camino (sin repetir compras).
export function emparejarEnCamino(grupo: Solicitud[], compras: CompraEnCamino[]): Map<string, CompraEnCamino> {
  const usadas = new Set<string>(), out = new Map<string, CompraEnCamino>()
  for (const s of grupo) {
    const cod = String(s.producto_codigo ?? '').trim().toUpperCase()
    if (!cod) continue
    const talla = tallaDeCompra(s.talla)
    const c = compras.find((x) => !usadas.has(x.id) && String(x.codigo ?? '').trim().toUpperCase() === cod
      && (!talla || !tallaDeCompra(x.talla_color) || tallaDeCompra(x.talla_color) === talla))
    if (c) { usadas.add(c.id); out.set(s.id, c) }
  }
  return out
}

export async function convertirComprasEnCamino(codigoPedido: string, grupo: Solicitud[]): Promise<number> {
  const client = requireSupabase()
  const pares = emparejarEnCamino(grupo, await comprasEnCamino())
  if (!pares.size) return 0
  const { data: pedido, error } = await client.from('pedidos').select('id, pedido_items(id, codigo_producto, talla)').eq('codigo', codigoPedido).single()
  if (error) throw error
  const items = ((pedido as { pedido_items?: { id: string; codigo_producto: string | null; talla: string | null }[] }).pedido_items ?? [])
  const itemsUsados = new Set<string>()
  const { copiarFotosInversionAPedido } = await import('./archivos.service')
  for (const s of grupo) {
    const compra = pares.get(s.id)
    if (!compra) continue
    const item = items.find((i) => !itemsUsados.has(i.id) && String(i.codigo_producto ?? '').toUpperCase() === String(s.producto_codigo ?? '').toUpperCase())
    if (item) {
      itemsUsados.add(item.id)
      const unidades = Math.max(1, Number(compra.cantidad) || 1)
      const costo = Math.round(((Number(compra.costo_unitario) * unidades + Number(compra.gastos_adicionales || 0)) / unidades) * 100) / 100
      await client.from('pedido_item_costos').upsert({ item_id: item.id, precio_compra: costo }, { onConflict: 'item_id' })
    }
    await client.from('inversiones').update({ estado: 'vendido', pedido_id: pedido.id }).eq('id', compra.id)
    try { await copiarFotosInversionAPedido(compra.id, pedido.id) } catch { /* las fotos se pueden pasar luego desde Compras libres */ }
  }
  // Ya está comprado y viajando: el pedido salta a "En tránsito internacional" (sin pasar por
  // "En preparación", así no se pide registrar el pago al proveedor).
  const { actualizarEstadoPedido } = await import('./pedidos.service')
  await actualizarEstadoPedido(pedido.id, 'transito_internacional')
  invalidateComercial()
  return pares.size
}
