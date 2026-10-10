import { CalendarClock, Pause, Play, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { listarCuentas } from '../../services/cuentas.service'
import { guardarGastosFijos, listarGastosFijos, mesDe, procesarGastosFijos, proximoRegistro, type GastoFijo } from '../../services/gastosFijos.service'
import type { CuentaBancaria, Gasto, Moneda } from '../../types/domain'
import { Modal } from '../ui/Modal'

// Gastos fijos del mes: se definen una vez y el panel los registra solo el día indicado.
const CATEGORIAS = ['Publicidad', 'Suscripción', 'Empaque', 'Delivery', 'Personal', 'Otro']
const hoyNic = () => new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10)
const siguienteMes = (mes: string) => { const [y, m] = mes.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}` }
const nombreMes = (mes: string) => new Intl.DateTimeFormat('es-NI', { month: 'long', timeZone: 'UTC' }).format(new Date(`${mes}-01T00:00:00Z`))
const fechaLarga = (iso: string) => new Intl.DateTimeFormat('es-NI', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`))
const VACIO = { descripcion: '', categoria: 'Publicidad', monto: '', moneda: 'USD' as Moneda, dia: '1', cuentaId: '', deGanancia: false, empieza: 'este' as 'este' | 'proximo' }

export function GastosFijosModal({ open, onClose, onRegistrados }: { open: boolean; onClose: () => void; onRegistrados: (gastos: Gasto[]) => void }) {
  const [lista, setLista] = useState<GastoFijo[]>([])
  const [cuentas, setCuentas] = useState<CuentaBancaria[]>([])
  const [form, setForm] = useState(VACIO)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [borrar, setBorrar] = useState<string | null>(null)
  const mesActual = mesDe(hoyNic())

  useEffect(() => {
    if (!open) return
    let vivo = true
    void Promise.all([listarGastosFijos().catch(() => []), listarCuentas().catch(() => [])]).then(([g, c]) => { if (vivo) { setLista(g); setCuentas(c); setCargando(false) } })
    return () => { vivo = false }
  }, [open])

  const persistir = async (nueva: GastoFijo[], ok: string) => {
    setGuardando(true)
    try {
      await guardarGastosFijos(nueva)
      setLista(nueva)
      toast.success(ok)
      // Si alguno ya toca hoy, se registra de una vez.
      const hechos = await procesarGastosFijos().catch(() => [])
      if (hechos.length) { toast.info(`Se ${hechos.length === 1 ? 'registró 1 gasto fijo' : `registraron ${hechos.length} gastos fijos`} que ya ${hechos.length === 1 ? 'tocaba' : 'tocaban'}.`); onRegistrados(hechos); setLista(await listarGastosFijos().catch(() => nueva)) }
    } catch { toast.error('No se pudo guardar.') } finally { setGuardando(false) }
  }

  const agregar = (e: FormEvent) => {
    e.preventDefault()
    const monto = Number(form.monto)
    const dia = Math.min(31, Math.max(1, Math.round(Number(form.dia) || 1)))
    if (!form.descripcion.trim() || !(monto > 0)) return toast.error('Escribí la descripción y el monto.')
    if (!form.cuentaId) return toast.error('Elegí de qué cuenta sale.')
    const nuevo: GastoFijo = {
      id: crypto.randomUUID().slice(0, 8), descripcion: form.descripcion.trim(), categoria: form.categoria, monto, moneda: form.moneda, dia,
      cuentaId: form.cuentaId, deGanancia: form.deGanancia, activo: true, ultimo: null, desde: form.empieza === 'este' ? mesActual : siguienteMes(mesActual),
    }
    setForm(VACIO)
    void persistir([...lista, nuevo], 'Gasto fijo guardado.')
  }

  return <Modal open={open} onClose={onClose} title="Gastos fijos" description="Lo que pagás todos los meses. Se registran solos el día que indiqués: salen de la cuenta elegida y aparecen en Gastos.">
    {cargando ? <div className="h-32 animate-pulse rounded-xl border border-line bg-white/[.02]" /> : <>
      <div className="space-y-2">
        {!lista.length && <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-xs text-muted">Todavía no hay gastos fijos. Agregá el primero abajo.</p>}
        {lista.map((g) => {
          const cuenta = cuentas.find((c) => c.id === g.cuentaId)
          const proximo = proximoRegistro(g)
          return <div key={g.id} className={`rounded-xl border p-3 ${g.activo ? 'border-line bg-white/[.02]' : 'border-line opacity-60'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{g.descripcion}</strong>{g.deGanancia && <span className="status-badge status-neutral">De mi ganancia</span>}{!g.activo && <span className="status-badge status-neutral">En pausa</span>}</div>
                <p className="mt-0.5 text-xs text-muted">{g.categoria} · cada día {g.dia} · {cuenta ? `sale de ${cuenta.nombre}` : <b className="text-amber-200">la cuenta ya no existe: no se registra</b>}</p>
                {g.activo && proximo && <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted"><CalendarClock size={12} /> Próximo: {fechaLarga(proximo)}{g.ultimo ? ` · último registrado: ${nombreMes(g.ultimo)}` : ''}</p>}
              </div>
              <strong className="shrink-0 tabular-nums">{g.moneda === 'NIO' ? 'C$' : 'US$'} {g.monto.toFixed(2)}</strong>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button className="subtle-button" disabled={guardando} onClick={() => void persistir(lista.map((x) => x.id === g.id ? { ...x, activo: !x.activo } : x), g.activo ? 'Gasto fijo en pausa.' : 'Gasto fijo activado.')}>{g.activo ? <><Pause size={13} /> Pausar</> : <><Play size={13} /> Activar</>}</button>
              {borrar === g.id
                ? <><button className="subtle-button text-red-300" disabled={guardando} onClick={() => { setBorrar(null); void persistir(lista.filter((x) => x.id !== g.id), 'Gasto fijo eliminado. Los ya registrados quedan en Gastos.') }}>Sí, eliminar</button><button className="subtle-button" onClick={() => setBorrar(null)}>No</button></>
                : <button className="subtle-button" onClick={() => setBorrar(g.id)}><Trash2 size={13} /> Eliminar</button>}
            </div>
          </div>
        })}
      </div>

      <form onSubmit={agregar} className="form-grid mt-5 border-t border-line pt-5">
        <p className="col-span-full text-xs font-semibold uppercase tracking-wide text-muted">Agregar gasto fijo</p>
        <label className="form-field col-span-full"><span>Descripción</span><input value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} placeholder="Ej: Publicidad de Instagram" /></label>
        <label className="form-field"><span>Categoría</span><select value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })}>{CATEGORIAS.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="form-field"><span>Día del mes (1 a 31)</span><input type="number" min="1" max="31" value={form.dia} onChange={(e) => setForm({ ...form, dia: e.target.value })} /></label>
        <label className="form-field"><span>Monto</span><input type="number" min="0" step="0.01" value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} placeholder="0.00" /></label>
        <label className="form-field"><span>Moneda</span><select value={form.moneda} onChange={(e) => setForm({ ...form, moneda: e.target.value as Moneda })}><option value="USD">Dólares (US$)</option><option value="NIO">Córdobas (C$)</option></select></label>
        <label className="form-field"><span>¿De qué cuenta sale?</span><select value={form.cuentaId} onChange={(e) => setForm({ ...form, cuentaId: e.target.value })}><option value="">Elegí una cuenta…</option>{cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre} ({c.moneda === 'NIO' ? 'C$' : 'US$'})</option>)}</select></label>
        <label className="form-field"><span>Empieza</span><select value={form.empieza} onChange={(e) => setForm({ ...form, empieza: e.target.value as 'este' | 'proximo' })}><option value="este">Este mes ({nombreMes(mesActual)})</option><option value="proximo">El próximo ({nombreMes(siguienteMes(mesActual))})</option></select></label>
        <label className="col-span-full flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-white/[.02] p-3"><input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-accent" checked={form.deGanancia} onChange={(e) => setForm({ ...form, deGanancia: e.target.checked })} /><span className="flex flex-col"><span className="text-sm font-medium">Lo tomo de mi ganancia</span><span className="text-[11px] text-muted">Si lo marcás, cada mes se resta de lo que te toca. Si no, es un gasto del negocio.</span></span></label>
        <p className="col-span-full text-[11px] leading-4 text-muted">Si elegís “este mes” y el día ya pasó, se registra ahora mismo con esa fecha. Si ponés 29, 30 o 31 y el mes es más corto, se registra el último día de ese mes.</p>
        <div className="col-span-full flex justify-end gap-2"><button type="button" className="subtle-button" onClick={onClose}>Cerrar</button><button className="primary-button px-5" disabled={guardando}><Plus size={16} /> {guardando ? 'Guardando…' : 'Agregar'}</button></div>
      </form>
    </>}
  </Modal>
}
