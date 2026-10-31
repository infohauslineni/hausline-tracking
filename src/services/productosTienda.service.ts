import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { aJpeg, catalogo, SITIO_TIENDA } from './ventaLibre.service'

// PRODUCTOS DE LA TIENDA (pantalla "Productos" del panel, reemplaza al admin.html viejo).
// La tienda une DOS fuentes: el catálogo base de productos.js (código) y la tabla catalogo_web
// del proyecto del CATÁLOGO (lo que se carga/edita desde el panel). Mismo código = edición del
// producto base; código nuevo = producto extra. activo=false lo oculta; datos.borrador=true es un
// borrador que no sale en ningún lado. Guardar escribe en catalogo_web con los MISMOS campos que
// usaba admin.html (la tienda, /p, Instagram y el tracking los leen igual). Al guardar, un trigger
// del catálogo avisa al tracking (POST /api/catalogo) y sincroniza la tabla productos.

const BUCKET = 'catalogo'
export const CATEGORIAS = ['Hombre', 'Dama', 'Unisex', 'Accesorios', 'Decoración']
export const SUBCATEGORIAS: Record<string, string[]> = { Hombre: ['Calzado', 'Ropa'], Dama: ['Calzado', 'Ropa'], Unisex: ['Calzado', 'Ropa'], Accesorios: ['Hombre', 'Dama'], 'Decoración': [] }
export const TIPOS_ROPA = ['Camisa', 'Camiseta', 'Short', 'Pantalón', 'Sudadera', 'Chaqueta', 'Conjunto', 'Vestido', 'Otro']
export const TALLAS_CALZADO = Array.from({ length: 14 }, (_, i) => String(34 + i))
export const TALLAS_ROPA = ['XS', 'S', 'M', 'L', 'XL', 'XXL']
// Etiquetas opcionales: [propiedad en datos, texto]. Deben coincidir con ETIQUETAS_OPCIONALES de productos.js.
export const ETIQUETAS: [string, string][] = [['og100', '100% OG'], ['masVendido', 'Más vendido'], ['ultimasUnidades', 'Últimas unidades'], ['exclusivo', 'Exclusivo'], ['preventa', 'Preventa'], ['edicionLimitada', 'Edición limitada'], ['restock', 'Restock'], ['recomendado', 'Recomendado']]

export type DatosTienda = Record<string, unknown> & {
  codigo: string; nombre: string; nombreReal?: string; marca: string; categoria: string; subcategoria: string; tipoPrenda?: string
  precio: number; cotizar: boolean; precioOferta: number; promocionHasta: string; descripcion: string
  tallas: string[]; colores: string[]; imagen: string; imagenes: string[]; imagenFit?: string; posicionImagen?: string; escalaImagen?: number | null
  destacadoNuevo?: boolean; entregaInmediata?: boolean; tallasEntregaInmediata?: string[]; coloresEntregaInmediata?: string[]
  precioEntregaInmediata?: number; cantidadDisponible?: number; enCamino?: boolean; tallasEnCamino?: string[]
  demoraExtendida?: boolean; diasExtra?: number; notaDemora?: string; prepMin?: number; prepMax?: number
  borrador?: boolean; ventaLibre?: boolean; fecha?: string
}
export type Origen = 'original' | 'editado' | 'nuevo'
export type EstadoTienda = 'activo' | 'borrador' | 'oculto'
export type ProductoTienda = { codigo: string; datos: DatosTienda; origen: Origen; activo: boolean; id: string | null; creado: string | null }

const lista = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [])
export const estadoDe = (p: ProductoTienda): EstadoTienda => (p.datos.borrador === true ? 'borrador' : !p.activo ? 'oculto' : 'activo')
export const linkProducto = (codigo: string) => `${SITIO_TIENDA}/p/${encodeURIComponent(codigo)}/`
export const linkInstagram = (codigo: string, modo?: string) => `${SITIO_TIENDA}/admin.html?ig=${encodeURIComponent(codigo)}${modo ? `&modo=${modo}` : ''}`

