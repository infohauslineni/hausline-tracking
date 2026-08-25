import { ArrowDownRight, ArrowUpRight, CalendarRange, Pencil, ReceiptText, Sparkles, Trash2, Wallet } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Modal } from '../../components/ui/Modal'
import { MoneyField } from '../../components/ui/MoneyField'
import { eliminarGasto, eliminarMovimiento, guardarAperturaCaja, listarInversiones, listarMovimientos, listarProveedores, obtenerCajaMes, obtenerResumenComercial, obtenerTipoCambio, registrarMovimiento } from '../../services/comercial.service'
import { listarPedidos } from '../../services/pedidos.service'
import type { CajaMes, Inversion, Moneda, MovimientoCuenta, Pedido, Proveedor, ResumenComercial } from '../../types/domain'
import { aUsd, formatMoneda } from '../../utils/money'
import { periodoDeMes } from '../../utils/periodo'
import { GastoModal } from './GastosPage'
import { Actions, Empty, Field, formatDate, PageHeader } from './PagosPage'

const zero: ResumenComercial = { ventas: 0, cobrado: 0, por_cobrar: 0, gastos: 0, costos_productos: 0, saldo_cuenta: 0, pedidos: 0 }
const zeroCaja: CajaMes = { periodo: '', sugerido: 0, apertura: null, opening: 0, movimientos_mes: 0, saldo_mes: 0, confirmada: false }
const mesActualStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const mesLabel = (ym: string) => { const [y, m] = ym.split('-').map(Number); if (!y || !m) return ym; return new Intl.DateTimeFormat('es-NI', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1)) }
const capitalizar = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

