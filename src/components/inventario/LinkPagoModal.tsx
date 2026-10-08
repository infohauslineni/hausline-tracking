import { Copy, Link2, MessageCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { actualizarInversion, obtenerTipoCambio } from '../../services/comercial.service'
import { MARCA_LINK_PAGO } from '../../services/solicitudes.service'
import { datosTienda } from '../../services/ventaLibre.service'
import type { Inversion } from '../../types/domain'
import { cordobas } from '../../utils/fichaCliente'
import { whatsappUrl } from '../../utils/whatsapp'
import { Modal } from '../ui/Modal'

// "Enviar link de pago" de una compra libre que ya está en Nicaragua (entrega inmediata): arma
// el link del checkout de la tienda con ese producto y talla. El cliente pone sus datos, paga
// COMPLETO y sube su comprobante (o lo manda por WhatsApp). La compra queda marcada para que, al
// confirmar su encargo en Solicitudes, pase sola al pedido.
export function LinkPagoModal({ item, onClose, onMarcada }: { item: Inversion; onClose: () => void; onMarcada: (item: Inversion) => void }) {
  const codigo = (item.codigo ?? '').trim().toUpperCase()
  const [precio, setPrecio] = useState<number | null>(null)
  const [tallas, setTallas] = useState<string[]>([])
  const [talla, setTalla] = useState((item.talla_color ?? '').trim())
  const [tc, setTc] = useState(37)
  const [whatsapp, setWhatsapp] = useState('')
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let vivo = true
    void Promise.all([datosTienda(codigo, true).catch(() => ({ precio: null, tallas: [] as string[] })), obtenerTipoCambio().catch(() => 37)]).then(([d, t]) => {
      if (!vivo) return
      setPrecio(d.precio); setTallas(d.tallas); setTc(t)
      if (!(item.talla_color ?? '').trim() && d.tallas.length === 1) setTalla(d.tallas[0])
      setCargando(false)
    })
    return () => { vivo = false }
  }, [codigo, item.talla_color])

  const link = `https://hauslineshopni.es/checkout/?inmediata=${encodeURIComponent(codigo)}${talla ? `&talla=${encodeURIComponent(talla)}` : ''}`
  const mensaje = precio ? [
    `Buen día. Para comprar el ${item.producto}${talla ? ` en talla ${talla}` : ''}, solo complete sus datos y suba su comprobante en este enlace:`,
    link,
    `El precio es de $${precio} (${cordobas(precio, tc)}) y es compra inmediata: se cancela completo y se lo entregamos apenas confirmemos su pago. Si prefiere, también puede enviarme el comprobante por este chat.`,
  ].join('\n\n') : ''

  // Marca la compra (una sola vez) para reconocer el encargo del cliente al confirmarlo.
  async function marcar() {
    if ((item.notas ?? '').includes(MARCA_LINK_PAGO)) return
    try {
      const notas = `${(item.notas ?? '').trim()} ${MARCA_LINK_PAGO}`.trim()
      const nuevo = await actualizarInversion(item.id, { notas })
      onMarcada(nuevo)
    } catch { toast.error('No se pudo marcar la compra: igual podés mandar el link, pero al confirmar el encargo pasala a vendida a mano.') }
  }
  async function copiar(texto: string, que: string) {
    try { await navigator.clipboard.writeText(texto); toast.success(`${que} copiado`); void marcar() } catch { toast.error('No se pudo copiar') }
  }

  const sinPublicar = !cargando && !precio
  return <Modal open onClose={onClose} title="Enviar link de pago" description="Compra inmediata: el cliente pone sus datos, paga completo y sube su comprobante.">
    {cargando ? <p className="text-sm text-muted">Cargando el producto de la tienda…</p> : sinPublicar ? (
      <p className="rounded-xl border border-amber-300/30 bg-amber-300/[.07] p-3 text-sm leading-6 text-amber-200">Este producto no está publicado en la tienda con precio. Ponelo en Entrega inmediata (botón "Inmediata") y volvé a abrir esta ventana.</p>
    ) : <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-semibold text-muted">Talla
          {tallas.length > 1 && !(item.talla_color ?? '').trim()
            ? <select className="mt-1.5 w-full" value={talla} onChange={(e) => setTalla(e.target.value)}><option value="">Elegir talla…</option>{tallas.map((t) => <option key={t} value={t}>{t}</option>)}</select>
            : <input className="mt-1.5 w-full" value={talla} onChange={(e) => setTalla(e.target.value)} placeholder="Ej. 42 o M" />}
        </label>
        <label className="block text-xs font-semibold text-muted">WhatsApp del cliente (opcional)
          <input className="mt-1.5 w-full" type="tel" inputMode="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="8888 8888" />
        </label>
      </div>
      <div className="rounded-xl border border-line bg-white/[0.02] p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-muted">Precio (compra inmediata)</span><strong>${precio} <span className="font-normal text-muted">· {cordobas(precio!, tc)}</span></strong></div>
        <p className="mt-2 break-all font-mono text-[11px] text-accent">{link}</p>
      </div>
      <div className="rounded-xl border border-line">
        <div className="border-b border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Mensaje para WhatsApp</div>
        <p className="whitespace-pre-wrap px-3 py-2.5 text-xs leading-5 text-white/85">{mensaje}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {whatsapp.trim()
          ? <a className="primary-button justify-center py-2.5" style={{ fontSize: 13 }} href={whatsappUrl(whatsapp, mensaje)} target="_blank" rel="noopener noreferrer" onClick={() => void marcar()}><MessageCircle size={15} /> Abrir WhatsApp</a>
          : <button className="primary-button justify-center py-2.5" style={{ fontSize: 13 }} onClick={() => void copiar(mensaje, 'Mensaje')}><Copy size={15} /> Copiar mensaje</button>}
        {whatsapp.trim() && <button className="subtle-button justify-center py-2.5" style={{ fontSize: 13 }} onClick={() => void copiar(mensaje, 'Mensaje')}><Copy size={15} /> Copiar mensaje</button>}
        <button className="subtle-button justify-center py-2.5" style={{ fontSize: 13 }} onClick={() => void copiar(link, 'Link')}><Link2 size={15} /> Copiar link</button>
      </div>
      <p className="text-[11px] leading-5 text-muted">Cuando el cliente pague te llega como encargo en Solicitudes con la etiqueta "Entrega inmediata · compra libre". Al confirmarlo, esta compra pasa sola a su pedido y queda Pagado.</p>
    </div>}
  </Modal>
}
