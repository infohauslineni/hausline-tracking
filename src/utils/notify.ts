// Sonido de notificación (tipo "cha-ching" de Shopify) para cuando cae un encargo nuevo.
// Se genera con Web Audio (sin archivo). Los navegadores bloquean el audio hasta que el
// usuario interactúa con la página, así que "despertamos" el contexto al primer clic.
let ctx: AudioContext | null = null

function ensureCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  if (!ctx) { try { ctx = new AC() } catch { return null } }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

if (typeof window !== 'undefined') {
  const wake = () => { ensureCtx() }
  window.addEventListener('pointerdown', wake, { once: false })
}

// Un "ding" tipo campana (fundamental + armónicos brillantes), fuerte y con cuerpo.
function ding(ac: AudioContext, freq: number, t: number, vol: number) {
  const now = ac.currentTime
  const master = ac.createGain()
  master.gain.setValueAtTime(0.0001, now + t)
  master.gain.exponentialRampToValueAtTime(vol, now + t + 0.008)
  master.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.55)
  master.connect(ac.destination)
  for (const [mult, amp] of [[1, 1], [2.01, 0.45], [3.03, 0.18]] as [number, number][]) {
    const osc = ac.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = freq * mult
    const g = ac.createGain()
    g.gain.value = amp
    osc.connect(g)
    g.connect(master)
    osc.start(now + t)
    osc.stop(now + t + 0.55)
  }
}

// Blip corto y metálico (una "monedita"). Se usan varios seguidos para el brillo de dinero.
function blip(ac: AudioContext, freq: number, t: number, vol: number, dur = 0.06) {
  const now = ac.currentTime
  const g = ac.createGain()
  g.gain.setValueAtTime(0.0001, now + t)
  g.gain.exponentialRampToValueAtTime(vol, now + t + 0.004)
  g.gain.exponentialRampToValueAtTime(0.0001, now + t + dur)
  g.connect(ac.destination)
  const osc = ac.createOscillator()
  osc.type = 'triangle'
  osc.frequency.value = freq
  osc.connect(g)
  osc.start(now + t)
  osc.stop(now + t + dur)
}

// Sonido de DINERO tipo caja registradora: "cha-CHING" (dos campanas brillantes) + un
// brillo de moneditas cayendo. Suena una sola vez por encargo (ver PrivateLayout).
export function playEncargoChime() {
  const ac = ensureCtx()
  if (!ac) return
  ding(ac, 1318.5, 0, 0.5)      // E6  — "cha"
  ding(ac, 1975.5, 0.09, 0.58)  // B6  — "ching"
  const monedas = [2637, 3136, 2489, 2960, 3520, 2794]
  monedas.forEach((f, i) => blip(ac, f, 0.2 + i * 0.045, 0.16, 0.06))
}