// Tallas que vienen EN CAMINO descontadas de las de Entrega inmediata (igual que la tienda).
export function tallasEISinEnCamino(d: DatosTienda) {
  const quedan = lista(d.tallasEntregaInmediata)
  if (d.enCamino === true) for (const t of lista(d.tallasEnCamino)) { const i = quedan.indexOf(t); if (i >= 0) quedan.splice(i, 1) }
  return quedan
}
export function disponibilidad(d: DatosTienda): { tipo: 'ei' | 'encamino' | 'encargo'; tallas: string[] } {
  const ei = d.entregaInmediata ? tallasEISinEnCamino(d) : []
  const sinTallasEI = d.entregaInmediata && !lista(d.tallasEntregaInmediata).length
  if (ei.length || (sinTallasEI && !d.enCamino)) return { tipo: 'ei', tallas: [...new Set(ei)] }
  if (d.enCamino && lista(d.tallasEnCamino).length) return { tipo: 'encamino', tallas: [...new Set(lista(d.tallasEnCamino))] }
  return { tipo: 'encargo', tallas: lista(d.tallas) }
}
export const enOferta = (d: DatosTienda) => Number(d.precioOferta) > 0 && Number(d.precioOferta) < Number(d.precio) && (!d.promocionHasta || new Date(String(d.promocionHasta)) > new Date())

// Tallas en orden: números de menor a mayor, luego letras, luego el resto (igual que la tienda).
const LETRAS = ['XXXS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '2XL', '3XL']
export function ordenarTallas(t: string[]) {
  const clave = (x: string): [number, number] => { const s = x.trim().toUpperCase(); const n = parseFloat(s.replace(',', '.')); if (/^\d/.test(s) && !Number.isNaN(n)) return [0, n]; const i = LETRAS.indexOf(s); return i >= 0 ? [1, i] : [2, 0] }
  return t.map((x, i) => ({ x, i, k: clave(x) })).sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.i - b.i).map((o) => o.x)
}

// --------- Sesión con el catálogo (mismo login de admin.html) ---------
// Vista previa local (sin .env): lee el catálogo público y NO guarda nada.
export const vistaPrevia = !isSupabaseConfigured
export async function conectadoCatalogo() { if (vistaPrevia) return true; const { data } = await catalogo().auth.getSession(); return Boolean(data.session) }

function lanzar(error: { message: string } | null, que: string) {
  if (!error) return
  if (/jwt|auth|permission|policy|row-level/i.test(error.message)) throw new Error('La sesión con la tienda venció. Volvé a conectar.')
  throw new Error(`${que}: ${error.message}`)
}

// --------- Producto base (productos.js) → datos, igual que datosDeBase() de admin.html ---------
type Base = Record<string, unknown> & { codigo: string; nombreVisible?: string; descripcionVisible?: string; marcaVisible?: string }
function datosDeBase(p: Base): DatosTienda {
  const imagenes = lista(p.imagenes).length ? lista(p.imagenes) : (p.imagen ? [String(p.imagen)] : [])
  const datos: DatosTienda = {
    codigo: p.codigo, nombre: p.nombreVisible || String(p.nombre ?? '') || p.codigo, marca: String(p.marcaVisible || p.marca || ''), categoria: String(p.categoria ?? ''), subcategoria: String(p.subcategoria ?? ''),
    precio: Number(p.precio) || 0, cotizar: p.cotizar === true, precioOferta: Number(p.precioOferta) || 0, promocionHasta: String(p.promocionHasta ?? ''),
    descripcion: String(p.descripcionVisible || p.descripcionReal || p.descripcion || '').trim(), tallas: lista(p.tallas), colores: lista(p.colores),
    imagen: String(p.imagen || imagenes[0] || ''), imagenes, imagenFit: String(p.imagenFit ?? ''), posicionImagen: String(p.posicionImagen ?? ''), escalaImagen: (p.escalaImagen as number) || null,
    destacadoNuevo: p.destacadoNuevo === true, demoraExtendida: p.demoraExtendida === true, diasExtra: Number(p.diasExtra) || 0, notaDemora: String(p.notaDemora ?? ''),
    prepMin: Number(p.prepMin) || 0, prepMax: Number(p.prepMax) || 0, fecha: String(p.fecha || '2025-01-01'),
    entregaInmediata: p.entregaInmediata === true, tallasEntregaInmediata: lista(p.tallasEntregaInmediata), coloresEntregaInmediata: lista(p.coloresEntregaInmediata),
    precioEntregaInmediata: Number(p.precioEntregaInmediata) || 0, cantidadDisponible: Number(p.cantidadDisponible) || 0,
  }
  for (const [k] of ETIQUETAS) datos[k] = p[k] === true
  return datos
}

