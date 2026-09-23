import { Cookie } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

// Consentimiento de cookies. Guardamos la elección del usuario en localStorage.
// "essential" = solo lo necesario para que el sitio funcione (rechazó el rastreo).
// "all" = aceptó también las cookies de rastreo/analítica.
const STORAGE_KEY = 'hausline_cookie_consent'
type Consent = 'all' | 'essential'

export function getCookieConsent(): Consent | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'all' || value === 'essential' ? value : null
  } catch { return null }
}

// ¿El usuario permitió el rastreo/analítica? Útil para condicionar scripts a futuro.
export function trackingAllowed() { return getCookieConsent() === 'all' }

export function CookieBanner() {
  const [visible, setVisible] = useState(false)
  // El aviso se muestra en CADA carga de la página (aunque el visitante recargue), no solo
  // la primera vez. Igual guardamos la última elección en localStorage para poder condicionar
  // scripts de rastreo con trackingAllowed() dentro de la sesión.
  useEffect(() => { setVisible(true) }, [])

  const decidir = (consent: Consent) => {
    try { localStorage.setItem(STORAGE_KEY, consent) } catch { /* modo privado: no persiste */ }
    setVisible(false)
  }

  if (!visible) return null
  return <div className="cookie-banner" role="dialog" aria-live="polite" aria-label="Aviso de cookies">
    <div className="cookie-banner__inner">
      <Cookie size={20} className="mt-0.5 shrink-0" style={{ color: '#1a1a1a' }} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>Usamos cookies</p>
        <p className="mt-1 text-xs leading-5" style={{ color: '#79776f' }}>
          Usamos cookies necesarias para que el sitio funcione. Con tu permiso también usaríamos cookies de rastreo para entender cómo se usa la página.{' '}
          <Link to="/privacidad" className="underline underline-offset-2" style={{ color: '#1a1a1a' }}>Más información</Link>.
        </p>
      </div>
      <div className="cookie-banner__actions">
        <button type="button" className="cookie-btn" onClick={() => decidir('essential')}>Rechazar</button>
        <button type="button" className="cookie-btn cookie-btn--primary" onClick={() => decidir('all')}>Aceptar</button>
      </div>
    </div>
  </div>
}
