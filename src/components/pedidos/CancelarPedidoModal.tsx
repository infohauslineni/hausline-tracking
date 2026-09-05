import { AlertTriangle, MessageCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { MOTIVOS_CANCELACION, mensajeWhatsAppReembolso, type MotivoCancelacion } from '../../constants/orders'
import { isSupabaseConfigured } from '../../lib/supabase'
import { obtenerTipoCambio, registrarReembolso } from '../../services/comercial.service'
import { cancelarPedido } from '../../services/pedidos.service'
import type { Pedido } from '../../types/domain'
import { whatsappUrl } from '../../utils/whatsapp'
import { CuentaSelect, type DestinoPago } from '../finanzas/CuentaSelect'
import { Modal } from '../ui/Modal'

// Modal para cancelar un pedido eligiendo el motivo. Si el motivo es "paquete no
// entregado / pérdida", ofrece registrar la devolución del dinero al cliente (reembolso):
// sale de la caja y del saldo de la cuenta desde la que se devolvió.
export function CancelarPedidoModal({ pedido, open, onClose, onDone }: { pedido: Pedido; open: boolean; onClose: () => void; onDone: (updated: Pedido) => void }) {
  const [motivo, setMotivo] = useState<MotivoCancelacion>('no_entregado')
  const [reembolsar, setReembolsar] = useState(true)
  const [monto, setMonto] = useState(0)
  const [metodo, setMetodo] = useState('Transferencia')
  const [destino, setDestino] = useState<DestinoPago>({ cuentaId: null, montoCuenta: 0 })
  const [tipoCambio, setTipoCambio] = useState(37)
  const [saving, setSaving] = useState(false)

  const abono = Math.max(0, Number(pedido.abono || 0))
  useEffect(() => {
    if (open) { setMotivo('no_entregado'); setReembolsar(true); setMonto(Number(abono.toFixed(2))); setMetodo('Transferencia'); setDestino({ cuentaId: null, montoCuenta: 0 }); if (isSupabaseConfigured) void obtenerTipoCambio().then(setTipoCambio).catch(() => undefined) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pedido.id])

  const info = MOTIVOS_CANCELACION.find((m) => m.value === motivo)
  const esDevolucion = !!info?.devolucion
  const haraReembolso = esDevolucion && reembolsar && monto > 0

  const confirmar = async () => {
    if (haraReembolso && !destino.cuentaId) return toast.error('Elegí de qué cuenta sale la devolución.')
    setSaving(true)
    try {
      if (isSupabaseConfigured) {
        const updated = await cancelarPedido(pedido.id, motivo)
        if (haraReembolso) {
          await registrarReembolso({ pedido_id: pedido.id, cliente_id: pedido.cliente_id, codigo: pedido.codigo, fecha: new Date().toISOString().slice(0, 10), monto, metodo_pago: metodo || null, observaciones: `Devolución por paquete no entregado · ${pedido.codigo}` }, destino)
        }
        onDone({ ...pedido, ...updated })
      } else {
        onDone({ ...pedido, estado: 'cancelado', motivo_cancelacion: motivo, updated_at: new Date().toISOString() })
      }
      toast.success(haraReembolso ? `Pedido cancelado y devolución de US$ ${monto.toFixed(2)} registrada.` : 'Pedido cancelado.')
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cancelar el pedido.')
    } finally { setSaving(false) }
  }

  return <Modal open={open} onClose={onClose} title={`Cancelar pedido ${pedido.codigo}`} description="El pedido queda como “Cancelado” (no se le avisa al cliente automáticamente). Elegí el motivo.">
    <div className="space-y-4">
      <label className="form-field"><span>Motivo</span>
        <select value={motivo} onChange={(e) => setMotivo(e.target.value as MotivoCancelacion)}>{MOTIVOS_CANCELACION.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select>
      </label>

      {esDevolucion && (
        <div className="rounded-2xl border border-red-400/25 bg-red-400/[0.05] p-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-accent" checked={reembolsar} onChange={(e) => setReembolsar(e.target.checked)} />
            <span className="flex flex-col"><span className="text-sm font-medium text-red-100">Registrar la devolución del dinero</span><span className="text-[11px] text-red-100/70">El cliente pagó US$ {abono.toFixed(2)}. Se registra como reembolso (sale de la caja).</span></span>
          </label>
          {reembolsar && <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="form-field"><span>Monto a devolver (US$)</span><input type="number" min="0" step=".01" value={monto} onChange={(e) => setMonto(Number(e.target.value))} /></label>
            <label className="form-field"><span>Método</span><input value={metodo} onChange={(e) => setMetodo(e.target.value)} /></label>
            <CuentaSelect requerido montoUsd={monto} tipoCambio={tipoCambio} value={destino} onChange={setDestino} modo="resta" />
          </div>}
        </div>
      )}

      {haraReembolso && pedido.clientes?.whatsapp && (
        <a className="inline-flex items-center gap-2 text-xs text-accent hover:underline" href={whatsappUrl(pedido.clientes.whatsapp, mensajeWhatsAppReembolso({ nombre: pedido.clientes?.nombre, codigo: pedido.codigo, monto }))} target="_blank" rel="noreferrer"><MessageCircle size={14} /> Avisar la devolución al cliente por WhatsApp</a>
      )}

      <div className="flex items-center gap-2 rounded-xl border border-line bg-white/[.02] p-3 text-xs text-muted"><AlertTriangle size={15} className="shrink-0 text-amber-300" /> Podés reactivar el pedido desde su detalle si hace falta.</div>

      <div className="flex justify-end gap-2"><button className="subtle-button" onClick={onClose}>No cancelar</button><button className="primary-button px-5" disabled={saving} onClick={() => void confirmar()}>{saving ? 'Guardando…' : haraReembolso ? 'Cancelar y devolver' : 'Cancelar pedido'}</button></div>
    </div>
  </Modal>
}
