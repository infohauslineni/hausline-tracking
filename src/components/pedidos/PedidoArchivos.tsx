import { Eye, EyeOff, ImagePlus, LoaderCircle, Star, Trash2, UploadCloud } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { isSupabaseConfigured } from '../../lib/supabase'
import { comprimirImagen, eliminarArchivo, listarArchivos, marcaParaTipo, marcarPrincipal, subirArchivo } from '../../services/archivos.service'
import { avanzarAWarehousePorMiami } from '../../services/pedidos.service'
import type { ArchivoPedido, Pedido, TipoArchivo } from '../../types/domain'

// Categorías visibles para subir fotos. "Recibido en bodega Miami" mueve el pedido
// automáticamente a "Warehouse HAUSLINE" (ver cargar()).
const CATEGORIAS: { id: TipoArchivo; label: string; description: string }[] = [
  { id: 'control_calidad', label: 'Control de calidad', description: 'Evidencia de revisión y empaque' },
  { id: 'recepcion_miami', label: 'Recibido en bodega Miami', description: 'Foto del paquete en la bodega · pasa el pedido a Warehouse HAUSLINE' },
]

export function PedidoArchivos({ pedidoId, codigo, onQualityReady, onEstadoAvanzado }: { pedidoId: string; codigo?: string; onQualityReady?: (ready: boolean) => void; onEstadoAvanzado?: (pedido: Pedido) => void }) {
  const [categoria, setCategoria] = useState<TipoArchivo>('control_calidad')
  const [archivos, setArchivos] = useState<ArchivoPedido[]>([])
  const [visibleCliente, setVisibleCliente] = useState(true)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const localUrls = useRef(new Set<string>())

  useEffect(() => {
    if (!isSupabaseConfigured) return
    void listarArchivos(pedidoId)
      .then((files) => {
        setArchivos(files)
        onQualityReady?.(files.some((file) => file.tipo === 'control_calidad' && file.visible_cliente))
      })
      .catch(() => toast.error('No se pudieron cargar las imágenes.'))
      .finally(() => setLoading(false))
  }, [pedidoId, onQualityReady])

  useEffect(() => () => { localUrls.current.forEach((url) => URL.revokeObjectURL(url)) }, [])

  const cambiarCategoria = (tipo: TipoArchivo) => {
    setCategoria(tipo)
    setVisibleCliente(tipo !== 'comprobante')
  }

  const cargar = async (files: FileList | File[]) => {
    const imagenes = Array.from(files)
    if (!imagenes.length) return
    setUploading(true)
    try {
      for (const file of imagenes) {
        if (isSupabaseConfigured) {
          const nuevo = await subirArchivo(pedidoId, categoria, file, visibleCliente, codigo)
          setArchivos((current) => [...current, nuevo])
        } else {
          const blob = await comprimirImagen(file, marcaParaTipo(categoria, codigo))
          const url = URL.createObjectURL(blob)
          localUrls.current.add(url)
          const nuevo: ArchivoPedido = {
            id: crypto.randomUUID(), pedido_id: pedidoId, tipo: categoria,
            storage_path: url, signed_url: url, nombre: file.name,
            mime_type: 'image/webp', tamano_bytes: blob.size,
            orden: archivos.filter((item) => item.tipo === categoria).length + 1,
            es_principal: false, visible_cliente: visibleCliente,
            created_at: new Date().toISOString(),
          }
          setArchivos((current) => [...current, nuevo])
        }
      }
      if (categoria === 'control_calidad' && visibleCliente) onQualityReady?.(true)
      toast.success(`${imagenes.length === 1 ? 'Imagen cargada' : 'Imágenes cargadas'} correctamente.`)
      // Al subir la foto de recepción en Miami, el pedido pasa solo a "Warehouse HAUSLINE".
      if (categoria === 'recepcion_miami' && isSupabaseConfigured) {
        try {
          const avanzado = await avanzarAWarehousePorMiami(pedidoId)
          if (avanzado) { onEstadoAvanzado?.(avanzado); toast.success('📦 Pedido movido a “Warehouse HAUSLINE”.') }
        } catch { toast.error('La foto se guardó, pero no se pudo mover el pedido a Warehouse. Cámbialo a mano.') }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cargar la imagen.')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const borrar = async (archivo: ArchivoPedido) => {
    try {
      if (isSupabaseConfigured) await eliminarArchivo(archivo)
      const localUrl = archivo.signed_url
      if (localUrl && localUrls.current.has(localUrl)) {
        URL.revokeObjectURL(localUrl)
        localUrls.current.delete(localUrl)
      }
      const remaining = archivos.filter((item) => item.id !== archivo.id)
      setArchivos(remaining)
      if (archivo.tipo === 'control_calidad') onQualityReady?.(remaining.some((item) => item.tipo === 'control_calidad' && item.visible_cliente))
      toast.success('Imagen eliminada.')
    } catch { toast.error('No se pudo eliminar la imagen.') }
  }

  const hacerPrincipal = async (archivo: ArchivoPedido) => {
    try {
      if (isSupabaseConfigured) await marcarPrincipal(archivo)
      setArchivos((current) => current.map((item) => ({ ...item, es_principal: item.id === archivo.id })))
      toast.success('Imagen principal actualizada.')
    } catch { toast.error('No se pudo cambiar la imagen principal.') }
  }

  const actuales = archivos.filter((archivo) => archivo.tipo === categoria)
  const detalle = CATEGORIAS.find((item) => item.id === categoria)!

  return <section id="imagenes-pedido" className="form-section">
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
      <div><h2 className="flex items-center gap-2 font-semibold"><ImagePlus size={18} className="text-accent" /> Imágenes y archivos</h2><p className="mt-1 text-xs text-muted">Organiza la evidencia visual del pedido por categoría.</p></div>
      {!isSupabaseConfigured && <span className="status-badge status-neutral mt-2 w-fit sm:mt-0">Vista previa local</span>}
    </div>

    {CATEGORIAS.length > 1 && <div className="mt-5 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Categorías de imágenes">
      {CATEGORIAS.map((item) => <button key={item.id} type="button" role="tab" aria-selected={categoria === item.id} onClick={() => cambiarCategoria(item.id)} className={`shrink-0 rounded-full border px-3 py-2 text-xs font-semibold transition ${categoria === item.id ? 'border-accent bg-accent text-app' : 'border-line bg-white/[0.02] text-muted hover:text-white'}`}>
        {item.label} <span className="ml-1 opacity-65">{archivos.filter((file) => file.tipo === item.id).length}</span>
      </button>)}
    </div>}

    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div><strong className="text-sm">{detalle.label}</strong><p className="mt-0.5 text-xs text-muted">{detalle.description}</p></div>
      <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
        <input type="checkbox" checked={visibleCliente} onChange={(event) => setVisibleCliente(event.target.checked)} className="size-4 accent-[#b7ff00]" /> Visible para el cliente
      </label>
    </div>

    <button type="button" disabled={uploading} onClick={() => inputRef.current?.click()} onDragEnter={(event) => { event.preventDefault(); setDragging(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void cargar(event.dataTransfer.files) }} className={`mt-4 flex min-h-36 w-full flex-col items-center justify-center rounded-xl border border-dashed px-5 py-6 text-center transition ${dragging ? 'border-accent bg-accent/[0.07]' : 'border-white/15 bg-white/[0.015] hover:border-white/30'}`}>
      {uploading ? <LoaderCircle className="animate-spin text-accent" size={26} /> : <UploadCloud className="text-accent" size={27} />}
      <strong className="mt-3 text-sm">{uploading ? 'Procesando imágenes…' : 'Selecciona o arrastra imágenes'}</strong>
      <span className="mt-1 text-xs text-muted">JPG, PNG o WEBP · máximo 10 MB · se optimizan automáticamente</span>
    </button>
    {(categoria === 'control_calidad' || categoria === 'producto') && <div className="mt-2 text-center text-[10px] font-semibold text-accent">Marca de agua HAUSLINE.NI automática</div>}
    {categoria === 'recibido_local' && <div className="mt-2 text-center text-[10px] font-semibold text-accent">Se agrega sello “✓ RECIBIDO” con código y fecha automáticamente</div>}
    {categoria === 'recepcion_miami' && <div className="mt-2 text-center text-[10px] font-semibold text-accent">Marca HAUSLINE.NI en la esquina automática</div>}
    <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(event) => event.target.files && void cargar(event.target.files)} />

    {loading ? <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3"><div className="aspect-square animate-pulse rounded-xl bg-white/[0.04]" /><div className="aspect-square animate-pulse rounded-xl bg-white/[0.04]" /></div>
      : actuales.length > 0 ? <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {actuales.map((archivo) => <article key={archivo.id} className="group overflow-hidden rounded-xl border border-line bg-black/20">
          <div className="relative aspect-square overflow-hidden bg-white/[0.025]">
            <img src={archivo.signed_url} alt={archivo.nombre} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
            <div className="absolute left-2 top-2 flex flex-wrap gap-1">{archivo.es_principal && <span className="status-badge border-accent/20 bg-app/85 text-accent"><Star size={10} fill="currentColor" /> Principal</span>}<span className="status-badge border-white/10 bg-app/85 text-white">{archivo.visible_cliente ? <Eye size={10} /> : <EyeOff size={10} />} {archivo.visible_cliente ? 'Cliente' : 'Interna'}</span></div>
          </div>
          <div className="flex items-center gap-2 p-2.5"><div className="min-w-0 flex-1"><strong className="block truncate text-xs">{archivo.nombre}</strong><span className="text-[10px] text-muted">{(archivo.tamano_bytes / 1024).toFixed(0)} KB</span></div><button type="button" className="table-action" onClick={() => void hacerPrincipal(archivo)} title="Marcar como principal" aria-label="Marcar como principal"><Star size={15} /></button><button type="button" className="table-action hover:!text-red-300" onClick={() => void borrar(archivo)} title="Eliminar" aria-label="Eliminar imagen"><Trash2 size={15} /></button></div>
        </article>)}
      </div> : <div className="mt-5 rounded-xl border border-line bg-white/[0.015] px-4 py-7 text-center"><p className="text-sm text-muted">Todavía no hay imágenes en {detalle.label.toLowerCase()}.</p></div>}
  </section>
}
