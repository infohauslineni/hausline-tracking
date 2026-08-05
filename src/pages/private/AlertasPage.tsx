import { AlertTriangle, Check, CheckCircle2, Clock3, ImageOff, PackageSearch, RefreshCw, Search, Settings2, ShieldAlert, Truck, UserRound } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Modal } from '../../components/ui/Modal'
import { DEMO_ALERTAS } from '../../data/demoAlerts'
import { isSupabaseConfigured } from '../../lib/supabase'
import { generarAlertas, guardarConfiguracionAlertas, listarAlertas, obtenerConfiguracionAlertas, resolverAlerta, suscribirAlertas, type ConfiguracionAlertas } from '../../services/alertas.service'
import type { Alerta, PrioridadAlerta } from '../../types/domain'

type Vista = 'pendientes' | 'resueltas' | 'todas'
const PRIORIDADES: PrioridadAlerta[] = ['critica', 'alta', 'media', 'baja']
const prioridadLabel: Record<PrioridadAlerta, string> = { critica: 'Crítica', alta: 'Alta', media: 'Media', baja: 'Baja' }
const priorityRank: Record<PrioridadAlerta, number> = { critica: 4, alta: 3, media: 2, baja: 1 }

function AlertIcon({ tipo }: { tipo: string }) {
  if (tipo.includes('tracking') || tipo.includes('siguiente')) return <PackageSearch size={19} />
  if (tipo.includes('actualizacion') || tipo.includes('atrasado')) return <Clock3 size={19} />
  if (tipo.includes('entrega')) return <Truck size={19} />
  if (tipo.includes('foto') || tipo.includes('calidad')) return <ImageOff size={19} />
  if (tipo.includes('cliente')) return <UserRound size={19} />
  return <AlertTriangle size={19} />
}

