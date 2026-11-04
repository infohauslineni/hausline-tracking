import { Download, Share2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Modal } from '../ui/Modal'
import { FRASES_ORDEN, compartirHistoriaOrden, crearHistoriaOrdenBlob, descargarHistoriaOrden, type FraseOrden, type ProductoHistoria } from '../../services/historiaOrden.service'

// Vista previa + compartir de la historia "Tus productos" (como un comprobante de compra): los
// productos de un pedido web o de la lista de compra, sin datos del cliente, códigos ni precios.
export function HistoriaOrdenModal({ productos, fraseInicial, open, onClose }: { productos: ProductoHistoria[]; fraseInicial: FraseOrden; open: boolean; onClose: () => void }) {
  const [frase, setFrase] = useState<FraseOrden>(fraseInicial)
  const [preview, setPreview] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [busy, setBusy] = useState(false)

  // Solo se regenera si cambian los productos de verdad (el padre los arma en cada render).
  const clave = JSON.stringify(productos)
  useEffect(() => {
    if (!open) return
    let vivo = true
    let url: string | null = null
    setCargando(true)
    crearHistoriaOrdenBlob(productos, frase)
      .then((blob) => { if (!vivo) return; url = URL.createObjectURL(blob); setPreview(url) })
      .catch(() => { if (vivo) toast.error('No se pudo generar la historia.') })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false; if (url) URL.revokeObjectURL(url) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, frase, clave])

  const descargar = async () => { setBusy(true); try { await descargarHistoriaOrden(productos, frase); toast.success('Historia descargada.') } catch { toast.error('No se pudo descargar.') } finally { setBusy(false) } }
  const compartir = async () => {
    setBusy(true)
    try { const r = await compartirHistoriaOrden(productos, frase); if (r === 'shared') toast.success('Historia compartida.'); else if (r === 'downloaded') toast.success('Historia descargada (compartir no disponible aquí).') }
    catch { toast.error('No se pudo compartir.') } finally { setBusy(false) }
  }

  return <Modal open={open} onClose={onClose} title="Historia de la orden" description="Como el comprobante de compra de una tienda, listo para tus historias. No muestra cliente, ciudad, códigos ni precios.">
    <div className="mx-auto w-full max-w-[280px]">
      <div className="relative aspect-[9/16] overflow-hidden rounded-2xl border border-line bg-black/40">
        {preview && <img src={preview} alt="Vista previa de la historia" className={`size-full object-cover transition-opacity ${cargando ? 'opacity-40' : 'opacity-100'}`} />}
        {cargando && <div className="absolute inset-0 grid place-items-center text-xs text-muted">Generando…</div>}
      </div>
    </div>

    <p className="mt-4 text-xs font-semibold text-muted">Frase de abajo</p>
    <div className="mt-2 flex flex-wrap gap-2">
      {(Object.keys(FRASES_ORDEN) as FraseOrden[]).map((f) => <button key={f} type="button" onClick={() => setFrase(f)} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${frase === f ? 'border-accent bg-accent/[.12] text-white' : 'border-line text-muted hover:text-white'}`}>{FRASES_ORDEN[f]}</button>)}
    </div>

    <div className="mt-5 flex justify-end gap-2">
      <button type="button" className="subtle-button" disabled={busy || cargando} onClick={() => void descargar()}><Download size={16} /> Descargar</button>
      <button type="button" className="primary-button px-5" disabled={busy || cargando} onClick={() => void compartir()}><Share2 size={16} /> Compartir</button>
    </div>
  </Modal>
}
