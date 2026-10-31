import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'

// RESEÑA DESDE LA TIENDA (hauslineshopni.es/resena/?c=HS…), con FOTO opcional del cliente.
// Va por el servidor (no directo a Supabase) para revisar que el pedido exista y que la foto sea una
// imagen de verdad: se vuelve a codificar a JPEG 1200 px (quita datos ocultos como la ubicación) y se
// guarda en el bucket público `resenas`. La reseña queda pendiente hasta que se aprueba en el panel.
const BUCKET = 'resenas'
const MAX_FOTO = 6 * 1024 * 1024
const esEnvio = (it) => /^(env[íi]o|delivery|cup[óo]n)/i.test(String(it?.producto ?? '').trim())

// "María José López" → "María L." (como se muestra en la tienda, sin el apellido completo).
function nombrePublico(nombre) {
  const p = String(nombre ?? '').trim().split(/\s+/).filter(Boolean)
  if (!p.length) return 'Cliente verificado'
  const pila = p[0].charAt(0).toUpperCase() + p[0].slice(1).toLowerCase()
  return p.length > 1 ? `${pila} ${p[p.length - 1].charAt(0).toUpperCase()}.` : pila
}

export async function resenaPublica(response, body) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return response.status(500).json({ ok: false, error: 'config' })
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const codigo = String(body.codigo ?? '').trim().toUpperCase()
  const estrellas = Math.round(Number(body.estrellas))
  const comentario = String(body.comentario ?? '').trim().slice(0, 500) || null
  if (!/^[A-Z]{1,4}-?\d{3,10}$/.test(codigo)) return response.status(200).json({ ok: false, error: 'codigo' })
  if (!(estrellas >= 1 && estrellas <= 5)) return response.status(200).json({ ok: false, error: 'estrellas' })

  const { data: pedido } = await db.from('pedidos').select('id, codigo, clientes(nombre), pedido_items(codigo_producto, producto)').eq('codigo', codigo).maybeSingle()
  if (!pedido) return response.status(200).json({ ok: false, error: 'pedido' })
  // Anti-abuso: máximo 5 reseñas por pedido.
  const { count } = await db.from('resenas').select('id', { count: 'exact', head: true }).eq('pedido_codigo', codigo)
  if ((count ?? 0) >= 5) return response.status(200).json({ ok: false, error: 'demasiadas' })

  const items = (Array.isArray(pedido.pedido_items) ? pedido.pedido_items : []).filter((it) => !esEnvio(it) && it.codigo_producto)
  const pedido_producto = String(body.producto ?? '').trim().toUpperCase()
  const producto = (pedido_producto && items.some((it) => String(it.codigo_producto).toUpperCase() === pedido_producto) ? pedido_producto : String(items[0]?.codigo_producto ?? '').toUpperCase()) || null
  const cli = Array.isArray(pedido.clientes) ? pedido.clientes[0] : pedido.clientes

  // Foto opcional (data URL o base64).
  let foto_url = null
  const crudo = String(body.foto ?? '')
  if (crudo) {
    const b64 = crudo.includes(',') ? crudo.slice(crudo.indexOf(',') + 1) : crudo
    const buf = Buffer.from(b64, 'base64')
    if (!buf.length || buf.length > MAX_FOTO) return response.status(200).json({ ok: false, error: 'foto_grande' })
    let jpg
    try { jpg = await sharp(buf).rotate().resize(1200, 1200, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer() }
    catch { return response.status(200).json({ ok: false, error: 'foto_invalida' }) }
    // El bucket se crea solo la primera vez.
    const { data: bucket } = await db.storage.getBucket(BUCKET)
    if (!bucket) await db.storage.createBucket(BUCKET, { public: true, fileSizeLimit: 3 * 1024 * 1024, allowedMimeTypes: ['image/jpeg'] }).catch(() => undefined)
    const ruta = `${codigo}/${Date.now()}.jpg`
    const { error: eFoto } = await db.storage.from(BUCKET).upload(ruta, jpg, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false })
    if (eFoto) { console.error('resena: no se pudo subir la foto', eFoto.message); return response.status(200).json({ ok: false, error: 'foto_subida' }) }
    foto_url = db.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl
  }

  const { error } = await db.from('resenas').insert({ pedido_codigo: codigo, producto_codigo: producto, cliente_nombre: nombrePublico(cli?.nombre), estrellas, comentario, foto_url })
  if (error) { console.error('resena: no se pudo guardar', error.message); return response.status(200).json({ ok: false, error: 'guardar' }) }
  return response.status(200).json({ ok: true, foto: Boolean(foto_url) })
}
