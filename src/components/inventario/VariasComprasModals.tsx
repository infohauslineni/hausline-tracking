import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Modal } from '../ui/Modal'
import { CuentaSelect, type DestinoPago } from '../finanzas/CuentaSelect'
import { obtenerTipoCambio, pagarVariasCompras, registrarEnvioCompras } from '../../services/comercial.service'
import type { Inversion } from '../../types/domain'
import { porPagarInversion } from '../../utils/compraPago'
import { MODOS_REPARTO, TIPOS_PRODUCTO, repartir, tipoDeProducto, type ModoReparto } from '../../utils/repartoCompra'

// Acciones sobre VARIAS compras seleccionadas en Compras libres:
//   • Repartir envío: el paquete trae zapatos y camisas → cada uno carga su parte (por peso).
//   • Pagar juntas: un solo pago con comisión → la comisión se reparte según lo que cuesta cada una.

const usd = (n: number) => `$${(Number.isFinite(n) ? n : 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const hoy = () => new Date().toISOString().slice(0, 10)
const opcion = (activo: boolean) => `rounded-xl border px-3 py-2 text-left text-xs transition ${activo ? 'border-accent bg-accent/[.1] text-white' : 'border-line text-muted hover:border-white/25 hover:text-white'}`
const costoProducto = (x: Inversion) => Number(x.costo_unitario) * Number(x.cantidad) + Number(x.gastos_adicionales)
const nombre = (x: Inversion) => `${x.producto}${x.talla_color ? ` · ${x.talla_color}` : ''}`

function Tabla({ filas }: { filas: { id: string; img?: string | null; nombre: string; detalle: string; monto: number }[] }) {
  return <div className="max-h-64 overflow-y-auto rounded-xl border border-line">{filas.map((f) => <div key={f.id} className="flex items-center justify-between gap-3 border-b border-line px-3 py-2 text-xs last:border-0"><span className="min-w-0"><span className="block truncate font-medium text-white">{f.nombre}</span><span className="text-[11px] text-muted">{f.detalle}</span></span><b className="shrink-0 font-mono text-accent">{usd(f.monto)}</b></div>)}</div>
}

export function RepartirEnvioModal({ items, onClose, onListo }: { items: Inversion[] | null; onClose: () => void; onListo: () => void }) {
  const [monto, setMonto] = useState('')
  const [modo, setModo] = useState<ModoReparto>('peso')
  const [libras, setLibras] = useState<Record<string, string>>({})
  const [fecha, setFecha] = useState(hoy())
  const [destino, setDestino] = useState<DestinoPago>({ cuentaId: null, montoCuenta: 0 })
  const [tipoCambio, setTipoCambio] = useState(37)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!items) return
    setMonto(''); setModo('peso'); setFecha(hoy()); setDestino({ cuentaId: null, montoCuenta: 0 })
    setLibras(Object.fromEntries(items.map((x) => [x.id, String(TIPOS_PRODUCTO[tipoDeProducto(x.producto)].lb * (Number(x.cantidad) || 1))])))
    void obtenerTipoCambio().then(setTipoCambio).catch(() => undefined)
  }, [items])
  const total = Number(monto) || 0
  const partes = useMemo(() => !items ? [] : repartir(total, items.map((x) => modo === 'igual' ? Number(x.cantidad) || 1 : modo === 'peso' ? Number(libras[x.id]) || 0 : costoProducto(x))), [items, total, modo, libras])
  if (!items) return null
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (total <= 0) return toast.error('Escribí cuánto costó el envío del paquete.')
    setSaving(true)
    try {
      await registrarEnvioCompras(items.map((item, i) => ({ item, monto: partes[i] })), { fecha, metodo: 'Transferencia' }, destino)
      toast.success(`Envío de ${usd(total)} repartido entre ${items.length} compras.`)
      onListo()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo registrar el envío.') } finally { setSaving(false) }
  }
  return <Modal open onClose={onClose} title={`Repartir envío · ${items.length} ${items.length === 1 ? 'compra' : 'compras'}`} description="Lo que pagaste por traer el paquete a Nicaragua. Cada producto carga su parte y su ganancia se recalcula.">
    <form className="space-y-4" onSubmit={(event) => void submit(event)}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="form-field"><span>Costo del envío (US$)</span><input type="number" min="0" step=".01" value={monto} onChange={(e) => setMonto(e.target.value)} autoFocus placeholder="Ej. 45" /></label>
        <label className="form-field"><span>Fecha</span><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
      </div>
      <div className="grid grid-cols-3 gap-2">{(['peso', 'igual', 'precio'] as ModoReparto[]).map((m) => <button type="button" key={m} className={opcion(modo === m)} onClick={() => setModo(m)}><strong className="block text-sm">{MODOS_REPARTO[m].titulo}</strong>{MODOS_REPARTO[m].ayuda}</button>)}</div>
      <div className="max-h-72 overflow-y-auto rounded-xl border border-line">{items.map((x, i) => <div key={x.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-line px-3 py-2 text-xs last:border-0">
        <span className="min-w-0"><span className="block truncate font-medium text-white">{nombre(x)}</span><span className="text-[11px] text-muted">{x.codigo ?? 'Sin código'} · {Number(x.cantidad) || 1} ud</span></span>
        {modo === 'peso' ? <label className="flex items-center gap-1 text-[11px] text-muted"><input className="simple-input w-16! px-2! py-1!" type="number" min="0" step=".1" value={libras[x.id] ?? ''} onChange={(e) => setLibras((l) => ({ ...l, [x.id]: e.target.value }))} aria-label="Peso en libras" />lb</label> : <span />}
        <b className="w-20 text-right font-mono text-accent">{usd(partes[i] ?? 0)}</b>
      </div>)}</div>
      <CuentaSelect proposito="comprar" montoUsd={total} tipoCambio={tipoCambio} value={destino} onChange={setDestino} modo="resta" label="¿De qué cuenta salió el envío?" />
      <div className="flex justify-end gap-2"><button type="button" className="subtle-button" onClick={onClose}>Cancelar</button><button className="primary-button px-5" disabled={saving}>{saving ? 'Guardando…' : 'Repartir envío'}</button></div>
    </form>
  </Modal>
}

export function PagarVariasModal({ items, onClose, onPagadas }: { items: Inversion[] | null; onClose: () => void; onPagadas: (pagadas: Inversion[]) => void }) {
  const [total, setTotal] = useState('')
  const [modo, setModo] = useState<ModoReparto>('precio')
  const [fecha, setFecha] = useState(hoy())
  const [metodo, setMetodo] = useState('PayPal')
  const [destino, setDestino] = useState<DestinoPago>({ cuentaId: null, montoCuenta: 0 })
  const [tipoCambio, setTipoCambio] = useState(37)
  const [saving, setSaving] = useState(false)
  // Solo las que de verdad deben algo.
  const deben = useMemo(() => (items ?? []).filter((x) => porPagarInversion(x, costoProducto(x)) > 0.005), [items])
  const faltas = deben.map((x) => porPagarInversion(x, costoProducto(x)))
  const debido = Math.round(faltas.reduce((s, f) => s + f, 0) * 100) / 100
  useEffect(() => { if (!items) return; setTotal(debido ? String(debido) : ''); setModo('precio'); setFecha(hoy()); setMetodo('PayPal'); setDestino({ cuentaId: null, montoCuenta: 0 }); void obtenerTipoCambio().then(setTipoCambio).catch(() => undefined) }, [items]) // eslint-disable-line react-hooks/exhaustive-deps
  const pagado = Number(total) || 0
  const comision = Math.round((pagado - debido) * 100) / 100
  // La comisión se reparte según lo que le falta a cada una (el zapato más caro carga más) o igual.
  const extras = useMemo(() => repartir(Math.max(0, comision), deben.map((_, i) => modo === 'igual' ? 1 : faltas[i])), [comision, deben, modo]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!items) return null
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!deben.length) return toast.error('Ninguna de las seleccionadas tiene saldo por pagar.')
    if (pagado < debido - 0.005) return toast.error(`Lo que pagaste es menos de lo que se debe (${usd(debido)}). Para un abono, pagá cada compra desde su ficha.`)
    setSaving(true)
    try {
      const pagadas = await pagarVariasCompras(deben, extras, { fecha, metodo }, destino)
      toast.success(`${pagadas.length} compras pagadas${comision > 0.005 ? ` · comisión de ${usd(comision)} repartida` : ''}.`)
      onPagadas(pagadas)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo registrar el pago.') } finally { setSaving(false) }
  }
  return <Modal open onClose={onClose} title={`Pagar ${deben.length} ${deben.length === 1 ? 'compra' : 'compras'} juntas`} description="Escribí lo que pagaste en total (con la comisión de PayPal). La diferencia se reparte como comisión y queda en el costo de cada producto.">
    <form className="space-y-4" onSubmit={(event) => void submit(event)}>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="form-field"><span>Total pagado (US$)</span><input type="number" min="0" step=".01" value={total} onChange={(e) => setTotal(e.target.value)} autoFocus /></label>
        <label className="form-field"><span>Fecha</span><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
        <label className="form-field"><span>Método</span><input value={metodo} onChange={(e) => setMetodo(e.target.value)} /></label>
      </div>
      <div className="grid grid-cols-3 gap-2 rounded-xl border border-line bg-white/[.02] p-3 text-center text-xs">
        <div><span className="text-[10px] uppercase text-muted">Se debía</span><b className="mt-1 block text-sm">{usd(debido)}</b></div>
        <div><span className="text-[10px] uppercase text-muted">Pagaste</span><b className="mt-1 block text-sm text-accent">{usd(pagado)}</b></div>
        <div><span className="text-[10px] uppercase text-muted">Comisión</span><b className={`mt-1 block text-sm ${comision < 0 ? 'text-red-300' : 'text-amber-200'}`}>{usd(comision)}{debido > 0 && comision > 0 ? ` (${((comision / debido) * 100).toFixed(2)} %)` : ''}</b></div>
      </div>
      {comision > 0.005 && <div className="grid grid-cols-2 gap-2">{(['precio', 'igual'] as ModoReparto[]).map((m) => <button type="button" key={m} className={opcion(modo === m)} onClick={() => setModo(m)}><strong className="block text-sm">{m === 'precio' ? 'Según lo que cuesta cada una' : 'Igual para todas'}</strong>{m === 'precio' ? 'El zapato más caro paga más comisión' : `${usd(deben.length ? comision / deben.length : 0)} a cada una`}</button>)}</div>}
      <Tabla filas={deben.map((x, i) => ({ id: x.id, nombre: nombre(x), detalle: `Debía ${usd(faltas[i])}${extras[i] > 0.004 ? ` + comisión ${usd(extras[i])}` : ''}`, monto: faltas[i] + (extras[i] || 0) }))} />
      <CuentaSelect proposito="comprar" montoUsd={pagado} tipoCambio={tipoCambio} value={destino} onChange={setDestino} modo="resta" />
      <div className="flex justify-end gap-2"><button type="button" className="subtle-button" onClick={onClose}>Cancelar</button><button className="primary-button px-5" disabled={saving || !deben.length}>{saving ? 'Registrando…' : `Pagar ${usd(pagado)}`}</button></div>
    </form>
  </Modal>
}
