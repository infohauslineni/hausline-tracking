import { Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Modal } from '../ui/Modal'
import type { EditarPedidoInput } from '../../services/pedidos.service'
import type { Pedido, PedidoItem } from '../../types/domain'
import { costoRealPedido } from '../../utils/pedidoCosto'

const itemVacio: PedidoItem = { producto: '', marca: '', categoria: '', talla: '', color: '', cantidad: 1, precio_unitario: 0, notas: '' }

export function EditarPedidoModal({ pedido, open, onClose, onSave }: {
  pedido: Pedido
  open: boolean
  onClose: () => void
  onSave: (input: EditarPedidoInput) => Promise<void>
}) {
  const [items, setItems] = useState<PedidoItem[]>([])
  const [fechaEstimada, setFechaEstimada] = useState('')
  const [abono, setAbono] = useState(0)
  const [costoProveedor, setCostoProveedor] = useState(0)
  const [notasInternas, setNotasInternas] = useState('')
  const [notasPublicas, setNotasPublicas] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setItems(pedido.pedido_items?.length ? pedido.pedido_items.map((item) => ({ ...item })) : [{ ...itemVacio }])
    setFechaEstimada(pedido.fecha_estimada ?? '')
    setAbono(Number(pedido.abono))
    const proveedor = pedido.gastos?.find((gasto) => (gasto.categoria ?? '').toLowerCase().includes('proveedor'))
    setCostoProveedor(proveedor ? Number(proveedor.monto) : costoRealPedido(pedido))
    setNotasInternas(pedido.notas_internas ?? '')
    setNotasPublicas(pedido.notas_publicas ?? '')
    setError('')
  }, [open, pedido])

  const total = useMemo(() => items.reduce((sum, item) => sum + Number(item.cantidad || 0) * Number(item.precio_unitario || 0), 0), [items])
  const changeItem = (index: number, field: keyof PedidoItem, value: string | number) => setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item))

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!items.length || items.some((item) => !item.producto.trim())) return setError('Escribe el nombre de todos los productos.')
    if (items.some((item) => Number(item.cantidad) < 1 || Number(item.precio_unitario) < 0)) return setError('Revisa la cantidad y el precio de los productos.')
    if (abono < 0) return setError('El abono no puede ser negativo.')
    if (costoProveedor < 0) return setError('El costo real no puede ser negativo.')
    setSaving(true)
    setError('')
    try {
      await onSave({
        fecha_estimada: fechaEstimada || null,
        abono: Number(abono),
        costo_proveedor: Number(costoProveedor),
        notas_internas: notasInternas.trim() || null,
        notas_publicas: notasPublicas.trim() || null,
        items: items.map((item) => ({ ...item, cantidad: Number(item.cantidad), precio_unitario: Number(item.precio_unitario) })),
      })
      onClose()
    } finally { setSaving(false) }
  }

  return <Modal open={open} onClose={onClose} title="Editar pedido" description={`Modifica los productos y datos de ${pedido.codigo}.`}>
    <form onSubmit={(event) => void submit(event)} className="space-y-5">
      <div className="flex items-center justify-between gap-3"><strong className="text-sm">Productos</strong><button type="button" className="subtle-button px-3" onClick={() => setItems((current) => [...current, { ...itemVacio }])}><Plus size={16} /> Agregar</button></div>
      <div className="space-y-4">{items.map((item, index) => <article key={item.id ?? index} className="rounded-xl border border-line bg-black/10 p-4">
        <div className="mb-4 flex items-center justify-between"><strong className="text-sm">Producto {index + 1}</strong>{items.length > 1 && <button type="button" className="table-action hover:text-red-300" aria-label={`Eliminar producto ${index + 1}`} onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={16} /></button>}</div>
        <div className="form-grid">
          <Field label="Producto"><input value={item.producto} onChange={(event) => changeItem(index, 'producto', event.target.value)} /></Field>
          <Field label="Marca"><input value={item.marca ?? ''} onChange={(event) => changeItem(index, 'marca', event.target.value)} /></Field>
          <Field label="Categoría"><input value={item.categoria ?? ''} onChange={(event) => changeItem(index, 'categoria', event.target.value)} /></Field>
          <Field label="Talla"><input value={item.talla ?? ''} onChange={(event) => changeItem(index, 'talla', event.target.value)} /></Field>
          <Field label="Color"><input value={item.color ?? ''} onChange={(event) => changeItem(index, 'color', event.target.value)} /></Field>
          <Field label="Cantidad"><input type="number" min="1" value={item.cantidad} onChange={(event) => changeItem(index, 'cantidad', Number(event.target.value))} /></Field>
          <Field label="Precio unitario"><input type="number" min="0" step="0.01" value={item.precio_unitario} onChange={(event) => changeItem(index, 'precio_unitario', Number(event.target.value))} /></Field>
          <Field label="Notas del producto"><input value={item.notas ?? ''} onChange={(event) => changeItem(index, 'notas', event.target.value)} /></Field>
        </div>
      </article>)}</div>
      <div className="form-grid">
        <Field label="Fecha estimada"><input type="date" value={fechaEstimada} onChange={(event) => setFechaEstimada(event.target.value)} /></Field>
        <Field label="Abono"><input type="number" min="0" step="0.01" value={abono} onChange={(event) => setAbono(Number(event.target.value))} /></Field>
        <Field label="Costo real (proveedor)"><input type="number" min="0" step="0.01" value={costoProveedor} onChange={(event) => setCostoProveedor(Number(event.target.value))} /></Field>
        <Field label="Notas internas"><textarea rows={3} value={notasInternas} onChange={(event) => setNotasInternas(event.target.value)} /></Field>
        <Field label="Nota visible para el cliente"><textarea rows={3} value={notasPublicas} onChange={(event) => setNotasPublicas(event.target.value)} /></Field>
      </div>
      <div className="grid gap-3 rounded-xl border border-line bg-white/[0.025] p-4 sm:grid-cols-3"><Money label="Total" value={total} /><Money label="Abono" value={abono} /><Money label="Saldo" value={total - abono} accent /><Money label="Costo real" value={costoProveedor} /><Money label="Ganancia estimada" value={total - costoProveedor} /></div>
      {error && <p className="text-sm text-red-300">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" className="subtle-button px-4" onClick={onClose}>Cancelar</button><button className="primary-button px-5" disabled={saving}><Save size={16} /> {saving ? 'Guardando…' : 'Guardar cambios'}</button></div>
    </form>
  </Modal>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="form-field"><span>{label}</span>{children}</label> }
function Money({ label, value, accent }: { label: string; value: number; accent?: boolean }) { return <div><span className="text-xs text-muted">{label}</span><strong className={`mt-1 block ${accent ? 'text-accent' : ''}`}>${Number(value || 0).toFixed(2)}</strong></div> }
