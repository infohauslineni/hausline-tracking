import { Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Modal } from '../ui/Modal'
import { CuentaSelect, type DestinoPago } from '../finanzas/CuentaSelect'
import { obtenerTipoCambio } from '../../services/comercial.service'
import { ENVIO_RAPIDO_RECARGO, esLineaEnvioRapido, type EditarPedidoInput } from '../../services/pedidos.service'
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
  const [costoOriginal, setCostoOriginal] = useState(0)
  const [destinoCosto, setDestinoCosto] = useState<DestinoPago>({ cuentaId: null, montoCuenta: 0 })
  const [tipoCambio, setTipoCambio] = useState(37)
  const [notasInternas, setNotasInternas] = useState('')
  const [notasPublicas, setNotasPublicas] = useState('')
  const [envioRapido, setEnvioRapido] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    // La línea de envío rápido no se edita a mano: la maneja la casilla de abajo.
    const productos = (pedido.pedido_items ?? []).filter((item) => !esLineaEnvioRapido(item))
    setItems(productos.length ? productos.map((item) => ({ ...item })) : [{ ...itemVacio }])
    setFechaEstimada(pedido.fecha_estimada ?? '')
    setAbono(Number(pedido.abono))
    const proveedor = pedido.gastos?.find((gasto) => (gasto.categoria ?? '').toLowerCase().includes('proveedor'))
    const costoInicial = proveedor ? Number(proveedor.monto) : costoRealPedido(pedido)
    setCostoProveedor(costoInicial)
    setCostoOriginal(costoInicial)
    setDestinoCosto({ cuentaId: null, montoCuenta: 0 })
    setNotasInternas(pedido.notas_internas ?? '')
    setNotasPublicas(pedido.notas_publicas ?? '')
    setEnvioRapido(Boolean(pedido.envio_rapido))
    setError('')
  }, [open, pedido])

  useEffect(() => { if (open) void obtenerTipoCambio().then(setTipoCambio).catch(() => undefined) }, [open])

  const totalProductos = useMemo(() => items.reduce((sum, item) => sum + Number(item.cantidad || 0) * Number(item.precio_unitario || 0), 0), [items])
  const total = totalProductos + (envioRapido ? ENVIO_RAPIDO_RECARGO : 0)
  // Diferencia de costo real respecto a lo que estaba antes: >0 salió más plata, <0 volvió.
  const deltaCosto = Math.round((Number(costoProveedor) - Number(costoOriginal)) * 100) / 100
  const changeItem = (index: number, field: keyof PedidoItem, value: string | number) => setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item))

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!items.length || items.some((item) => !item.producto.trim())) return setError('Escribe el nombre de todos los productos.')
    if (items.some((item) => Number(item.cantidad) < 1 || Number(item.precio_unitario) < 0)) return setError('Revisa la cantidad y el precio de los productos.')
    if (abono < 0) return setError('El abono no puede ser negativo.')
    if (costoProveedor < 0) return setError('El costo real no puede ser negativo.')
    if (Math.abs(deltaCosto) > 0.001 && !destinoCosto.cuentaId) return setError('Elegí la cuenta que absorbe la diferencia de costo.')
    setSaving(true)
    setError('')
    try {
      await onSave({
        fecha_estimada: fechaEstimada || null,
        abono: Number(abono),
        costo_proveedor: Number(costoProveedor),
        cuentaAjuste: destinoCosto.cuentaId && deltaCosto !== 0
          ? { cuentaId: destinoCosto.cuentaId, ajuste: deltaCosto > 0 ? -Math.abs(destinoCosto.montoCuenta) : Math.abs(destinoCosto.montoCuenta) }
          : null,
        notas_internas: notasInternas.trim() || null,
        notas_publicas: notasPublicas.trim() || null,
        envio_rapido: envioRapido,
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
      <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-line bg-white/[0.02] p-3 transition hover:border-accent/40"><input type="checkbox" className="size-4 shrink-0 accent-accent" checked={envioRapido} onChange={(event) => setEnvioRapido(event.target.checked)} /><span className="flex flex-col"><span className="text-sm font-medium">El cliente quiere envío rápido</span><span className="text-[11px] text-muted">Llega en 14 a 17 días en vez de 20 a 25. Suma US$15 al total del pedido (una sola vez).</span></span></label>
      <div className="grid gap-3 rounded-xl border border-line bg-white/[0.025] p-4 sm:grid-cols-3"><Money label="Total" value={total} /><Money label="Abono" value={abono} /><Money label="Saldo" value={total - abono} accent /><Money label="Costo real" value={costoProveedor} /><Money label="Ganancia estimada" value={total - costoProveedor} /></div>
      {Math.abs(deltaCosto) > 0.001 && <div className="grid gap-3 rounded-xl border border-line bg-white/[.02] p-4">
        <p className="text-xs text-muted">El costo {deltaCosto > 0 ? 'subió' : 'bajó'} <strong className={deltaCosto > 0 ? 'text-red-300' : 'text-green-300'}>${Math.abs(deltaCosto).toFixed(2)}</strong>. {deltaCosto > 0 ? 'Elegí de qué cuenta salió esa diferencia (baja esa tarjeta).' : 'Elegí a qué cuenta vuelve esa diferencia (sube esa tarjeta).'}</p>
        <CuentaSelect requerido proposito={deltaCosto > 0 ? 'comprar' : 'recibir'} montoUsd={Math.abs(deltaCosto)} tipoCambio={tipoCambio} value={destinoCosto} onChange={setDestinoCosto} modo={deltaCosto > 0 ? 'resta' : 'suma'} label={deltaCosto > 0 ? '¿De qué cuenta salió la diferencia?' : '¿A qué cuenta volvió la diferencia?'} />
      </div>}
      {error && <p className="text-sm text-red-300">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" className="subtle-button px-4" onClick={onClose}>Cancelar</button><button className="primary-button px-5" disabled={saving}><Save size={16} /> {saving ? 'Guardando…' : 'Guardar cambios'}</button></div>
    </form>
  </Modal>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="form-field"><span>{label}</span>{children}</label> }
function Money({ label, value, accent }: { label: string; value: number; accent?: boolean }) { return <div><span className="text-xs text-muted">{label}</span><strong className={`mt-1 block ${accent ? 'text-accent' : ''}`}>${Number(value || 0).toFixed(2)}</strong></div> }
