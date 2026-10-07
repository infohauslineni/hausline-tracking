import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

// VENTA LIBRE: producto para UN cliente que pidió algo fuera del catálogo. Se guarda en la
// tabla catalogo_web del proyecto del CATÁLOGO (el mismo que usa admin.html de la tienda) con
// datos.ventaLibre=true: la tienda no lo lista, pero su link /p/CODIGO/ lo abre y el cliente
// lo encarga igual que cualquier producto (le cae a Encargos web). Después se publica en la
// tienda o se deja solo para esa venta.
//
// El catálogo es OTRO proyecto de Supabase: se entra con las mismas credenciales del admin
// (igual que el login doble de admin.html) y la sesión se guarda aparte.
const CATALOGO_URL = 'https://xgdijumnmaqfirmckugw.supabase.co'
const CATALOGO_KEY = 'sb_publishable_NwpQth6G3qhpvtnRan3Xfg_8EqPM4Pw' // llave pública
const BUCKET = 'catalogo'
export const SITIO_TIENDA = 'https://hauslineshopni.es'

let cliente: SupabaseClient | null = null
function catalogo() {
  if (!cliente) cliente = createClient(CATALOGO_URL, CATALOGO_KEY, { auth: { storageKey: 'hausline-catalogo-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } })
  return cliente
}

export async function conectadoATienda() {
  const { data } = await catalogo().auth.getSession()
  return Boolean(data.session)
}
export async function conectarTienda(email: string, password: string) {
  const { error } = await catalogo().auth.signInWithPassword({ email, password })
  if (error) throw new Error(/invalid/i.test(error.message) ? 'Correo o contraseña incorrectos para la tienda.' : error.message)
}
// scope local: no cerrar la sesión de admin.html (misma cuenta del catálogo) en otras pestañas/navegadores.
export async function desconectarTienda() { try { await catalogo().auth.signOut({ scope: 'local' }) } catch { /* sin sesión */ } }

export type DatosVentaLibre = Record<string, unknown> & {
  codigo: string; nombre: string; marca?: string; categoria: string; subcategoria?: string
  precio: number; descripcion?: string; tallas: string[]; colores: string[]; imagen: string; imagenes: string[]
  ventaLibre: boolean; fecha?: string
}
export type VentaLibre = { id: string; codigo: string; activo: boolean; datos: DatosVentaLibre; created_at: string }

export const linkVentaLibre = (codigo: string) => `${SITIO_TIENDA}/p/${encodeURIComponent(codigo)}/`
export function mensajeVentaLibre(d: Pick<DatosVentaLibre, 'codigo' | 'nombre' | 'precio'>) {
  const precio = Number(d.precio) > 0 ? ` — $${Number(d.precio)}` : ''
  return `Hola 👋 Le compartimos el link de su pedido en HAUSLINE: ${d.nombre}${precio}.\nAhí puede elegir su talla y encargarlo directo:\n${linkVentaLibre(d.codigo)}`
}

function lanzar(error: { message: string } | null, que: string) {
  if (!error) return
  if (/jwt|auth|permission|policy|row-level/i.test(error.message)) throw new Error('La sesión con la tienda venció. Volvé a conectar.')
  throw new Error(`${que}: ${error.message}`)
}

export async function listarVentasLibres(): Promise<VentaLibre[]> {
  const { data, error } = await catalogo().from('catalogo_web').select('id, codigo, activo, datos, created_at').eq('datos->>ventaLibre', 'true').order('created_at', { ascending: false })
  lanzar(error, 'No se pudieron cargar')
  return (data ?? []) as VentaLibre[]
}

// Siguiente código libre LIB001, LIB002… (el catálogo base ya usa VL00x para Valentino).
export async function siguienteCodigo() {
  const { data } = await catalogo().from('catalogo_web').select('codigo').ilike('codigo', 'LIB%')
  const enTracking = supabase ? (await supabase.from('productos').select('codigo').ilike('codigo', 'LIB%')).data ?? [] : []
  const max = [...(data ?? []), ...enTracking].reduce((m, r) => { const x = /^LIB(\d+)$/i.exec(String(r.codigo)); return x ? Math.max(m, Number(x[1])) : m }, 0)
  return `LIB${String(max + 1).padStart(3, '0')}`
}

// Un código que ya es producto de la tienda no se puede usar: la venta libre lo sacaría del catálogo.
// (Se revisa el catálogo del panel y los productos del tracking, que incluyen los de productos.js.)
async function codigoOcupado(codigo: string, idPropio?: string) {
  const { data } = await catalogo().from('catalogo_web').select('id').eq('codigo', codigo).maybeSingle()
  if (data) return data.id !== idPropio
  if (supabase) {
    const { data: prod } = await supabase.from('productos').select('id').eq('codigo', codigo).limit(1)
    if (prod?.length) return true
  }
  return false
}

// JPEG (no webp): WhatsApp solo muestra la foto del link si es jpg/png.
async function aJpeg(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('El archivo no es una imagen.')
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => mal(new Error('No se pudo leer la foto.')); i.src = url })
    const escala = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * escala)); canvas.height = Math.max(1, Math.round(img.naturalHeight * escala))
    const ctx = canvas.getContext('2d')
    if (ctx) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height) }
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.8))
    if (!blob) throw new Error('No se pudo comprimir la foto.')
    return blob
  } finally { URL.revokeObjectURL(url) }
}

