import { AlertTriangle, BadgeCheck, Check, CheckCircle2, ChevronDown, Eye, HeartPulse, LogIn, MailCheck, MapPin, MessageCircle, RefreshCw, Search, Send, ShoppingBag, Trash2, Users, X } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useEstadoVista } from '../../hooks/useEstadoVista'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { isSupabaseConfigured } from '../../lib/supabase'
import { activarCuentaCliente, eliminarCuentaCliente, sugerenciaCorreo, listarCuentasClientes, listarCuentasRevisadas, listarEventosClientes, marcarCuentaRevisada, marcarEventosRevisados, reenviarConfirmacion, type CuentaCliente, type CuentaRevisada, type EventoCliente, type MotivoAyuda } from '../../services/saludClientes.service'
import { whatsappUrl } from '../../utils/whatsapp'
import { DireccionesClienteCard } from '../../components/clientes/DireccionesClienteCard'
import { ClienteAvatar } from '../../components/clientes/ClienteAvatar'
import { listarAvataresClientes } from '../../services/clientes.service'
import { contarDireccionesPorCuenta } from '../../services/direccionesCliente.service'

type Rango = 1 | 7 | 30
const RANGOS: [Rango, string][] = [[1, 'Últimas 24 h'], [7, '7 días'], [30, '30 días']]

// Qué significa cada cosa que anota la tienda, en palabras del negocio.
const NOMBRE_ERROR: Record<string, string> = {
  error_visto: 'Le salió un error en pantalla',
  rpc_error: 'No cargaron sus datos',
  aviso_error: 'Le salió un aviso de error',
  js_error: 'Falla de la página (código)',
  promesa_error: 'Falla de la página (código)',
  supabase_no_cargo: 'No cargó el sistema de cuentas',
  enlace_invalido: 'El enlace del correo no funcionó (vencido o inválido)',
  login_fallido: 'Falla del sistema al ingresar',
  crear_fallido: 'Falla del sistema al crear la cuenta',
  recuperar_fallido: 'Falla al enviar el correo de recuperación',
  nueva_fallido: 'Falla al guardar la contraseña nueva',
  checkout_error: 'Falla en el checkout',
  comprobante_error: 'No pudo subir el comprobante',
  seguimiento_error: 'El seguimiento no cargó (vio "No pudimos cargar tu pedido")',
  fotos_error: 'No cargaron las fotos del seguimiento',
  pantalla_error: 'Vio la pantalla "Algo salió mal"',
  cupon_error: 'No se pudo validar el cupón',
}
// Qué suele significar cada error y si hay que hacer algo (para no tener que adivinar).
const AYUDA_ERROR: Record<string, string> = {
  js_error: 'Un archivo de la página no cargó o falló, casi siempre por mala señal del cliente. La tienda ya se recupera sola; si se repite mucho, avisá.',
  promesa_error: 'Una acción de la página falló, casi siempre por mala señal. Si se repite mucho, avisá.',
  rpc_error: 'Sus datos no llegaron (señal o sesión vencida). Se reintenta solo.',
  supabase_no_cargo: 'El sistema de cuentas no cargó en ese teléfono (señal o bloqueador).',
  enlace_invalido: 'Abrió un enlace viejo o ya usado. Puede pedir uno nuevo.',
  checkout_error: 'Algo falló al hacer el encargo. Revisá si te escribió o si el encargo quedó a medias.',
  comprobante_error: 'No pudo subir la foto del comprobante: pedíselo por WhatsApp.',
  cupon_error: 'El cupón no se pudo validar (señal o código mal escrito).',
  seguimiento_error: 'No le cargó su pedido: revisá que el código exista.',
}
const ORIGEN: Record<EventoCliente['origen'], string> = { tienda: 'Tienda', cuenta: 'Mi cuenta', checkout: 'Checkout', seguimiento: 'Seguimiento' }
const MOTIVO_LOGIN: Record<string, string> = {
  credenciales: 'Correo o contraseña incorrectos', sin_confirmar: 'No había confirmado el correo', ya_registrado: 'El correo ya tenía cuenta',
  demasiados_intentos: 'Demasiados intentos', clave_debil: 'Contraseña muy corta', sistema: 'Falla del sistema',
}

