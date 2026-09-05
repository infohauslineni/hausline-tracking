import { CalendarClock, Check, Clock3, Cloud, Coins, Info, Power, RefreshCw, Save, ShieldCheck, Smartphone, UserPlus, Users } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { ESTADOS_PEDIDO } from '../../constants/orders'
import { isSupabaseConfigured } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { guardarTipoCambio, obtenerTipoCambio } from '../../services/comercial.service'
import { activarUsuario, crearOperador, listarEquipo, type MiembroEquipo } from '../../services/equipo.service'
import { DEFAULT_ESTIMACIONES, guardarConfiguracionEstimaciones, obtenerConfiguracionEstimaciones, recalcularEstimaciones, type ConfiguracionEstimaciones } from '../../services/estimaciones.service'
import type { EstadoPedido } from '../../types/domain'

const EDITABLE_STATES: EstadoPedido[] = ['pedido_confirmado', 'en_preparacion', 'transito_internacional', 'llego_nicaragua']

export function ConfiguracionPage() {
  const [config, setConfig] = useState<ConfiguracionEstimaciones>(DEFAULT_ESTIMACIONES)
  const [saving, setSaving] = useState(false)
  const [recalculating, setRecalculating] = useState(false)
  const [tipoCambio, setTipoCambio] = useState(37)
  const [savingTc, setSavingTc] = useState(false)
  useEffect(() => { if (isSupabaseConfigured) { void obtenerConfiguracionEstimaciones().then(setConfig).catch(() => toast.error('No se pudo cargar la configuración.')); void obtenerTipoCambio().then(setTipoCambio).catch(() => undefined) } }, [])
  const saveTipoCambio = async () => { if (tipoCambio <= 0) return toast.error('Ingresa un tipo de cambio válido.'); setSavingTc(true); try { if (isSupabaseConfigured) await guardarTipoCambio(tipoCambio); toast.success('Tipo de cambio guardado.') } catch { toast.error('No se pudo guardar el tipo de cambio.') } finally { setSavingTc(false) } }

  const save = async () => {
    setSaving(true)
    try { if (isSupabaseConfigured) await guardarConfiguracionEstimaciones(config); toast.success('Configuración guardada.'); if (isSupabaseConfigured) { const total = await recalcularEstimaciones(); toast.success(`${total} pedidos recalculados.`) } } catch { toast.error('No se pudo guardar la configuración.') } finally { setSaving(false) }
  }
  const recalculate = async () => {
    setRecalculating(true)
    try { const total = isSupabaseConfigured ? await recalcularEstimaciones() : 3; toast.success(`${total} pedidos recalculados.`) } catch { toast.error('No se pudieron recalcular las fechas.') } finally { setRecalculating(false) }
  }
  const setDays = (estado: EstadoPedido, value: number) => setConfig((current) => ({ ...current, dias_por_estado: { ...current.dias_por_estado, [estado]: Math.max(0, Math.min(90, value || 0)) } }))

  return <div>
    {!isSupabaseConfigured && <div className="preview-banner"><strong>Vista previa local:</strong> la configuración real se guardará al conectar Supabase.</div>}
    <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"><div><p className="eyebrow">Sistema</p><h1 className="page-title">Configuración</h1><p className="page-subtitle">Controla las estimaciones y la operación automática.</p></div><div className="flex flex-wrap gap-2"><button className="subtle-button min-h-11" disabled={recalculating} onClick={() => void recalculate()}><RefreshCw size={16} className={recalculating ? 'animate-spin' : ''} /> Recalcular ahora</button><button className="primary-button min-h-11 px-5" disabled={saving} onClick={() => void save()}><Save size={17} /> Guardar cambios</button></div></div>

    <div className="mt-7 grid gap-5 xl:grid-cols-[1.35fr_.65fr]">
      <div className="space-y-5">
        <section className="form-section"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="flex items-center gap-2 font-semibold"><CalendarClock size={18} className="text-accent" /> Fecha de entrega dinámica</h2><p className="mt-2 max-w-2xl text-xs leading-5 text-muted">La fecha cambia según el estado que tú registras. Si el pedido se demora, se mueve hacia adelante; si avanza antes, se acerca.</p></div><label className="flex cursor-pointer items-center gap-2 text-xs text-muted"><input type="checkbox" checked={config.activo} onChange={(event) => setConfig((current) => ({ ...current, activo: event.target.checked }))} className="size-4 accent-[#b7ff00]" /> Activada</label></div>
          <div className="mt-6 rounded-xl border border-accent/15 bg-accent/[0.04] p-4"><div className="flex items-start gap-3"><Info className="mt-0.5 shrink-0 text-accent" size={18} /><p className="text-xs leading-5 text-[#d8ff78]">No consulta USPS ni otras paqueterías por sí sola. Reacciona a los estados y eventos guardados manualmente; cuando exista una API, también podrá reaccionar a esos eventos.</p></div></div>
          <div className="mt-6"><span className="field-label">Margen adicional por imprevistos</span><div className="mt-3 grid grid-cols-2 gap-2">{([1, 2] as const).map((days) => <button key={days} className={`rounded-xl border p-4 text-left transition ${config.dias_margen === days ? 'border-accent bg-accent/[0.07]' : 'border-line bg-white/[0.015]'}`} onClick={() => setConfig((current) => ({ ...current, dias_margen: days }))}><strong className={config.dias_margen === days ? 'text-accent' : ''}>{days} {days === 1 ? 'día' : 'días'}</strong><span className="mt-1 block text-xs text-muted">Se suma al cálculo de cada etapa.</span></button>)}</div></div>
        </section>

        <section className="form-section"><div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="flex items-center gap-2 font-semibold"><Coins size={18} className="text-accent" /> Moneda y tipo de cambio</h2><p className="mt-2 max-w-2xl text-xs leading-5 text-muted">Puedes registrar pagos y gastos en córdobas o dólares. Los córdobas se convierten a dólares con este tipo de cambio para la caja. Ajústalo cuando cambie.</p></div></div>
          <div className="mt-5 flex flex-wrap items-end gap-3"><label className="form-field max-w-[16rem]"><span>Córdobas por 1 dólar (C$ / US$)</span><input type="number" min="1" step=".01" value={tipoCambio} onChange={(event) => setTipoCambio(Number(event.target.value))} /></label><button className="primary-button px-5" disabled={savingTc} onClick={() => void saveTipoCambio()}><Save size={16} /> {savingTc ? 'Guardando…' : 'Guardar tipo de cambio'}</button></div>
          <p className="mt-3 text-[11px] text-muted">Ejemplo: si te pagan C$ 3.660 y el tipo de cambio es {tipoCambio.toFixed(2)}, se registran US$ {(3660 / (tipoCambio || 1)).toFixed(2)}.</p>
        </section>

        <section className="form-section"><h2 className="flex items-center gap-2 font-semibold"><Clock3 size={18} className="text-accent" /> Días restantes por etapa</h2><p className="mt-2 text-xs leading-5 text-muted">Ajusta el tiempo base esperado desde cada estado. El margen se suma automáticamente.</p><div className="mt-5 grid gap-3 sm:grid-cols-2">{EDITABLE_STATES.map((estado) => <label className="form-field" key={estado}><span>{ESTADOS_PEDIDO.find((item) => item.value === estado)?.label}</span><div className="flex items-center gap-2"><input type="number" min="0" max="90" value={config.dias_por_estado[estado] ?? 0} onChange={(event) => setDays(estado, Number(event.target.value))} /><span className="shrink-0 text-xs text-muted">días</span></div></label>)}</div></section>
      </div>

      <aside className="space-y-5"><section className="form-section"><Cloud size={20} className="text-accent" /><h2 className="mt-3 font-semibold">Actualización diaria</h2><p className="mt-2 text-xs leading-5 text-muted">Vercel ejecutará una revisión cada mañana aunque tu computadora esté apagada. También se recalcula inmediatamente cuando cambias el estado.</p><div className="mt-4 flex items-center gap-2 text-xs text-[#62eaa0]"><Check size={15} /> Programación preparada</div></section><section className="form-section"><Smartphone size={20} className="text-accent" /><h2 className="mt-3 font-semibold">Web tradicional responsive</h2><p className="mt-2 text-xs leading-5 text-muted">Optimizada para iPhone, Android, tablet y computadora. No incluye instalación, modo offline, manifest ni Service Worker.</p></section><section className="form-section"><ShieldCheck size={20} className="text-accent" /><h2 className="mt-3 font-semibold">Estimación honesta</h2><p className="mt-2 text-xs leading-5 text-muted">La página pública la identifica como estimada y explica que puede variar. Nunca se presenta como una fecha confirmada por la paquetería.</p></section></aside>
    </div>

    <EquipoSection />
  </div>
}

