import { Download, Share2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Modal } from '../ui/Modal'
import { compartirHistoriaResena, crearHistoriaResenaBlob, descargarHistoriaResena, nombreCorto, type ProductoResena } from '../../services/historiaResena.service'
import type { Resena } from '../../services/resenas.service'

// Vista previa + descargar/compartir la historia (9:16) de una reseña.
export function HistoriaResenaModal({ resena, producto, onClose }: { resena: Resena; producto: ProductoResena; onClose: () => void }) {
  const [mostrarNombre, setMostrarNombre] = useState(true)
  const [conFoto, setConFoto] = useState(true)
  const [preview, setPreview] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [busy, setBusy] = useState(false)
  const hayFoto = !!(resena.foto_url || producto?.imagen)

  useEffect(() => {
    let vivo = true
    let url: string | null = null
    setCargando(true)
    crearHistoriaResenaBlob(resena, producto, { mostrarNombre, conFoto })
      .then((blob) => { if (!vivo) return; url = URL.createObjectURL(blob); setPreview(url) })
      .catch(() => { if (vivo) toast.error('No se pudo generar la historia.') })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false; if (url) URL.revokeObjectURL(url) }
  }, [resena, producto, mostrarNombre, conFoto])

  const opts = { mostrarNombre, conFoto }
  const descargar = async () => { setBusy(true); try { await descargarHistoriaResena(resena, producto, opts); toast.success('Historia descargada.') } catch { toast.error('No se pudo descargar.') } finally { setBusy(false) } }
  const compartir = async () => {
    setBusy(true)
    try { const r = await compartirHistoriaResena(resena, producto, opts); if (r === 'shared') toast.success('Historia compartida.'); else if (r === 'downloaded') toast.success('Historia descargada (compartir no disponible aquí).') }
    catch { toast.error('No se pudo compartir.') } finally { setBusy(false) }
  }

  return <Modal open onClose={onClose} title="Compartir reseña en historia" description="Imagen lista para tus historias. No muestra teléfono ni montos.">
    <div className="mx-auto w-full max-w-[280px]">
      <div className="relative aspect-[9/16] overflow-hidden rounded-2xl border border-line bg-black/40">
        {preview && <img src={preview} alt="Vista previa de la historia" className={`size-full object-cover transition-opacity ${cargando ? 'opacity-40' : 'opacity-100'}`} />}
        {cargando && <div className="absolute inset-0 grid place-items-center text-xs text-muted">Generando…</div>}
      </div>
    </div>
    <label className="mt-4 flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-line bg-white/[0.02] px-4 py-3">
      <span className="text-sm"><strong className="block">Mostrar el nombre del cliente</strong><span className="text-xs text-muted">{mostrarNombre ? `Se ve: "${nombreCorto(resena.cliente_nombre)}"` : 'Anónimo: "Cliente HAUSLINE"'}</span></span>
      <input type="checkbox" className="size-5 shrink-0 accent-accent" checked={mostrarNombre} onChange={(e) => setMostrarNombre(e.target.checked)} />
    </label>
    {hayFoto && <label className="mt-2 flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-line bg-white/[0.02] px-4 py-3">
      <span className="text-sm"><strong className="block">Incluir foto</strong><span className="text-xs text-muted">{resena.foto_url ? 'La foto que subió el cliente' : 'La foto del producto'}</span></span>
      <input type="checkbox" className="size-5 shrink-0 accent-accent" checked={conFoto} onChange={(e) => setConFoto(e.target.checked)} />
    </label>}
    <div className="mt-5 flex justify-end gap-2">
      <button type="button" className="subtle-button" disabled={busy || cargando} onClick={() => void descargar()}><Download size={16} /> Descargar</button>
      <button type="button" className="primary-button px-5" disabled={busy || cargando} onClick={() => void compartir()}><Share2 size={16} /> Compartir</button>
    </div>
  </Modal>
}
