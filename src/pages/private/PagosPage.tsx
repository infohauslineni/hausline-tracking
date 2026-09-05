import { CalendarRange, CircleDollarSign, Download, MessageCircle, Plus } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { CuentaSelect, type DestinoPago } from '../../components/finanzas/CuentaSelect'
import { Modal } from '../../components/ui/Modal'
import { MoneyField } from '../../components/ui/MoneyField'
import { listarPagos, obtenerTipoCambio, registrarPago } from '../../services/comercial.service'
import { listarPedidos } from '../../services/pedidos.service'
import { descargarRecibo, enviarReciboWhatsApp } from '../../services/recibos.service'
import type { Moneda, Pago, Pedido } from '../../types/domain'
import { aUsd, formatMoneda } from '../../utils/money'
import { periodoDeMes } from '../../utils/periodo'

export function PagosPage() {
  const [pagos, setPagos] = useState<Pago[]>([]), [pedidos, setPedidos] = useState<Pedido[]>([]), [open, setOpen] = useState(false)
  const [tipoCambio, setTipoCambio] = useState(37)
  const [verTodo, setVerTodo] = useState(false)
  const periodo = useMemo(() => periodoDeMes(), [])
  useEffect(() => { void Promise.all([listarPagos(), listarPedidos()]).then(([p, o]) => { setPagos(p); setPedidos(o) }).catch(() => toast.error('No se pudieron cargar los pagos.')); void obtenerTipoCambio().then(setTipoCambio).catch(() => undefined) }, [])
  const descargar = async (pago: Pago) => { const pedido = pedidos.find((item) => item.id === pago.pedido_id); if (!pedido) return toast.error('No se encontró el pedido de este pago.'); try { await descargarRecibo(pago, pedido); toast.success('Comprobante descargado.') } catch { toast.error('No se pudo generar el comprobante.') } }
  const enviarWhatsApp = async (pago: Pago) => { const pedido = pedidos.find((item) => item.id === pago.pedido_id); if (!pedido) return toast.error('No se encontró el pedido de este pago.'); try { const result = await enviarReciboWhatsApp(pago, pedido); if (result === 'cancelled') return; if (result === 'shared') return void toast.success('Comprobante compartido.'); toast.success(result === 'downloaded_no_whatsapp' ? 'Comprobante descargado. Este cliente no tiene WhatsApp guardado.' : 'Comprobante descargado y WhatsApp abierto: adjunta la imagen en el chat.') } catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return; toast.error('No se pudo generar el comprobante.') } }
  const visible = verTodo ? pagos : pagos.filter((p) => { const dia = p.fecha.slice(0, 10); return dia >= periodo.desde && dia <= periodo.hasta })
  const total = visible.filter((p) => p.tipo !== 'reembolso').reduce((sum, p) => sum + Number(p.monto), 0)
  return <div><PageHeader title="Pagos" subtitle="Abonos y pagos finales de clientes." onAdd={() => setOpen(true)} button="Registrar pago" />
    <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-line bg-accent/[.035] p-5 sm:flex-row sm:items-center sm:justify-between">
      <div><span className="flex items-center gap-2 text-xs capitalize text-muted"><CalendarRange size={14} className="text-accent" /> {verTodo ? 'Todos los pagos' : periodo.etiqueta}</span><strong className="mt-1 block text-2xl text-accent">USD {total.toFixed(2)}</strong></div>
      <button className="subtle-button" onClick={() => setVerTodo((value) => !value)}>{verTodo ? 'Ver solo este mes' : 'Ver todos los meses'}</button>
    </div>
    <div className="mt-5 overflow-hidden rounded-2xl border border-line bg-panel">{visible.map((p) =><div key={p.id} className="grid gap-3 border-b border-line px-5 py-4 last:border-0 sm:grid-cols-[1fr_1fr_.7fr_.7fr_auto] sm:items-center"><div><strong className="text-sm">{p.clientes?.nombre}</strong><p className="text-xs text-muted">{p.pedidos?.codigo}</p></div><div><span className="text-xs text-muted">{p.tipo.replace('_', ' ')}</span><p className="text-xs">{p.metodo_pago || 'Sin método'}</p></div><span className="text-xs text-muted">{formatDate(p.fecha)}</span><div><strong className="block text-accent">+ USD {Number(p.monto).toFixed(2)}</strong>{p.moneda === 'NIO' && p.monto_original != null && <span className="text-[10px] text-muted">Recibido {formatMoneda(Number(p.monto_original), 'NIO')}</span>}</div><div className="flex gap-2"><button type="button" className="subtle-button min-h-10 px-3" onClick={() => void descargar(p)} title="Descargar comprobante"><Download size={15} /> <span className="hidden sm:inline">Descargar</span></button><button type="button" className="primary-button min-h-10 px-3" onClick={() => void enviarWhatsApp(p)} title="Enviar comprobante por WhatsApp"><MessageCircle size={15} /> <span className="hidden sm:inline">WhatsApp</span></button></div></div>)}{!visible.length && <Empty text={verTodo ? 'No hay pagos registrados.' : 'No hay pagos este mes.'} />}</div><PagoModal open={open} pedidos={pedidos} tipoCambio={tipoCambio} onClose={() => setOpen(false)} onSaved={(p) => { setPagos((all) => [p, ...all]); const saldo = Number(p.pedidos?.saldo); if (Number.isFinite(saldo)) setPedidos((all) => all.map((item) => item.id === p.pedido_id ? { ...item, saldo, abono: Math.max(0, Number(item.total) - saldo) } : item)); setOpen(false) }} /></div>
}
export function PagoModal({ open, pedidos, tipoCambio, onClose, onSaved, fijarPedido }: { open: boolean; pedidos: Pedido[]; tipoCambio: number; onClose: () => void; onSaved: (p: Pago) => void; fijarPedido?: string }) {
  const vacio = () => ({ pedido_id: fijarPedido ?? '', fecha: new Date().toISOString().slice(0, 10), tipo: 'abono' as Pago['tipo'], monto: 0, moneda: 'USD' as Moneda, metodo_pago: 'Transferencia', referencia: '', observaciones: '' })
  const [form, setForm] = useState(vacio())
  const [destino, setDestino] = useState<DestinoPago>({ cuentaId: null, montoCuenta: 0 })
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (open) { setForm(vacio()); setDestino({ cuentaId: null, montoCuenta: 0 }) } }, [open, fijarPedido])
  const pedidoFijo = fijarPedido ? pedidos.find((p) => p.id === fijarPedido) : null
  const montoUsd = aUsd(form.monto, form.moneda, tipoCambio)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const order = pedidos.find((p) => p.id === form.pedido_id)
    if (!order || montoUsd <= 0) return toast.error('Selecciona el pedido e indica el monto.')
    if (form.tipo !== 'reembolso' && !destino.cuentaId) return toast.error('Elegí a qué cuenta entra el pago.')
    setSaving(true)
    try { const saved = await registrarPago({ pedido_id: form.pedido_id, fecha: form.fecha, tipo: form.tipo, monto: montoUsd, moneda: form.moneda, monto_original: form.monto, tipo_cambio: form.moneda === 'NIO' ? tipoCambio : null, metodo_pago: form.metodo_pago, cliente_id: order.cliente_id, referencia: form.referencia || null, observaciones: form.observaciones || null }, destino); onSaved(saved); toast.success('Abono registrado y saldo actualizado.') }
    catch { toast.error('No se pudo registrar el pago.') } finally { setSaving(false) }
  }
  return <Modal open={open} onClose={onClose} title={pedidoFijo ? `Registrar abono · ${pedidoFijo.codigo}` : 'Registrar pago'}><form onSubmit={(e) => void submit(e)} className="form-grid">
    {pedidoFijo
      ? <label className="form-field col-span-full"><span>Pedido</span><div className="rounded-xl border border-line bg-white/[.03] px-3 py-2.5 text-sm">{pedidoFijo.codigo} · {pedidoFijo.clientes?.nombre} · <span className="text-amber-300">saldo ${Number(pedidoFijo.saldo).toFixed(2)}</span></div></label>
      : <Field label="Pedido"><select value={form.pedido_id} onChange={(e) => setForm({ ...form, pedido_id: e.target.value })}><option value="">Selecciona</option>{pedidos.filter((p) => Number(p.saldo) > 0).map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.clientes?.nombre} · saldo ${Number(p.saldo).toFixed(2)}</option>)}</select></Field>}
    <Field label="Fecha"><input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} /></Field>
    <Field label="Tipo"><select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as Pago['tipo'] })}><option value="abono">Abono</option><option value="pago_final">Pago final</option><option value="reembolso">Reembolso</option></select></Field>
    <MoneyField moneda={form.moneda} montoOriginal={form.monto} tipoCambio={tipoCambio} onMoneda={(moneda) => setForm({ ...form, moneda })} onMonto={(monto) => setForm({ ...form, monto })} />
    <Field label="Método"><input value={form.metodo_pago} onChange={(e) => setForm({ ...form, metodo_pago: e.target.value })} /></Field>
    <Field label="Referencia"><input value={form.referencia} onChange={(e) => setForm({ ...form, referencia: e.target.value })} placeholder="N° de transferencia, etc." /></Field>
    {form.tipo !== 'reembolso' && <CuentaSelect requerido proposito="recibir" montoUsd={montoUsd} tipoCambio={tipoCambio} value={destino} onChange={setDestino} />}
    <label className="form-field col-span-full"><span>Nota</span><textarea rows={2} value={form.observaciones} onChange={(e) => setForm({ ...form, observaciones: e.target.value })} /></label>
    <Actions saving={saving} onClose={onClose} />
  </form></Modal>
}
export function PageHeader({ title, subtitle, onAdd, button }: { title: string; subtitle: string; onAdd: () => void; button: string }) { return <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Finanzas</p><h1 className="page-title">{title}</h1><p className="page-subtitle">{subtitle}</p></div><button className="primary-button px-5" onClick={onAdd}><Plus size={17} /> {button}</button></div> }
export function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="form-field"><span>{label}</span>{children}</label> }
export function Actions({ saving, onClose }: { saving: boolean; onClose: () => void }) { return <div className="col-span-full flex justify-end gap-2"><button type="button" className="subtle-button" onClick={onClose}>Cancelar</button><button className="primary-button px-5" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button></div> }
export function Empty({ text }: { text: string }) { return <div className="grid min-h-40 place-items-center text-sm text-muted"><CircleDollarSign size={22} /><span>{text}</span></div> }
export function formatDate(value: string) { return new Intl.DateTimeFormat('es-NI').format(new Date(value.includes('T') ? value : `${value}T12:00:00`)) }
