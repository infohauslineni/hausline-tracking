import { Check, Copy, Download, MessageCircle, Package, Share2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { isSupabaseConfigured } from '../../lib/supabase'
import { marcarEnListaProveedor } from '../../services/pedidos.service'
import type { Pedido } from '../../types/domain'
import { resolverImagenCatalogo } from '../../utils/catalogoImagen'
import { generarHojasProveedor, lineasDeCompra, mensajeListaProveedor, urlProveedor, yaEnListaProveedor } from '../../utils/listaProveedor'
import { Modal } from '../ui/Modal'

// Lista de compra para el proveedor: todos los productos de los pedidos confirmados que todavía
// no se han comprado, en un solo mensaje y en hojas con la foto de cada producto.
export function ListaCompraModal({ open, pedidos, onClose, onMarcados }: { open: boolean; pedidos: Pedido[]; onClose: () => void; onMarcados: (ids: string[], notas: Map<string, string | null>) => void }) {
  const [verEnviados, setVerEnviados] = useState(false)
  const [fuera, setFuera] = useState<Set<string>>(new Set()) // renglones que se quitaron de esta lista
  const [trabajando, setTrabajando] = useState<'hojas' | 'marcar' | null>(null)
  useEffect(() => { if (open) void Promise.resolve().then(() => setFuera(new Set())) }, [open])

  const confirmados = useMemo(() => pedidos.filter((p) => p.estado === 'pedido_confirmado'), [pedidos])
  const yaEnviados = confirmados.filter(yaEnListaProveedor).length
  const todas = useMemo(() => lineasDeCompra(verEnviados ? confirmados : confirmados.filter((p) => !yaEnListaProveedor(p))), [confirmados, verEnviados])
  const lineas = todas.filter((l) => !fuera.has(l.clave))
  const mensaje = mensajeListaProveedor(lineas)
  const unidades = lineas.reduce((s, l) => s + l.cantidad, 0)
  const pedidosIncluidos = [...new Set(lineas.map((l) => l.pedidoId))]
  const alternar = (clave: string) => setFuera((cur) => { const s = new Set(cur); if (s.has(clave)) s.delete(clave); else s.add(clave); return s })

  const copiar = async () => { try { await navigator.clipboard.writeText(mensaje); toast.success('Mensaje copiado. Pegalo en el chat del proveedor.') } catch { toast.error('No se pudo copiar.') } }
  // Hojas con las fotos: en el teléfono se comparten directo a WhatsApp; en la PC se descargan.
  const hojas = async (compartir: boolean) => {
    setTrabajando('hojas')
    try {
      const blobs = await generarHojasProveedor(lineas)
      const fecha = new Date().toISOString().slice(0, 10)
      const archivos = blobs.map((b, i) => new File([b], `lista-proveedor-${fecha}-${i + 1}.jpg`, { type: 'image/jpeg' }))
      if (compartir && navigator.canShare?.({ files: archivos })) { await navigator.share({ files: archivos, text: mensaje }); return }
      for (const f of archivos) { const url = URL.createObjectURL(f); const a = document.createElement('a'); a.href = url; a.download = f.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 4000) }
      toast.success(`${archivos.length} ${archivos.length === 1 ? 'hoja descargada' : 'hojas descargadas'} con las fotos. Adjuntalas en el chat del proveedor.`)
    } catch (e) { if (!(e instanceof DOMException && e.name === 'AbortError')) toast.error('No se pudieron generar las hojas.') }
    finally { setTrabajando(null) }
  }
  const marcar = async () => {
    setTrabajando('marcar')
    try {
      const incluidos = confirmados.filter((p) => pedidosIncluidos.includes(p.id))
      const notas = isSupabaseConfigured ? await marcarEnListaProveedor(incluidos, true) : new Map<string, string | null>()
      onMarcados(pedidosIncluidos, notas)
      toast.success(`${pedidosIncluidos.length} ${pedidosIncluidos.length === 1 ? 'pedido marcado' : 'pedidos marcados'} como ya pedidos al proveedor. No salen en la próxima lista.`)
      onClose()
    } catch { toast.error('No se pudo marcar.') } finally { setTrabajando(null) }
  }
  const puedeCompartir = typeof navigator !== 'undefined' && typeof navigator.share === 'function' && /Android|iPhone|iPad/i.test(navigator.userAgent)

  return <Modal open={open} onClose={onClose} title="Lista de compra para el proveedor" description="Los pedidos en “Orden confirmada” que todavía no le has pedido al proveedor, juntos en un solo mensaje y con la foto de cada producto.">
    {!todas.length ? <div className="grid place-items-center rounded-xl border border-dashed border-line px-5 py-10 text-center"><Check size={26} className="text-accent" /><p className="mt-2 text-sm font-semibold">No hay nada por pedir</p><p className="mt-1 text-xs text-muted">{yaEnviados ? `Los ${yaEnviados} pedidos confirmados ya están en una lista enviada.` : 'No hay pedidos en “Orden confirmada”.'}</p>{yaEnviados > 0 && !verEnviados && <button className="subtle-button mt-3" onClick={() => setVerEnviados(true)}>Ver los ya enviados</button>}</div> : <>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span><b className="text-white">{unidades}</b> {unidades === 1 ? 'producto' : 'productos'} de <b className="text-white">{pedidosIncluidos.length}</b> {pedidosIncluidos.length === 1 ? 'pedido' : 'pedidos'}</span>
        {yaEnviados > 0 && <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" className="size-4 accent-accent" checked={verEnviados} onChange={(e) => setVerEnviados(e.target.checked)} /> Incluir {yaEnviados} ya enviados</label>}
      </div>
      <div className="mt-3 max-h-[42vh] space-y-2 overflow-y-auto pr-1">
        {todas.map((l) => { const dentro = !fuera.has(l.clave); return <label key={l.clave} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-2.5 transition ${dentro ? 'border-line bg-white/[.02]' : 'border-line opacity-45'}`}>
          <input type="checkbox" className="size-4 shrink-0 accent-accent" checked={dentro} onChange={() => alternar(l.clave)} />
          <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-white">{l.imagen ? <img src={resolverImagenCatalogo(l.imagen)} alt="" className="h-full w-full object-contain" loading="lazy" /> : <Package size={18} className="text-black/40" />}</span>
          <span className="min-w-0 flex-1"><strong className="block truncate text-sm">{l.codigo || l.producto} <span className="font-normal text-muted">· {l.talla}{l.cantidad > 1 ? ` · ${l.cantidad} unidades` : ''}</span></strong><span className="block truncate text-[11px] text-muted">{l.pedido}{l.cliente ? ` · ${l.cliente}` : ''}{l.codigo ? ` · ${l.producto}` : ''}{l.color ? ` · ${l.color}` : ''}</span></span>
        </label> })}
      </div>

      <details className="mt-3 rounded-xl border border-line bg-white/[.02] p-3 text-xs"><summary className="cursor-pointer font-semibold text-muted">Ver el mensaje</summary><pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-5 text-white/85">{mensaje}</pre></details>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <button className="primary-button" disabled={!lineas.length || trabajando !== null} onClick={() => void hojas(puedeCompartir)}>{puedeCompartir ? <Share2 size={16} /> : <Download size={16} />} {trabajando === 'hojas' ? 'Generando…' : puedeCompartir ? 'Compartir fotos y mensaje' : 'Descargar hojas con fotos'}</button>
        <button className="subtle-button" disabled={!lineas.length} onClick={() => void copiar()}><Copy size={15} /> Copiar mensaje</button>
        <a className={`subtle-button ${lineas.length ? '' : 'pointer-events-none opacity-50'}`} href={urlProveedor(mensaje)} target="_blank" rel="noopener noreferrer"><MessageCircle size={15} className="text-[#62eaa0]" /> Abrir WhatsApp del proveedor</a>
        <button className="subtle-button" disabled={!lineas.length || trabajando !== null} onClick={() => void marcar()}><Check size={15} /> {trabajando === 'marcar' ? 'Marcando…' : 'Ya se lo mandé (marcar)'}</button>
      </div>
      <p className="mt-2 text-[11px] leading-4 text-muted">WhatsApp no deja adjuntar fotos desde un enlace: {puedeCompartir ? 'usá “Compartir” y elegí el chat del proveedor.' : 'descargá las hojas y arrastralas al chat; el mensaje ya va escrito al abrir WhatsApp.'} Al marcar, esos pedidos no vuelven a salir en la lista (siguen en “Orden confirmada” hasta que registrés el pago al proveedor).</p>
    </>}
  </Modal>
}