export function AlertasPage() {
  const [alertas, setAlertas] = useState<Alerta[]>(isSupabaseConfigured ? [] : DEMO_ALERTAS)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [syncing, setSyncing] = useState(false)
  const [vista, setVista] = useState<Vista>('pendientes')
  const [prioridad, setPrioridad] = useState<PrioridadAlerta | 'todas'>('todas')
  const [search, setSearch] = useState('')
  const [configOpen, setConfigOpen] = useState(false)
  const [config, setConfig] = useState<ConfiguracionAlertas>({ dias_sin_actualizacion: 7, dias_atraso: 1 })

  const cargar = useCallback(async (silencioso = false) => {
    if (!isSupabaseConfigured) return
    try { setAlertas(await listarAlertas()) } catch { if (!silencioso) toast.error('No se pudieron cargar las alertas.') } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured) return
    const timer = window.setTimeout(() => void cargar(), 0)
    void obtenerConfiguracionAlertas().then(setConfig).catch(() => undefined)
    const unsubscribe = suscribirAlertas(() => void cargar(true))
    return () => { window.clearTimeout(timer); unsubscribe() }
  }, [cargar])

  const filtradas = useMemo(() => {
    const term = search.trim().toLowerCase()
    return alertas.filter((alerta) => {
      if (vista === 'pendientes' && alerta.resuelta) return false
      if (vista === 'resueltas' && !alerta.resuelta) return false
      if (prioridad !== 'todas' && alerta.prioridad !== prioridad) return false
      return !term || [alerta.titulo, alerta.descripcion, alerta.pedidos?.codigo, alerta.pedidos?.clientes?.nombre].some((value) => value?.toLowerCase().includes(term))
    }).sort((a, b) => Number(a.resuelta) - Number(b.resuelta) || priorityRank[b.prioridad] - priorityRank[a.prioridad] || Date.parse(b.created_at) - Date.parse(a.created_at))
  }, [alertas, prioridad, search, vista])

  const cambiarResolucion = async (alerta: Alerta) => {
    try {
      if (isSupabaseConfigured) {
        const actualizada = await resolverAlerta(alerta.id, !alerta.resuelta)
        setAlertas((current) => current.map((item) => item.id === alerta.id ? actualizada : item))
      } else setAlertas((current) => current.map((item) => item.id === alerta.id ? { ...item, resuelta: !item.resuelta, fecha_resuelta: !item.resuelta ? new Date().toISOString() : null } : item))
      toast.success(alerta.resuelta ? 'Alerta reabierta.' : 'Alerta resuelta.')
    } catch { toast.error('No se pudo actualizar la alerta.') }
  }

  const detectar = async () => {
    setSyncing(true)
    try {
      if (isSupabaseConfigured) { const creadas = await generarAlertas(); await cargar(true); toast.success(creadas ? `${creadas} alertas nuevas detectadas.` : 'No se detectaron alertas nuevas.') }
      else toast.success('La demostración ya está actualizada.')
    } catch { toast.error('No se pudo ejecutar la revisión.') } finally { setSyncing(false) }
  }

  const guardarConfig = async () => {
    if (config.dias_sin_actualizacion < 1 || config.dias_atraso < 0) return toast.error('Revisa los días configurados.')
    try { if (isSupabaseConfigured) await guardarConfiguracionAlertas(config); setConfigOpen(false); toast.success('Configuración guardada.') } catch { toast.error('No se pudo guardar la configuración.') }
  }

  const pendientes = alertas.filter((item) => !item.resuelta)
  return <div>
    {!isSupabaseConfigured && <div className="preview-banner"><strong>Vista previa local:</strong> las acciones se conservan hasta recargar la página.</div>}
    <div className="mb-5 flex items-start gap-3 rounded-xl border border-blue-300/15 bg-blue-300/[0.04] p-4 text-xs leading-5 text-blue-100/75"><ShieldAlert className="mt-0.5 shrink-0 text-blue-300" size={17} /><p>Las alertas se calculan únicamente con datos registrados en Hausline. Sin una API configurada, no consultan USPS ni otras paqueterías automáticamente.</p></div>
    <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"><div><p className="eyebrow">Necesitan atención</p><h1 className="page-title">Alertas operativas</h1><p className="page-subtitle">Detecta retrasos y datos pendientes sin cambiar estados automáticamente.</p></div><div className="flex flex-wrap gap-2"><button className="subtle-button min-h-11" onClick={() => setConfigOpen(true)}><Settings2 size={17} /> Configurar</button><button className="primary-button min-h-11 px-4" disabled={syncing} onClick={() => void detectar()}><RefreshCw size={17} className={syncing ? 'animate-spin' : ''} /> Revisar ahora</button></div></div>
    <section className="mt-7 grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric label="Pendientes" value={pendientes.length} icon={ShieldAlert} tone="danger" /><Metric label="Críticas" value={pendientes.filter((item) => item.prioridad === 'critica').length} icon={AlertTriangle} tone="danger" /><Metric label="Alta prioridad" value={pendientes.filter((item) => item.prioridad === 'alta').length} icon={Clock3} tone="amber" /><Metric label="Resueltas" value={alertas.filter((item) => item.resuelta).length} icon={CheckCircle2} tone="success" /></section>
    <div className="mt-6 flex flex-col gap-3 xl:flex-row"><div className="relative flex-1"><Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" size={18} /><input className="search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pedido, cliente o tipo de alerta" /></div><div className="flex gap-2 overflow-x-auto pb-1">{(['pendientes', 'resueltas', 'todas'] as Vista[]).map((item) => <button key={item} className={`shrink-0 rounded-lg border px-3 py-2 text-xs font-semibold capitalize ${vista === item ? 'border-accent bg-accent text-app' : 'border-line text-muted'}`} onClick={() => setVista(item)}>{item}</button>)}</div><select className="select-input xl:w-48" value={prioridad} onChange={(event) => setPrioridad(event.target.value as PrioridadAlerta | 'todas')}><option value="todas">Toda prioridad</option>{PRIORIDADES.map((item) => <option key={item} value={item}>{prioridadLabel[item]}</option>)}</select></div>
    {loading ? <div className="mt-5 h-80 animate-pulse rounded-2xl border border-line bg-panel" /> : filtradas.length ? <div className="mt-5 grid gap-3 xl:grid-cols-2">{filtradas.map((alerta) => <AlertaCard key={alerta.id} alerta={alerta} onResolve={() => void cambiarResolucion(alerta)} />)}</div> : <div className="mt-5 grid min-h-72 place-items-center rounded-2xl border border-dashed border-line bg-panel/40 p-8 text-center"><div><CheckCircle2 className="mx-auto text-accent" size={32} /><h2 className="mt-3 font-semibold">Todo está bajo control</h2><p className="mt-1 text-sm text-muted">No hay alertas que coincidan con estos filtros.</p></div></div>}
    <Modal title="Configuración de alertas" description="Define cuándo una operación necesita atención." open={configOpen} onClose={() => setConfigOpen(false)}><div className="form-grid"><label className="form-field"><span>Días sin actualización</span><input type="number" min="1" max="90" value={config.dias_sin_actualizacion} onChange={(event) => setConfig((current) => ({ ...current, dias_sin_actualizacion: Number(event.target.value) }))} /><p className="mt-2 text-xs leading-5 text-muted">Alerta cuando un trayecto activo no recibe eventos.</p></label><label className="form-field"><span>Días de tolerancia por atraso</span><input type="number" min="0" max="30" value={config.dias_atraso} onChange={(event) => setConfig((current) => ({ ...current, dias_atraso: Number(event.target.value) }))} /><p className="mt-2 text-xs leading-5 text-muted">Días adicionales después de la fecha estimada.</p></label></div><div className="mt-6 flex justify-end gap-2"><button className="subtle-button" onClick={() => setConfigOpen(false)}>Cancelar</button><button className="primary-button min-h-10 px-4" onClick={() => void guardarConfig()}><Check size={16} /> Guardar</button></div></Modal>
  </div>
}

