import { Camera, Send, Trash2, Upload } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Modal } from '../ui/Modal'
import { buscarPedidoPorCodigo, copiarFotosInversionAPedido, eliminarFotoInversion, listarFotosInversion, subirFotoInversion, type FotoInversion } from '../../services/archivos.service'
import type { Inversion } from '../../types/domain'

// Fotos de CONTROL DE CALIDAD de una compra libre (en camino o en stock). Se suben antes de que
// haya cliente; al apartarla desde aquí pasan solas al pedido. Si el cliente apartó desde la
// tienda (el pedido no quedó conectado), "Pasar a un pedido" las copia con el código HS.
export function FotosCompraModal({ item, onClose, onCambio }: { item: Inversion; onClose: () => void; onCambio: (n: number) => void }) {
  const [fotos, setFotos] = useState<FotoInversion[] | null>(null)
  const [subiendo, setSubiendo] = useState(0)
  const [codigo, setCodigo] = useState('')
  const [pasando, setPasando] = useState(false)

  useEffect(() => {
    let vivo = true
    void listarFotosInversion(item.id).then((f) => { if (vivo) setFotos(f) }).catch((e) => { if (vivo) { setFotos([]); toast.error(/archivos_inversion|schema cache/i.test(String(e?.message)) ? 'Falta aplicar la migración 202610030003.' : 'No se pudieron cargar las fotos.') } })
    return () => { vivo = false }
  }, [item.id])

  const subir = async (files: FileList | null) => {
    const lista = Array.from(files ?? [])
    if (!lista.length) return
    setSubiendo(lista.length)
    let nuevas: FotoInversion[] = []
    for (const file of lista) {
      try { nuevas = [...nuevas, await subirFotoInversion(item.id, file, item.codigo ?? undefined)] }
      catch (e) { toast.error(e instanceof Error ? e.message : `No se pudo subir ${file.name}.`) }
      setSubiendo((n) => n - 1)
    }
    if (nuevas.length) {
      const total = (fotos?.length ?? 0) + nuevas.length
      setFotos((f) => [...(f ?? []), ...nuevas]); onCambio(total)
      toast.success(nuevas.length === 1 ? 'Foto subida.' : `${nuevas.length} fotos subidas.`)
      // Si la compra ya está apartada en un pedido, las nuevas también le llegan al cliente.
      if (item.pedido_id) void copiarFotosInversionAPedido(item.id, item.pedido_id).catch(() => undefined)
    }
  }
  const borrar = async (f: FotoInversion) => {
    if (!window.confirm('¿Borrar esta foto?')) return
    try { await eliminarFotoInversion(f); const resto = (fotos ?? []).filter((x) => x.id !== f.id); setFotos(resto); onCambio(resto.length) }
    catch { toast.error('No se pudo borrar.') }
  }
  const pasar = async () => {
    const cod = codigo.trim().toUpperCase()
    if (!cod) return
    setPasando(true)
    try {
      const pedido = await buscarPedidoPorCodigo(cod)
      if (!pedido) { toast.error(`No encontré el pedido ${cod}.`); return }
      const n = await copiarFotosInversionAPedido(item.id, pedido.id)
      toast.success(n ? `${n} ${n === 1 ? 'foto pasó' : 'fotos pasaron'} al pedido ${pedido.codigo}: ya las ve el cliente en su seguimiento.` : `El pedido ${pedido.codigo} ya tenía estas fotos.`)
      setCodigo('')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudieron pasar las fotos.') }
    finally { setPasando(false) }
  }

  return <Modal open onClose={onClose} title="Control de calidad" description={`${item.producto}${item.talla_color ? ` · ${item.talla_color}` : ''} — si un cliente la aparta, estas fotos le salen en su seguimiento.`}>
    <div className="space-y-4 text-sm">
      {fotos === null ? <div className="h-32 animate-pulse rounded-xl border border-line bg-white/[.02]" />
        : fotos.length ? <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {fotos.map((f) => <div key={f.id} className="group relative overflow-hidden rounded-xl border border-line bg-white/[.03]">
            <a href={f.signed_url} target="_blank" rel="noreferrer"><img src={f.signed_url} alt="Control de calidad" className="aspect-square w-full object-cover" /></a>
            <button className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-lg bg-black/70 text-red-300 hover:bg-black" onClick={() => void borrar(f)} aria-label="Borrar foto" title="Borrar foto"><Trash2 size={14} /></button>
          </div>)}
        </div>
        : <p className="flex items-center gap-2 rounded-xl border border-dashed border-line p-4 text-xs text-muted"><Camera size={16} /> Todavía no hay fotos de control de calidad de esta compra.</p>}

      <label className={`primary-button w-full cursor-pointer justify-center ${subiendo ? 'pointer-events-none opacity-60' : ''}`}>
        <Upload size={16} /> {subiendo ? `Subiendo… (${subiendo})` : 'Subir fotos de control de calidad'}
        <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { void subir(e.target.files); e.target.value = '' }} />
      </label>
      <p className="text-[11px] leading-4 text-muted">Llevan la marca de agua de HAUSLINE como las de los pedidos. {item.pedido_id ? 'Esta compra ya está en un pedido: las fotos nuevas también le llegan al cliente.' : 'Al tocar "Apartar a un cliente" pasan solas al pedido nuevo.'}</p>

      {(fotos?.length ?? 0) > 0 && <div className="rounded-xl border border-line bg-white/[.02] p-3">
        <p className="text-xs font-semibold">¿El cliente la apartó desde la tienda?</p>
        <p className="mt-0.5 text-[11px] text-muted">Pegá el código del pedido y las fotos pasan a su seguimiento.</p>
        <div className="mt-2 flex gap-2">
          <input className="simple-input" placeholder="HS000123" value={codigo} onChange={(e) => setCodigo(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void pasar() }} />
          <button className="subtle-button shrink-0 px-4" disabled={pasando || !codigo.trim()} onClick={() => void pasar()}><Send size={15} /> {pasando ? 'Pasando…' : 'Pasar'}</button>
        </div>
      </div>}
    </div>
  </Modal>
}
