// Publica en Instagram (post y/o story) con la API oficial de Meta (Instagram Graph API,
// "Content Publishing"). Lo usa el botón "Publicar en Instagram" de admin.html: la tienda sube
// las imágenes JPG a un enlace público y aquí se le pide a Instagram que las publique.
//
// Configuración (variables de entorno en Vercel):
//   IG_USER_ID       = ID de la cuenta de Instagram Business/Creator (conectada a una página de Facebook)
//   IG_ACCESS_TOKEN  = token de larga duración con permisos instagram_basic + instagram_content_publish
//   IG_GRAPH_VERSION = opcional (por defecto v21.0)
// Sin configuración no hace nada y lo dice (el panel muestra cómo conectarlo).

const graph = () => `https://graph.facebook.com/${process.env.IG_GRAPH_VERSION || 'v21.0'}`
export const instagramConfigurado = () => !!(process.env.IG_USER_ID && process.env.IG_ACCESS_TOKEN)

async function llamar(ruta, params, metodo = 'POST') {
  const qs = new URLSearchParams({ ...params, access_token: process.env.IG_ACCESS_TOKEN })
  const res = await fetch(metodo === 'GET' ? `${graph()}${ruta}?${qs}` : `${graph()}${ruta}`, metodo === 'GET' ? {} : {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: qs,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.error) {
    const e = json.error ?? {}
    // Mensajes claros para los errores típicos.
    if (e.code === 190) throw new Error('El token de Instagram venció o es inválido. Hay que generar uno nuevo (IG_ACCESS_TOKEN en Vercel).')
    if (e.code === 10 || e.code === 200) throw new Error('Al token le faltan permisos: necesita instagram_basic e instagram_content_publish.')
    if (e.code === 9004 || /image/i.test(e.message || '')) throw new Error('Instagram no pudo descargar la imagen. Probá de nuevo en un minuto.')
    throw new Error(`Instagram: ${e.error_user_msg || e.message || `HTTP ${res.status}`}`)
  }
  return json
}

// Crea el contenedor, espera a que Instagram lo procese y lo publica.
async function publicarUno({ image_url, caption, story }) {
  const ig = process.env.IG_USER_ID
  const cont = await llamar(`/${ig}/media`, story ? { image_url, media_type: 'STORIES' } : { image_url, caption: caption || '' })
  for (let i = 0; i < 10; i++) {
    const st = await llamar(`/${cont.id}`, { fields: 'status_code' }, 'GET').catch(() => ({}))
    if (!st.status_code || st.status_code === 'FINISHED') break
    if (st.status_code === 'ERROR' || st.status_code === 'EXPIRED') throw new Error('Instagram no pudo procesar la imagen.')
    await new Promise((r) => setTimeout(r, 1500))
  }
  const pub = await llamar(`/${ig}/media_publish`, { creation_id: cont.id })
  const info = await llamar(`/${pub.id}`, { fields: 'permalink' }, 'GET').catch(() => ({}))
  return { id: pub.id, permalink: info.permalink || null }
}

// Solo imágenes subidas a NUESTRO almacenamiento (evita usar el endpoint para publicar cualquier cosa).
const urlPermitida = (u) => /^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\/catalogo\/ig\/[\w\-./%]+\.jpe?g$/i.test(String(u || ''))

export async function publicarEnInstagram({ post_url, story_url, caption }) {
  if (!instagramConfigurado()) return { ok: false, configurar: true, error: 'Instagram todavía no está conectado (faltan IG_USER_ID e IG_ACCESS_TOKEN en Vercel).' }
  if (post_url && !urlPermitida(post_url)) return { ok: false, error: 'Imagen del post no válida.' }
  if (story_url && !urlPermitida(story_url)) return { ok: false, error: 'Imagen de la story no válida.' }
  if (!post_url && !story_url) return { ok: false, error: 'No hay nada para publicar.' }
  const res = { ok: true }
  if (post_url) res.post = await publicarUno({ image_url: post_url, caption: String(caption || '').slice(0, 2200) })
  if (story_url) {
    try { res.story = await publicarUno({ image_url: story_url, story: true }) }
    catch (e) { res.ok = !!res.post; res.errorStory = e?.message || 'No se pudo publicar la story.' } // el post ya salió: no se pierde
  }
  return res
}
