// Comportamiento común de TODOS los botones del panel (se instala una vez desde PrivateLayout):
//  1. Un "tic" suave al tocar un botón o enlace (y una vibración cortita en Android).
//     Se puede apagar desde el menú de la cuenta.
//  2. Si el toque dispara una llamada al servidor, el botón muestra una ruedita y no deja
//     volver a tocarlo hasta que termine (evita guardados o pagos dobles).
// El panel tiene cientos de botones sueltos, por eso se hace a nivel de página y no botón por botón.

const CLAVE_SONIDO = 'hl-sonido-botones'
const SELECTOR = 'button, a[href], [role="button"], input[type="checkbox"], input[type="radio"]'

let ctx: AudioContext | null = null
let instalado = false

export function sonidoBotonesActivo(): boolean {
  try { return localStorage.getItem(CLAVE_SONIDO) !== 'no' } catch { return true }
}

export function guardarSonidoBotones(activo: boolean) {
  try { localStorage.setItem(CLAVE_SONIDO, activo ? 'si' : 'no') } catch { /* sin almacenamiento: queda como está */ }
  if (activo) tic()
}

function audio(): AudioContext | null {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  if (!ctx) { try { ctx = new AC() } catch { return null } }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

// "Tic" corto y suave: un tono que cae rápido de agudo a medio, con volumen bajo.
function tic() {
  const ac = audio()
  if (!ac) return
  const t = ac.currentTime
  const g = ac.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.07, t + 0.004)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07)
  g.connect(ac.destination)
  const osc = ac.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(1500, t)
  osc.frequency.exponentialRampToValueAtTime(650, t + 0.05)
  osc.connect(g)
  osc.start(t)
  osc.stop(t + 0.08)
}

// --- Ruedita de carga en el botón tocado ---
const VENTANA_MS = 400   // una llamada que empieza hasta 0,4 s después del toque es "de ese botón"
const DEMORA_MS = 150    // la ruedita sale solo si tarda más que esto (sin parpadeos)
const MAXIMO_MS = 45000  // seguro: nunca queda trabado más de 45 s

let ultimo: { el: HTMLElement; t: number } | null = null
const pendientes = new WeakMap<HTMLElement, number>()

function empezar(el: HTMLElement): () => void {
  pendientes.set(el, (pendientes.get(el) ?? 0) + 1)
  const mostrar = setTimeout(() => { if ((pendientes.get(el) ?? 0) > 0) el.setAttribute('data-cargando', '') }, DEMORA_MS)
  let hecho = false
  const fin = () => {
    if (hecho) return
    hecho = true
    clearTimeout(mostrar); clearTimeout(seguro)
    const n = (pendientes.get(el) ?? 1) - 1
    pendientes.set(el, n)
    if (n <= 0) el.removeAttribute('data-cargando')
  }
  const seguro = setTimeout(fin, MAXIMO_MS)
  return fin
}

export function instalarBotonesPanel() {
  if (instalado || typeof window === 'undefined') return
  instalado = true

  document.addEventListener('click', (e) => {
    const el = (e.target as Element | null)?.closest?.(SELECTOR) as HTMLElement | null
    if (!el || el.matches(':disabled, [aria-disabled="true"]')) return
    if (sonidoBotonesActivo()) {
      tic()
      try { navigator.vibrate?.(8) } catch { /* sin vibración */ }
    }
    // Solo los botones muestran ruedita (los enlaces cambian de página).
    ultimo = el.matches('button, [role="button"]') ? { el, t: performance.now() } : null
  }, true)

  const fetchOriginal = window.fetch.bind(window)
  window.fetch = (...args: Parameters<typeof fetch>) => {
    const u = ultimo
    if (!u || performance.now() - u.t > VENTANA_MS || !u.el.isConnected) return fetchOriginal(...args)
    const fin = empezar(u.el)
    return fetchOriginal(...args).finally(fin)
  }
}