type Fila = { id: string; codigo: string; activo: boolean; datos: DatosTienda | null; created_at: string | null }

// Copia en memoria para pasar de la lista a la ficha sin volver a cargar todo.
let cache: ProductoTienda[] | null = null
export const productosEnCache = () => cache
export function actualizarCache(p: ProductoTienda | null, codigoViejo?: string) { if (!cache) return; const c = (codigoViejo ?? p?.codigo ?? '').toUpperCase(); cache = cache.filter((x) => x.codigo.toUpperCase() !== c); if (p) cache = [p, ...cache] }
export async function listarProductosTienda(): Promise<ProductoTienda[]> {
  const [resBase, resFilas] = await Promise.all([
    fetch('/api/catalogo?base=1', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : [])).catch(() => []) as Promise<Base[]>,
    catalogo().from('catalogo_web').select('id, codigo, activo, datos, created_at'),
  ])
  lanzar(resFilas.error, 'No se pudo leer el catálogo')
  const filas = (resFilas.data ?? []) as Fila[]
  const porCodigo = new Map(filas.map((f) => [String(f.codigo).trim().toUpperCase(), f]))
  const base = Array.isArray(resBase) ? resBase : []
  const vistos = new Set<string>()
  const salida: ProductoTienda[] = []
  for (const p of base) {
    const c = String(p.codigo).trim().toUpperCase()
    if (vistos.has(c)) continue
    vistos.add(c)
    const f = porCodigo.get(c)
    if (f && f.datos) {
      if (f.datos.ventaLibre === true) continue
      const datos = { ...datosDeBase(p), ...f.datos, nombre: String(f.datos.nombreReal || f.datos.nombre || p.nombreVisible || p.nombre || c) } as DatosTienda
      salida.push({ codigo: p.codigo, datos, origen: 'editado', activo: f.activo, id: f.id, creado: f.created_at })
    } else salida.push({ codigo: p.codigo, datos: datosDeBase(p), origen: 'original', activo: true, id: null, creado: null })
  }
  for (const f of filas) {
    const c = String(f.codigo).trim().toUpperCase()
    if (vistos.has(c) || !f.datos || f.datos.ventaLibre === true) continue
    vistos.add(c)
    const d = f.datos
    salida.push({ codigo: f.codigo, datos: { ...d, tallas: lista(d.tallas), colores: lista(d.colores), imagenes: lista(d.imagenes), nombre: String(d.nombreReal || d.nombre || f.codigo) } as DatosTienda, origen: 'nuevo', activo: f.activo, id: f.id, creado: f.created_at })
  }
  // Más nuevos primero: los del panel por fecha de creación, después los de fábrica.
  cache = salida.sort((a, b) => String(b.datos.fecha || b.creado || '').localeCompare(String(a.datos.fecha || a.creado || '')))
  return cache
}

// COSTO del producto = productos.precio_compra del tracking (la misma tabla que usan la ganancia,
// los pedidos y "Pagar al proveedor"). Antes se editaba en "Costos de productos"; ahora en la ficha.
export async function costoDe(codigo: string): Promise<number> {
  if (!supabase || !codigo) return 0
  const { data } = await supabase.from('productos').select('precio_compra').eq('codigo', codigo.trim().toUpperCase()).maybeSingle()
  return Number(data?.precio_compra) || 0
}
// Todos los costos de una vez (para la lista): código → costo.
export async function costosTracking(): Promise<Map<string, number>> {
  if (!supabase) return new Map()
  const { data } = await supabase.from('productos').select('codigo, precio_compra').limit(5000)
  return new Map(((data ?? []) as { codigo: string; precio_compra: number | null }[]).map((r) => [String(r.codigo).trim().toUpperCase(), Number(r.precio_compra) || 0]))
}
// Guarda el costo en el tracking. Si el producto todavía no existe ahí (recién creado), lo crea con
// los datos de la tienda; la sincronización del catálogo mantiene el resto (nombre, precio, foto).
export async function guardarCosto(d: DatosTienda, costo: number) {
  if (!supabase) return
  const codigo = d.codigo.trim().toUpperCase()
  const venta = d.cotizar ? 0 : enOferta(d) ? Number(d.precioOferta) : Number(d.precio) || 0
  const valor = Math.max(0, Math.round(costo * 100) / 100)
  const { data: fila } = await supabase.from('productos').select('id').eq('codigo', codigo).maybeSingle()
  const { error } = fila
    ? await supabase.from('productos').update({ precio_compra: valor }).eq('id', fila.id)
    : await supabase.from('productos').insert({ codigo, nombre: d.nombre || codigo, marca: d.marca || null, categoria: d.categoria || null, tallas: d.tallas ?? [], precio_venta: venta, precio_compra: valor, imagen: d.imagen || null, activo: true })
  if (error) throw new Error(`No se pudo guardar el costo: ${error.message}`)
}

