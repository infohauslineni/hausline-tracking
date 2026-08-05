import { supabase } from '../lib/supabase'
import { comprimirImagen } from './archivos.service'

function client() { if (!supabase) throw new Error('Supabase no está configurado.'); return supabase }

export async function subirImagenCatalogo(tipo: 'productos' | 'inversiones', id: string, file: File) {
  const blob = await comprimirImagen(file, 'esquina')
  const path = `${tipo}/${id}/${crypto.randomUUID()}.webp`
  const { error } = await client().storage.from('catalogo').upload(path, blob, { contentType: 'image/webp', upsert: false })
  if (error) throw error
  return client().storage.from('catalogo').getPublicUrl(path).data.publicUrl
}
