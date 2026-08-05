const EVEREST_URL = 'https://everest.cargotrack.net/m/track.asp'
const USPS_URL = 'https://tools.usps.com/go/TrackConfirmAction?tLabels='
// Rastreador universal: detecta el transportista por el número. Se usa cuando el
// transportista no tiene una web propia configurada (UNI Express, China Post, etc.).
const FALLBACK_TRACKING_URL = 'https://t.17track.net/en#nums={tracking}'

// Consulta iniciada por el usuario. No lee, automatiza ni almacena la respuesta externa.
export function consultarEnEverest(tracking: string) {
  const cleanTracking = tracking.trim()
  if (!cleanTracking) throw new Error('El trayecto no tiene número de tracking.')

  const form = document.createElement('form')
  form.method = 'POST'
  form.action = EVEREST_URL
  form.target = '_blank'
  form.style.display = 'none'
  for (const [name, value] of [['track', cleanTracking], ['action2', 'process']]) {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = value
    form.append(input)
  }
  document.body.append(form)
  form.submit()
  form.remove()
}

export function consultarEnUsps(tracking: string) {
  const cleanTracking = tracking.trim()
  if (!cleanTracking) throw new Error('El trayecto no tiene número de tracking.')
  window.open(`${USPS_URL}${encodeURIComponent(cleanTracking)}`, '_blank', 'noopener,noreferrer')
}

export function construirUrlTransportista(template: string | null, tracking: string | null) {
  if (!tracking) return null
  // Si el transportista no tiene web propia, usamos el rastreador universal para que
  // siempre se abra una página con el número (antes quedaba sin enlace, p. ej. UNI Express).
  return (template || FALLBACK_TRACKING_URL).replace('{tracking}', encodeURIComponent(tracking))
}
