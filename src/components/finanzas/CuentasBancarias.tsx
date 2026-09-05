import { ArrowLeftRight, Pencil, Plus, Trash2, Wallet } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Modal } from '../ui/Modal'
import { eliminarCuenta, guardarCuenta, listarCuentas, recibidoPorCuentaMes, transferirEntreCuentas, type CuentaInput } from '../../services/cuentas.service'
import { obtenerTipoCambio } from '../../services/comercial.service'
import type { CuentaBancaria, Moneda } from '../../types/domain'
import { MONEDA_SIMBOLO } from '../../utils/money'

// Formatea el saldo con separador de miles y el símbolo de la moneda de la cuenta.
const formatSaldo = (monto: number, moneda: Moneda) =>
  `${MONEDA_SIMBOLO[moneda]} ${new Intl.NumberFormat('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(monto || 0))}`

// Degradado tipo app del banco. BAC usa su rojo característico; el resto (LAFISE, etc.)
// va por moneda: dólares en verde→esmeralda, córdobas en azul→verde. Así se distinguen
// de un vistazo.
const gradiente = (cuenta: Pick<CuentaBancaria, 'banco' | 'moneda'>) => {
  const banco = (cuenta.banco ?? '').toUpperCase()
  if (banco.includes('BAC')) return 'linear-gradient(135deg, #7f1d1d 0%, #dc2626 55%, #f87171 100%)'
  return cuenta.moneda === 'USD'
    ? 'linear-gradient(135deg, #065f46 0%, #0ea5e9 55%, #34d399 100%)'
    : 'linear-gradient(135deg, #1e3a8a 0%, #0891b2 55%, #34d399 100%)'
}

