import { obtenerCatalogoMergeado } from './_catalogo.js'

// Endpoint que consume la app (comercial.service.ts → sincronizarCatalogo). Devuelve el
// catálogo unido de la tienda + feed + panel. La lógica vive en _catalogo.js para
// compartirla con el cron diario que sincroniza la tabla `productos` sin intervención.
export default async function handler(_request, response) {
  try {
    const merged = await obtenerCatalogoMergeado()
    if (!merged.length) return response.status(502).json({ error: 'No se pudo leer el catálogo publicado.' })
    response.setHeader('Cache-Control', 'no-store, max-age=0')
    return response.status(200).json(merged)
  } catch {
    return response.status(502).json({ error: 'No se pudo leer el catálogo publicado.' })
  }
}