export function CuentaPage() {
  const [mes, setMes] = useState(mesActualStr())
  const periodo = useMemo(() => { const [y, m] = mes.split('-').map(Number); return periodoDeMes(new Date(y, m - 1, 1)) }, [mes])
  const [items, setItems] = useState<MovimientoCuenta[]>([])
  const [summary, setSummary] = useState(zero)
  const [caja, setCaja] = useState(zeroCaja)
  const [tipoCambio, setTipoCambio] = useState(37)
  const [open, setOpen] = useState(false)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [aperturaOpen, setAperturaOpen] = useState(false)
  // Datos para registrar un gasto desde aquí (mismo modal completo que la sección Gastos).
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [stock, setStock] = useState<Inversion[]>([])
  const [providers, setProviders] = useState<Proveedor[]>([])
  const [gastoOpen, setGastoOpen] = useState(false)

  // Meses con movimientos (del más nuevo al más viejo); siempre incluye el mes actual y el elegido.
  const meses = useMemo(() => { const set = new Set(items.map((it) => it.fecha.slice(0, 7)).filter(Boolean)); set.add(mesActualStr()); set.add(mes); return [...set].sort().reverse() }, [items, mes])

  const load = () => void Promise.all([listarMovimientos(setItems), obtenerResumenComercial(periodo.desde, periodo.hasta, setSummary), obtenerCajaMes(periodo.periodo, setCaja)])
    .then(([movements, result, cajaMes]) => {
      setItems(movements)
      setSummary(result)
      setCaja(cajaMes)
      // Solo empuja a definir apertura en el MES ACTUAL; navegar meses viejos no debe abrir el modal.
      if (!cajaMes.confirmada && mes === mesActualStr()) setAperturaOpen(true)
    })
    .catch(() => toast.error('No se pudo cargar la cuenta. Ejecuta primero la migración de Supabase.'))
  useEffect(load, [periodo])
  useEffect(() => { void obtenerTipoCambio().then(setTipoCambio).catch(() => undefined) }, [])
  useEffect(() => { void Promise.all([listarPedidos(), listarInversiones(), listarProveedores()]).then(([orders, inventory, suppliers]) => { setPedidos(orders); setStock(inventory); setProviders(suppliers) }).catch(() => undefined) }, [])

  const reload = () => { setOpen(false); setAdjustOpen(false); setAperturaOpen(false); load() }
  const borrar = async (movement: MovimientoCuenta) => {
    const esGasto = !!movement.gasto_id
    const aviso = esGasto ? ' También se eliminará el gasto asociado.' : ''
    if (!window.confirm(`¿Eliminar el movimiento "${movement.descripcion}" por USD ${Number(movement.monto).toFixed(2)}? El saldo se recalculará.${aviso}`)) return
    try {
      if (esGasto) await eliminarGasto(movement.gasto_id!)
      else await eliminarMovimiento(movement.id)
      toast.success(esGasto ? 'Gasto y movimiento eliminados.' : 'Movimiento eliminado.'); load()
    }
    catch { toast.error('No se pudo eliminar el movimiento.') }
  }
  const mesActual = items.filter((movement) => { const dia = movement.fecha.slice(0, 10); return dia >= periodo.desde && dia <= periodo.hasta })

  return <div>
    <PageHeader title="Mi cuenta" subtitle="Gastos, ingresos, salidas y saldo — todo tu movimiento de dinero en un solo lugar." onAdd={() => setOpen(true)} button="Registrar ingreso o retiro" />

    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white/[.02] px-4 py-3">
      <span className="flex items-center gap-2 text-sm"><CalendarRange size={16} className="text-accent" /><select className="select-input sm:w-52" value={mes} onChange={(event) => setMes(event.target.value)} aria-label="Mes">{meses.map((m) => <option key={m} value={m}>{capitalizar(mesLabel(m))}</option>)}</select></span>
      <div className="flex flex-wrap gap-2">
        <button className="subtle-button" onClick={() => setGastoOpen(true)}><ReceiptText size={15} /> Registrar gasto</button>
        <button className="subtle-button" onClick={() => setAperturaOpen(true)}><Sparkles size={15} /> {caja.confirmada ? 'Editar apertura del mes' : 'Definir apertura del mes'}</button>
      </div>
    </div>

    <section className="mt-4 rounded-2xl border border-accent/20 bg-accent/[.06] p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-accent text-black"><Wallet size={20} /></span><div><p className="text-xs text-muted">Saldo actual de la caja</p><strong className="text-3xl text-accent">USD {caja.saldo_mes.toFixed(2)}</strong></div></div>
        <button className="subtle-button px-4" onClick={() => setAdjustOpen(true)}><Pencil size={16} /> Modificar saldo actual</button>
      </div>
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-accent/15 pt-4 text-xs text-muted">
        <span>Apertura del mes: <strong className="text-white">USD {caja.opening.toFixed(2)}</strong>{!caja.confirmada && <em className="ml-1 not-italic text-amber-300">(sin confirmar)</em>}</span>
        <span>Movimiento del mes: <strong className={caja.movimientos_mes >= 0 ? 'text-green-300' : 'text-red-300'}>{caja.movimientos_mes >= 0 ? '+' : '−'} USD {Math.abs(caja.movimientos_mes).toFixed(2)}</strong></span>
      </div>
    </section>

    <div className="mt-5 grid gap-3 sm:grid-cols-3"><Mini label="Entradas del mes" value={summary.cobrado} green /><Mini label="Gastos del mes" value={summary.gastos} /><Mini label="Por cobrar (total)" value={summary.por_cobrar} /></div>

    <p className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Movimientos de {periodo.etiqueta}</p>
    <div className="overflow-hidden rounded-2xl border border-line bg-panel">{mesActual.map((movement) => { const incoming = ['ingreso', 'ajuste_entrada'].includes(movement.tipo); return <div key={movement.id} className="flex items-center gap-3 border-b border-line px-5 py-4 last:border-0"><span className={`grid size-9 shrink-0 place-items-center rounded-xl ${incoming ? 'bg-green-400/10 text-green-300' : 'bg-red-400/10 text-red-300'}`}>{incoming ? <ArrowUpRight size={17} /> : <ArrowDownRight size={17} />}</span><div className="min-w-0 flex-1"><strong className="block truncate text-sm">{movement.descripcion}</strong><p className="text-xs text-muted">{formatDate(movement.fecha)} · {movement.metodo || 'Sin método'} {movement.pedidos?.codigo ? `· ${movement.pedidos.codigo}` : ''}</p></div><div className="text-right"><strong className={incoming ? 'text-green-300' : 'text-red-300'}>{incoming ? '+' : '−'} USD {Number(movement.monto).toFixed(2)}</strong>{movement.moneda === 'NIO' && movement.monto_original != null && <span className="block text-[10px] text-muted">{formatMoneda(Number(movement.monto_original), 'NIO')}</span>}</div><button type="button" onClick={() => void borrar(movement)} className="grid size-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-red-400/10 hover:text-red-300" aria-label="Eliminar movimiento" title="Eliminar movimiento"><Trash2 size={16} /></button></div> })}{!mesActual.length && <Empty text="No hay movimientos este mes." />}</div>

    <MovimientoModal open={open} tipoCambio={tipoCambio} onClose={() => setOpen(false)} onSaved={reload} />
    <AjustarSaldoModal open={adjustOpen} saldoActual={caja.saldo_mes} onClose={() => setAdjustOpen(false)} onSaved={reload} />
    <AperturaCajaModal open={aperturaOpen} caja={caja} periodo={periodo} onClose={() => setAperturaOpen(false)} onSaved={reload} />
    <GastoModal open={gastoOpen} editing={null} pedidos={pedidos} stock={stock} providers={providers} tipoCambio={tipoCambio} onClose={() => setGastoOpen(false)} onSaved={() => { setGastoOpen(false); load() }} />
  </div>
}