// Siguiente código para una marca, siguiendo los que ya existen (GG021 → GG022, CLW006 → CLW007).
export function sugerirCodigo(marca: string, todos: ProductoTienda[], dama = false) {
  const m = marca.trim().toLowerCase()
  const deMarca = todos.filter((p) => String(p.datos.marca).trim().toLowerCase() === m).map((p) => p.codigo.toUpperCase())
  const prefijos = new Map<string, number>()
  for (const c of deMarca) { const x = /^([A-Z&]+)(\d+)$/.exec(c); if (!x) continue; const esDama = /W$/.test(x[1]); if (esDama !== dama && deMarca.some((d) => /W\d+$/.test(d))) continue; prefijos.set(x[1], Math.max(prefijos.get(x[1]) ?? 0, Number(x[2]))) }
  const usados = new Set(todos.map((p) => p.codigo.toUpperCase()))
  const [pref, max] = [...prefijos.entries()].sort((a, b) => b[1] - a[1])[0] ?? [m.replace(/[^a-z]/g, '').slice(0, 3).toUpperCase() || 'PRD', 0]
  const ancho = deMarca.find((c) => c.startsWith(pref))?.slice(pref.length).length ?? 3
  let n = max + 1
  while (usados.has(`${pref}${String(n).padStart(ancho, '0')}`)) n++
  return `${pref}${String(n).padStart(ancho, '0')}`
}

export type FotoTienda = { url: string; file?: File }

