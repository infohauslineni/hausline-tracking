import { Download, FileText, MessageCircle } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Modal } from '../ui/Modal'
import { descargarFacturaPdf, enviarFacturaWhatsApp, type FacturaData } from '../../services/factura.service'

type FacturaModalProps = {
  factura: FacturaData | null
  onClose: () => void
  title?: string
  description?: string
  codeLabel?: string
  note?: string
  closeLabel?: string
}

// Modal para enviar/descargar la factura de compra o el comprobante de pago.
// Reutilizado al registrar un pedido y al confirmar la entrega con su cobro.
export function FacturaModal({ factura, onClose, title, description, codeLabel, note, closeLabel }: FacturaModalProps) {
  const [busy, setBusy] = useState<'wa' | 'pdf' | null>(null)
  if (!factura) return null
  const esPago = factura.variante === 'pago'
  const documento = esPago ? 'comprobante' : 'factura'
  const enviar = async () => {
    setBusy('wa')
    try {
      const result = await enviarFacturaWhatsApp(factura)
      toast.success(result === 'shared' ? `${esPago ? 'Comprobante' : 'Factura'} compartido.` : result === 'cancelled' ? 'Envío cancelado.' : result === 'downloaded_no_whatsapp' ? `${esPago ? 'Comprobante' : 'Factura'} descargado (el cliente no tiene WhatsApp).` : `${esPago ? 'Comprobante' : 'Factura'} descargado y chat de WhatsApp abierto.`)
    } catch { toast.error(`No se pudo enviar la ${documento}.`) }
    finally { setBusy(null) }
  }
  const descargar = async () => {
    setBusy('pdf')
    try { await descargarFacturaPdf(factura); toast.success(`${esPago ? 'Comprobante' : 'Factura'} PDF descargado.`) }
    catch { toast.error('No se pudo generar el PDF.') }
    finally { setBusy(null) }
  }
  return <Modal open={Boolean(factura)} onClose={onClose} title={title ?? 'Pedido creado'} description={description ?? 'Envía la factura al cliente junto con su código de seguimiento.'}>
    <div className="space-y-4">
      <div className="rounded-2xl border border-accent/25 bg-accent/[.05] p-5 text-center">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">{codeLabel ?? 'Código de compra'}</p>
        <strong className="mt-1 block text-3xl font-black tracking-tight text-accent">{factura.codigo}</strong>
        <p className="mt-2 text-xs text-muted">{factura.cliente} · Total USD {factura.total.toFixed(2)} · {esPago ? 'PAGADO' : `Saldo USD ${Math.max(0, factura.saldo).toFixed(2)}`}</p>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <button type="button" className="primary-button" disabled={busy !== null} onClick={() => void enviar()}><MessageCircle size={17} /> {busy === 'wa' ? 'Preparando…' : 'Enviar por WhatsApp'}</button>
        <button type="button" className="subtle-button justify-center py-3" disabled={busy !== null} onClick={() => void descargar()}><Download size={16} /> {busy === 'pdf' ? 'Generando…' : 'Descargar PDF'}</button>
      </div>
      <div className="flex items-center gap-2 rounded-xl border border-line bg-white/[.02] p-3 text-[11px] leading-5 text-muted"><FileText size={22} className="shrink-0 text-muted" /> {note ?? 'La factura incluye el detalle del pedido, los totales y el código para rastrear. La imagen es ideal para WhatsApp y el PDF para archivarlo.'}</div>
      <button type="button" className="subtle-button w-full justify-center py-3" onClick={onClose}>{closeLabel ?? 'Ir a pedidos'}</button>
    </div>
  </Modal>
}
