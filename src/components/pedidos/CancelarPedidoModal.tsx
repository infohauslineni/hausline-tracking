import { AlertTriangle, MessageCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { MOTIVOS_CANCELACION, MOTIVO_CANCELACION_RAZON, POLITICA_DEVOLUCION, mensajeWhatsAppCancelacion, type MotivoCancelacion } from '../../constants/orders'
import { isSupabaseConfigured } from '../../lib/supabase'
import { obtenerTipoCambio, registrarReembolso } from '../../services/comercial.service'
import { cancelarPedido, enviarCorreoCancelacion } from '../../services/pedidos.service'
import { linkDatosReembolso, mensajeWhatsAppPedirCuenta, pedirDatosReembolso } from '../../services/reembolsos.service'
import type { Pedido } from '../../types/domain'
import { whatsappUrl } from '../../utils/whatsapp'
import { CuentaSelect, type DestinoPago } from '../finanzas/CuentaSelect'
import { Modal } from '../ui/Modal'

// Modal para cancelar un pedido eligiendo el motivo. Si el motivo es "paquete no
// entregado / pérdida", ofrece registrar la devolución del dinero al cliente (reembolso):
// sale de la caja y del saldo de la cuenta desde la que se devolvió.
export function CancelarPedidoModal({ pedido, open, onClose, onDone }: { pedido: Pedido; open: boolean; onClose: () => void; onDone: (updated: Pedido) => void }) {
  const [motivo, setMotivo] = useState<MotivoCancelacion>('no_disponible')
  const [reembolsar, setReembolsar] = useState(true)
  // Devolución: 'pedir' = se le pide la cuenta al cliente con un enlace (protocolo normal);
  // 'ya' = ya tengo sus datos / ya transferí → se registra la devolución ahora.
  const [modoDevolucion, setModoDevolucion] = useState<'pedir' | 'ya'>('pedir')
  const [tokenDatos, setTokenDatos] = useState<string | null>(null)
  const [monto, setMonto] = useState(0)
  const [metodo, setMetodo] = useState('Transferencia')
  const [destino, setDestino] = useState<DestinoPago>({ cuentaId: null, montoCuenta: 0 })
  const [tipoCambio, setTipoCambio] = useState(37)
  const [saving, setSaving] = useState(false)

  const abono = Math.max(0, Number(pedido.abono || 0))
  useEffect(() => {
    if (open) { setMotivo('no_disponible'); setReembolsar(true); setModoDevolucion('pedir'); setTokenDatos(null); setMonto(Number(abono.toFixed(2))); setMetodo('Transferencia'); setDestino({ cuentaId: null, montoCuenta: 0 }); if (isSupabaseConfigured) void obtenerTipoCambio().then(setTipoCambio).catch(() => undefined) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pedido.id])

  const info = MOTIVOS_CANCELACION.find((m) => m.value === motivo)
  const esDevolucion = !!info?.devolucion
  const devuelve = esDevolucion && reembolsar && monto > 0
  const haraReembolso = devuelve && modoDevolucion === 'ya'
  const pideCuenta = devuelve && modoDevolucion === 'pedir'

  const confirmar = async () => {
    if (haraReembolso && !destino.cuentaId) return toast.error('Elegí de qué cuenta sale la devolución.')
    if (tokenDatos) { onClose(); return }
    setSaving(true)
    try {
      if (isSupabaseConfigured) {
        // Primero lo de la devolución (así el correo automático de "Cancelado" ya la incluye).
        let token: string | null = null
        if (pideCuenta) token = await pedirDatosReembolso(pedido.id, monto, motivo)
        if (haraReembolso) {
          await registrarReembolso({ pedido_id: pedido.id, cliente_id: pedido.cliente_id, codigo: pedido.codigo, fecha: new Date().toISOString().slice(0, 10), monto, metodo_pago: metodo || null, observaciones: `Devolución por cancelación (${motivo}) · ${pedido.codigo}` }, destino)
        }
        const updated = await cancelarPedido(pedido.id, motivo)
        onDone({ ...pedido, ...updated })
        // El correo sale solo al cancelar; esto lo confirma (no se manda dos veces) y avisa si falló.
        try {
          await enviarCorreoCancelacion(pedido.codigo, { motivo, monto: devuelve ? monto : 0 })
          toast.success(pideCuenta ? 'Pedido cancelado. Le enviamos el correo pidiéndole su cuenta para la devolución.' : haraReembolso ? `Pedido cancelado, devolución de US$ ${monto.toFixed(2)} registrada y correo enviado al cliente.` : 'Pedido cancelado y correo enviado al cliente.', { duration: 8000 })
        } catch (mailError) {
          toast.warning(mailError instanceof Error ? `Pedido cancelado, pero el correo no se envió: ${mailError.message}` : 'Pedido cancelado, pero el correo no se envió.', { duration: 12000 })
        }
        if (token) { setTokenDatos(token); setSaving(false); return }
      } else {
        onDone({ ...pedido, estado: 'cancelado', motivo_cancelacion: motivo, updated_at: new Date().toISOString() })
        toast.success(haraReembolso ? `Pedido cancelado y devolución de US$ ${monto.toFixed(2)} registrada.` : 'Pedido cancelado.')
      }
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cancelar el pedido.')
    } finally { setSaving(false) }
  }

  return <Modal open={open} onClose={onClose} title={`Cancelar pedido ${pedido.codigo}`} description="El pedido queda como “Cancelado” y al cliente le llega un correo automático con el motivo. Elegí el motivo.">
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
          {reembolsar && <>
            <div className="mt-4 grid gap-2">
              <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${modoDevolucion === 'pedir' ? 'border-accent/50 bg-accent/[.06]' : 'border-line'}`}><input type="radio" className="mt-0.5 accent-accent" checked={modoDevolucion === 'pedir'} onChange={() => setModoDevolucion('pedir')} /><span className="flex flex-col"><span className="text-sm font-medium text-white">Pedirle su número de cuenta (recomendado)</span><span className="text-[11px] text-muted">Le llega un correo con un enlace para mandar banco, número de cuenta y titular. Queda en Reembolsos y cuando la mande transferís desde ahí.</span></span></label>
              <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${modoDevolucion === 'ya' ? 'border-accent/50 bg-accent/[.06]' : 'border-line'}`}><input type="radio" className="mt-0.5 accent-accent" checked={modoDevolucion === 'ya'} onChange={() => setModoDevolucion('ya')} /><span className="flex flex-col"><span className="text-sm font-medium text-white">Ya le devolví / ya tengo su cuenta</span><span className="text-[11px] text-muted">Registra la devolución ahora (sale de la caja y de la cuenta que elijas).</span></span></label>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="form-field"><span>Monto a devolver (US$)</span><input type="number" min="0" step=".01" value={monto} onChange={(e) => setMonto(Number(e.target.value))} /></label>
              {modoDevolucion === 'ya' && <><label className="form-field"><span>Método</span><input value={metodo} onChange={(e) => setMetodo(e.target.value)} /></label>
              <CuentaSelect requerido montoUsd={monto} tipoCambio={tipoCambio} value={destino} onChange={setDestino} modo="resta" /></>}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-red-100/70">Al cliente se le avisa que {POLITICA_DEVOLUCION.charAt(0).toLowerCase() + POLITICA_DEVOLUCION.slice(1)}</p>
          </>}
        </div>
      )}

      {tokenDatos && <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/[.06] p-4 text-sm">
        <p className="font-semibold text-emerald-200">Pedido cancelado. Falta que el cliente mande su cuenta.</p>
        <p className="mt-1 text-xs text-muted">Le llegó el correo con el enlace. Mandáselo también por WhatsApp para que lo vea rápido. Cuando lo llene, te llega un aviso y aparece en Reembolsos para transferir.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {pedido.clientes?.whatsapp && <a className="primary-button min-h-9 px-3 text-xs" href={whatsappUrl(pedido.clientes.whatsapp, mensajeWhatsAppPedirCuenta({ nombre: pedido.clientes?.nombre, codigo: pedido.codigo, monto, razon: MOTIVO_CANCELACION_RAZON[motivo] ?? MOTIVO_CANCELACION_RAZON.otro, token: tokenDatos }))} target="_blank" rel="noreferrer"><MessageCircle size={14} /> Pedirle la cuenta por WhatsApp</a>}
          <button type="button" className="subtle-button min-h-9 px-3 text-xs" onClick={() => { void navigator.clipboard?.writeText(linkDatosReembolso(tokenDatos)).then(() => toast.success('Enlace copiado.')) }}>Copiar enlace</button>
        </div>
      </div>}
      {!tokenDatos && pedido.clientes?.whatsapp && !pideCuenta && (
        <a className="inline-flex items-center gap-2 text-xs text-accent hover:underline" href={whatsappUrl(pedido.clientes.whatsapp, mensajeWhatsAppCancelacion({ nombre: pedido.clientes?.nombre, codigo: pedido.codigo, motivo, monto: haraReembolso ? monto : 0 }))} target="_blank" rel="noreferrer"><MessageCircle size={14} /> Avisar la cancelación al cliente por WhatsApp</a>
      )}

      {!tokenDatos && <div className="flex items-center gap-2 rounded-xl border border-line bg-white/[.02] p-3 text-xs text-muted"><AlertTriangle size={15} className="shrink-0 text-amber-300" /> Al confirmar, se le envía al cliente el correo de cancelación. Podés reactivar el pedido desde su detalle si hace falta.</div>}

      <div className="flex justify-end gap-2">{!tokenDatos && <button className="subtle-button" onClick={onClose}>No cancelar</button>}<button className="primary-button px-5" disabled={saving} onClick={() => void confirmar()}>{saving ? 'Guardando…' : tokenDatos ? 'Listo' : pideCuenta ? 'Cancelar y pedir su cuenta' : haraReembolso ? 'Cancelar y devolver' : 'Cancelar pedido'}</button></div>
    </div>
  </Modal>
}