function AperturaCajaModal({ open, caja, periodo, onClose, onSaved }: { open: boolean; caja: CajaMes; periodo: ReturnType<typeof periodoDeMes>; onClose: () => void; onSaved: () => void }) {
  const [monto, setMonto] = useState(0)
  const [nota, setNota] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (open) { setMonto(Number((caja.apertura ?? caja.sugerido).toFixed(2))); setNota('') } }, [open, caja])
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try { await guardarAperturaCaja(periodo.periodo, monto, nota.trim() ? nota : undefined); toast.success(`Caja de ${periodo.etiqueta} abierta con USD ${monto.toFixed(2)}.`); onSaved() }
    catch { toast.error('No se pudo guardar la apertura.') } finally { setSaving(false) }
  }
  return <Modal open={open} onClose={onClose} title={`Apertura de caja · ${periodo.etiqueta}`} description="Comienza un mes nuevo. Confirma con cuánto flujo arranca la caja; puedes dejar el arrastre o ponerlo en menos.">
    <form onSubmit={(event) => void submit(event)} className="form-grid">
      <div className="col-span-full rounded-xl border border-line bg-white/[.025] p-4 text-sm"><span className="text-muted">Arrastre del mes anterior: </span><strong className="text-accent">USD {caja.sugerido.toFixed(2)}</strong></div>
      <Field label="Flujo con el que arranca la caja (USD)"><input type="number" step=".01" value={monto} onChange={(event) => setMonto(Number(event.target.value))} autoFocus /></Field>
      <div className="flex items-end"><button type="button" className="subtle-button" onClick={() => setMonto(Number(caja.sugerido.toFixed(2)))}>Usar el arrastre</button></div>
      <label className="form-field col-span-full"><span>Nota (opcional)</span><input value={nota} onChange={(event) => setNota(event.target.value)} placeholder="Ej: retiré ganancia del mes pasado" /></label>
      <Actions saving={saving} onClose={onClose} />
    </form>
  </Modal>
}