// Guarda el producto. `previo` = como estaba al abrirlo (null si es nuevo).
export async function guardarProductoTienda(form: DatosTienda, fotos: FotoTienda[], estado: EstadoTienda, previo: ProductoTienda | null, todos: ProductoTienda[]) {
  if (vistaPrevia) throw new Error('Vista previa local: no se guarda nada.')
  const codigo = form.codigo.trim().toUpperCase()
  const nombre = form.nombre.replace(/\s+/g, ' ').trim()
  if (!codigo) throw new Error('Poné el código del producto.')
  if (estado !== 'borrador' && (!nombre || !form.categoria)) throw new Error('Completá el título y la categoría.')
  const otro = todos.find((p) => p.codigo.toUpperCase() === codigo)
  if (otro && (!previo || previo.codigo.toUpperCase() !== codigo)) throw new Error(`El código ${codigo} ya existe (${otro.datos.nombre}). Usá otro.`)
  const { data: ses } = await catalogo().auth.refreshSession()
  if (!ses.session) throw new Error('La sesión con la tienda venció. Volvé a conectar.')

  // Fotos nuevas → JPEG 1600 px al bucket del catálogo (misma ruta que admin.html).
  const urls: string[] = []
  for (let i = 0; i < fotos.length; i++) {
    const f = fotos[i]
    if (!f.file) { urls.push(f.url); continue }
    const ruta = `${codigo}/${Date.now()}-${i}.jpg`
    const { error } = await catalogo().storage.from(BUCKET).upload(ruta, await aJpeg(f.file), { contentType: 'image/jpeg', upsert: true, cacheControl: '31536000' })
    lanzar(error, 'No se pudo subir la foto')
    urls.push(catalogo().storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl)
  }

  const esNuevo = !previo || previo.datos.borrador === true
  const oferta = Number(form.precioOferta) || 0
  const datos: DatosTienda = {
    ...(previo?.datos ?? {}),
    ...form,
    codigo, nombre, nombreReal: nombre, marca: String(form.marca).trim(),
    tipoPrenda: /ropa/i.test(form.subcategoria) ? String(form.tipoPrenda ?? '') : '',
    precio: form.cotizar ? 0 : Number(form.precio) || 0,
    precioOferta: oferta > 0 ? oferta : 0, promocionHasta: oferta > 0 ? String(form.promocionHasta || '') : '',
    descripcion: String(form.descripcion).trim(), tallas: ordenarTallas(lista(form.tallas)), colores: lista(form.colores),
    imagen: urls[0] ?? '', imagenes: urls, ventaLibre: false, borrador: estado === 'borrador',
    // Fecha de alta: editar no la cambia (si no, un producto viejo volvería a salir como "Nuevo").
    fecha: !esNuevo && /^\d{4}-\d{2}-\d{2}/.test(String(previo?.datos.fecha ?? '')) ? String(previo?.datos.fecha).slice(0, 10) : new Date().toISOString().slice(0, 10),
  }
  const pMin = Math.round(Number(form.prepMin) || 0), pMax = Math.round(Number(form.prepMax) || 0)
  datos.prepMin = pMin > 0 ? pMin : pMax > 0 ? pMax : 0
  datos.prepMax = datos.prepMin ? Math.max(datos.prepMin, pMax) : 0
  if (!datos.demoraExtendida) { datos.diasExtra = 0; datos.notaDemora = '' }
  if (!(Number(datos.precioEntregaInmediata) > 0)) datos.precioEntregaInmediata = 0

  // "En camino" y la Entrega inmediata también cambian SOLOS (ventas, cancelaciones, Compras libres).
  // Se toma lo que hay AHORA en la base para no pisarlo con lo que se abrió antes.
  if (previo && !esNuevo) {
    const { data: actual } = await catalogo().from('catalogo_web').select('datos').eq('codigo', codigo).maybeSingle()
    const ahora = (actual?.datos ?? null) as DatosTienda | null
    if (ahora) {
      for (const k of ['enCamino', 'tallasEnCamino']) if (k in ahora) datos[k] = ahora[k]
      const igual = (a: unknown, b: unknown) => JSON.stringify(lista(a)) === JSON.stringify(lista(b))
      const sinTocar = Boolean(previo.datos.entregaInmediata) === Boolean(form.entregaInmediata) && igual(previo.datos.tallasEntregaInmediata, form.tallasEntregaInmediata) && igual(previo.datos.coloresEntregaInmediata, form.coloresEntregaInmediata)
      if (sinTocar) for (const k of ['entregaInmediata', 'tallasEntregaInmediata', 'coloresEntregaInmediata', 'cantidadDisponible']) if (k in ahora) datos[k] = ahora[k]
    }
  }

  const { error } = await catalogo().from('catalogo_web').upsert({ codigo, activo: estado === 'activo', datos }, { onConflict: 'codigo' })
  lanzar(error, 'No se pudo guardar')
  // Código cambiado en un producto del panel: se borra la fila vieja.
  if (previo && previo.origen === 'nuevo' && previo.id && previo.codigo.toUpperCase() !== codigo) await catalogo().from('catalogo_web').delete().eq('id', previo.id)
  return datos
}

// Activar / pasar a borrador / ocultar varios a la vez.
export async function cambiarEstadoProductos(items: ProductoTienda[], estado: EstadoTienda) {
  if (vistaPrevia) throw new Error('Vista previa local: no se guarda nada.')
  const filas = items.map((p) => ({ codigo: p.codigo.toUpperCase(), activo: estado === 'activo', datos: { ...p.datos, codigo: p.codigo.toUpperCase(), borrador: estado === 'borrador' } }))
  if (!filas.length) return
  const { error } = await catalogo().from('catalogo_web').upsert(filas, { onConflict: 'codigo' })
  lanzar(error, 'No se pudo cambiar el estado')
}

// Borra un producto cargado desde el panel. Uno de fábrica (productos.js) no se puede borrar: se oculta.
export async function borrarProductoTienda(p: ProductoTienda) {
  if (vistaPrevia) throw new Error('Vista previa local: no se guarda nada.')
  if (p.origen !== 'nuevo' || !p.id) throw new Error('Los productos de fábrica no se borran: ocultalo.')
  const { error } = await catalogo().from('catalogo_web').delete().eq('id', p.id)
  lanzar(error, 'No se pudo borrar')
}
