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
