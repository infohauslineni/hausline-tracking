import vm from 'node:vm'

const BASE = 'https://hauslineshopni.es'
const CATALOG_URL = `${BASE}/catalogo-productos.json`
const STORE_SCRIPT_URL = `${BASE}/productos.js`

// Lee el arreglo `const productos = [ ... ];` publicado en la tienda y lo normaliza al
// mismo formato que consume la app. Es la fuente completa (incluye productos que aún no
// se hayan re-publicado en catalogo-productos.json).
async function leerCatalogoTienda() {
  const response = await fetch(`${STORE_SCRIPT_URL}?actualizado=${Date.now()}`, { headers: { accept: 'application/javascript,text/javascript,*/*' }, cache: 'no-store' })
  if (!response.ok) return []
  const source = await response.text()
  const start = source.indexOf('const productos')
  if (start < 0) return []
  const arrayStart = source.indexOf('[', start)
  const arrayEnd = source.indexOf('\n];', arrayStart)
  if (arrayStart < 0 || arrayEnd < 0) return []
  let parsed
  try { parsed = vm.runInNewContext(source.slice(arrayStart, arrayEnd + 2), {}, { timeout: 1500 }) }
  catch { return [] }
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((product) => product && String(product.codigo || '').trim() && String(product.nombre || '').trim())
    .map((product) => ({
      codigo: String(product.codigo).trim(),
      nombre: String(product.nombre).trim(),
      marca: product.marca ? String(product.marca).trim() : null,
      categoria: product.categoria ? String(product.categoria).trim() : null,
      tallas: Array.isArray(product.tallas) ? product.tallas.filter(Boolean).map(String) : [],
      precio_venta: Number(product.precio ?? product.precio_venta ?? 0),
      precio_oferta: Number(product.precioOferta ?? product.precio_oferta ?? 0),
      promocion_hasta: product.promocionHasta ?? product.promocion_hasta ?? null,
      imagen: product.imagen || null,
      descripcion: product.descripcion || null,
    }))
}

async function leerFeedJson() {
  try {
    const response = await fetch(`${CATALOG_URL}?actualizado=${Date.now()}`, { headers: { accept: 'application/json' }, cache: 'no-store' })
    if (!response.ok) return []
    const feed = await response.json()
    return Array.isArray(feed) ? feed : []
  } catch { return [] }
}

export default async function handler(_request, response) {
  try {
    const [feed, store] = await Promise.all([leerFeedJson(), leerCatalogoTienda()])

    // Se prefiere la entrada del feed (más campos: oferta, entrega inmediata, etc.) y se
    // agregan los productos de la tienda que todavía no estén en el feed publicado.
    const porCodigo = new Map()
    for (const item of store) porCodigo.set(String(item.codigo).trim().toUpperCase(), item)
    for (const item of feed) { const clave = String(item.codigo || '').trim().toUpperCase(); if (clave) porCodigo.set(clave, item) }
    const merged = [...porCodigo.values()]

    if (!merged.length) return response.status(502).json({ error: 'No se pudo leer el catálogo publicado.' })

    response.setHeader('Cache-Control', 'no-store, max-age=0')
    return response.status(200).json(merged)
  } catch {
    return response.status(502).json({ error: 'No se pudo leer el catálogo publicado.' })
  }
}
