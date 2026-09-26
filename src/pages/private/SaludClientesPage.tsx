import { AlertTriangle, CheckCircle2, ChevronDown, HeartPulse, MessageCircle, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { isSupabaseConfigured } from '../../lib/supabase'
import { listarCuentasClientes, listarEventosClientes, type CuentaCliente, type EventoCliente } from '../../services/saludClientes.service'
import { whatsappUrl } from '../../utils/whatsapp'

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
  seguimiento_error: 'El seguimiento no cargó (vio "no encontrado")',
  fotos_error: 'No cargaron las fotos del seguimiento',
  pantalla_error: 'Vio la pantalla "Algo salió mal"',
  cupon_error: 'No se pudo validar el cupón',
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
  const [eventos, setEventos] = useState<EventoCliente[]>([])
  const [rango, setRango] = useState<Rango>(7)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [abierto, setAbierto] = useState<string | null>(null)
  const [verTodas, setVerTodas] = useState(false)
  // Momento de la última carga: base de "últimas 24 h / 7 días" (fijo entre renders).
  const [ahora, setAhora] = useState(() => Date.now())

  const cargar = useCallback(async () => {
    if (!isSupabaseConfigured) return // loading ya arranca en false sin Supabase
    const [c, e] = await Promise.allSettled([listarCuentasClientes(), listarEventosClientes(30)])
    if (c.status === 'fulfilled') setCuentas(c.value)
    if (e.status === 'fulfilled') setEventos(e.value)
    setAhora(Date.now())
    if (c.status === 'rejected' || e.status === 'rejected') toast.error('No se pudo cargar todo. ¿Aplicaste la migración 202609260001_salud_clientes?')
    setLoading(false)
  }, [])
  useEffect(() => { void Promise.resolve().then(cargar) }, [cargar])

  const correoDe = useMemo(() => new Map(cuentas.map((c) => [c.user_id, c.correo])), [cuentas])
  const enRango = useMemo(() => { const desde = ahora - rango * 86_400_000; return eventos.filter((e) => new Date(e.created_at).getTime() >= desde) }, [eventos, rango, ahora])
  const errores = useMemo(() => enRango.filter((e) => e.tipo === 'error'), [enRango])
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
  const codigosPerdidos = contar(enRango.filter((e) => (e.nombre === 'seguimiento_no_encontrado' || e.nombre === 'pedido_no_encontrado') && e.mensaje).map((e) => e.mensaje as string)).slice(0, 12)

  const confirmadas = cuentas.filter((c) => c.confirmada_at).length
  const activas7 = cuentas.filter((c) => c.ultimo_ingreso_at && ahora - new Date(c.ultimo_ingreso_at).getTime() < 7 * 86_400_000).length
  const conPedidos = cuentas.filter((c) => c.pedidos > 0).length
  const sinConfirmar = cuentas.filter((c) => !c.confirmada_at && ahora - new Date(c.creada_at).getTime() > 3_600_000)
  const sinPedidos = cuentas.filter((c) => c.confirmada_at && c.pedidos === 0)
  const visitasConError = visitasDe(errores)
  const tablaCuentas = verTodas ? cuentas : cuentas.slice(0, 15)

  return (
    <div>
      {!isSupabaseConfigured && <div className="preview-banner"><strong>Vista previa local:</strong> esta pantalla necesita conexión a Supabase.</div>}
      <p className="eyebrow">Clientes y productos</p>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="page-title">Salud de clientes</h1>
        <button className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white/[0.02] px-3 py-2 text-xs font-semibold text-muted transition hover:text-white" onClick={() => { setLoading(true); void cargar() }} disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Actualizar</button>
      </div>
      <p className="page-subtitle">La tienda, el checkout, Mi cuenta y el seguimiento anotan solos cada error que ve un cliente. Aquí te enterás aunque nadie te lo diga.</p>

      <div className="mt-5 flex flex-wrap gap-2">
        {RANGOS.map(([v, t]) => (
          <button key={v} className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${rango === v ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line text-muted hover:text-white'}`} onClick={() => setRango(v)}>{t}</button>
        ))}
      </div>

      {loading ? <div className="mt-5 h-64 animate-pulse rounded-2xl border border-line bg-panel" /> : <>
        {/* Estado general */}
        {errores.length === 0 ? (
          <div className="mt-5 flex items-start gap-3 rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.06] p-4">
            <CheckCircle2 size={22} className="mt-0.5 shrink-0 text-emerald-300" />
            <div><p className="font-semibold text-emerald-200">Todo en orden</p><p className="mt-0.5 text-sm text-muted">Ningún cliente vio un error en {rango === 1 ? 'las últimas 24 h' : `los últimos ${rango} días`}.</p></div>
          </div>
        ) : (
          <div className="mt-5 flex items-start gap-3 rounded-2xl border border-red-400/30 bg-red-400/[0.06] p-4">
            <AlertTriangle size={22} className="mt-0.5 shrink-0 text-red-300" />
            <div><p className="font-semibold text-red-200">{visitasConError === 1 ? '1 cliente tuvo' : `${visitasConError} clientes tuvieron`} problemas</p><p className="mt-0.5 text-sm text-muted">{errores.length} {errores.length === 1 ? 'error' : 'errores'} en {grupos.length} {grupos.length === 1 ? 'tipo' : 'tipos'} distintos. Abajo ves cuál, dónde y en qué teléfono.</p></div>
          </div>
        )}

        {/* Cuentas */}
        <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi titulo="Cuentas creadas" valor={cuentas.length} nota="en Mi cuenta" />
          <Kpi titulo="Confirmaron el correo" valor={confirmadas} nota={cuentas.length ? `${Math.round((confirmadas / cuentas.length) * 100)}% del total` : '—'} />
          <Kpi titulo="Entraron esta semana" valor={activas7} nota="últimos 7 días" />
          <Kpi titulo="Con pedidos vinculados" valor={conPedidos} nota={`${cuentas.length - conPedidos} sin pedidos`} />
        </section>

        {/* Uso */}
        <section className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="rounded-2xl border border-line bg-panel p-4">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Cómo ven sus pedidos · {RANGOS.find((r) => r[0] === rango)?.[1].toLowerCase()}</p>
            <Barra etiqueta="Con el link del correo (sin cuenta)" valor={vistasLink} total={vistasLink + vistasCuenta} />
            <Barra etiqueta="Entrando a Mi cuenta" valor={vistasCuenta} total={vistasLink + vistasCuenta} />
            <p className="mt-3 text-[11px] text-muted">Cuenta visitas distintas. Se registra desde hoy en adelante.</p>
          </div>
          <div className="rounded-2xl border border-line bg-panel p-4">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Ingresos a Mi cuenta</p>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span>Registros: <b>{de('registro_ok').length}</b></span>
              <span>Confirmaron correo: <b>{de('correo_verificado').length}</b></span>
              <span>Entraron: <b className="text-emerald-300">{loginOk}</b></span>
              <span>Intentos fallidos: <b className={loginFallidos.length ? 'text-amber-300' : ''}>{loginFallidos.length}</b></span>
            </div>
            {motivos.length > 0 && <ul className="mt-2 space-y-0.5 text-[12px] text-muted">{motivos.map(([k, n]) => <li key={k}>· {MOTIVO_LOGIN[k] ?? k}: <b className="text-white/80">{n}</b></li>)}</ul>}
            {sinPoderEntrar > 0 && <p className="mt-2 text-[12px] text-amber-200/90">{sinPoderEntrar === 1 ? '1 visita intentó entrar y no lo logró' : `${sinPoderEntrar} visitas intentaron entrar y no lo lograron`}. Si son muchas, puede que no les llegue el correo o que olviden la contraseña.</p>}
          </div>
        </section>

        {/* Errores */}
        <section className="mt-6">
          <h2 className="text-sm font-bold">Errores que vieron los clientes</h2>
          {grupos.length === 0 ? <p className="mt-2 text-sm text-muted">Ninguno en este período.</p> : (
            <div className="mt-3 space-y-2">
              {grupos.map((g) => {
                const open = abierto === g.clave
                return (
                  <article key={g.clave} className="rounded-2xl border border-line bg-panel">
                    <button className="flex w-full items-start gap-3 p-4 text-left" onClick={() => setAbierto(open ? null : g.clave)}>
                      <span className="mt-0.5 grid min-w-9 place-items-center rounded-lg bg-red-400/12 px-2 py-1 text-sm font-bold text-red-300">{g.eventos.length}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">{NOMBRE_ERROR[g.nombre] ?? g.nombre}</span>
                        {g.mensaje && <span className="mt-0.5 block break-words text-[12px] text-muted">{g.mensaje}</span>}
                        <span className="mt-1 block text-[11px] text-muted">{ORIGEN[g.origen]} · {g.visitas === 1 ? '1 cliente' : `${g.visitas} clientes`} · último: {hace(g.eventos[0].created_at)}</span>
                      </span>
                      <ChevronDown size={16} className={`mt-1 shrink-0 text-muted transition ${open ? 'rotate-180' : ''}`} />
                    </button>
                    {open && (
                      <ul className="border-t border-line px-4 py-2 text-[12px]">
                        {g.eventos.slice(0, 30).map((e) => (
                          <li key={e.id} className="flex flex-wrap gap-x-3 gap-y-0.5 border-b border-line/60 py-1.5 last:border-0">
                            <span className="text-white/80">{fechaHora(e.created_at)}</span>
                            <span className="text-muted">{e.dispositivo ?? '—'}</span>
                            <span className="break-all font-mono text-[11px] text-muted">{e.pagina}</span>
                            {e.user_id && correoDe.get(e.user_id) && <span className="text-accent">{correoDe.get(e.user_id)}</span>}
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
          <section className="mt-6 rounded-2xl border border-line bg-panel p-4">
            <h2 className="text-sm font-bold">Códigos que buscaron y no aparecieron</h2>
            <p className="mt-0.5 text-[12px] text-muted">Si un código parece correcto (HS + 6 números), revisá si ese pedido existe o si le diste otro código al cliente.</p>
            <div className="mt-2 flex flex-wrap gap-2">{codigosPerdidos.map(([c, n]) => <span key={c} className="rounded-full border border-line px-2.5 py-1 font-mono text-[12px]">{c}{n > 1 ? <b className="ml-1 text-amber-300">×{n}</b> : null}</span>)}</div>
          </section>
        )}

        {/* Cuentas que necesitan ayuda */}
        {(sinConfirmar.length > 0 || sinPedidos.length > 0) && (
          <section className="mt-6 grid gap-3 lg:grid-cols-2">
            {sinConfirmar.length > 0 && <ListaAyuda titulo="Se registraron y no confirmaron el correo" nota="Puede que el correo les haya caído en spam o no les llegó."
              cuentas={sinConfirmar} mensaje={(c) => `Hola${primerNombre(c.nombre) ? ` ${primerNombre(c.nombre)}` : ''}, te saluda HAUSLINE. Vimos que creaste tu cuenta en nuestra tienda. ¿Te llegó el correo para confirmarla? Revisá también la carpeta de spam; si no aparece, te ayudamos por aquí.`} />}
            {sinPedidos.length > 0 && <ListaAyuda titulo="Cuentas sin pedidos vinculados" nota="Si ya te compraron, puede que hayan usado otro correo. Vinculalo desde la ficha del cliente (Cuenta web)."
              cuentas={sinPedidos} mensaje={(c) => `Hola${primerNombre(c.nombre) ? ` ${primerNombre(c.nombre)}` : ''}, te saluda HAUSLINE. Vimos que creaste tu cuenta. Si ya tenés un pedido con nosotros y no te aparece, decinos tu código de pedido y lo vinculamos a tu cuenta.`} />}
          </section>
        )}

        {/* Todas las cuentas */}
        <section className="mt-6">
          <h2 className="text-sm font-bold">Cuentas de clientes ({cuentas.length})</h2>
          {cuentas.length === 0 ? <div className="mt-3 rounded-2xl border border-line bg-panel px-6 py-12 text-center"><HeartPulse size={28} className="mx-auto text-muted" /><p className="mt-3 text-sm text-muted">Todavía nadie creó una cuenta en la tienda.</p></div> : (
            <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-panel">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-[10px] uppercase tracking-wide text-muted"><tr className="border-b border-line">
                  <th className="px-4 py-2.5 font-bold">Cliente</th><th className="px-3 py-2.5 font-bold">Creada</th><th className="px-3 py-2.5 font-bold">Correo</th><th className="px-3 py-2.5 font-bold">Último ingreso</th><th className="px-3 py-2.5 text-right font-bold">Pedidos</th>
                </tr></thead>
                <tbody>
                  {tablaCuentas.map((c) => (
                    <tr key={c.user_id} className="border-b border-line/60 last:border-0">
                      <td className="px-4 py-2.5"><p className="font-semibold">{c.nombre || 'Sin nombre'}</p><p className="text-[11px] text-muted">{c.correo}</p></td>
                      <td className="px-3 py-2.5 text-[12px] text-muted">{fechaHora(c.creada_at)}</td>
                      <td className="px-3 py-2.5 text-[12px]">{c.confirmada_at ? <span className="text-emerald-300">Confirmado</span> : <span className="text-amber-300">Sin confirmar</span>}</td>
                      <td className="px-3 py-2.5 text-[12px] text-muted">{hace(c.ultimo_ingreso_at)}</td>
                      <td className="px-3 py-2.5 text-right font-semibold">{c.pedidos}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {cuentas.length > 15 && <button className="w-full border-t border-line py-2.5 text-xs font-semibold text-accent" onClick={() => setVerTodas((v) => !v)}>{verTodas ? 'Ver menos' : `Ver las ${cuentas.length}`}</button>}
            </div>
          )}
        </section>
      </>}
    </div>
  )
}

function Kpi({ titulo, valor, nota }: { titulo: string; valor: number; nota: string }) {
  return <div className="rounded-2xl border border-line bg-panel p-4"><p className="text-[10px] font-bold uppercase tracking-wide text-muted">{titulo}</p><p className="mt-1 text-2xl font-bold">{valor}</p><p className="text-[11px] text-muted">{nota}</p></div>
}

function Barra({ etiqueta, valor, total }: { etiqueta: string; valor: number; total: number }) {
  const pct = total ? Math.round((valor / total) * 100) : 0
  return <div className="mt-3"><div className="flex justify-between text-sm"><span>{etiqueta}</span><b>{valor}{total ? <span className="ml-1 text-[11px] font-normal text-muted">({pct}%)</span> : null}</b></div><div className="mt-1 h-2 rounded-full bg-white/[0.06]"><div className="h-2 rounded-full bg-accent" style={{ width: `${pct}%` }} /></div></div>
}

function ListaAyuda({ titulo, nota, cuentas, mensaje }: { titulo: string; nota: string; cuentas: CuentaCliente[]; mensaje: (c: CuentaCliente) => string }) {
  return (
    <div className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.04] p-4">
      <p className="text-sm font-semibold text-amber-200">{titulo} ({cuentas.length})</p>
      <p className="mt-0.5 text-[12px] text-muted">{nota}</p>
      <ul className="mt-2 space-y-1.5">
        {cuentas.slice(0, 10).map((c) => (
          <li key={c.user_id} className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{c.nombre || c.correo} <span className="text-[11px] text-muted">· {hace(c.creada_at)}</span></span>
            {c.telefono && <a className="inline-flex shrink-0 items-center gap-1 text-xs text-accent hover:underline" href={whatsappUrl(c.telefono, mensaje(c))} target="_blank" rel="noreferrer"><MessageCircle size={13} /> WhatsApp</a>}
          </li>
        ))}
      </ul>
    </div>
  )
}