// Panel de tarjetas de cuentas bancarias con su saldo. Se puede agregar, editar y ajustar
// el saldo (para cuadrar con el banco). El saldo sube solo al registrar pagos hacia la cuenta.
// `refreshKey` sube cada vez que otra acción de la página (registrar/borrar un gasto, etc.)
// cambia el saldo de una cuenta; al cambiar, volvemos a leer los saldos sin recargar la web.
export function CuentasBancarias({ refreshKey = 0 }: { refreshKey?: number }) {
  const [cuentas, setCuentas] = useState<CuentaBancaria[]>([])
  const [recibidoMes, setRecibidoMes] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<CuentaBancaria | null>(null)
  const [creating, setCreating] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [tipoCambio, setTipoCambio] = useState(37)

  const load = () => Promise.all([
    listarCuentas(setCuentas).then(setCuentas),
    recibidoPorCuentaMes(setRecibidoMes).then(setRecibidoMes),
  ]).catch(() => undefined).finally(() => setLoading(false))
  useEffect(() => { void load() }, [refreshKey])
  useEffect(() => { void obtenerTipoCambio().then(setTipoCambio).catch(() => undefined) }, [])

  const total = { USD: 0, NIO: 0 }
  for (const cuenta of cuentas) total[cuenta.moneda] += Number(cuenta.saldo || 0)

  return <section className="mt-4">
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Mis cuentas</p>
      <div className="flex gap-2">
        {cuentas.length >= 2 && <button className="subtle-button px-3 py-1.5 text-xs" onClick={() => setTransferOpen(true)}><ArrowLeftRight size={14} /> Transferir</button>}
        <button className="subtle-button px-3 py-1.5 text-xs" onClick={() => setCreating(true)}><Plus size={14} /> Agregar cuenta</button>
      </div>
    </div>

    <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {cuentas.map((cuenta) => (
        <article key={cuenta.id} className="relative overflow-hidden rounded-2xl p-4 text-white shadow-lg" style={{ background: gradiente(cuenta) }}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="grid size-10 place-items-center rounded-xl bg-white/20 text-xl backdrop-blur">{cuenta.emoji || '🏦'}</span>
              <div className="min-w-0">
                <strong className="block truncate text-sm leading-tight">{cuenta.nombre}</strong>
                <span className="block truncate text-[11px] text-white/80">{cuenta.banco || cuenta.numero || '—'}</span>
              </div>
            </div>
            <button className="grid size-7 shrink-0 place-items-center rounded-lg bg-white/15 text-white/90 transition hover:bg-white/25" onClick={() => setEditing(cuenta)} aria-label="Editar cuenta" title="Editar / ajustar saldo"><Pencil size={14} /></button>
          </div>
          {cuenta.proposito && cuenta.proposito !== 'ambos' && <span className="mt-2.5 inline-block rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide backdrop-blur">{cuenta.proposito === 'recibir' ? 'Solo recibir' : 'Solo comprar'}</span>}
          <p className="mt-3 text-[11px] text-white/80">Saldo disponible</p>
          <strong className="block text-2xl font-bold tracking-tight">{formatSaldo(cuenta.saldo, cuenta.moneda)}</strong>
          {cuenta.limite != null && Number(cuenta.limite) > 0 && (() => {
            const recibido = Math.max(0, Number(recibidoMes[cuenta.id] || 0))
            const pct = Math.min(100, Math.round((recibido / Number(cuenta.limite)) * 100))
            const cerca = pct >= 90
            return <div className="mt-2">
              <div className="flex items-center justify-between gap-2 text-[10px] text-white/80"><span>Recibido este mes: <b className="text-white">{formatSaldo(recibido, cuenta.moneda)}</b> / {formatSaldo(cuenta.limite, cuenta.moneda)}</span><span className={cerca ? 'font-bold text-amber-200' : ''}>{pct}%</span></div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/25"><div className={`h-full rounded-full ${cerca ? 'bg-amber-300' : 'bg-white/70'}`} style={{ width: `${pct}%` }} /></div>
              {cerca && <span className="mt-1 block text-[10px] font-semibold text-amber-200">⚠ Cerca del tope mensual de recepción</span>}
            </div>
          })()}
          {cuenta.numero && <span className="mt-1 block font-mono text-[11px] text-white/70">{cuenta.numero}</span>}
        </article>
      ))}
      {!loading && !cuentas.length && (
        <button onClick={() => setCreating(true)} className="grid min-h-[8.5rem] place-items-center rounded-2xl border border-dashed border-line text-sm text-muted transition hover:border-accent hover:text-accent sm:col-span-2 xl:col-span-3">
          <span className="flex flex-col items-center gap-1"><Wallet size={22} /> Agrega tu primera cuenta</span>
        </button>
      )}
    </div>

    {(total.USD > 0 || total.NIO > 0) && (
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 px-1 text-xs text-muted">
        {total.NIO > 0 && <span>Total en córdobas: <strong className="text-white">{formatSaldo(total.NIO, 'NIO')}</strong></span>}
        {total.USD > 0 && <span>Total en dólares: <strong className="text-white">{formatSaldo(total.USD, 'USD')}</strong></span>}
      </div>
    )}

    <CuentaModal open={creating || !!editing} cuenta={editing} onClose={() => { setCreating(false); setEditing(null) }} onSaved={() => { setCreating(false); setEditing(null); void load() }} />
    <TransferModal open={transferOpen} cuentas={cuentas} tipoCambio={tipoCambio} onClose={() => setTransferOpen(false)} onSaved={() => { setTransferOpen(false); void load() }} />
  </section>
}

// Convierte un monto de la moneda de una cuenta a la de otra (para proponer cuánto llega).
function convertir(monto: number, de: Moneda, a: Moneda, tc: number): number {
  const n = Number(monto) || 0
  if (de === a) return Math.round(n * 100) / 100
  const tasa = tc > 0 ? tc : 37
  // USD → NIO: redondea a la decena (como en el resto de la app). NIO → USD: 2 decimales.
  return a === 'NIO' ? Math.round((n * tasa) / 10) * 10 : Math.round((n / tasa) * 100) / 100
}

