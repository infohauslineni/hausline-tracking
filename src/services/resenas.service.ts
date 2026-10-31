import { supabase } from '../lib/supabase'

// Reseñas de clientes. La tabla vive en el mismo proyecto (pedidos) y está cerrada por
// RLS: el usuario autenticado (admin) puede leerlas y administrarlas todas; el público
// solo lee las aprobadas (vía RPC desde la tienda). Aquí van las operaciones del panel.
export type Resena = {
  id: string
  pedido_codigo: string | null
  producto_codigo: string | null
  cliente_nombre: string
  estrellas: number
  comentario: string | null
  foto_url: string | null
  aprobada: boolean
  destacada: boolean
  created_at: string
}

export async function listarResenas(): Promise<Resena[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('resenas')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as Resena[]
}

export async function aprobarResena(id: string, aprobada: boolean): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('resenas').update({ aprobada }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function destacarResena(id: string, destacada: boolean): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('resenas').update({ destacada }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function eliminarResena(id: string): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('resenas').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// Alta manual desde el panel (para cargar reseñas reales que llegaron por otro medio,
// p. ej. WhatsApp). Entra ya aprobada porque la crea el admin.
export type NuevaResenaInput = {
  cliente_nombre: string
  estrellas: number
  comentario?: string | null
  producto_codigo?: string | null
  foto_url?: string | null
}
export async function crearResena(input: NuevaResenaInput): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('resenas').insert({
    cliente_nombre: input.cliente_nombre.trim(),
    estrellas: input.estrellas,
    comentario: input.comentario?.trim() || null,
    producto_codigo: input.producto_codigo?.trim().toUpperCase() || null,
    foto_url: input.foto_url?.trim() || null,
    aprobada: true,
  })
  if (error) throw new Error(error.message)
}

// "Pedir reseñas ahora": manda el correo de reseña a los entregados hace 1–14 días sin reseña
// (los que ya lo recibieron no se repiten). Devuelve a quiénes se les mandó y por qué no a otros.
export type ResultadoPedirResenas = { enviados: { codigo: string; nombre: string }[]; yaTenian: { codigo: string; nombre: string }[]; sinCorreo: { codigo: string; nombre: string }[]; yaPedidas: { codigo: string; nombre: string }[] }
export async function pedirResenasAhora(): Promise<ResultadoPedirResenas> {
  if (!supabase) throw new Error('Sin conexión.')
  const { data: ses } = await supabase.auth.getSession()
  const token = ses.session?.access_token
  if (!token) throw new Error('Sesión no disponible.')
  const res = await fetch('/api/notificar-estado', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify({ pedirResenas: true }) })
  const j = await res.json().catch(() => ({})) as Partial<ResultadoPedirResenas> & { ok?: boolean; error?: string }
  if (!res.ok || !j.ok) throw new Error(j.error || 'No se pudieron pedir las reseñas (HTTP ' + res.status + ').')
  return { enviados: j.enviados ?? [], yaTenian: j.yaTenian ?? [], sinCorreo: j.sinCorreo ?? [], yaPedidas: j.yaPedidas ?? [] }
}
