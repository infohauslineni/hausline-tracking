import { ChevronLeft, Heart, Home, Search, UserRound } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { esDemo, obtenerCuenta, TIENDA_URL, type CuentaCliente } from '../../services/cuentaCliente.service'

// Cascarón del panel del CLIENTE (tema claro del portal: blanco/negro, verde solo para
// estados activos). Pensado primero para teléfono: encabezado con "atrás" + título y
// navegación inferior fija Inicio | Buscar | Favoritos | Cuenta (Inicio y Buscar llevan a
// la tienda, que vive en otro dominio).

function useLightBody() {
  useEffect(() => {
    const html = document.documentElement
    const prev = html.style.background
    html.style.background = '#f6f6f4'
    return () => { html.style.background = prev }
  }, [])
}

type CuentaCtx = { cuenta: CuentaCliente | null; recargar: () => Promise<void> }
const Ctx = createContext<CuentaCtx>({ cuenta: null, recargar: async () => undefined })
// eslint-disable-next-line react-refresh/only-export-components
export const useCuenta = () => useContext(Ctx)

// Protege /cuenta/*: sin sesión → pantalla de ingreso. En preview local (sin Supabase) deja
// pasar con datos demo. Carga la cuenta una vez y la comparte con todas las pantallas.
export function CuentaGuard() {
  const { user, loading } = useAuth()
  const location = useLocation()
  const [cuenta, setCuenta] = useState<CuentaCliente | null>(null)
  const uid = user?.id
  const recargar = useCallback(async () => { try { setCuenta(await obtenerCuenta()) } catch { /* se reintenta al navegar */ } }, [])
  useEffect(() => { if (esDemo || uid) void Promise.resolve().then(recargar) }, [uid, recargar])
  useLightBody()
  if (!esDemo && loading) return <main className="hs-portal grid min-h-screen place-items-center"><span className="hsc-spinner" /></main>
  if (!esDemo && !user) return <Navigate to="/cuenta/ingresar" replace state={{ from: location.pathname + location.search }} />
  return <Ctx.Provider value={{ cuenta, recargar }}><Outlet /></Ctx.Provider>
}

type ShellProps = {
  children: ReactNode
  titulo?: string
  subtitulo?: string
  volver?: string | true
  accion?: ReactNode
  inicio?: ReactNode
  sinNav?: boolean
}

export function CuentaShell({ children, titulo, subtitulo, volver, accion, inicio, sinNav }: ShellProps) {
  const navigate = useNavigate()
  const atras = () => { if (volver === true) { if (window.history.length > 1) navigate(-1); else navigate('/cuenta') } else if (volver) navigate(volver) }
  return <main className="hs-portal hsc min-h-screen">
    <div className={`mx-auto w-full max-w-xl px-4 ${sinNav ? 'pb-10' : 'pb-28'}`}>
      {inicio ?? <header className="hsc-top">
        <div className="flex min-h-12 items-center gap-2">
          {volver && <button type="button" onClick={atras} className="hsc-iconbtn -ml-2" aria-label="Volver"><ChevronLeft size={22} /></button>}
          <h1 className="min-w-0 flex-1 truncate text-[19px] font-semibold tracking-[-0.01em]">{titulo}</h1>
          {accion}
        </div>
        {subtitulo && <p className="hsp-muted -mt-0.5 text-[13px]">{subtitulo}</p>}
      </header>}
      {children}
    </div>
    {!sinNav && <BottomNav />}
  </main>
}

function BottomNav() {
  const { pathname } = useLocation()
  const enFavoritos = pathname.startsWith('/cuenta/favoritos')
  const item = (activo: boolean) => `hsc-nav__item${activo ? ' is-active' : ''}`
  return <nav className="hsc-nav" aria-label="Navegación principal">
    <div className="mx-auto grid max-w-xl grid-cols-4">
      <a href={TIENDA_URL} className={item(false)}><Home size={20} strokeWidth={1.7} /><span>Inicio</span></a>
      <a href={`${TIENDA_URL}/?buscar=1`} className={item(false)}><Search size={20} strokeWidth={1.7} /><span>Buscar</span></a>
      <Link to="/cuenta/favoritos" className={item(enFavoritos)}><Heart size={20} strokeWidth={1.7} fill={enFavoritos ? 'currentColor' : 'none'} /><span>Favoritos</span></Link>
      <Link to="/cuenta" className={item(!enFavoritos)}><UserRound size={20} strokeWidth={1.7} fill={!enFavoritos ? 'currentColor' : 'none'} /><span>Cuenta</span></Link>
    </div>
  </nav>
}

// Fila de menú tipo app (icono + etiqueta + valor + chevron).
export function FilaMenu({ icono, etiqueta, valor, to, onClick, peligro }: { icono: ReactNode; etiqueta: string; valor?: ReactNode; to?: string; onClick?: () => void; peligro?: boolean }) {
  const contenido = <>
    <span className="hsc-row__icon" style={peligro ? { color: '#b91c1c' } : undefined}>{icono}</span>
    <span className="min-w-0 flex-1">
      <span className="block text-[13px]" style={peligro ? { color: '#b91c1c', fontWeight: 600 } : { color: 'var(--ink)' }}>{etiqueta}</span>
      {valor != null && <span className="hsp-muted mt-0.5 block truncate text-[13px]">{valor}</span>}
    </span>
    {!peligro && <ChevronLeft size={17} className="hsp-faint shrink-0 rotate-180" />}
  </>
  if (to) return <Link to={to} className="hsc-row">{contenido}</Link>
  return <button type="button" onClick={onClick} className="hsc-row w-full text-left">{contenido}</button>
}

// Hoja inferior (bottom sheet) para ediciones rápidas y confirmaciones.
export function Hoja({ abierta, onCerrar, titulo, children }: { abierta: boolean; onCerrar: () => void; titulo?: string; children: ReactNode }) {
  useEffect(() => {
    if (!abierta) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar() }
    window.addEventListener('keydown', esc)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', esc); document.body.style.overflow = prev }
  }, [abierta, onCerrar])
  if (!abierta) return null
  return <div className="hs-portal hsc-sheet" role="dialog" aria-modal="true" aria-label={titulo}>
    <button type="button" className="hsc-sheet__backdrop" onClick={onCerrar} aria-label="Cerrar" />
    <div className="hsc-sheet__panel">
      <span className="hsc-sheet__grab" aria-hidden />
      {titulo && <h2 className="mb-3 text-[17px] font-semibold">{titulo}</h2>}
      {children}
    </div>
  </div>
}

export function Cargando() {
  return <div className="grid place-items-center py-20"><span className="hsc-spinner" /></div>
}