const fechaHora = (iso: string) => new Intl.DateTimeFormat('es-NI', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
function hace(iso: string | null) {
  if (!iso) return 'Nunca'
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (min < 1) return 'Ahora'
  if (min < 60) return `Hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `Hace ${h} h`
  const d = Math.round(h / 24)
  return d < 30 ? `Hace ${d} ${d === 1 ? 'día' : 'días'}` : fechaHora(iso)
}
const visitasDe = (lista: EventoCliente[]) => new Set(lista.map((e) => e.visita ?? `id${e.id}`)).size
const primerNombre = (n: string) => (n || '').trim().split(/\s+/)[0] || ''
// [valor, veces] ordenado de más a menos frecuente.
function contar(valores: string[]): [string, number][] {
  const m = new Map<string, number>()
  for (const v of valores) m.set(v, (m.get(v) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

type GrupoError = { clave: string; nombre: string; mensaje: string | null; origen: EventoCliente['origen']; eventos: EventoCliente[]; visitas: number }

// ¿A los clientes les funciona todo? Junta las cuentas de Mi cuenta y los fallos que la
// tienda anota sola, para enterarse de un problema aunque el cliente no lo reporte.
export function SaludClientesPage() {
  const [cuentas, setCuentas] = useState<CuentaCliente[]>([])
  // Cuenta a eliminar (se pide confirmación en una ventana antes de borrarla).
  const [borrar, setBorrar] = useState<CuentaCliente | null>(null)
  const [borrando, setBorrando] = useState(false)
  const [eventos, setEventos] = useState<EventoCliente[]>([])
  const [rango, setRango] = useEstadoVista<Rango>('salud.rango', 7)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [abierto, setAbierto] = useState<string | null>(null)
  const [verTodas, setVerTodas] = useEstadoVista('salud.verTodas', false)
  const [verRevisados, setVerRevisados] = useState(false)
  const [revisadas, setRevisadas] = useState<CuentaRevisada[]>([])
  const [numDirecciones, setNumDirecciones] = useState<Map<string, number>>(new Map())
  const [cuentaAbierta, setCuentaAbierta] = useState<string | null>(null)
  // Momento de la última carga: base de "últimas 24 h / 7 días" (fijo entre renders).
  const [ahora, setAhora] = useState(() => Date.now())

  const cargar = useCallback(async () => {
    if (!isSupabaseConfigured) return // loading ya arranca en false sin Supabase
    const [c, e, r, d] = await Promise.allSettled([listarCuentasClientes(), listarEventosClientes(30), listarCuentasRevisadas(), contarDireccionesPorCuenta()])
    if (c.status === 'fulfilled') setCuentas(c.value)
    if (e.status === 'fulfilled') setEventos(e.value)
    if (r.status === 'fulfilled') setRevisadas(r.value)
    if (d.status === 'fulfilled') setNumDirecciones(d.value)
    setAhora(Date.now())
    if (c.status === 'rejected' || e.status === 'rejected') toast.error('No se pudo cargar todo. ¿Aplicaste la migración 202609260001_salud_clientes?')
    setLoading(false)
  }, [])
  useEffect(() => { void Promise.resolve().then(cargar) }, [cargar])

  const correoDe = useMemo(() => new Map(cuentas.map((c) => [c.user_id, c.correo])), [cuentas])
  const enRango = useMemo(() => { const desde = ahora - rango * 86_400_000; return eventos.filter((e) => new Date(e.created_at).getTime() >= desde) }, [eventos, rango, ahora])
  // Los revisados salen de la lista (pero siguen guardados); "Ver revisados" los muestra.
  const errores = useMemo(() => enRango.filter((e) => e.tipo === 'error' && (verRevisados || !e.revisado_at)), [enRango, verRevisados])
  const revisadosEnRango = enRango.filter((e) => e.tipo === 'error' && e.revisado_at).length
  const grupos = useMemo<GrupoError[]>(() => {
    const m = new Map<string, GrupoError>()
    for (const e of errores) {
      const clave = `${e.nombre}|${e.mensaje ?? ''}`
      const g = m.get(clave) ?? { clave, nombre: e.nombre, mensaje: e.mensaje, origen: e.origen, eventos: [], visitas: 0 }
      g.eventos.push(e); m.set(clave, g)
    }
    return [...m.values()].map((g) => ({ ...g, visitas: visitasDe(g.eventos) })).sort((a, b) => b.visitas - a.visitas || b.eventos[0].created_at.localeCompare(a.eventos[0].created_at))
  }, [errores])

  const de = (nombre: string) => enRango.filter((e) => e.nombre === nombre)
  const vistasCuenta = visitasDe(enRango.filter((e) => e.nombre === 'vio_cuenta' || e.nombre === 'vio_mis_pedidos' || e.nombre === 'vio_pedido'))
  const vistasLink = visitasDe(de('vio_seguimiento'))
  const loginOk = de('login_ok').length
  const loginFallidos = de('login_fallido')
  const motivos = contar(loginFallidos.map((e) => String(e.detalle?.motivo ?? 'sistema')))
  // Visitas que intentaron entrar y nunca lo lograron: clientes que se quedaron afuera.
  const entraron = new Set(de('login_ok').map((e) => e.visita))
  const sinPoderEntrar = new Set(loginFallidos.filter((e) => !entraron.has(e.visita)).map((e) => e.visita)).size
  const eventosCodigo = enRango.filter((e) => (e.nombre === 'seguimiento_no_encontrado' || e.nombre === 'pedido_no_encontrado') && e.mensaje && !e.revisado_at)
  const codigosPerdidos = contar(eventosCodigo.map((e) => e.mensaje as string)).slice(0, 12)

  // Marca (o desmarca) eventos como revisados: se ve al instante y se guarda en la base.
  const revisar = async (ids: number[], revisado = true) => {
    const antes = eventos
    const marca = revisado ? new Date().toISOString() : null
    setEventos((lista) => lista.map((e) => ids.includes(e.id) ? { ...e, revisado_at: marca } : e))
    try { await marcarEventosRevisados(ids, revisado); toast.success(revisado ? 'Marcado como revisado. Sigue guardado: lo ves con "Ver revisados".' : 'Vuelve a aparecer en la lista.') }
    catch { setEventos(antes); toast.error('No se pudo guardar. ¿Aplicaste la migración 202609260003_salud_revisados?') }
  }
  const esRevisada = (userId: string, motivo: MotivoAyuda) => revisadas.some((r) => r.user_id === userId && r.motivo === motivo)
  const contactado = async (userId: string, motivo: MotivoAyuda) => {
    setRevisadas((lista) => [...lista, { user_id: userId, motivo, revisado_at: new Date().toISOString() }])
    try { await marcarCuentaRevisada(userId, motivo); toast.success('Listo, sale de la lista.') }
    catch { setRevisadas((lista) => lista.filter((r) => !(r.user_id === userId && r.motivo === motivo))); toast.error('No se pudo guardar. ¿Aplicaste la migración 202609260003_salud_revisados?') }
  }

  const confirmadas = cuentas.filter((c) => c.confirmada_at).length
  const activas7 = cuentas.filter((c) => c.ultimo_ingreso_at && ahora - new Date(c.ultimo_ingreso_at).getTime() < 7 * 86_400_000).length
  const conPedidos = cuentas.filter((c) => c.pedidos > 0).length
  const sinConfirmar = cuentas.filter((c) => !c.confirmada_at && ahora - new Date(c.creada_at).getTime() > 3_600_000 && !esRevisada(c.user_id, 'sin_confirmar'))
  const sinPedidos = cuentas.filter((c) => c.confirmada_at && c.pedidos === 0 && !esRevisada(c.user_id, 'sin_pedidos'))
  const pendientes = errores.filter((e) => !e.revisado_at)
  const visitasConError = visitasDe(pendientes)
  const [busca, setBusca] = useState('')
  // Fotos de perfil de Mi cuenta (por id de la cuenta).
  const [avatares, setAvatares] = useState<Record<string, string>>({})
  useEffect(() => { if (isSupabaseConfigured) void listarAvataresClientes().then((a) => setAvatares(a.porUsuario)).catch(() => undefined) }, [])
  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return t ? cuentas.filter((c) => [c.nombre, c.correo, c.telefono].some((v) => String(v ?? '').toLowerCase().includes(t))) : cuentas
  }, [cuentas, busca])
  const tablaCuentasVista = busca.trim() ? filtradas : (verTodas ? cuentas : cuentas.slice(0, 15))
  const pctConfirmadas = cuentas.length ? Math.round((confirmadas / cuentas.length) * 100) : 0

  return (
    <div className="mx-auto max-w-6xl">
      {!isSupabaseConfigured && <div className="preview-banner"><strong>Vista previa local:</strong> esta pantalla necesita conexión a Supabase.</div>}

      {/* Encabezado */}
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Link to="/configuracion" className="eyebrow inline-flex items-center gap-1 hover:underline">← Configuración</Link>
          <h1 className="page-title">Salud de clientes</h1>
          <p className="page-subtitle max-w-2xl">Errores que ven los clientes en la tienda, el checkout, Mi cuenta y el seguimiento — anotados solos, aunque nadie te lo diga.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-xl border border-line bg-white/[0.02] p-1">
            {RANGOS.map(([v, t]) => (
              <button key={v} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${rango === v ? 'bg-accent text-black' : 'text-muted hover:text-white'}`} onClick={() => setRango(v)}>{t}</button>
            ))}
          </div>
          <button className="grid size-9 place-items-center rounded-xl border border-line bg-white/[0.02] text-muted transition hover:text-white" title="Actualizar" aria-label="Actualizar" onClick={() => { setLoading(true); void cargar() }} disabled={loading}><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /></button>
        </div>
      </header>

      {loading ? <div className="mt-6 grid gap-3"><div className="h-20 animate-pulse rounded-2xl border border-line bg-panel" /><div className="h-28 animate-pulse rounded-2xl border border-line bg-panel" /><div className="h-64 animate-pulse rounded-2xl border border-line bg-panel" /></div> : <>
        {/* Estado general */}
        <div className={`mt-6 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center ${pendientes.length ? 'border-red-400/25 bg-gradient-to-r from-red-500/[0.08] to-transparent' : 'border-emerald-400/20 bg-gradient-to-r from-emerald-500/[0.08] to-transparent'}`}>
          <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${pendientes.length ? 'bg-red-400/15 text-red-300' : 'bg-emerald-400/15 text-emerald-300'}`}>{pendientes.length ? <AlertTriangle size={20} /> : <CheckCircle2 size={20} />}</span>
          <div className="min-w-0 flex-1">
            <p className={`font-semibold ${pendientes.length ? 'text-red-100' : 'text-emerald-100'}`}>{pendientes.length ? `${visitasConError === 1 ? '1 cliente tuvo' : `${visitasConError} clientes tuvieron`} problemas` : 'Todo en orden'}</p>
            <p className="mt-0.5 text-sm text-muted">{pendientes.length ? `${pendientes.length} ${pendientes.length === 1 ? 'error sin revisar' : 'errores sin revisar'} en ${rango === 1 ? 'las últimas 24 h' : `los últimos ${rango} días`}.` : `${revisadosEnRango ? 'No hay errores sin revisar' : 'Ningún cliente vio un error'} en ${rango === 1 ? 'las últimas 24 h' : `los últimos ${rango} días`}.`}</p>
          </div>
          {pendientes.length > 0 && <a href="#errores" className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-red-400/30 px-3 py-2 text-xs font-semibold text-red-200 transition hover:bg-red-400/10">Ver errores <ChevronDown size={14} /></a>}
        </div>

        {/* Métricas de cuentas */}
        <section className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi icono={<Users size={16} />} titulo="Cuentas creadas" valor={cuentas.length} nota="en Mi cuenta" />
          <Kpi icono={<MailCheck size={16} />} titulo="Correo confirmado" valor={confirmadas} nota={cuentas.length ? `${pctConfirmadas}% del total` : '—'} barra={pctConfirmadas} />
          <Kpi icono={<LogIn size={16} />} titulo="Activas esta semana" valor={activas7} nota="entraron en 7 días" />
          <Kpi icono={<ShoppingBag size={16} />} titulo="Con pedidos" valor={conPedidos} nota={`${cuentas.length - conPedidos} todavía sin comprar`} />
        </section>

        {/* Uso */}
        <section className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="rounded-2xl border border-line bg-panel p-5">
            <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">Cómo siguen sus pedidos</h2><span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] text-muted">{RANGOS.find((r) => r[0] === rango)?.[1]}</span></div>
            <Barra etiqueta="Con el link del correo (sin cuenta)" valor={vistasLink} total={vistasLink + vistasCuenta} />
            <Barra etiqueta="Entrando a Mi cuenta" valor={vistasCuenta} total={vistasLink + vistasCuenta} />
            <p className="mt-4 text-[11px] text-muted">Visitas distintas que abrieron su pedido.</p>
          </div>
          <div className="rounded-2xl border border-line bg-panel p-5">
            <h2 className="text-sm font-semibold">Ingresos a Mi cuenta</h2>
            <div className="mt-3 grid grid-cols-4 gap-2">
              <MiniStat etiqueta="Registros" valor={de('registro_ok').length} />
              <MiniStat etiqueta="Confirmaron" valor={de('correo_verificado').length} />
              <MiniStat etiqueta="Entraron" valor={loginOk} tono="ok" />
              <MiniStat etiqueta="Fallidos" valor={loginFallidos.length} tono={loginFallidos.length ? 'alerta' : undefined} />
            </div>
            {motivos.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{motivos.map(([k, n]) => <span key={k} className="rounded-full border border-line px-2.5 py-1 text-[11px] text-muted">{MOTIVO_LOGIN[k] ?? k} · <b className="text-white/85">{n}</b></span>)}</div>}
            {sinPoderEntrar > 0 && <p className="mt-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.05] px-3 py-2 text-[12px] text-amber-200/90">{sinPoderEntrar === 1 ? '1 visita intentó entrar y no lo logró' : `${sinPoderEntrar} visitas intentaron entrar y no lo lograron`}. Si se repite, puede que no les llegue el correo o que olviden la contraseña.</p>}
          </div>
        </section>

        {/* Errores */}
        <section className="mt-8" id="errores">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-base font-semibold">Errores que vieron los clientes {pendientes.length > 0 && <span className="rounded-full bg-red-400/15 px-2 py-0.5 text-[11px] font-bold text-red-300">{pendientes.length}</span>}</h2>
            <div className="flex flex-wrap gap-2">
              {pendientes.length > 1 && <button className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-xs font-semibold text-muted transition hover:border-emerald-400/40 hover:text-emerald-300" onClick={() => void revisar(pendientes.map((e) => e.id))}><Check size={13} /> Marcar todos como revisados</button>}
              {revisadosEnRango > 0 && <button className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${verRevisados ? 'border-accent/50 text-accent' : 'border-line text-muted hover:text-white'}`} onClick={() => setVerRevisados((v) => !v)}><Eye size={13} /> {verRevisados ? 'Ocultar revisados' : `Revisados (${revisadosEnRango})`}</button>}
            </div>
          </div>
          {grupos.length === 0 ? <div className="mt-3 rounded-2xl border border-dashed border-line px-6 py-10 text-center text-sm text-muted"><CheckCircle2 size={22} className="mx-auto mb-2 text-emerald-300/80" />{revisadosEnRango ? 'Todos los errores de este período ya están revisados.' : 'Ningún error en este período.'}</div> : (
            <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-panel">
              {grupos.map((g) => {
                const open = abierto === g.clave
                const sinRevisar = g.eventos.filter((e) => !e.revisado_at)
                return (
                  <article key={g.clave} className={`border-b border-line last:border-0 ${sinRevisar.length ? '' : 'opacity-55'}`}>
                    <div className="flex items-start gap-3 p-4">
                      <span className={`mt-0.5 grid min-w-9 place-items-center rounded-lg px-2 py-1 text-sm font-bold ${sinRevisar.length ? 'bg-red-400/12 text-red-300' : 'bg-white/[0.05] text-muted'}`}>{g.eventos.length}</span>
                      <button className="min-w-0 flex-1 text-left" onClick={() => setAbierto(open ? null : g.clave)}>
                        <span className="block text-sm font-semibold">{NOMBRE_ERROR[g.nombre] ?? g.nombre}</span>
                        {AYUDA_ERROR[g.nombre] && <span className="mt-0.5 block text-[12px] text-white/60">{AYUDA_ERROR[g.nombre]}</span>}
                        {g.mensaje && <span className="mt-1 block truncate font-mono text-[11px] text-muted" title={g.mensaje}>{g.mensaje}</span>}
                        <span className="mt-2 flex flex-wrap gap-1.5 text-[10.5px]">
                          <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-muted">{ORIGEN[g.origen]}</span>
                          <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-muted">{g.visitas === 1 ? '1 cliente' : `${g.visitas} clientes`}</span>
                          <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-muted">{hace(g.eventos[0].created_at)}</span>
                        </span>
                      </button>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {sinRevisar.length
                          ? <button className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-semibold text-muted transition hover:border-emerald-400/40 hover:text-emerald-300" onClick={() => void revisar(sinRevisar.map((e) => e.id))}><Check size={13} /> Revisado</button>
                          : <button className="rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-semibold text-muted hover:text-white" onClick={() => void revisar(g.eventos.map((e) => e.id), false)}>Mostrar</button>}
                        <button className="grid size-8 place-items-center rounded-lg text-muted hover:bg-white/[0.05] hover:text-white" aria-label="Ver detalle" onClick={() => setAbierto(open ? null : g.clave)}><ChevronDown size={16} className={`transition ${open ? 'rotate-180' : ''}`} /></button>
                      </div>
                    </div>
                    {open && (
                      <ul className="mx-4 mb-4 overflow-hidden rounded-xl border border-line text-[12px]">
                        {g.eventos.slice(0, 30).map((e) => (
                          <li key={e.id} className="grid gap-x-3 gap-y-0.5 border-b border-line/60 bg-black/20 px-3 py-2 last:border-0 sm:grid-cols-[130px_1fr]">
                            <span className="text-white/80">{fechaHora(e.created_at)}</span>
                            <span className="min-w-0"><span className="text-muted">{e.dispositivo ?? '—'}</span> <span className="break-all font-mono text-[11px] text-muted">· {e.pagina}</span>{e.user_id && correoDe.get(e.user_id) && <span className="ml-1 text-accent">· {correoDe.get(e.user_id)}</span>}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                )
              })}
            </div>
          )}
        </section>

        {codigosPerdidos.length > 0 && (
          <section className="mt-6 rounded-2xl border border-line bg-panel p-5">
            <h2 className="text-sm font-semibold">Códigos que buscaron y no aparecieron</h2>
            <p className="mt-0.5 text-[12px] text-muted">Si parece un código correcto (HS + 6 números), revisá si ese pedido existe o si al cliente le diste otro código.</p>
            <div className="mt-3 flex flex-wrap gap-2">{codigosPerdidos.map(([c, n]) => <span key={c} className="inline-flex items-center gap-1 rounded-full border border-line py-1 pl-2.5 pr-1 font-mono text-[12px]">{c}{n > 1 ? <b className="ml-1 text-amber-300">×{n}</b> : null}<button className="grid size-5 place-items-center rounded-full text-muted hover:bg-white/10 hover:text-white" title="Quitar (queda guardado)" aria-label={`Quitar ${c}`} onClick={() => void revisar(eventosCodigo.filter((e) => e.mensaje === c).map((e) => e.id))}><X size={12} /></button></span>)}</div>
          </section>
        )}

        {/* Cuentas que necesitan ayuda */}
        {(sinConfirmar.length > 0 || sinPedidos.length > 0) && (
          <section className="mt-6 grid gap-3 lg:grid-cols-2">
            {sinConfirmar.length > 0 && <ListaAyuda avatares={avatares} titulo="No confirmaron su correo" nota="Puede que el correo les haya caído en spam o no les llegó."
              cuentas={sinConfirmar} onListo={(c) => void contactado(c.user_id, 'sin_confirmar')}
              extra={(c) => <AccionesConfirmar cuenta={c} onActivada={(fecha) => setCuentas((lista) => lista.map((x) => x.user_id === c.user_id ? { ...x, confirmada_at: fecha } : x))} />} mensaje={(c) => `Hola${primerNombre(c.nombre) ? ` ${primerNombre(c.nombre)}` : ''}, le saludamos del equipo de HAUSLINE 👋 Vimos que creó su cuenta en nuestra tienda, pero todavía falta confirmar su correo. ¿Le llegó el mensaje? Revise también la carpeta de spam; si no aparece, le ayudamos por aquí.`} />}
            {sinPedidos.length > 0 && <ListaAyuda avatares={avatares} titulo="Todavía no compran" nota="Invitalos a su primera compra. Si ya te compraron con otro correo, vinculá el pedido desde la ficha del cliente."
              cuentas={sinPedidos} onListo={(c) => void contactado(c.user_id, 'sin_pedidos')} mensaje={(c) => `Hola${primerNombre(c.nombre) ? ` ${primerNombre(c.nombre)}` : ''}, le saludamos del equipo de HAUSLINE 👋 ¡Gracias por crear su cuenta en nuestra tienda! Cuando desee hacer su primer pedido, estamos para ayudarle: puede ver lo nuevo en hauslineshopni.es o escribirnos por aquí si busca algún modelo o talla en especial.`} />}
          </section>
        )}

        {/* Todas las cuentas */}
        <section className="mt-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-base font-semibold">Cuentas de clientes <span className="text-muted">({cuentas.length})</span></h2>
              <p className="mt-0.5 text-[12px] text-muted">Tocá las direcciones para ver dónde vive cada cliente (con mapa), aunque todavía no haya comprado.</p>
            </div>
            {cuentas.length > 5 && <div className="relative sm:w-72"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input className="w-full rounded-xl border border-line bg-white/[0.02] py-2 pl-9 pr-3 text-sm outline-none focus:border-accent/50" placeholder="Buscar por nombre, correo o teléfono" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>}
          </div>
          {cuentas.length === 0 ? <div className="mt-3 rounded-2xl border border-dashed border-line px-6 py-12 text-center"><HeartPulse size={28} className="mx-auto text-muted" /><p className="mt-3 text-sm text-muted">Todavía nadie creó una cuenta en la tienda.</p></div> : (
            <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-panel">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-white/[0.02] text-[10.5px] uppercase tracking-wider text-muted"><tr className="border-b border-line">
                  <th className="px-4 py-3 font-semibold">Cliente</th><th className="px-3 py-3 font-semibold">Correo</th><th className="px-3 py-3 font-semibold">Creada</th><th className="px-3 py-3 font-semibold">Último ingreso</th><th className="px-3 py-3 font-semibold">Direcciones</th><th className="px-4 py-3 text-right font-semibold">Pedidos</th><th className="px-2 py-3"><span className="sr-only">Acciones</span></th>
                </tr></thead>
                <tbody>
                  {tablaCuentasVista.map((c) => {
                    const nDir = numDirecciones.get(c.user_id) ?? 0
                    const abiertaCuenta = cuentaAbierta === c.user_id
                    return <Fragment key={c.user_id}>
                    <tr className="border-b border-line/60 transition last:border-0 hover:bg-white/[0.015]">
                      <td className="px-4 py-3"><div className="flex items-center gap-3"><ClienteAvatar nombre={c.nombre || c.correo} url={avatares[c.user_id]} size={36} /><div className="min-w-0"><p className="truncate font-semibold">{c.nombre || 'Sin nombre'}</p><p className="truncate text-[11px] text-muted">{c.correo}</p>{sugerenciaCorreo(c.correo) && <p className="mt-0.5 text-[10.5px] font-semibold text-amber-300">¿Mal escrito? Quizás {sugerenciaCorreo(c.correo)}</p>}</div>{c.telefono && <a className="ml-auto grid size-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-white/[0.05] hover:text-accent" href={whatsappUrl(c.telefono)} target="_blank" rel="noreferrer" title={`WhatsApp ${c.telefono}`}><MessageCircle size={14} /></a>}</div></td>
                      <td className="px-3 py-3 text-[12px]">{c.confirmada_at ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 font-semibold text-emerald-300"><Check size={11} /> Confirmado</span> : <span className="rounded-full bg-amber-400/10 px-2 py-0.5 font-semibold text-amber-300">Sin confirmar</span>}</td>
                      <td className="px-3 py-3 text-[12px] text-muted">{fechaHora(c.creada_at)}</td>
                      <td className="px-3 py-3 text-[12px] text-muted">{hace(c.ultimo_ingreso_at)}</td>
                      <td className="px-3 py-3 text-[12px]">{nDir ? <button className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold transition ${abiertaCuenta ? 'bg-accent text-black' : 'bg-accent/10 text-accent hover:bg-accent/20'}`} onClick={() => setCuentaAbierta(abiertaCuenta ? null : c.user_id)}><MapPin size={12} /> {nDir} {abiertaCuenta ? '· ocultar' : nDir === 1 ? 'dirección' : 'direcciones'}</button> : <span className="text-muted">—</span>}</td>
                      <td className="px-4 py-3 text-right"><span className={`inline-grid min-w-8 place-items-center rounded-lg px-2 py-1 text-xs font-bold ${c.pedidos ? 'bg-white/[0.06] text-white' : 'text-muted'}`}>{c.pedidos}</span></td>
                      <td className="px-2 py-3 text-right"><button className="table-action table-action-danger" onClick={() => setBorrar(c)} aria-label={`Eliminar la cuenta de ${c.correo}`} title="Eliminar cuenta"><Trash2 size={15} /></button></td>
                    </tr>
                    {abiertaCuenta && <tr className="border-b border-line/60 bg-black/20"><td colSpan={7} className="px-4 pb-4"><DireccionesClienteCard userId={c.user_id} /></td></tr>}
                    </Fragment>
                  })}
                  {tablaCuentasVista.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-muted">Ninguna cuenta coincide con “{busca}”.</td></tr>}
                </tbody>
              </table>
              {!busca.trim() && cuentas.length > 15 && <button className="w-full border-t border-line py-3 text-xs font-semibold text-accent hover:bg-white/[0.02]" onClick={() => setVerTodas((v) => !v)}>{verTodas ? 'Ver menos' : `Ver las ${cuentas.length} cuentas`}</button>}
            </div>
          )}
        </section>
      </>}
      <Modal open={!!borrar} onClose={() => { if (!borrando) setBorrar(null) }} title="¿Eliminar esta cuenta?" description="Esto no se puede deshacer.">
        {borrar && <div className="space-y-4 text-sm">
          <div className="rounded-xl border border-line bg-white/[0.02] p-4">
            <p className="font-semibold">{borrar.nombre || 'Sin nombre'}</p>
            <p className="mt-0.5 text-muted">{borrar.correo}</p>
            {sugerenciaCorreo(borrar.correo) && <p className="mt-1 text-xs font-semibold text-amber-300">El correo parece mal escrito: quizás {sugerenciaCorreo(borrar.correo)}</p>}
            <p className="mt-2 text-xs text-muted">{borrar.confirmada_at ? 'Cuenta confirmada' : 'Nunca confirmó su correo'} · {borrar.pedidos} {borrar.pedidos === 1 ? 'pedido' : 'pedidos'}</p>
          </div>
          <p className="leading-6 text-muted">Se borran su usuario y contraseña, su perfil, sus direcciones y sus favoritos. {borrar.pedidos > 0 ? 'Sus pedidos se conservan en el panel.' : 'No tiene pedidos.'} Si después quiere entrar, tendrá que crear una cuenta nueva.</p>
          <div className="flex flex-wrap justify-end gap-2">
            <button className="subtle-button" disabled={borrando} onClick={() => setBorrar(null)}>Cancelar</button>
            <button className="primary-button !bg-red-500 !text-white hover:!bg-red-400" disabled={borrando} onClick={() => {
              const c = borrar; setBorrando(true)
              void eliminarCuentaCliente(c.user_id)
                .then(() => { setCuentas((todas) => todas.filter((x) => x.user_id !== c.user_id)); toast.success(`Cuenta ${c.correo} eliminada.`); setBorrar(null) })
                .catch((e) => toast.error(e instanceof Error ? e.message : 'No se pudo eliminar la cuenta.'))
                .finally(() => setBorrando(false))
            }}><Trash2 size={15} /> {borrando ? 'Eliminando…' : 'Sí, eliminar la cuenta'}</button>
          </div>
        </div>}
      </Modal>
    </div>
  )
}

function Kpi({ icono, titulo, valor, nota, barra }: { icono: ReactNode; titulo: string; valor: number; nota: string; barra?: number }) {
  return <div className="rounded-2xl border border-line bg-panel p-4">
    <div className="flex items-center justify-between gap-2"><p className="text-[11px] font-semibold text-muted">{titulo}</p><span className="grid size-8 place-items-center rounded-lg bg-accent/10 text-accent">{icono}</span></div>
    <p className="mt-2 text-3xl font-bold tracking-tight">{valor}</p>
    {barra != null ? <div className="mt-2 h-1.5 rounded-full bg-white/[0.06]"><div className="h-1.5 rounded-full bg-accent" style={{ width: `${barra}%` }} /></div> : null}
    <p className="mt-1.5 text-[11px] text-muted">{nota}</p>
  </div>
}

function MiniStat({ etiqueta, valor, tono }: { etiqueta: string; valor: number; tono?: 'ok' | 'alerta' }) {
  return <div className="rounded-xl border border-line bg-white/[0.02] px-3 py-2.5 text-center">
    <p className={`text-xl font-bold ${tono === 'ok' ? 'text-emerald-300' : tono === 'alerta' ? 'text-amber-300' : ''}`}>{valor}</p>
    <p className="text-[10.5px] text-muted">{etiqueta}</p>
  </div>
}

function Barra({ etiqueta, valor, total }: { etiqueta: string; valor: number; total: number }) {
  const pct = total ? Math.round((valor / total) * 100) : 0
  return <div className="mt-4"><div className="flex justify-between text-sm"><span className="text-white/85">{etiqueta}</span><b>{valor}{total ? <span className="ml-1 text-[11px] font-normal text-muted">{pct}%</span> : null}</b></div><div className="mt-1.5 h-2 rounded-full bg-white/[0.06]"><div className="h-2 rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} /></div></div>
}

// "No le llegó el correo": reenviarlo, o activar la cuenta desde el panel (solo admin).
function AccionesConfirmar({ cuenta, onActivada }: { cuenta: CuentaCliente; onActivada: (fecha: string) => void }) {
  const [ocupado, setOcupado] = useState<'' | 'reenviar' | 'activar'>('')
  const reenviar = async () => {
    setOcupado('reenviar')
    try { await reenviarConfirmacion(cuenta.correo); toast.success(`Le volvimos a mandar el correo a ${cuenta.correo}.`) }
    catch (e) { toast.error(e instanceof Error && /seconds|rate/i.test(e.message) ? 'Esperá un minuto antes de volver a mandarlo.' : 'No se pudo reenviar. Probá con "Activar".') }
    finally { setOcupado('') }
  }
  const activar = async () => {
    if (!window.confirm(`¿Activar la cuenta de ${cuenta.nombre || cuenta.correo}?\n\nQueda como si hubiera confirmado su correo (${cuenta.correo}) y ya puede ingresar con su contraseña.`)) return
    setOcupado('activar')
    try { const fecha = await activarCuentaCliente(cuenta.user_id); toast.success('Cuenta activada. Ya puede ingresar en la tienda con su contraseña.'); onActivada(fecha) }
    catch (e) { toast.error(e instanceof Error && /activar_cuenta_cliente|schema cache/i.test(e.message) ? 'Falta aplicar la migración 202610030001.' : e instanceof Error ? e.message : 'No se pudo activar.') }
    finally { setOcupado('') }
  }
  return <>
    <button className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted hover:bg-white/[0.05] hover:text-white disabled:opacity-50" title="Le vuelve a mandar el correo de confirmación" disabled={!!ocupado} onClick={() => void reenviar()}><Send size={13} /> {ocupado === 'reenviar' ? 'Enviando…' : 'Reenviar'}</button>
    <button className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-emerald-400/30 px-2 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-400/10 disabled:opacity-50" title="Confirma su cuenta sin el correo" disabled={!!ocupado} onClick={() => void activar()}><BadgeCheck size={13} /> {ocupado === 'activar' ? 'Activando…' : 'Activar'}</button>
  </>
}

function ListaAyuda({ titulo, nota, cuentas, mensaje, onListo, extra, avatares }: { avatares?: Record<string, string>; titulo: string; nota: string; cuentas: CuentaCliente[]; mensaje: (c: CuentaCliente) => string; onListo: (c: CuentaCliente) => void; extra?: (c: CuentaCliente) => ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-5">
      <div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold">{titulo}</p><span className="rounded-full bg-amber-400/12 px-2 py-0.5 text-[11px] font-bold text-amber-300">{cuentas.length}</span></div>
      <p className="mt-0.5 text-[12px] text-muted">{nota}</p>
      <ul className="mt-3 divide-y divide-line/60">
        {cuentas.slice(0, 10).map((c) => (
          <li key={c.user_id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
            <ClienteAvatar nombre={c.nombre || c.correo} url={avatares?.[c.user_id]} size={28} />
            <span className="min-w-0 flex-1 truncate">{c.nombre || c.correo} <span className="text-[11px] text-muted">· {hace(c.creada_at)}</span>{extra && c.correo ? <span className="block truncate text-[11px] text-muted">{c.correo}</span> : null}</span>
            {extra?.(c)}
            {c.telefono && <a className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-accent hover:bg-accent/10" href={whatsappUrl(c.telefono, mensaje(c))} target="_blank" rel="noreferrer"><MessageCircle size={13} /> Escribir</a>}
            <button className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted hover:bg-white/[0.05] hover:text-white" title="Sale de la lista (queda guardado)" onClick={() => onListo(c)}><Check size={13} /> Listo</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