function MovimientoModal({ open, tipoCambio, onClose, onSaved }: { open: boolean; tipoCambio: number; onClose: () => void; onSaved: (movement: MovimientoCuenta) => void }) {
  const [form, setForm] = useState({ fecha: new Date().toISOString().slice(0, 16), tipo: 'ajuste_entrada' as MovimientoCuenta['tipo'], descripcion: '', monto: 0, moneda: 'USD' as Moneda, metodo: 'Transferencia', observaciones: '' })
  const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const montoUsd = aUsd(form.monto, form.moneda, tipoCambio)
    if (!form.descripcion.trim() || montoUsd <= 0) return toast.error('Completa concepto y monto.')
    setSaving(true)
    try { const result = await registrarMovimiento({ fecha: form.fecha, tipo: form.tipo, descripcion: form.descripcion, monto: montoUsd, moneda: form.moneda, monto_original: form.monto, tipo_cambio: form.moneda === 'NIO' ? tipoCambio : null, metodo: form.metodo, pedido_id: null, observaciones: form.observaciones || null }); onSaved(result); toast.success('Movimiento registrado.') }
    catch { toast.error('No se pudo registrar.') } finally { setSaving(false) }
  }
  return <Modal open={open} onClose={onClose} title="Movimiento de cuenta"><form onSubmit={(event) => void submit(event)} className="form-grid"><Field label="Tipo"><select value={form.tipo} onChange={(event) => setForm({ ...form, tipo: event.target.value as MovimientoCuenta['tipo'] })}><option value="ajuste_entrada">Ingreso a cuenta</option><option value="retiro">Retiro</option><option value="ajuste_salida">Ajuste de salida</option></select></Field><Field label="Fecha"><input type="datetime-local" value={form.fecha} onChange={(event) => setForm({ ...form, fecha: event.target.value })} /></Field><Field label="Concepto"><input value={form.descripcion} onChange={(event) => setForm({ ...form, descripcion: event.target.value })} /></Field><MoneyField moneda={form.moneda} montoOriginal={form.monto} tipoCambio={tipoCambio} onMoneda={(moneda) => setForm({ ...form, moneda })} onMonto={(monto) => setForm({ ...form, monto })} /><Field label="Método"><input value={form.metodo} onChange={(event) => setForm({ ...form, metodo: event.target.value })} /></Field><Field label="Observaciones"><input value={form.observaciones} onChange={(event) => setForm({ ...form, observaciones: event.target.value })} /></Field><Actions saving={saving} onClose={onClose} /></form></Modal>
}

function AjustarSaldoModal({ open, saldoActual, onClose, onSaved }: { open: boolean; saldoActual: number; onClose: () => void; onSaved: (movement: MovimientoCuenta) => void }) {
  const [nuevoSaldo, setNuevoSaldo] = useState(saldoActual)
  const [motivo, setMotivo] = useState('Corrección de saldo actual')
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (open) setNuevoSaldo(saldoActual) }, [open, saldoActual])
  const diferencia = Number((nuevoSaldo - saldoActual).toFixed(2))
  const submit = async (event: FormEvent) => { event.preventDefault(); if (diferencia === 0) return toast.info('El saldo no cambió.'); setSaving(true); try { const result = await registrarMovimiento({ fecha: new Date().toISOString(), tipo: diferencia > 0 ? 'ajuste_entrada' : 'ajuste_salida', descripcion: 'Ajuste manual de saldo', monto: Math.abs(diferencia), moneda: 'USD', monto_original: Math.abs(diferencia), tipo_cambio: null, metodo: 'Ajuste manual', pedido_id: null, observaciones: motivo || null }); onSaved(result); toast.success(`Saldo actualizado a USD ${nuevoSaldo.toFixed(2)}.`) } catch { toast.error('No se pudo ajustar el saldo.') } finally { setSaving(false) } }
  return <Modal open={open} onClose={onClose} title="Modificar saldo actual" description="Se registrará la diferencia como un ajuste, sin borrar el historial."><form onSubmit={(event) => void submit(event)} className="form-grid"><Field label="Saldo calculado"><input value={`USD ${saldoActual.toFixed(2)}`} disabled /></Field><Field label="Nuevo saldo real"><input type="number" step=".01" value={nuevoSaldo} onChange={(event) => setNuevoSaldo(Number(event.target.value))} autoFocus /></Field><label className="form-field col-span-full"><span>Motivo del ajuste</span><textarea rows={3} value={motivo} onChange={(event) => setMotivo(event.target.value)} /></label><div className="col-span-full rounded-xl border border-line bg-white/[.025] p-4 text-sm"><span className="text-muted">Movimiento que se registrará: </span><strong className={diferencia >= 0 ? 'text-green-300' : 'text-red-300'}>{diferencia >= 0 ? '+' : '−'} USD {Math.abs(diferencia).toFixed(2)}</strong></div><Actions saving={saving} onClose={onClose} /></form></Modal>
}

function Mini({ label, value, green }: { label: string; value: number; green?: boolean }) { return <article className="metric-card"><p className="text-xs text-muted">{label}</p><strong className={`mt-2 block text-xl ${green ? 'text-green-300' : ''}`}>USD {value.toFixed(2)}</strong></article> }