function TransferModal({ open, cuentas, tipoCambio, onClose, onSaved }: { open: boolean; cuentas: CuentaBancaria[]; tipoCambio: number; onClose: () => void; onSaved: () => void }) {
  const [origenId, setOrigenId] = useState('')
  const [destinoId, setDestinoId] = useState('')
  const [monto, setMonto] = useState(0)
  const [montoDestino, setMontoDestino] = useState(0)
  const [editadoDestino, setEditadoDestino] = useState(false)
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (open) { setOrigenId(''); setDestinoId(''); setMonto(0); setMontoDestino(0); setEditadoDestino(false) } }, [open])

  const origen = cuentas.find((c) => c.id === origenId) ?? null
  const destino = cuentas.find((c) => c.id === destinoId) ?? null
  const distintaMoneda = !!origen && !!destino && origen.moneda !== destino.moneda
  // Mientras no se toque a mano, el monto que llega sigue al de origen (convertido si aplica).
  useEffect(() => {
    if (!editadoDestino && origen && destino) setMontoDestino(convertir(monto, origen.moneda, destino.moneda, tipoCambio))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monto, origenId, destinoId, tipoCambio])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      await transferirEntreCuentas(origenId, destinoId, monto, distintaMoneda ? montoDestino : monto)
      toast.success('Transferencia registrada. Los saldos se actualizaron.')
      onSaved()
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo transferir.') } finally { setSaving(false) }
  }

  return <Modal open={open} onClose={onClose} title="Transferir entre cuentas" description="Mové dinero de una cuenta a otra. Baja el saldo de origen y sube el de destino (no afecta la caja).">
    <form onSubmit={(e) => void submit(e)} className="form-grid">
      <label className="form-field"><span>Desde</span><select value={origenId} onChange={(e) => setOriginAndReset(e.target.value)}><option value="">Cuenta de origen</option>{cuentas.map((c) => <option key={c.id} value={c.id} disabled={c.id === destinoId}>{c.emoji} {c.nombre} · {formatSaldo(c.saldo, c.moneda)}</option>)}</select></label>
      <label className="form-field"><span>Hacia</span><select value={destinoId} onChange={(e) => { setEditadoDestino(false); setDestinoId(e.target.value) }}><option value="">Cuenta de destino</option>{cuentas.map((c) => <option key={c.id} value={c.id} disabled={c.id === origenId}>{c.emoji} {c.nombre} ({MONEDA_SIMBOLO[c.moneda]})</option>)}</select></label>
      <label className="form-field"><span>Monto que sale{origen ? ` (${MONEDA_SIMBOLO[origen.moneda]})` : ''}</span><input type="number" min="0" step=".01" value={monto} onChange={(e) => { setMonto(Number(e.target.value)); setEditadoDestino(false) }} autoFocus /></label>
      {distintaMoneda && <label className="form-field"><span>Monto que llega ({MONEDA_SIMBOLO[destino!.moneda]})</span><input type="number" min="0" step=".01" value={montoDestino} onChange={(e) => { setEditadoDestino(true); setMontoDestino(Number(e.target.value)) }} /></label>}
      {origen && destino && monto > 0 && <div className="col-span-full rounded-xl border border-line bg-white/[.025] p-3 text-xs text-muted">De <strong className="text-red-300">−{formatSaldo(monto, origen.moneda)}</strong> ({origen.nombre}) a <strong className="text-green-300">+{formatSaldo(distintaMoneda ? montoDestino : monto, destino.moneda)}</strong> ({destino.nombre}).</div>}
      <div className="col-span-full flex justify-end gap-2"><button type="button" className="subtle-button" onClick={onClose}>Cancelar</button><button className="primary-button px-5" disabled={saving || !origenId || !destinoId || !(monto > 0)}>{saving ? 'Transfiriendo…' : 'Transferir'}</button></div>
    </form>
  </Modal>

  function setOriginAndReset(value: string) { setEditadoDestino(false); setOrigenId(value); if (value === destinoId) setDestinoId('') }
}