export type FotoVentaLibre = { url: string; file?: File }

export async function guardarVentaLibre(datos: DatosVentaLibre, fotos: FotoVentaLibre[], existente?: VentaLibre | null) {
  const codigo = datos.codigo.trim().toUpperCase()
  if (await codigoOcupado(codigo, existente?.id)) throw new Error(`El código ${codigo} ya existe en la tienda. Usá otro.`)
  const urls: string[] = []
  for (let i = 0; i < fotos.length; i++) {
    const f = fotos[i]
    if (!f.file) { urls.push(f.url); continue }
    const ruta = `${codigo}/${Date.now()}-${i}.jpg`
    const { error } = await catalogo().storage.from(BUCKET).upload(ruta, await aJpeg(f.file), { contentType: 'image/jpeg', upsert: true })
    lanzar(error, 'No se pudo subir la foto')
    urls.push(catalogo().storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl)
  }
  const final: DatosVentaLibre = {
    // Mismos campos que guarda admin.html, para que la tienda lo trate igual que un producto.
    cotizar: false, precioOferta: 0, promocionHasta: '', tipoPrenda: '', imagenFit: '', posicionImagen: '', escalaImagen: null,
    destacadoNuevo: false, entregaInmediata: false, tallasEntregaInmediata: [], coloresEntregaInmediata: [],
    demoraExtendida: false, diasExtra: 0, notaDemora: '',
    ...(existente?.datos ?? {}),
    ...datos,
    codigo, nombreReal: datos.nombre, imagen: urls[0] ?? '', imagenes: urls, ventaLibre: true,
    fecha: existente?.datos.fecha ?? new Date().toISOString().slice(0, 10),
  }
  const { error } = await catalogo().from('catalogo_web').upsert({ codigo, activo: existente ? existente.activo : true, datos: final }, { onConflict: 'codigo' })
  lanzar(error, 'No se pudo guardar')
  // Si se cambió el código al editar, se borra la fila vieja.
  if (existente && existente.codigo.toUpperCase() !== codigo) await catalogo().from('catalogo_web').delete().eq('id', existente.id)
  return final
}

export async function cambiarActivoVentaLibre(v: VentaLibre) {
  const { error } = await catalogo().from('catalogo_web').update({ activo: !v.activo }).eq('id', v.id)
  lanzar(error, 'No se pudo cambiar')
}
// Pasa al catálogo normal: sale en la tienda, la búsqueda y "Nuevo". El link sigue igual.
export async function publicarEnTienda(v: VentaLibre) {
  const datos = { ...v.datos, ventaLibre: false, destacadoNuevo: true, fecha: new Date().toISOString().slice(0, 10) }
  const { error } = await catalogo().from('catalogo_web').update({ activo: true, datos }).eq('id', v.id)
  lanzar(error, 'No se pudo publicar')
}
export async function borrarVentaLibre(v: VentaLibre) {
  const { error } = await catalogo().from('catalogo_web').delete().eq('id', v.id)
  lanzar(error, 'No se pudo borrar')
}

// Precio con el que la TIENDA vende un producto (admin de la tienda → catalogo_web). Es el que paga
// el cliente al apartar desde la web; puede diferir del "precio de venta" de una compra libre.
export async function precioTienda(codigo: string): Promise<number | null> {
  const c = codigo.trim().toUpperCase()
  if (!c) return null
  const { data } = await catalogo().from('catalogo_web').select('datos').eq('codigo', c).maybeSingle()
  const precio = Number((data?.datos as { precio?: unknown } | undefined)?.precio)
  return precio > 0 ? precio : null
}
