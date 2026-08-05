import { CalendarRange, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Modal } from '../../components/ui/Modal'
import { MoneyField } from '../../components/ui/MoneyField'
import { eliminarGasto, listarGastos, listarInversiones, listarProveedores, obtenerTipoCambio, registrarGasto } from '../../services/comercial.service'
import { listarPedidos } from '../../services/pedidos.service'
import type { Gasto, Inversion, Moneda, Pedido, Proveedor } from '../../types/domain'
import { aUsd, formatMoneda } from '../../utils/money'
import { periodoDeMes } from '../../utils/periodo'
import { Actions, Empty, Field, formatDate, PageHeader } from './PagosPage'

export function GastosPage() {
  const [items, setItems] = useState<Gasto[]>([])
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [stock, setStock] = useState<Inversion[]>([])
  const [providers, setProviders] = useState<Proveedor[]>([])
  const [tipoCambio, setTipoCambio] = useState(37)
  const [open, setOpen] = useState(false)
  const [verTodo, setVerTodo] = useState(false)
  const periodo = useMemo(() => periodoDeMes(), [])

  useEffect(() => {
    void Promise.all([listarGastos(), listarPedidos(), listarInversiones(), listarProveedores()])
      .then(([expenses, orders, inventory, suppliers]) => { setItems(expenses); setPedidos(orders); setStock(inventory); setProviders(suppliers) })
      .catch(() => toast.error('No se pudieron cargar los gastos.'))
    void obtenerTipoCambio().then(setTipoCambio).catch(() => undefined)
  }, [])

  const visible = verTodo ? items : items.filter((item) => { const dia = item.fecha.slice(0, 10); return dia >= periodo.desde && dia <= periodo.hasta })
  const total = visible.reduce((sum, item) => sum + Number(item.monto), 0)
  const remove = async (item: Gasto) => {
    if (!window.confirm(`¿Eliminar el gasto "${item.descripcion}" de USD ${Number(item.monto).toFixed(2)}? Se devolverá ese monto al saldo de Mi cuenta.`)) return
    try { await eliminarGasto(item.id); setItems((all) => all.filter((g) => g.id !== item.id)); toast.success('Gasto eliminado y saldo revertido.') }
    catch { toast.error('No se pudo eliminar el gasto.') }
  }
  return <div>
    <PageHeader title="Gastos" subtitle="Compras, proveedores, delivery y gastos operativos." onAdd={() => setOpen(true)} button="Registrar gasto" />
    <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-line bg-accent/[.035] p-5 sm:flex-row sm:items-center sm:justify-between">
      <div><span className="flex items-center gap-2 text-xs capitalize text-muted"><CalendarRange size={14} className="text-accent" /> {verTodo ? 'Todos los gastos' : periodo.etiqueta}</span><strong className="mt-1 block text-2xl text-red-300">USD {total.toFixed(2)}</strong></div>
      <button className="subtle-button" onClick={() => setVerTodo((value) => !value)}>{verTodo ? 'Ver solo este mes' : 'Ver todos los meses'}</button>
    </div>
    <div className="mt-5 overflow-hidden rounded-2xl border border-line bg-panel">{visible.map((item) => <div key={item.id} className="grid items-center gap-2 border-b border-line px-5 py-4 last:border-0 sm:grid-cols-[1.4fr_.8fr_.8fr_.7fr_40px]"><div><strong className="text-sm">{item.descripcion}</strong><p className="text-xs text-muted">{item.categoria} · {item.proveedores?.nombre || item.pedidos?.codigo || (item.inversiones ? `${item.inversiones.codigo || 'Stock'} · ${item.inversiones.producto}` : 'General')}</p></div><span className="text-xs text-muted">{item.metodo_pago || 'Sin método'}</span><span className="text-xs text-muted">{formatDate(item.fecha)}</span><div><strong className="block text-red-300">− USD {Number(item.monto).toFixed(2)}</strong>{item.moneda === 'NIO' && item.monto_original != null && <span className="text-[10px] text-muted">Pagado {formatMoneda(Number(item.monto_original), 'NIO')}</span>}</div><button className="table-action table-action-danger justify-self-end" onClick={() => void remove(item)} aria-label={`Eliminar gasto ${item.descripcion}`}><Trash2 size={16} /></button></div>)}{!visible.length && <Empty text={verTodo ? 'No hay gastos registrados.' : 'No hay gastos este mes.'} />}</div>
    <GastoModal open={open} pedidos={pedidos} stock={stock} providers={providers} tipoCambio={tipoCambio} onClose={() => setOpen(false)} onSaved={(item) => { setItems((all) => [item, ...all]); setOpen(false) }} />
  </div>
}