function CuentaModal({ open, cuenta, onClose, onSaved }: { open: boolean; cuenta: CuentaBancaria | null; onClose: () => void; onSaved: () => void }) {
  const vacio = (): CuentaInput => ({ nombre: '', banco: '', numero: '', titular: '', moneda: 'NIO', emoji: '🏦', saldo: 0, orden: 0, proposito: 'ambos', limite: null })
  const [form, setForm] = useState<CuentaInput>(vacio())
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (open) setForm(cuenta ? { nombre: cuenta.nombre, banco: cuenta.banco ?? '', numero: cuenta.numero ?? '', titular: cuenta.titular ?? '', moneda: cuenta.moneda, emoji: cuenta.emoji || '🏦', saldo: Number(cuenta.saldo || 0), orden: cuenta.orden, proposito: cuenta.proposito ?? 'ambos', limite: cuenta.limite ?? null } : vacio()) }, [open, cuenta])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!form.nombre.trim()) return toast.error('Ponle un nombre a la cuenta.')
    setSaving(true)
    try {
      await guardarCuenta({ ...form, nombre: form.nombre.trim(), banco: form.banco?.trim() || null, numero: form.numero?.trim() || null, titular: form.titular?.trim() || null, saldo: Number(form.saldo || 0), limite: Number(form.limite) > 0 ? Number(form.limite) : null }, cuenta?.id)
      toast.success(cuenta ? 'Cuenta actualizada.' : 'Cuenta agregada.')
      onSaved()
    } catch { toast.error('No se pudo guardar la cuenta.') } finally { setSaving(false) }
  }

  const borrar = async () => {
    if (!cuenta) return
    if (!window.confirm(`¿Quitar la cuenta "${cuenta.nombre}"? Ya no aparecerá en las tarjetas.`)) return
    try { await eliminarCuenta(cuenta.id); toast.success('Cuenta quitada.'); onSaved() }
    catch { toast.error('No se pudo quitar la cuenta.') }
  }

  return <Modal open={open} onClose={onClose} title={cuenta ? 'Editar cuenta' : 'Agregar cuenta'} description={cuenta ? 'Corrige el saldo para cuadrarlo con lo que muestra el banco.' : 'La nueva cuenta aparecerá como tarjeta y podrás recibir pagos en ella.'}>
    <form onSubmit={(event) => void submit(event)} className="form-grid">
      <label className="form-field"><span>Ícono</span><input value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })} maxLength={4} placeholder="🏦" /></label>
      <label className="form-field"><span>Nombre</span><input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} placeholder="Ej: Cuenta Digital" autoFocus /></label>
      <label className="form-field"><span>Banco</span><input value={form.banco ?? ''} onChange={(e) => setForm({ ...form, banco: e.target.value })} placeholder="Ej: LAFISE" /></label>
      <label className="form-field"><span>Número de cuenta</span><input value={form.numero ?? ''} onChange={(e) => setForm({ ...form, numero: e.target.value })} placeholder="Ej: 138038710" /></label>
      <label className="form-field"><span>Titular</span><input value={form.titular ?? ''} onChange={(e) => setForm({ ...form, titular: e.target.value })} placeholder="Nombre del titular" /></label>
      <label className="form-field"><span>Moneda</span><select value={form.moneda} onChange={(e) => setForm({ ...form, moneda: e.target.value as Moneda })}><option value="NIO">Córdobas (C$)</option><option value="USD">Dólares (US$)</option></select></label>
      <label className="form-field"><span>Saldo actual ({MONEDA_SIMBOLO[form.moneda]})</span><input type="number" step=".01" value={form.saldo} onChange={(e) => setForm({ ...form, saldo: Number(e.target.value) })} /></label>
      <label className="form-field"><span>¿Para qué la usás?</span><select value={form.proposito} onChange={(e) => setForm({ ...form, proposito: e.target.value as CuentaInput['proposito'] })}><option value="ambos">Comprar y recibir</option><option value="recibir">Solo recibir pagos</option><option value="comprar">Solo comprar / pagar</option></select></label>
      <label className="form-field"><span>Límite mensual de recepción ({MONEDA_SIMBOLO[form.moneda]}, opcional)</span><input type="number" min="0" step=".01" value={form.limite ?? ''} onChange={(e) => setForm({ ...form, limite: e.target.value === '' ? null : Number(e.target.value) })} placeholder="Ej: 1500" /></label>
      <div className="col-span-full flex items-center justify-between gap-2 pt-1">
        {cuenta ? <button type="button" className="inline-flex items-center gap-1.5 text-xs text-red-300 hover:text-red-200" onClick={() => void borrar()}><Trash2 size={14} /> Quitar cuenta</button> : <span />}
        <div className="flex gap-2"><button type="button" className="subtle-button" onClick={onClose}>Cancelar</button><button className="primary-button px-5" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button></div>
      </div>
    </form>
  </Modal>
}