function Metric({ label, value, icon: Icon, tone }: { label: string; value: number; icon: typeof AlertTriangle; tone: 'danger' | 'amber' | 'success' }) { return <article className="rounded-xl border border-line bg-panel p-3.5 sm:p-4"><span className={`grid size-9 place-items-center rounded-lg ${tone === 'danger' ? 'bg-red-400/10 text-red-300' : tone === 'amber' ? 'bg-amber-300/10 text-amber-300' : 'bg-accent/10 text-accent'}`}><Icon size={18} /></span><strong className="mt-4 block text-2xl">{value}</strong><span className="text-xs text-muted">{label}</span></article> }

function AlertaCard({ alerta, onResolve }: { alerta: Alerta; onResolve: () => void }) {
  return <article className={`rounded-2xl border bg-panel p-4 transition sm:p-5 ${alerta.resuelta ? 'border-line opacity-65' : alerta.prioridad === 'critica' ? 'border-red-400/25' : alerta.prioridad === 'alta' ? 'border-amber-300/20' : 'border-line'}`}>
    <div className="flex items-start gap-3"><span className={`grid size-10 shrink-0 place-items-center rounded-xl ${alerta.resuelta ? 'bg-white/[0.04] text-muted' : alerta.prioridad === 'critica' ? 'bg-red-400/10 text-red-300' : 'bg-amber-300/10 text-amber-300'}`}><AlertIcon tipo={alerta.tipo} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{alerta.titulo}</h2><span className={`status-badge ${alerta.prioridad === 'critica' ? 'status-danger' : alerta.prioridad === 'alta' ? 'border-amber-300/20 bg-amber-300/10 text-amber-200' : 'status-neutral'}`}>{prioridadLabel[alerta.prioridad]}</span>{alerta.resuelta && <span className="status-badge status-success">Resuelta</span>}</div><p className="mt-2 text-sm leading-6 text-muted">{alerta.descripcion}</p></div></div>
    <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between"><div><strong className="text-sm">{alerta.pedidos?.codigo ?? 'Pedido'}</strong><p className="mt-0.5 text-xs text-muted">{alerta.pedidos?.clientes?.nombre} · {new Intl.DateTimeFormat('es-NI', { dateStyle: 'medium' }).format(new Date(alerta.created_at))}</p></div><div className="flex flex-wrap gap-2"><Link to={`/pedidos/${alerta.pedido_id}`} className="subtle-button min-h-10 px-4">Ir a corregir</Link><button className={alerta.resuelta ? 'subtle-button min-h-10' : 'primary-button min-h-10 px-4'} onClick={onResolve}>{alerta.resuelta ? <RefreshCw size={15} /> : <Check size={16} />} {alerta.resuelta ? 'Reabrir' : 'Marcar resuelta'}</button></div></div>
  </article>
}
