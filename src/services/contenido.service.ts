import { supabase } from '../lib/supabase'
import type { IdeaContenido } from '../types/domain'
import { cachedQuery, invalidateCache } from '../utils/queryCache'

const CONFIG_KEY = 'contenido_privado'

export type IdeaContenidoInput = Pick<IdeaContenido, 'titulo' | 'pedido_id' | 'formato' | 'descripcion' | 'estado' | 'notas'>

function requireSupabase() {
  if (!supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

async function readIdeas() {
  const { data, error } = await requireSupabase()
    .from('configuracion')
    .select('valor_json')
    .eq('clave', CONFIG_KEY)
    .maybeSingle()
  if (error) throw error
  const value = data?.valor_json as { items?: IdeaContenido[] } | null
  return Array.isArray(value?.items) ? value.items : []
}

async function writeIdeas(items: IdeaContenido[]) {
  const { error } = await requireSupabase()
    .from('configuracion')
    .upsert({ clave: CONFIG_KEY, valor_json: { items } }, { onConflict: 'clave' })
  if (error) throw error
  invalidateCache('contenido_privado')
}

export async function listarIdeasContenido() {
  return cachedQuery('contenido_privado', async () => {
    const items = await readIdeas()
    return [...items].sort((a, b) => {
      if (a.estado !== b.estado) return a.estado === 'pendiente_grabacion' ? -1 : 1
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    })
  })
}

export async function guardarIdeaContenido(input: IdeaContenidoInput, id?: string) {
  const items = await readIdeas()
  const now = new Date().toISOString()
  const previous = id ? items.find((item) => item.id === id) : undefined
  const saved: IdeaContenido = {
    id: previous?.id ?? crypto.randomUUID(),
    titulo: input.titulo.trim(),
    pedido_id: input.pedido_id || null,
    formato: input.formato,
    descripcion: input.descripcion.trim(),
    estado: input.estado,
    fecha_grabacion: input.estado === 'grabado' ? previous?.fecha_grabacion ?? now : null,
    notas: input.notas?.trim() || null,
    created_at: previous?.created_at ?? now,
    updated_at: now,
  }
  await writeIdeas(previous ? items.map((item) => item.id === id ? saved : item) : [saved, ...items])
  return saved
}

export async function cambiarEstadoIdea(id: string, estado: IdeaContenido['estado']) {
  const items = await readIdeas()
  const current = items.find((item) => item.id === id)
  if (!current) throw new Error('No se encontró la idea de contenido.')
  return guardarIdeaContenido({
    titulo: current.titulo,
    pedido_id: current.pedido_id,
    formato: current.formato,
    descripcion: current.descripcion,
    estado,
    notas: current.notas,
  }, id)
}

export async function eliminarIdeaContenido(id: string) {
  const items = await readIdeas()
  await writeIdeas(items.filter((item) => item.id !== id))
}
