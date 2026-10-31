import { toast } from 'sonner'
import { listarProductosTienda, productosEnCache, type DatosTienda } from '../services/productosTienda.service'
import { resolverImagenCatalogo } from './catalogoImagen'

// GENERADOR DEL POST / HISTORIA DE INSTAGRAM dentro del panel (antes vivía en admin.html de la
// tienda). public/ig-imagen.js es una COPIA de ig-imagen.js de la tienda: dibuja en canvas el post
// 4:5 y la historia 9:16 con las fuentes de la tienda, y arma el texto para copiar.
// modo: 'inmediata' (Entrega inmediata) | 'encamino' (Llega pronto) | 'nuevo' (Nuevo ingreso).
type HL = { abrir: (p: Record<string, unknown>, modo?: string) => Promise<void> }
declare global { interface Window { HLInstagram?: HL } }

let cargando: Promise<void> | null = null
function cargarGenerador(): Promise<void> {
  if (window.HLInstagram) return Promise.resolve()
  if (cargando) return cargando
  cargando = new Promise<void>((ok, mal) => {
    // Fuentes de la tienda (Cormorant Garamond + Jost) para que la imagen salga igual que allá.
    if (!document.getElementById('fuentes-tienda')) {
      const l = document.createElement('link')
      l.id = 'fuentes-tienda'; l.rel = 'stylesheet'
      l.href = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Jost:wght@400;500;600&display=swap'
      document.head.appendChild(l)
    }
    const s = document.createElement('script')
    s.src = '/ig-imagen.js?v=20261030'
    s.onload = () => (window.HLInstagram ? ok() : mal(new Error('No se pudo abrir el generador.')))
    s.onerror = () => { cargando = null; mal(new Error('No se pudo cargar el generador de Instagram.')) }
    document.head.appendChild(s)
  })
  return cargando
}

export async function abrirPostInstagram(datos: DatosTienda, modo?: 'inmediata' | 'encamino' | 'nuevo') {
  try {
    await cargarGenerador()
    // Las fotos tienen que ir con dirección completa (las del catálogo base son rutas relativas).
    const imagenes = (datos.imagenes?.length ? datos.imagenes : [datos.imagen]).filter(Boolean).map((u) => resolverImagenCatalogo(u))
    await window.HLInstagram!.abrir({ ...datos, imagen: imagenes[0] ?? '', imagenes }, modo)
  } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo abrir el generador de Instagram.') }
}

// Desde un código (p. ej. Compras libres): busca los datos del producto en la tienda.
export async function abrirPostInstagramPorCodigo(codigo: string, modo?: 'inmediata' | 'encamino' | 'nuevo') {
  const c = codigo.trim().toUpperCase()
  let lista = productosEnCache()
  if (!lista) { try { lista = await listarProductosTienda() } catch { lista = [] } }
  const p = lista.find((x) => x.codigo.toUpperCase() === c)
  if (!p) { toast.error(`No encontré ${c} en la tienda.`); return }
  await abrirPostInstagram(p.datos, modo)
}
