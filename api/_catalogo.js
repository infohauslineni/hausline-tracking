// Lógica compartida del catálogo (el guion bajo evita que Vercel lo publique como
// endpoint). La usan api/catalogo.js (endpoint que consume la app) y el cron diario
// (api/cron-estimaciones.js) para sincronizar la tabla `productos` del tracking sin
// que nadie toque el botón "Sincronizar catálogo".
import vm from 'node:vm'

const BASE = 'https://hauslineshopni.es'
const CATALOG_URL = `${BASE}/catalogo-productos.json`
const STORE_SCRIPT_URL = `${BASE}/productos.js`

// Productos cargados desde el PANEL (admin.html) → tabla catalogo_web.
// Mismo proyecto Supabase que el tracking (clave pública, solo lectura de activos).
const PANEL_URL = 'https://xgdijumnmaqfirmckugw.supabase.co'
const PANEL_KEY = 'sb_publishable_NwpQth6G3qhpvtnRan3Xfg_8EqPM4Pw'

async function leerCatalogoPanel() {
  try {
    const response = await fetch(`${PANEL_URL}/rest/v1/catalogo_web?select=codigo,datos&activo=eq.true`, {
      headers: { apikey: PANEL_KEY, authorization: `Bearer ${PANEL_KEY}` }, cache: 'no-store',
    })
    if (!response.ok) return []
    const rows = await response.json()
    if (!Array.isArray(rows)) return []
    return rows
      .filter((r) => r && r.datos && String(r.datos.codigo || '').trim() && String(r.datos.nombre || '').trim())
      .map((r) => {
        const d = r.datos
        return {
          codigo: String(d.codigo).trim(),
          nombre: String(d.nombreReal || d.nombre).trim(),
          nombre_panel: Boolean(String(d.nombreReal || '').trim()),
          marca: d.marca ? String(d.marca).trim() : null,
          categoria: d.categoria ? String(d.categoria).trim() : null,
          tallas: Array.isArray(d.tallas) ? d.tallas.filter(Boolean).map(String) : [],
          precio_venta: Number(d.precio ?? 0),
          precio_oferta: Number(d.precioOferta ?? 0),
          promocion_hasta: d.promocionHasta ?? null,
          imagen: d.imagen || null,
          descripcion: d.descripcion || null,
        }
      })
  } catch { return [] }
}

// Lee el arreglo `const productos = [ ... ];` publicado en la tienda y lo normaliza al
// mismo formato que consume la app. Es la fuente completa (incluye productos que aún no
// se hayan re-publicado en catalogo-productos.json).
// Nombre que la web muestra al cliente: mapa `const nombresReales = { CODIGO: { nombre } }`
// de productos.js (código → nombre neutro). Si no se puede leer, devuelve un mapa vacío.
function leerNombresVisibles(source) {
  const start = source.indexOf('const nombresReales')
  if (start < 0) return new Map()
  const objStart = source.indexOf('{', start)
  const objEnd = source.indexOf('\n};', objStart)
  if (objStart < 0 || objEnd < 0) return new Map()
  let parsed
  try { parsed = vm.runInNewContext(`(${source.slice(objStart, objEnd + 2)})`, {}, { timeout: 1500 }) }
  catch { return new Map() }
  const nombres = new Map()
  for (const [codigo, valor] of Object.entries(parsed ?? {})) {
    const nombre = String(valor?.nombre ?? '').trim()
    if (nombre) nombres.set(codigo.trim().toUpperCase(), nombre)
  }
  return nombres
}

async function leerCatalogoTienda() {
  const vacio = { productos: [], nombres: new Map() }
  const response = await fetch(`${STORE_SCRIPT_URL}?actualizado=${Date.now()}`, { headers: { accept: 'application/javascript,text/javascript,*/*' }, cache: 'no-store' })
  if (!response.ok) return vacio
  const source = await response.text()
  const nombres = leerNombresVisibles(source)
  const start = source.indexOf('const productos')
  if (start < 0) return { productos: [], nombres }
  const arrayStart = source.indexOf('[', start)
  const arrayEnd = source.indexOf('\n];', arrayStart)
  if (arrayStart < 0 || arrayEnd < 0) return { productos: [], nombres }
  let parsed
  try { parsed = vm.runInNewContext(source.slice(arrayStart, arrayEnd + 2), {}, { timeout: 1500 }) }
  catch { return { productos: [], nombres } }
  if (!Array.isArray(parsed)) return { productos: [], nombres }
  return { nombres, productos: parsed
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
    })) }
}

async function leerFeedJson() {
  try {
    const response = await fetch(`${CATALOG_URL}?actualizado=${Date.now()}`, { headers: { accept: 'application/json' }, cache: 'no-store' })
    if (!response.ok) return []
    const feed = await response.json()
    return Array.isArray(feed) ? feed : []
  } catch { return [] }
}

// Catálogo unido de las tres fuentes. Prioridad: tienda (base) → feed (más campos) →
// panel (lo último editado en el panel gana). Devuelve [] si ninguna fuente respondió.
// El nombre final es el que ve el cliente en la web: el escrito en el panel (nombreReal)
// o, si no, el de nombresReales de productos.js; el nombre original queda como respaldo.
export async function obtenerCatalogoMergeado() {
  const [feed, { productos: store, nombres }, panel] = await Promise.all([leerFeedJson(), leerCatalogoTienda(), leerCatalogoPanel()])
  const porCodigo = new Map()
  for (const item of store) porCodigo.set(String(item.codigo).trim().toUpperCase(), item)
  for (const item of feed) { const clave = String(item.codigo || '').trim().toUpperCase(); if (clave) porCodigo.set(clave, item) }
  for (const item of panel) { const clave = String(item.codigo || '').trim().toUpperCase(); if (clave) porCodigo.set(clave, item) }
  return [...porCodigo.entries()].map(([clave, item]) => {
    const { nombre_panel: nombrePanel, ...resto } = item
    const visible = nombrePanel ? null : nombres.get(clave)
    return visible ? { ...resto, nombre: visible } : resto
  })
}

// Precio que realmente se vende en la web: usa la oferta solo si es válida y no venció.
// (Espejo de precioVentaWeb en src/services/comercial.service.ts.)
function precioVentaWeb(item) {
  const base = Number(item.precio_venta ?? item.precio ?? 0)
  const oferta = Number(item.precio_oferta ?? item.precioOferta ?? 0)
  if (!(oferta > 0 && oferta < base)) return base
  const hasta = String(item.promocion_hasta ?? item.promocionHasta ?? '').trim()
  if (hasta) { const fin = new Date(hasta); if (!Number.isNaN(fin.getTime()) && fin.getTime() < Date.now()) return base }
  return oferta
}

// Convierte el catálogo unido en los registros para upsert en la tabla `productos`.
// Mismo shape que produce la sincronización manual del panel (comercial.service.ts).
export function mapearCatalogoAProductos(merged) {
  const records = (merged ?? [])
    .filter((item) => String(item.codigo ?? '').trim() && String(item.nombre ?? '').trim())
    .map((item) => ({
      codigo: String(item.codigo).trim().toUpperCase(),
      nombre: String(item.nombre).trim(),
      marca: item.marca || null,
      categoria: item.categoria || null,
      tallas: Array.isArray(item.tallas) ? item.tallas : [],
      precio_venta: precioVentaWeb(item),
      imagen: item.imagen ? new URL(item.imagen, CATALOG_URL).href : null,
      descripcion: item.descripcion || null,
      activo: true,
    }))
  return [...new Map(records.map((item) => [item.codigo, item])).values()]
}
