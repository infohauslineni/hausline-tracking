import { useEffect, useRef, useState } from 'react'
import { enOferta, listarProductosTienda, productosEnCache, type ProductoTienda } from '../services/productosTienda.service'

// CATÁLOGO DE LA TIENDA para completar formularios por código (Compras libres, compra en
// conjunto). La lista interna de productos del panel no tiene los productos nuevos de la tienda
// (los que se cargan en Productos / Yupoo): sin esto, al escribir "CL0007" no se llenaba nada.
// Usa lo que ya esté cargado y lo refresca por detrás.
// alCargar: se llama cuando llega la lista (para completar un código que se escribió antes).
export function useCatalogoTienda(activo: boolean, alCargar?: (lista: ProductoTienda[]) => void) {
  const [lista, setLista] = useState<ProductoTienda[]>(() => productosEnCache() ?? [])
  const aviso = useRef(alCargar)
  useEffect(() => { aviso.current = alCargar })
  useEffect(() => {
    if (!activo) return
    let vivo = true
    void listarProductosTienda().then((l) => { if (!vivo) return; setLista(l); aviso.current?.(l) }).catch(() => undefined)
    return () => { vivo = false }
  }, [activo])
  return lista
}

export type DatosCatalogo = { nombre: string; marca: string; precioVenta: number; imagen: string | null; texto: string }

// Busca un producto de la tienda por código (sin importar mayúsculas) y devuelve lo que sirve para
// el formulario: nombre, marca, precio de venta (el de oferta si está en oferta) y foto.
export function buscarEnTienda(lista: ProductoTienda[], codigo: string): DatosCatalogo | null {
  const c = codigo.trim().toUpperCase()
  if (!c) return null
  const p = lista.find((x) => x.codigo.trim().toUpperCase() === c)
  if (!p) return null
  const d = p.datos
  const precio = d.cotizar ? 0 : enOferta(d) ? Number(d.precioOferta) : Number(d.precio) || 0
  const nombre = String(d.nombreReal || d.nombre || p.codigo).trim()
  return { nombre, marca: String(d.marca ?? '').trim(), precioVenta: precio, imagen: d.imagen || null, texto: `${d.subcategoria ?? ''} ${d.tipoPrenda ?? ''} ${nombre}` }
}
