import { Download, Share2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Modal } from '../ui/Modal'
import { compartirHistoria, crearHistoriaBlob, descargarHistoria } from '../../services/historia.service'
import type { Pedido } from '../../types/domain'

// Vista previa + descarga/compartir de la "historia" (imagen 9:16) de un pedido entregado.
// El admin elige si mostrar el primer nombre del cliente o dejarlo anónimo antes de postear.
export function HistoriaModal({ pedido, open, onClose }: { pedido: Pedido; open: boolean; onClose: () => void }) {
  const [mostrarNombre, setMostrarNombre] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [busy, setBusy] = useState(false)

  // Regenera la vista previa al abrir y cada vez que cambia el toggle del nombre.
  useEffect(() => {
    if (!open) return
    let vivo = true
    let url: string | null = null
    setCargando(true)
    crearHistoriaBlob(pedido, { mostrarNombre })
      .then((blob) => { if (!vivo) return; url = URL.createObjectURL(blob); setPreview(url) })
      .catch(() => { if (vivo) toast.error('No se pudo generar la historia.') })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false; if (url) URL.revokeObjectURL(url) }
  }, [open, mostrarNombre, pedido])

  const descargar = async () => { setBusy(true); try { await descargarHistoria(pedido, { mostrarNombre }); toast.success('Historia descargada.') } catch { toast.error('No se pudo descargar.') } finally { setBusy(false) } }
  const compartir = async () => {
    setBusy(true)
    try { const r = await compartirHistoria(pedido, { mostrarNombre }); if (r === 'shared') toast.success('Historia compartida.'); else if (r === 'downloaded') toast.success('Historia descargada (compartir no disponible aquí).') }
    catch { toast.error('No se pudo compartir.') } finally { setBusy(false) }
  }

  return <Modal open={open} onClose={onClose} title="Compartir en historia" description="Imagen lista para subir a tus historias. No muestra teléfono, dirección, código ni montos.">
    <div className="mx-auto w-full max-w-[280px]">
      <div className="relative aspect-[9/16] overflow-hidden rounded-2xl border border-line bg-black/40">
        {preview && <img src={preview} alt="Vista previa de la historia" className={`size-full object-cover transition-opacity ${cargando ? 'opacity-40' : 'opacity-100'}`} />}
        {cargando && <div className="absolute inset-0 grid place-items-center text-xs text-muted">Generando…</div>}
      </div>
    </div>

    <label className="mt-4 flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-line bg-white/[0.02] px-4 py-3">
      <span className="text-sm"><strong className="block">Mostrar el nombre del cliente</strong><span className="text-xs text-muted">{mostrarNombre ? `Se ve: "${(pedido.clientes?.nombre ?? '').trim().split(/\s+/)[0] || 'Nombre'} · ciudad"` : 'Anónimo: "Entrega en <ciudad>"'}</span></span>
      <input type="checkbox" className="size-5 shrink-0 accent-[#b7ff00]" checked={mostrarNombre} onChange={(e) => setMostrarNombre(e.target.checked)} />
    </label>

    <div className="mt-5 flex justify-end gap-2">
      <button type="button" className="subtle-button" disabled={busy || cargando} onClick={() => void descargar()}><Download size={16} /> Descargar</button>
      <button type="button" className="primary-button px-5" disabled={busy || cargando} onClick={() => void compartir()}><Share2 size={16} /> Compartir</button>
    </div>
  </Modal>
}
