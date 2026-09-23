import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { EstadoPedido } from '../../types/domain'
import { etapaBase } from '../../constants/orders'

// Wordmark limpio del portal (sin el logo verde/neón del panel administrativo).
export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="hsp-wordmark">
      <b>HAUSLINE</b>
      {!compact && <span>King of Shoes</span>}
    </span>
  )
}

// Fija el fondo claro mientras el portal está montado y lo restaura al salir (para que el
// overscroll no muestre el fondo oscuro del panel y no quede un flash al navegar).
function useLightBody() {
  useEffect(() => {
    const html = document.documentElement
    const prev = html.style.background
    html.style.background = '#f6f6f4'
    return () => { html.style.background = prev }
  }, [])
}

// Cascarón del portal del cliente: fondo claro, encabezado con wordmark + acceso a "Mis
// pedidos", y pie discreto con enlaces legales. `nav` permite acciones extra en el header.
export function PortalShell({ children, nav }: { children: ReactNode; nav?: ReactNode }) {
  useLightBody()
  return (
    <main className="hs-portal min-h-screen">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-5 sm:px-8">
        <Link to="/pedido" aria-label="Inicio del seguimiento"><Wordmark /></Link>
        <div className="flex items-center gap-1.5">
          {nav}
          <Link to="/mis-pedidos" className="hsp-btn--ghost inline-flex items-center rounded-lg">Mis pedidos</Link>
          <Link to="/cuenta" className="hsp-btn--ghost inline-flex items-center rounded-lg" style={{ color: 'var(--ink)' }}>Mi cuenta</Link>
        </div>
      </header>
      {children}
      <footer className="mx-auto mt-8 flex w-full max-w-5xl flex-col gap-2 border-t px-5 py-6 text-center text-xs sm:flex-row sm:items-center sm:justify-between sm:px-8" style={{ borderColor: 'var(--hair)' }}>
        <span className="hsp-faint">© 2026 Hausline · King of Shoes</span>
        <nav className="flex flex-wrap justify-center gap-x-5 gap-y-1">
          <Link to="/privacidad" className="hsp-muted hover:text-black">Privacidad</Link>
          <Link to="/terminos" className="hsp-muted hover:text-black">Términos</Link>
          <Link to="/login" className="hsp-faint hover:text-black">Acceso interno</Link>
        </nav>
      </footer>
    </main>
  )
}

// Tono (color sutil) de cada etapa para el tema CLARO del portal. Es intencionalmente
// distinto del mapa del panel (neón sobre oscuro): aquí buscamos color discreto sobre blanco.
const TONE: Record<string, string> = {
  pedido_confirmado: '#64748b', en_preparacion: '#ea580c', control_calidad: '#7c3aed',
  transito_internacional: '#2563eb', llego_nicaragua: '#0d9488', disponible_entrega: '#b45309',
  pagado: '#16a34a', empaquetado: '#0891b2', entregado: '#16a34a', cancelado: '#dc2626', incidencia: '#ea580c',
}
export function tonoEstado(estado: EstadoPedido): string {
  return TONE[etapaBase(estado)] ?? '#64748b'
}