function GastoModal({ open, pedidos, stock, providers, tipoCambio, onClose, onSaved }: { open: boolean; pedidos: Pedido[]; stock: Inversion[]; providers: Proveedor[]; tipoCambio: number; onClose: () => void; onSaved: (item: Gasto) => void }) {
  const initial = { fecha: new Date().toISOString().slice(0, 10), categoria: 'Proveedor', monto: '', moneda: 'USD' as Moneda, metodo_pago: 'Transferencia', pedido_id: '', inversion_id: '', proveedor_id: '', descripcion: '', observaciones: '' }
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (open) setForm(initial) }, [open])

  // Solo pedidos activos (los entregados/cancelados ya no deberían recibir gastos nuevos),
  // ordenados del más reciente al más viejo para que no aparezcan pedidos viejos arriba.
  const pedidosDisponibles = useMemo(() => pedidos
    .filter((pedido) => pedido.estado !== 'entregado' && pedido.estado !== 'cancelado')
    .sort((a, b) => b.fecha_pedido.localeCompare(a.fecha_pedido)), [pedidos])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const amount = aUsd(Number(form.monto), form.moneda, tipoCambio)
    if (amount <= 0 || !form.descripcion.trim()) return toast.error('Completa descripción y monto.')
    setSaving(true)
    try {
      const saved = await registrarGasto({ fecha: form.fecha, categoria: form.categoria, descripcion: form.descripcion, monto: amount, moneda: form.moneda, monto_original: Number(form.monto), tipo_cambio: form.moneda === 'NIO' ? tipoCambio : null, pedido_id: form.pedido_id || null, inversion_id: form.inversion_id || null, proveedor_id: form.proveedor_id || null, metodo_pago: form.metodo_pago || null, observaciones: form.observaciones || null })
      onSaved(saved)
      toast.success(form.inversion_id ? 'Gasto registrado y sumado al costo total del stock.' : 'Gasto registrado.')
    } catch { toast.error('No se pudo registrar el gasto.') } finally { setSaving(false) }
  }

  return <Modal open={open} onClose={onClose} title="Registrar gasto" description="Puedes asociarlo a un pedido o a un producto de stock inmediato.">
    <form className="form-grid" onSubmit={(event) => void submit(event)}>
      <Field label="Fecha"><input type="date" value={form.fecha} onChange={(event) => setForm({ ...form, fecha: event.target.value })} /></Field>
      <Field label="Categoría"><select value={form.categoria} onChange={(event) => setForm({ ...form, categoria: event.target.value })}><option>Proveedor</option><option>Envío internacional</option><option>Delivery</option><option>Publicidad</option><option>Empaque</option><option>Otro</option></select></Field>
      <Field label="Descripción"><input value={form.descripcion} onChange={(event) => setForm({ ...form, descripcion: event.target.value })} /></Field>
      <MoneyField moneda={form.moneda} montoOriginal={form.monto} tipoCambio={tipoCambio} onMoneda={(moneda) => setForm({ ...form, moneda })} onMonto={(value) => setForm({ ...form, monto: String(value) })} />
      <Field label="Pedido (opcional)"><select value={form.pedido_id} onChange={(event) => setForm({ ...form, pedido_id: event.target.value, inversion_id: event.target.value ? '' : form.inversion_id })}><option value="">No asociar a pedido</option>{pedidosDisponibles.map((pedido) => <option value={pedido.id} key={pedido.id}>{pedido.codigo} · {pedido.clientes?.nombre}</option>)}</select></Field>
      <Field label="Stock inmediato (opcional)"><select value={form.inversion_id} onChange={(event) => setForm({ ...form, inversion_id: event.target.value, pedido_id: event.target.value ? '' : form.pedido_id })}><option value="">No asociar a stock</option>{stock.filter((item) => item.estado !== 'descartado').map((item) => <option value={item.id} key={item.id}>{item.codigo || 'SIN CÓDIGO'} · {item.producto} · {item.talla_color || 'Sin talla'}</option>)}</select></Field>
      <Field label="Proveedor (opcional)"><select value={form.proveedor_id} onChange={(event) => setForm({ ...form, proveedor_id: event.target.value })}><option value="">Sin proveedor</option>{providers.map((provider) => <option value={provider.id} key={provider.id}>{provider.nombre}</option>)}</select></Field>
      <Field label="Método"><input value={form.metodo_pago} onChange={(event) => setForm({ ...form, metodo_pago: event.target.value })} /></Field>
      <label className="form-field col-span-full"><span>Observaciones</span><input value={form.observaciones} onChange={(event) => setForm({ ...form, observaciones: event.target.value })} /></label>
      {form.inversion_id && <p className="col-span-full rounded-xl border border-accent/20 bg-accent/[.05] p-4 text-xs leading-5 text-muted">Este gasto se descontará una sola vez de Mi cuenta y se sumará al costo total del producto seleccionado.</p>}
      <Actions saving={saving} onClose={onClose} />
    </form>
  </Modal>
}
