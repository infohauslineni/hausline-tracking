import { useEffect, useState } from 'react'
import { isSupabaseConfigured } from '../../lib/supabase'
import { cuentaParaGanancia, obtenerBaseGanancia, resumenGanancia, type BaseGanancia } from '../../services/miGanancia.service'
import type { Pedido } from '../../types/domain'
import { repartoPedido } from '../../utils/reparto'
import { Modal } from '../ui/Modal'

// Se abre al registrar el pago o la entrega de un pedido: cuánto deja ESTE pedido, cuánto se
// queda el negocio, cuánto se guarda en el fondo de gastos fijos y cuánto es del dueño; y cómo
// va su ganancia acumulada (solo pedidos ya entregados desde la fecha de arranque).

const usd = (n: number) => `US$ ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fechaCorta = (iso: string) => new Intl.DateTimeFormat('es-NI', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`))
const nombreMes = (mes: string) => new Intl.DateTimeFormat('es-NI', { month: 'long', timeZone: 'UTC' }).format(new Date(`${mes}-01T00:00:00Z`))

export function GananciaPedidoModal({ open, pedido, onClose }: { open: boolean; pedido: Pedido | null; onClose: () => void }) {
  const [base, setBase] = useState<BaseGanancia | null>(null)
  useEffect(() => {
    if (!open || !pedido || !isSupabaseConfigured) return
    let vivo = true
    void obtenerBaseGanancia(pedido.id).then((b) => { if (vivo) setBase(b) }).catch(() => undefined)
    return () => { vivo = false }
  }, [open, pedido])
  if (!open || !pedido) return null

  const pct = base?.pct ?? 30
  const r = repartoPedido(pedido, pct)
  const entregado = pedido.estado === 'entregado'
  const cuenta = base ? cuentaParaGanancia(pedido, base.desde) && !r.pendiente : false
  // Antes y después de sumar ESTE pedido (con sus datos frescos): la diferencia es lo que aporta al fondo.
  const antes = base ? resumenGanancia(base) : null
  const total = base ? resumenGanancia(cuenta ? { ...base, ganado: base.ganado + r.tuyoYa, negocio: base.negocio + r.negocioYa, pedidos: base.pedidos + 1 } : base) : null
  const alFondoNegocio = antes && total ? Math.max(0, total.apartadoNegocio - antes.apartadoNegocio) : 0
  const alFondoDueno = antes && total ? Math.max(0, total.apartadoDueno - antes.apartadoDueno) : 0
  const alFondo = alFondoNegocio + alFondoDueno

  const nota = r.pendiente ? 'A este pedido le falta el costo. Registralo (pago al proveedor o costo del producto) para poder calcular la ganancia.'
    : r.ganancia <= 0 ? 'Este pedido no deja ganancia: lo que costó es igual o mayor a la venta.'
      : !entregado ? 'Todavía no es ganancia real: se suma a tu ganancia cuando marqués el pedido como Entregado.'
        : !base ? ''
          : !cuenta ? `Se entregó antes del ${fechaCorta(base.desde)}: no entra en tu ganancia acumulada, que empieza a contar desde esa fecha.`
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
        {alFondo > 0.005 && <p className="mt-2 border-t border-white/10 pt-2 text-xs leading-5 text-muted">De este pedido se guardan <b className="text-white">{usd(alFondo)}</b> en el fondo de gastos fijos{alFondoNegocio > 0.005 && alFondoDueno > 0.005 ? <> ({usd(alFondoNegocio)} de lo del negocio y {usd(alFondoDueno)} de lo tuyo)</> : alFondoDueno > 0.005 ? ' (de lo tuyo)' : ' (de lo del negocio)'}.{alFondoDueno > 0.005 && <> Te quedan libres <b className="text-white">{usd(r.tuyoYa - alFondoDueno)}</b>.</>}</p>}
      </div>
    </div>}
    {nota && <p className={`mt-3 text-xs leading-5 ${r.pendiente || r.ganancia <= 0 ? 'text-amber-200' : 'text-muted'}`}>{nota}</p>}

    {total && <div className="mt-5 rounded-xl border border-line bg-white/[.02] p-4 text-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Tu ganancia acumulada · desde el {fechaCorta(total.desde)}</p>
      <div className="mt-3 space-y-2">
        <Linea label={`Ganado en ${total.pedidos} ${total.pedidos === 1 ? 'pedido entregado' : 'pedidos entregados'}`} valor={usd(total.ganado)} />
        {total.gastado > 0.005 && <Linea label="Gastos que tomaste de tu ganancia" valor={`− ${usd(total.gastado)}`} />}
        {total.retirado > 0.005 && <Linea label="Retiros de Mi cuenta" valor={`− ${usd(total.retirado)}`} />}
        {total.apartadoDueno > 0.005 && <Linea label="Guardado para tus gastos fijos" valor={`− ${usd(total.apartadoDueno)}`} />}
        <div className="border-t border-line pt-2"><Linea label="Te queda disponible" valor={usd(total.disponible)} fuerte /></div>
      </div>
    </div>}

    {total && total.metaMes > 0.005 && <div className="mt-3 rounded-xl border border-line bg-white/[.02] p-4 text-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Fondo de gastos fijos · {nombreMes(total.mes)}</p>
      <div className="mt-3 space-y-2">
        <Linea label="Gastos fijos del mes" valor={usd(total.metaMes)} />
        {total.pagadoMes > 0.005 && <Linea label="Ya pagados" valor={`− ${usd(total.pagadoMes)}`} />}
        <div className="border-t border-line pt-2"><Linea label="Guardado para lo que falta pagar" valor={`${usd(total.apartado)} de ${usd(total.pendienteNegocio + total.pendienteDueno)}`} fuerte /></div>
        <Linea label="Le queda al negocio para funcionar" valor={usd(total.negocioLibre)} />
      </div>
      {total.faltaApartar > 0.005 && <p className="mt-2 text-xs leading-5 text-amber-200">Faltan {usd(total.faltaApartar)} por guardar: se completan solos con los próximos pedidos entregados.</p>}
    </div>}
    <div className="mt-5 flex justify-end"><button className="primary-button px-6" onClick={onClose}>Listo</button></div>
  </Modal>
}

function Linea({ label, valor, fuerte }: { label: string; valor: string; fuerte?: boolean }) {
  return <div className="flex items-baseline justify-between gap-3"><span className="text-muted">{label}</span><strong className={`tabular-nums ${fuerte ? 'text-base text-white' : 'font-medium text-white/90'}`}>{valor}</strong></div>
}
