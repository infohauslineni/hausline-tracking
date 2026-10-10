import { useEffect, useState } from 'react'
import { isSupabaseConfigured } from '../../lib/supabase'
import { cuentaParaGanancia, obtenerMiGanancia, type MiGanancia } from '../../services/miGanancia.service'
import type { Pedido } from '../../types/domain'
import { repartoPedido } from '../../utils/reparto'
import { Modal } from '../ui/Modal'

// Se abre al registrar el pago o la entrega de un pedido: cuánto deja ESTE pedido, cuánto se
// queda el negocio y cuánto es del dueño; y cómo va su ganancia acumulada (solo pedidos ya
// entregados desde la fecha de arranque, menos los gastos que tomó de su ganancia y retiros).

const usd = (n: number) => `US$ ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fechaCorta = (iso: string) => new Intl.DateTimeFormat('es-NI', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`))

export function GananciaPedidoModal({ open, pedido, onClose }: { open: boolean; pedido: Pedido | null; onClose: () => void }) {
  const [acumulado, setAcumulado] = useState<MiGanancia | null>(null)
  useEffect(() => {
    if (!open || !pedido || !isSupabaseConfigured) return
    let vivo = true
    void obtenerMiGanancia(pedido.id).then((m) => { if (vivo) setAcumulado(m) }).catch(() => undefined)
    return () => { vivo = false }
  }, [open, pedido])
  if (!open || !pedido) return null

  const pct = acumulado?.pct ?? 30
  const r = repartoPedido(pedido, pct)
  const entregado = pedido.estado === 'entregado'
  const cuenta = acumulado ? cuentaParaGanancia(pedido, acumulado.desde) : false
  // El pedido de esta pantalla se suma con sus datos frescos (la lista puede venir de caché).
  const ganado = (acumulado?.ganado ?? 0) + (cuenta && !r.pendiente ? r.tuyoYa : 0)
  const disponible = ganado - (acumulado?.gastado ?? 0) - (acumulado?.retirado ?? 0)
  const cuantos = (acumulado?.pedidos ?? 0) + (cuenta && !r.pendiente ? 1 : 0)

  const nota = r.pendiente ? 'A este pedido le falta el costo. Registralo (pago al proveedor o costo del producto) para poder calcular la ganancia.'
    : r.ganancia <= 0 ? 'Este pedido no deja ganancia: lo que costó es igual o mayor a la venta.'
      : !entregado ? 'Todavía no es ganancia real: se suma a tu ganancia cuando marqués el pedido como Entregado.'
        : !acumulado ? ''
          : !cuenta ? `Se entregó antes del ${fechaCorta(acumulado.desde)}: no entra en tu ganancia acumulada, que empieza a contar desde esa fecha.`
            : !r.completo ? `Con lo cobrado hasta hoy entran ${usd(r.tuyoYa)}. El resto se suma cuando pague el saldo.`
              : 'Ya se sumó a tu ganancia.'

  return <Modal open onClose={onClose} title="Ganancia de este pedido" description={`${pedido.codigo}${pedido.clientes?.nombre ? ` · ${pedido.clientes.nombre}` : ''}`}>
    {!r.pendiente && r.ganancia > 0 && <div className="space-y-2.5 text-sm">
      <Linea label="Venta" valor={usd(r.venta)} />
      <Linea label="Costo real del pedido" valor={`− ${usd(r.costo)}`} />
      <div className="border-t border-line pt-2.5"><Linea label="Ganancia neta" valor={usd(r.ganancia)} fuerte /></div>
      <Linea label={`Se queda en el negocio (${pct}%)`} valor={`− ${usd(r.negocio)}`} />
      <div className="rounded-xl border border-white/15 bg-white/[.04] p-4">
        <span className="text-xs text-muted">Tu ganancia de este pedido</span>
        <strong className="font-display mt-1 block text-4xl font-extrabold tracking-tight tabular-nums text-white">{usd(r.tuyo)}</strong>
      </div>
    </div>}
    {nota && <p className={`mt-3 text-xs leading-5 ${r.pendiente || r.ganancia <= 0 ? 'text-amber-200' : 'text-muted'}`}>{nota}</p>}

    {acumulado && <div className="mt-5 rounded-xl border border-line bg-white/[.02] p-4 text-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Tu ganancia acumulada · desde el {fechaCorta(acumulado.desde)}</p>
      <div className="mt-3 space-y-2">
        <Linea label={`Ganado en ${cuantos} ${cuantos === 1 ? 'pedido entregado' : 'pedidos entregados'}`} valor={usd(ganado)} />
        {acumulado.gastado > 0.005 && <Linea label="Gastos que tomaste de tu ganancia" valor={`− ${usd(acumulado.gastado)}`} />}
        {acumulado.retirado > 0.005 && <Linea label="Retiros de Mi cuenta" valor={`− ${usd(acumulado.retirado)}`} />}
        <div className="border-t border-line pt-2"><Linea label="Te queda disponible" valor={usd(disponible)} fuerte /></div>
      </div>
    </div>}
    <div className="mt-5 flex justify-end"><button className="primary-button px-6" onClick={onClose}>Listo</button></div>
  </Modal>
}

function Linea({ label, valor, fuerte }: { label: string; valor: string; fuerte?: boolean }) {
  return <div className="flex items-baseline justify-between gap-3"><span className="text-muted">{label}</span><strong className={`tabular-nums ${fuerte ? 'text-base text-white' : 'font-medium text-white/90'}`}>{valor}</strong></div>
}
