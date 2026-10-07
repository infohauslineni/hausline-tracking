import { Copy, Download, Share2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { listarFotosInversion } from '../../services/archivos.service'
import { obtenerTipoCambio } from '../../services/comercial.service'
import { datosTienda } from '../../services/ventaLibre.service'
import type { Inversion } from '../../types/domain'
import { resolverImagenCatalogo } from '../../utils/catalogoImagen'
import { cordobas, generarFichaCliente, textoLlegada, type DatosFicha } from '../../utils/fichaCliente'
import { Modal } from '../ui/Modal'

const normal = (t: string) => t.toUpperCase().replace(/[^A-Z0-9]/g, '')

// "Ficha para el cliente": imagen con el look del panel (sin costo ni ganancia) que muestra que el
// producto está en el sistema esperando ser apartado, + el mensaje de WhatsApp listo para copiar.
export function FichaClienteModal({ item, onClose }: { item: Inversion; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [datos, setDatos] = useState<DatosFicha | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const codigo = (item.codigo ?? '').trim().toUpperCase()

  useEffect(() => {
    let vivo = true, creado: string | null = null
    void (async () => {
      const enCamino = item.estado === 'en_transito'
      const venta = Number(item.precio_venta_estimado) || 0
      const [cat, fotos, llegada, tipoCambio] = await Promise.all([
        codigo ? datosTienda(codigo, !enCamino).catch(() => ({ precio: null, tallas: [] as string[] })) : Promise.resolve({ precio: null, tallas: [] as string[] }),
        listarFotosInversion(item.id).catch(() => []),
        enCamino && codigo && supabase
          ? supabase.rpc('en_camino_llegada', { p_codigo: codigo }).then(({ data }) => (data && (data as { desde?: string }).desde ? data as { desde: string; hasta: string } : null), () => null)
          : Promise.resolve(null),
        obtenerTipoCambio().catch(() => 37),
      ])
      // El cliente paga el precio de la TIENDA al apartar; se usa ese para que todo cuadre.
      const tienda = cat.precio
      const precio = tienda ?? venta
      // Talla: la de la compra; si no la tiene, la que la tienda muestra para ese producto.
      const talla = (item.talla_color ?? '').trim() || cat.tallas.join(', ') || null
      if (tienda && venta && Math.abs(tienda - venta) >= 0.5) setAviso(`En la tienda este producto cuesta $${tienda} y en esta compra libre pusiste $${venta}. La ficha usa $${tienda}, que es lo que el cliente paga al apartar. Si querés cobrar $${venta}, cambiá el precio en el admin de la tienda.`)
      const d: DatosFicha = {
        codigo, producto: item.producto, marca: item.marca, talla, unidades: Number(item.cantidad) || 1, precio, enCamino, tipoCambio,
        llegada: llegada ?? (item.llega_aprox ? { desde: item.llega_aprox, hasta: item.llega_aprox } : null),
        imagen: item.imagen ? resolverImagenCatalogo(item.imagen) : null,
        fotosCalidad: fotos.map((f) => f.signed_url).filter((u): u is string => !!u),
      }
      const b = await generarFichaCliente(d)
      if (!vivo) return
      creado = URL.createObjectURL(b)
      setDatos(d); setBlob(b); setUrl(creado)
    })().catch(() => { if (vivo) toast.error('No se pudo generar la ficha.') })
    return () => { vivo = false; if (creado) URL.revokeObjectURL(creado) }
  }, [item, codigo])

  const nombreArchivo = `HAUSLINE ${codigo || 'producto'} disponible.png`
  const mensaje = datos ? [
    // La marca solo si el nombre no la trae ya ("T-SHIRT ALL-SAINTS de ALL-SAINTS" sonaba repetido).
    `Buen día. Ya revisé nuestro inventario y tenemos disponible el ${datos.producto}${datos.marca && !normal(datos.producto).includes(normal(datos.marca)) ? ` de ${datos.marca}` : ''}${datos.talla ? ` en talla ${datos.talla}` : ''}.`,
    datos.enCamino
      ? `Este par ya está comprado y en preparación con nuestro proveedor, así que le llega más rápido que un encargo nuevo: aproximadamente ${datos.llegada ? (datos.llegada.desde === datos.llegada.hasta ? 'el ' : 'entre el ') + textoLlegada(datos.llegada).replace(' – ', ' y el ') : 'en pocos días'}.`
      : 'Ya está en Nicaragua, listo para entregar.',
    datos.enCamino
      ? `El precio es de $${datos.precio} (${cordobas(datos.precio, datos.tipoCambio)}). Puede apartarlo con el 50%: $${Math.ceil(datos.precio / 2)} (${cordobas(Math.ceil(datos.precio / 2), datos.tipoCambio)}), y el resto lo cancela cuando lo reciba. Se lo reservamos apenas recibamos su abono.`
      : `El precio es de $${datos.precio} (${cordobas(datos.precio, datos.tipoCambio)}) y es compra inmediata: se cancela completo y se lo entregamos de una vez. Se lo reservamos apenas recibamos su pago.`,
    ...(datos.enCamino ? [datos.fotosCalidad.length ? 'Ya tenemos las fotos de control de calidad: se las comparto.' : 'Apenas el proveedor nos envíe las fotos de control de calidad, se las compartimos.'] : []),
    `${datos.enCamino ? 'Puede apartarlo aquí' : 'Puede verlo aquí'}: https://hauslineshopni.es/${datos.enCamino ? '?coleccion=en-camino' : `p/${codigo}/`}`,
  ].join('\n\n') : ''

  async function compartir() {
    if (!blob) return
    const archivo = new File([blob], nombreArchivo, { type: 'image/png' })
    try {
      if (navigator.canShare?.({ files: [archivo] })) { await navigator.share({ files: [archivo], text: mensaje }); return }
    } catch (e) { if ((e as Error)?.name === 'AbortError') return }
    descargar()
  }
  function descargar() {
    if (!url) return
    const a = document.createElement('a'); a.href = url; a.download = nombreArchivo; a.click()
  }
  async function copiar() {
    try { await navigator.clipboard.writeText(mensaje); toast.success('Mensaje copiado') } catch { toast.error('No se pudo copiar') }
  }

  return <Modal open onClose={onClose} title="Ficha para el cliente" description="Imagen para mandar por WhatsApp: sin costo ni ganancia.">
    {aviso && <p className="mb-4 rounded-xl border border-amber-300/30 bg-amber-300/[.07] p-3 text-xs leading-5 text-amber-200">{aviso}</p>}
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="overflow-hidden rounded-xl border border-line bg-black/40">
        {url ? <img src={url} alt="Ficha para el cliente" className="block h-auto w-full" /> : <div className="grid aspect-[4/5] place-items-center text-xs text-muted">Generando la ficha…</div>}
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <button className="primary-button justify-center py-2.5" style={{ fontSize: 13 }} disabled={!blob} onClick={() => void compartir()}><Share2 size={15} /> Compartir imagen</button>
        <button className="subtle-button justify-center py-2.5" style={{ fontSize: 13 }} disabled={!url} onClick={descargar}><Download size={15} /> Descargar</button>
        <div className="rounded-xl border border-line">
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2"><span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Mensaje para WhatsApp</span>
            <button className="flex items-center gap-1 text-xs font-semibold text-accent hover:underline" disabled={!mensaje} onClick={() => void copiar()}><Copy size={13} /> Copiar</button></div>
          <p className="whitespace-pre-wrap px-3 py-2.5 text-xs leading-5 text-white/85">{mensaje || 'Preparando…'}</p>
        </div>
      </div>
    </div>
  </Modal>
}
