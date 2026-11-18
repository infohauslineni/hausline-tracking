import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { costosDeCompras, DATOS_PRECIO_DEFECTO, obtenerDatosPrecio, type DatosPrecio } from '../../services/preciosSugeridos.service'
import { costosTracking, estadoDe, listarProductosTienda, productosEnCache, type ProductoTienda } from '../../services/productosTienda.service'
import { Modal } from '../ui/Modal'
import { CarritoPrivadoModal } from './CarritoPrivadoModal'

// CARRITO PRIVADO desde cualquier pantalla (botón "+" / "Crear"): carga lo que necesita
// (productos de la tienda, costos y márgenes) y abre el mismo carrito de Productos.
// Si los productos ya se cargaron antes, abre al instante y los refresca por detrás.
export function CarritoPrivadoRapido({ onClose }: { onClose: () => void }) {
  const [todos, setTodos] = useState<ProductoTienda[] | null>(() => productosEnCache())
  const [costos, setCostos] = useState<Map<string, number>>(new Map())
  const [datosPrecio, setDatosPrecio] = useState<DatosPrecio>(DATOS_PRECIO_DEFECTO)

  useEffect(() => {
    let vivo = true
    void listarProductosTienda().then((l) => { if (vivo) setTodos(l) }).catch((e) => {
      if (!vivo) return
      toast.error(e instanceof Error ? e.message : 'No se pudieron cargar los productos.')
      setTodos((t) => t ?? [])
    })
    // Costo de cada producto: el del panel; si no tiene, el de Compras libres (igual que en Productos).
    void Promise.all([costosTracking().catch(() => new Map<string, number>()), costosDeCompras().catch(() => new Map())]).then(([tracking, compras]) => {
      if (!vivo) return
      const m = new Map(tracking)
      for (const [k, v] of compras) if (!(m.get(k) ?? 0)) m.set(k, v.costo)
      setCostos(m)
    })
    void obtenerDatosPrecio().then((d) => { if (vivo) setDatosPrecio(d) }).catch(() => undefined)
    return () => { vivo = false }
  }, [])

  if (!todos) return <Modal open onClose={onClose} title="Carrito privado" description="Cargando los productos de la tienda…">
    <div className="grid place-items-center py-10"><div className="loader" /></div>
  </Modal>
  return <CarritoPrivadoModal iniciales={[]} todos={todos.filter((p) => estadoDe(p) !== 'borrador')} costos={costos} datosPrecio={datosPrecio} onClose={onClose} />
}
