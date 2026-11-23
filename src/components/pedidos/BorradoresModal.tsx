import { FileClock, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Modal } from '../ui/Modal'
import { eliminarBorrador, type BorradorPedido } from '../../services/borradoresPedido.service'

// Pedidos en borrador (esperando el depósito). "Abrir" lo carga en Nuevo pedido: desde ahí se le
// manda "Esperamos su pago" / la cotización y, cuando deposita, se registra el abono y se guarda.
const fecha = (iso: string) => new Intl.DateTimeFormat('es-NI', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))

export function BorradoresModal({ open, borradores, onClose, onCambio }: { open: boolean; borradores: BorradorPedido[]; onClose: () => void; onCambio: () => void }) {
  const navigate = useNavigate()
  const [borrando, setBorrando] = useState<string | null>(null)
  const quitar = async (b: BorradorPedido) => {
    if (!window.confirm(`¿Eliminar el borrador de ${b.clienteNombre}? No se puede deshacer.`)) return
    setBorrando(b.id)
    try { await eliminarBorrador(b.id); toast.success('Borrador eliminado.'); onCambio() } catch { toast.error('No se pudo eliminar.') } finally { setBorrando(null) }
  }
  return <Modal open={open} onClose={onClose} title="Pedidos en borrador" description="Esperando el depósito. No cuentan como venta: el pedido se crea con la fecha del día que registres el depósito.">
    {borradores.length === 0 ? <p className="rounded-xl border border-line p-4 text-sm text-muted">No hay borradores. En Nuevo pedido, “Guardar borrador” deja el pedido listo mientras el cliente deposita.</p>
      : <div className="divide-y divide-line rounded-xl border border-line">
        {borradores.map((b) => {
          const items = Array.isArray((b.valores as { items?: unknown[] }).items) ? ((b.valores as { items: { producto?: string; codigo_producto?: string; talla?: string }[] }).items) : []
          const resumen = items.map((i) => `${i.producto || i.codigo_producto || 'Producto'}${i.talla ? ` (${i.talla})` : ''}`).join(', ')
          return <div key={b.id} className="flex flex-wrap items-center gap-3 p-3">
            <FileClock size={18} className="shrink-0 text-amber-300" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{b.clienteNombre} <span className="font-normal text-muted">· US$ {b.total.toFixed(2)} · {b.pago === '50' ? '50 %' : '100 %'}</span></p>
              <p className="truncate text-xs text-muted">{resumen || 'Sin productos'} · {fecha(b.actualizado)}</p>
            </div>
            <div className="flex gap-2">
              <button type="button" className="primary-button px-3 text-sm" onClick={() => { onClose(); navigate(`/pedidos/nuevo?borrador=${encodeURIComponent(b.id)}`) }}>Abrir</button>
              <button type="button" className="table-action table-action-danger" aria-label={`Eliminar borrador de ${b.clienteNombre}`} disabled={borrando === b.id} onClick={() => void quitar(b)}><Trash2 size={15} /></button>
            </div>
          </div>
        })}
      </div>}
  </Modal>
}