// Gestión de EMPLEADOS (rol operador): crear la cuenta y activar/desactivar el acceso. El
// operador ve solo la parte operativa (pedidos, encargos, logística, fotos), nunca finanzas
// ni costos. El blindaje real está en el RLS de Supabase; esta pantalla es el control.
function EquipoSection() {
  const { user } = useAuth()
  const [equipo, setEquipo] = useState<MiembroEquipo[]>([])
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [form, setForm] = useState({ nombre: '', correo: '', password: '' })
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const recargar = () => { void listarEquipo().then(setEquipo).catch(() => undefined).finally(() => setLoading(false)) }
  useEffect(() => { if (isSupabaseConfigured) recargar(); else setLoading(false) }, [])

  const crear = async (e: FormEvent) => {
    e.preventDefault()
    if (!form.correo.trim() || form.password.length < 8) return toast.error('Correo válido y contraseña de al menos 8 caracteres.')
    setSaving(true)
    try {
      await crearOperador({ nombre: form.nombre.trim(), correo: form.correo.trim(), password: form.password })
      toast.success('Empleado creado. Pásale su correo y contraseña temporal.')
      setForm({ nombre: '', correo: '', password: '' })
      recargar()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'No se pudo crear el usuario.') }
    finally { setSaving(false) }
  }

  const toggle = async (m: MiembroEquipo) => {
    if (m.id === user?.id) return toast.error('No podés desactivar tu propia cuenta.')
    setBusy(m.id)
    try { await activarUsuario(m.id, !m.activo); toast.success(m.activo ? 'Acceso desactivado.' : 'Acceso activado.'); recargar() }
    catch { toast.error('No se pudo actualizar el acceso.') }
    finally { setBusy(null) }
  }

  return <section className="form-section mt-5">
    <div className="flex flex-col gap-1"><h2 className="flex items-center gap-2 font-semibold"><Users size={18} className="text-accent" /> Equipo</h2><p className="max-w-2xl text-xs leading-5 text-muted">Da acceso a un empleado como <strong>operador</strong>: ve y trabaja los pedidos (fotos, control de calidad, etapas) y los encargos web, <strong>sin ver finanzas, costos ni ganancias</strong>. Podés cortar su acceso cuando quieras.</p></div>

    <form onSubmit={(e) => void crear(e)} className="mt-5 grid gap-3 sm:grid-cols-4">
      <label className="form-field"><span>Nombre</span><input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} placeholder="Nombre del empleado" /></label>
      <label className="form-field"><span>Correo</span><input type="email" autoComplete="off" value={form.correo} onChange={(e) => setForm({ ...form, correo: e.target.value })} placeholder="empleado@correo.com" /></label>
      <label className="form-field"><span>Contraseña temporal</span><input type="text" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Mínimo 8 caracteres" /></label>
      <div className="flex items-end"><button className="primary-button min-h-11 w-full px-4" disabled={saving}><UserPlus size={16} /> {saving ? 'Creando…' : 'Agregar empleado'}</button></div>
    </form>

    <div className="mt-6 divide-y divide-line">
      {loading ? <p className="py-4 text-xs text-muted">Cargando equipo…</p>
        : equipo.length === 0 ? <p className="py-4 text-xs text-muted">Todavía no hay usuarios.</p>
        : equipo.map((m) => <div key={m.id} className="flex items-center gap-3 py-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent/15 text-sm font-bold text-accent">{(m.nombre || m.correo).charAt(0).toUpperCase()}</span>
            <div className="min-w-0 flex-1"><strong className="block truncate text-sm">{m.nombre || m.correo}</strong><span className="block truncate text-[11px] text-muted">{m.correo}</span></div>
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${m.rol === 'admin' ? 'bg-accent/15 text-accent' : 'bg-white/[0.06] text-muted'}`}>{m.rol === 'admin' ? 'Administrador' : 'Operador'}</span>
            <span className={`hidden rounded-full px-2.5 py-1 text-[10px] font-semibold sm:inline ${m.activo ? 'bg-[#62eaa0]/12 text-[#62eaa0]' : 'bg-red-400/12 text-red-300'}`}>{m.activo ? 'Activo' : 'Inactivo'}</span>
            {m.id !== user?.id && <button className={`subtle-button min-h-9 px-3 ${m.activo ? 'text-red-300 hover:text-red-200' : 'text-[#62eaa0]'}`} disabled={busy === m.id} onClick={() => void toggle(m)} title={m.activo ? 'Desactivar acceso' : 'Activar acceso'}><Power size={15} /> {m.activo ? 'Desactivar' : 'Activar'}</button>}
          </div>)}
    </div>
  </section>
}
