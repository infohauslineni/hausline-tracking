import { ArrowUpRight, BarChart3, Bell, Bike, Boxes, CircleGauge, CreditCard, HandCoins, Inbox, LogOut, Menu, Moon, MoreHorizontal, PackagePlus, PackageSearch, Plus, ReceiptText, RotateCcw, Settings, ShoppingBag, Sun, Truck, UserPlus, Users, Wallet, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { RestaurarScroll } from './Navegacion'
import { toast } from 'sonner'
import { useAuth } from '../../contexts/AuthContext'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { prefetchRoute, warmDashboard } from '../../utils/prefetchDashboard'
import { playEncargoChime, primeEncargoAudio } from '../../utils/notify'
import { calcularAlertas, contarUrgentes, type Alerta } from '../../utils/alertas'
import { HauslineLogo } from '../ui/HauslineLogo'
import { guardarModoPanel, modoPanelGuardado, type ModoPanel } from '../../utils/temaPanel'
import { BuscadorGlobal } from './BuscadorGlobal'

type Badges = Record<string, number>
// Contadores de "requiere atención" del menú + alertas para la campana. Se calculan de
// una sola carga de pedidos (se recalculan en cada navegación).
async function calcularEstado(): Promise<{ badges: Badges; alertas: Alerta[] }> {
  const { listarPedidos } = await import('../../services/pedidos.service')
  const pedidos = await listarPedidos()
  // Encargos web pendientes de confirmar. Aislado en try/catch por si la tabla aún no existe.
  let solicitudes = 0
  try {
    const { listarSolicitudes } = await import('../../services/solicitudes.service')
    solicitudes = (await listarSolicitudes()).filter((s) => s.estado === 'pendiente').length
  } catch { /* la tabla solicitudes puede no estar creada todavía */ }
  // Solicitudes de cancelación/reembolso por revisar (solo admin; sin la migración, 0).
  let reembolsos = 0
  try {
    const { contarReembolsosPorAtender } = await import('../../services/reembolsos.service')
    reembolsos = await contarReembolsosPorAtender()
  } catch { /* sin permiso (operador) o sin migración 202609250002 */ }
  // Errores que vieron los clientes en las últimas 24 h (sin la migración 202609260001, 0).
  let erroresClientes = 0
  try {
    const { contarErroresClientes24h } = await import('../../services/saludClientes.service')
    erroresClientes = await contarErroresClientes24h()
  } catch { /* sin migración 202609260001 */ }
  const badges: Badges = {
    '/pedidos': pedidos.filter((p) => p.estado === 'disponible_entrega').length,
    '/solicitudes': solicitudes,
    '/reembolsos': reembolsos,
    // Salud de clientes vive dentro de Configuración: el contador de errores sale ahí.
    '/configuracion': erroresClientes,
    '/cuenta': pedidos.filter((p) => (p.estado === 'disponible_entrega' || p.estado === 'entregado') && Number(p.saldo) > 0.01).length,
    '/logistica': pedidos.filter((p) => p.estado === 'incidencia').length,
    // Disponibles a los que todavía no se les avisó por WhatsApp.
    '/entregas': pedidos.filter((p) => p.estado === 'disponible_entrega' && !p.aviso_disponible_at).length,
  }
  // Trayectos para las alertas de "tracking sin novedad" (best-effort).
  const trayectos = await (async () => { try { const { listarTrayectos } = await import('../../services/logistica.service'); return await listarTrayectos() } catch { return [] } })()
  return { badges, alertas: calcularAlertas(pedidos, trayectos) }
}

// `tambien`: otras rutas que marcan este ítem como activo (p. ej. las pestañas de un apartado).
type NavItem = { to: string; label: string; icon: typeof CircleGauge; nuevo?: boolean; tambien?: string[] }
// Operaciones del día a día. "Encargos web" recibe los pedidos que llegan del sitio.
const operaciones: NavItem[] = [
  { to: '/dashboard', label: 'Resumen', icon: CircleGauge },
  { to: '/pedidos', label: 'Pedidos', icon: Boxes },
  { to: '/solicitudes', label: 'Encargos web', icon: Inbox },
  { to: '/ventas', label: 'Ventas', icon: ShoppingBag },
]
const clientesProductos: NavItem[] = [
  // Clientes y Reseñas van juntos (pestañas dentro del mismo apartado).
  { to: '/clientes', label: 'Clientes y reseñas', icon: Users, tambien: ['/resenas'] },
  { to: '/productos', label: 'Productos', icon: PackageSearch },
  // Un solo apartado con dos pestañas (Compras libres / Venta libre): siguen siendo páginas aparte.
  { to: '/stock', label: 'Compras y ventas libres', icon: HandCoins, tambien: ['/venta-libre'] },
]
// "Mi cuenta" es el hub de dinero: gastos, ingresos, salidas, estado de cuenta y saldo.
// Por eso "Gastos" ya no es una entrada aparte (se registran desde Mi cuenta).
const finanzas: NavItem[] = [
  // Los pagos de clientes viven dentro de Mi cuenta (pestaña Pagos).
  { to: '/cuenta', label: 'Mi cuenta y pagos', icon: Wallet, tambien: ['/pagos'] },
  { to: '/gastos', label: 'Gastos', icon: ReceiptText },
  { to: '/reembolsos', label: 'Reembolsos', icon: RotateCcw },
  { to: '/reportes', label: 'Reportes', icon: BarChart3 },
]
const logistica: NavItem[] = [
  { to: '/logistica', label: 'Logística', icon: Truck },
  { to: '/entregas', label: 'Entregas', icon: Bike },
]
// Opciones administrativas (agrupadas aparte; se pueden ocultar por rol más adelante).
const administracion: NavItem[] = [
  { to: '/configuracion', label: 'Configuración', icon: Settings, tambien: ['/salud-clientes'] },
]
const navGroups = [
  { title: 'Operaciones', items: operaciones },
  { title: 'Clientes y productos', items: clientesProductos },
  { title: 'Finanzas', items: finanzas },
  { title: 'Logística', items: logistica },
  { title: 'Administración', items: administracion },
]
// Rutas que ve el OPERADOR (empleado): su trabajo operativo, sin nada de dinero. Todo lo
// demás (finanzas, productos/stock, reportes, cupones, reseñas, configuración, resumen) es
// solo para el admin. La seguridad real está en el servidor (RLS); esto es la capa visual.
const RUTAS_OPERADOR = new Set(['/pedidos', '/solicitudes', '/logistica', '/entregas'])
// Barra inferior en móvil (admin): Resumen · Pedidos · (+) · Ventas · Más.
const mobileLinks = [operaciones[0], operaciones[1], operaciones[3]]
// Barra inferior en móvil (operador): Pedidos · Encargos · Logística · Más (sin botón "+").
const mobileLinksOperador = [operaciones[1], operaciones[2], logistica[0]]
// Accesos rápidos del botón central "+" en móvil.
const quickActions: NavItem[] = [
  { to: '/pedidos/nuevo', label: 'Nuevo pedido', icon: PackagePlus },
  { to: '/pagos', label: 'Registrar pago', icon: CreditCard },
  { to: '/clientes', label: 'Nuevo cliente', icon: UserPlus },
  { to: '/gastos', label: 'Registrar gasto', icon: ReceiptText },
]

export function PrivateLayout() {
  const [open, setOpen] = useState(false)
  const [fabOpen, setFabOpen] = useState(false)
  const [badges, setBadges] = useState<Badges>({})
  const [alertas, setAlertas] = useState<Alerta[]>([])
  const [bellOpen, setBellOpen] = useState(false)
  const [cuentaOpen, setCuentaOpen] = useState(false)
  // Modo claro/oscuro (se cambia desde la barra superior o Configuración → Apariencia).
  const [modo, setModo] = useState<ModoPanel>(modoPanelGuardado)
  useEffect(() => { const f = (e: Event) => setModo((e as CustomEvent<ModoPanel>).detail); window.addEventListener('hausline:modo', f); return () => window.removeEventListener('hausline:modo', f) }, [])
  const { user, signOut, esAdmin } = useAuth()
  const location = useLocation()
  // Menú lateral filtrado por rol: el operador solo ve sus rutas operativas.
  const visibleGroups = navGroups
    .map((group) => ({ ...group, items: esAdmin ? group.items : group.items.filter((item) => RUTAS_OPERADOR.has(item.to)) }))
    .filter((group) => group.items.length > 0)
  useEffect(() => { warmDashboard() }, [])
  // Cuentas "Visible a clientes" para los mensajes de WhatsApp (si no, quedan las de respaldo).
  useEffect(() => { if (isSupabaseConfigured) void import('../../services/cuentas.service').then((m) => m.cargarCuentasPagoClientes()).catch(() => undefined) }, [])
  // Prepara el sonido de encargo SOLO en el panel admin (no en el sitio público de seguimiento).
  useEffect(() => { primeEncargoAudio() }, [])
  // Refresca los contadores y las alertas al cambiar de página (datos del caché de pedidos).
  useEffect(() => { if (!isSupabaseConfigured) return; let vivo = true; void calcularEstado().then((next) => { if (vivo) { setBadges(next.badges); setAlertas(next.alertas) } }).catch(() => undefined); return () => { vivo = false } }, [location.pathname])
  useEffect(() => { setBellOpen(false) }, [location.pathname])

  // Aviso en vivo cuando cae un encargo nuevo desde la web: suena el "cha-ching" de dinero,
  // sale un toast y se marca el contador de "Encargos web". Un carrito de la web crea un
  // encargo (solicitud) por producto, así que AGRUPAMOS los INSERT que llegan juntos: suena
  // UNA sola vez por pedido (no 38 veces), diciendo cuántos productos trae.
  useEffect(() => {
    const client = supabase
    if (!isSupabaseConfigured || !client) return
    let pendientes = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const disparar = () => {
      const n = pendientes; pendientes = 0
      playEncargoChime()
      toast.success(n > 1 ? `🛍️ Nuevo encargo web con ${n} productos — revisalo en "Encargos web".` : '🛍️ Nuevo encargo web — revisalo en "Encargos web".')
      void calcularEstado().then((next) => { setBadges(next.badges); setAlertas(next.alertas) }).catch(() => undefined)
    }
    const channel = client.channel('encargos-alerta').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'solicitudes' }, () => {
      pendientes += 1
      if (timer) clearTimeout(timer)
      timer = setTimeout(disparar, 2500)
    }).subscribe()
    return () => { if (timer) clearTimeout(timer); void client.removeChannel(channel) }
  }, [])

  // Aviso en vivo cuando un cliente pide cancelar su pedido desde Mi cuenta (solo lo recibe
  // el admin: la tabla solo es visible para admin por RLS).
  useEffect(() => {
    const client = supabase
    if (!isSupabaseConfigured || !client || !esAdmin) return
    const avisadas = new Set<string>()
    const channel = client.channel('reembolsos-alerta').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'solicitudes_reembolso' }, (payload) => {
      const codigo = (payload.new as { codigo?: string })?.codigo ?? ''
      playEncargoChime()
      toast.warning(`⚠️ Solicitud de cancelación${codigo ? ` del pedido ${codigo}` : ''} — revisala en "Reembolsos".`)
      void calcularEstado().then((next) => { setBadges(next.badges); setAlertas(next.alertas) }).catch(() => undefined)
    }).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'solicitudes_reembolso' }, (payload) => {
      // Tras el rechazo, el cliente eligió cancelar SIN reembolso: falta que el admin cancele el pedido.
      // (Realtime no trae el estado anterior: se avisa una sola vez por solicitud.)
      const nuevo = payload.new as { id?: string; codigo?: string; estado?: string }
      if (nuevo?.estado !== 'cancelada_sin_reembolso' || !nuevo.id || avisadas.has(nuevo.id)) return
      avisadas.add(nuevo.id)
      playEncargoChime()
      toast.warning(`🛑 El cliente del pedido ${nuevo.codigo ?? ''} eligió cancelar sin reembolso — cancelalo en "Reembolsos".`, { duration: 12000 })
      void calcularEstado().then((next) => { setBadges(next.badges); setAlertas(next.alertas) }).catch(() => undefined)
    }).subscribe()
    return () => { void client.removeChannel(channel) }
  }, [esAdmin])

  // Gastos fijos del mes: al abrir el panel se registran los que ya tocan (solo admin).
  useEffect(() => {
    if (!isSupabaseConfigured || !esAdmin) return
    void import('../../services/gastosFijos.service').then((m) => m.procesarGastosFijos())
      .then((hechos) => { if (hechos.length) toast.info(`Se ${hechos.length === 1 ? 'registró 1 gasto fijo' : `registraron ${hechos.length} gastos fijos`} del mes: ${hechos.map((g) => g.descripcion).join(', ')}.`, { duration: 9000 }) })
      .catch(() => undefined)
      // Aviso un día antes: qué gasto fijo se paga mañana y si el dinero ya está completo (una vez al día).
      .then(() => import('../../services/miGanancia.service')).then((m) => m.obtenerFondoDetalle())
      .then(({ pendientes }) => {
        const hoy = new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10)
        const manana = new Date(Date.parse(`${hoy}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
        const lista = pendientes.filter((p) => p.fecha === manana)
        let visto = ''
        try { visto = localStorage.getItem('hausline_aviso_fijos') ?? '' } catch { /* sin almacenamiento */ }
        if (!lista.length || visto === hoy) return
        try { localStorage.setItem('hausline_aviso_fijos', hoy) } catch { /* solo esta vez */ }
        const falta = lista.reduce((s, p) => s + p.falta, 0)
        const texto = `Mañana se paga: ${lista.map((p) => `${p.descripcion} (US$ ${p.usd.toFixed(2)})`).join(', ')}. ${falta > 0.005 ? `Faltan US$ ${falta.toFixed(2)} por guardar.` : 'El fondo está completo.'}`
        if (falta > 0.005) toast.warning(texto, { duration: 15000 }); else toast.info(texto, { duration: 12000 })
      })
      .catch(() => undefined)
  }, [esAdmin])

  const handleSignOut = async () => {
    try { await signOut() } catch { toast.error('No se pudo cerrar la sesión.') }
  }

  return (
    <div className="min-h-screen bg-app text-white">
      {/* Barra superior a todo el ancho (estilo tienda grande): marca, buscador al centro y,
          a la derecha, modo claro/oscuro, alertas y la cuenta. */}
      <header className="topbar fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-2 px-3 sm:px-4">
        <button className="topbar-icon lg:hidden!" onClick={() => setOpen(true)} aria-label="Abrir menú"><Menu size={20} /></button>
        <Link to={esAdmin ? '/dashboard' : '/pedidos'} className="flex shrink-0 items-center gap-2.5 lg:w-[224px]" aria-label="Inicio del panel">
          <HauslineLogo size={30} className="shrink-0 rounded-lg" />
          <span className="hidden leading-tight sm:block"><strong className="block text-[13px] font-extrabold tracking-[0.16em]" style={{ color: 'var(--top-ink)' }}>HAUSLINE</strong><span className="block text-[9.5px] font-semibold uppercase tracking-[0.2em]" style={{ color: '#a3a3a3' }}>Panel</span></span>
        </Link>
        <div className="mx-auto flex min-w-0 flex-1 justify-center"><BuscadorGlobal esAdmin={esAdmin} pantallas={visibleGroups.flatMap((g) => g.items.map(({ to, label }) => ({ to, label })))} /></div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" className="topbar-icon hidden! sm:grid!" onClick={() => guardarModoPanel(modo === 'claro' ? 'oscuro' : 'claro')} title={modo === 'claro' ? 'Modo oscuro' : 'Modo claro'} aria-label="Cambiar modo claro u oscuro">{modo === 'claro' ? <Moon size={17} /> : <Sun size={17} />}</button>
          <div className="relative">
            <button type="button" className="topbar-icon" onClick={() => setBellOpen((v) => !v)} title="Alertas" aria-label="Alertas"><Bell size={18} />{contarUrgentes(alertas) > 0 && <span className="absolute right-0.5 top-0.5 grid min-w-[16px] place-items-center rounded-full px-1 text-[9px] font-bold leading-4" style={{ background: '#e51c00', color: '#fff' }}>{contarUrgentes(alertas)}</span>}</button>
            {bellOpen && <>
              <button className="fixed inset-0 z-40 cursor-default" aria-label="Cerrar alertas" onClick={() => setBellOpen(false)} />
              <div className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-line bg-panel text-white shadow-2xl">
                <div className="flex items-center justify-between border-b border-line px-4 py-3"><strong className="text-sm">Alertas</strong><span className="text-[11px] text-muted">{alertas.length} {alertas.length === 1 ? 'activa' : 'activas'}</span></div>
                <div className="max-h-[70vh] overflow-y-auto">
                  {alertas.length === 0 ? <p className="px-4 py-8 text-center text-xs text-muted">Todo en orden. Sin alertas.</p>
                    : alertas.map((a) => <Link key={a.id} to={a.to} onClick={() => setBellOpen(false)} className="flex gap-3 border-b border-line px-4 py-3 transition last:border-0 hover:bg-white/[.03]"><span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg text-sm ${a.prioridad === 'alta' ? 'bg-red-400/12' : a.prioridad === 'media' ? 'bg-amber-400/12' : 'bg-sky-400/12'}`}>{a.icono}</span><span className="min-w-0 flex-1"><strong className="block text-xs">{a.titulo}</strong><span className="block text-[11px] leading-4 text-muted">{a.descripcion}</span></span><ArrowUpRight size={14} className="mt-1 shrink-0 text-muted" /></Link>)}
                </div>
              </div>
            </>}
          </div>
          <div className="relative">
            <button type="button" onClick={() => setCuentaOpen((v) => !v)} className="flex items-center gap-2 rounded-lg p-1 transition hover:bg-[rgba(255,255,255,.1)] md:pr-2" aria-label="Mi usuario">
              <span className="grid size-7 place-items-center rounded-md text-[12px] font-bold" style={{ background: '#36fba1', color: '#0b3b26' }}>{(user?.email ?? 'A').charAt(0).toUpperCase()}</span>
              <span className="hidden max-w-[140px] truncate text-xs font-medium md:block" style={{ color: 'var(--top-ink)' }}>{esAdmin ? 'HAUSLINE' : (user?.email ?? 'Usuario')}</span>
            </button>
            {cuentaOpen && <>
              <button className="fixed inset-0 z-40 cursor-default" aria-label="Cerrar menú de usuario" onClick={() => setCuentaOpen(false)} />
              <div className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-xl border border-line bg-panel text-white shadow-2xl">
                <div className="border-b border-line px-4 py-3"><p className="truncate text-sm font-semibold">{user?.email ?? 'Usuario'}</p><p className="text-[11px] text-muted">{esAdmin ? 'Administrador' : 'Operador'}</p></div>
                <div className="p-1.5">
                  {esAdmin && <Link to="/configuracion" onClick={() => setCuentaOpen(false)} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm hover:bg-white/[.05]"><Settings size={16} className="text-muted" /> Configuración</Link>}
                  <button type="button" onClick={() => guardarModoPanel(modo === 'claro' ? 'oscuro' : 'claro')} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm hover:bg-white/[.05]">{modo === 'claro' ? <Moon size={16} className="text-muted" /> : <Sun size={16} className="text-muted" />} {modo === 'claro' ? 'Modo oscuro' : 'Modo claro'}</button>
                  <button type="button" onClick={() => { setCuentaOpen(false); void handleSignOut() }} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-red-300 hover:bg-red-400/10"><LogOut size={16} /> Cerrar sesión</button>
                </div>
              </div>
            </>}
          </div>
        </div>
      </header>

      {open && <button aria-label="Cerrar menú" className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setOpen(false)} />}
      <aside className={`sidebar fixed bottom-0 left-0 top-0 z-50 flex w-[260px] flex-col transition-transform lg:top-14 lg:z-30 lg:w-[240px] lg:translate-x-0 ${open ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}`}>
        <div className="flex h-14 items-center justify-between px-4 lg:hidden"><span className="text-sm font-bold">Menú</span><button className="icon-button" onClick={() => setOpen(false)} aria-label="Cerrar menú"><X size={18} /></button></div>
        <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-3">
          {visibleGroups.map((group) => (
            <div key={group.title}>
              <p className="side-group mb-1">{group.title}</p>
              <div className="flex flex-col gap-px">
                {group.items.map(({ to, label, icon: Icon, tambien }) => (
                  <NavLink key={to} to={to} onPointerEnter={() => prefetchRoute(to)} onFocus={() => prefetchRoute(to)} onClick={() => setOpen(false)} className={({ isActive }) => `side-link ${isActive || tambien?.some((r) => location.pathname.startsWith(r)) ? 'is-active' : ''}`}>
                    <Icon size={17} strokeWidth={2} className="shrink-0" /><span className="min-w-0 flex-1 truncate">{label}</span>
                    {badges[to] > 0 && <span className="side-badge">{badges[to]}</span>}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        {esAdmin && <div className="border-t border-line p-3"><Link to="/pedidos/nuevo" onClick={() => setOpen(false)} className="primary-button w-full"><Plus size={16} /> Nuevo pedido</Link></div>}
      </aside>
      <div className="pt-14 lg:pl-[240px]">
        <main className="mx-auto max-w-[1400px] p-4 pb-24 sm:p-6 lg:px-8 lg:pb-10"><RestaurarScroll /><Outlet /></main>
      </div>
      {/* Hoja de accesos rápidos del botón central "+" (solo móvil, solo admin: todas las
          acciones rápidas mueven dinero). */}
      {esAdmin && fabOpen && <>
        <button aria-label="Cerrar" className="fixed inset-0 z-40 bg-black/70 lg:hidden" onClick={() => setFabOpen(false)} />
        <div className="reveal-up fixed inset-x-3 bottom-24 z-50 rounded-2xl border border-line bg-panel p-3 shadow-2xl lg:hidden">
          <p className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">Crear rápido</p>
          <div className="grid grid-cols-2 gap-2">
            {quickActions.map(({ to, label, icon: Icon }) => <Link key={label} to={to} onClick={() => setFabOpen(false)} className="flex items-center gap-3 rounded-xl border border-line bg-white/[0.02] px-3 py-3 text-sm font-semibold transition hover:border-accent/50 hover:bg-accent/[0.04]"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent"><Icon size={18} /></span>{label}</Link>)}
          </div>
        </div>
      </>}
      {esAdmin ? (
        <nav className="fixed inset-x-3 bottom-3 z-30 grid grid-cols-5 items-center rounded-2xl border border-line bg-panel/95 p-1.5 shadow-2xl backdrop-blur-xl lg:hidden" aria-label="Navegación móvil">
          <MobileTab to={mobileLinks[0].to} label={mobileLinks[0].label} Icon={mobileLinks[0].icon} badge={badges[mobileLinks[0].to]} />
          <MobileTab to={mobileLinks[1].to} label={mobileLinks[1].label} Icon={mobileLinks[1].icon} badge={badges[mobileLinks[1].to]} />
          <button type="button" className="mobile-fab" onClick={() => setFabOpen(true)} aria-label="Crear rápido"><Plus size={24} /></button>
          <MobileTab to={mobileLinks[2].to} label={mobileLinks[2].label} Icon={mobileLinks[2].icon} badge={badges[mobileLinks[2].to]} />
          <button type="button" className="mobile-tab text-muted" onClick={() => setOpen(true)} aria-label="Más opciones"><MoreHorizontal size={18} /><span className="max-w-full truncate">Más</span></button>
        </nav>
      ) : (
        <nav className="fixed inset-x-3 bottom-3 z-30 grid grid-cols-4 items-center rounded-2xl border border-line bg-panel/95 p-1.5 shadow-2xl backdrop-blur-xl lg:hidden" aria-label="Navegación móvil">
          {mobileLinksOperador.map((link) => <MobileTab key={link.to} to={link.to} label={link.label} Icon={link.icon} badge={badges[link.to]} />)}
          <button type="button" className="mobile-tab text-muted" onClick={() => setOpen(true)} aria-label="Más opciones"><MoreHorizontal size={18} /><span className="max-w-full truncate">Más</span></button>
        </nav>
      )}
    </div>
  )
}

function MobileTab({ to, label, Icon, badge }: { to: string; label: string; Icon: typeof CircleGauge; badge?: number }) {
  return <NavLink to={to} onPointerDown={() => prefetchRoute(to)} className={({ isActive }) => `mobile-tab ${isActive ? 'is-active' : 'text-muted'}`}>
    <span className="relative"><Icon size={18} />{badge != null && badge > 0 && <span className="absolute -right-2 -top-1.5 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[9px] font-bold text-app ring-2 ring-panel">{badge}</span>}</span>
    <span className="max-w-full truncate">{label}</span>
  </NavLink>
}
