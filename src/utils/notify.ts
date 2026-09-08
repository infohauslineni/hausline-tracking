// Sonido de notificación para cuando cae un encargo web nuevo. Suena un ARCHIVO de audio
// (public/encargo-sound.mp3, servido desde el mismo origen para cumplir la CSP). Si por lo
// que sea no se puede reproducir, cae a un "cha-ching" sintetizado con Web Audio. Los
// navegadores bloquean el audio hasta que el usuario interactúa con la página, así que
// "despertamos"/precargamos el sonido al primer clic.
let ctx: AudioContext | null = null
let audio: HTMLAudioElement | null = null
let audioListo = false

function ensureCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  if (!ctx) { try { ctx = new AC() } catch { return null } }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function ensureAudio(): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null
  if (!audio) {
    try {
      const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '')
      audio = new Audio(`${base}/encargo-sound.mp3`)
      audio.preload = 'auto'
    } catch { return null }
  }
  return audio
}

if (typeof window !== 'undefined') {
  // Al primer clic: despertamos el AudioContext (fallback) y "primamos" el archivo de audio
  // (un play muteado + pause) para que luego pueda sonar sin gesto directo del usuario.
  const wake = () => {
    ensureCtx()
    const a = ensureAudio()
    if (a && !audioListo) {
      audioListo = true
      const vol = a.volume
      a.volume = 0
      a.play().then(() => { a.pause(); a.currentTime = 0; a.volume = vol }).catch(() => { a.volume = vol })
    }
  }
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

// Suena el ARCHIVO de audio del encargo; si falla, cae al "cha-ching" sintetizado.
// Una sola vez por encargo (ver PrivateLayout).
export function playEncargoChime() {
  const a = ensureAudio()
  if (a) {
    try {
      a.currentTime = 0
      const p = a.play()
      if (p && typeof p.catch === 'function') p.catch(() => tonoDinero())
      return
    } catch { /* cae al sonido sintetizado */ }
  }
  tonoDinero()
}

// Fallback sintetizado: "cha-CHING" de caja registradora + cascada de monedas.
function tonoDinero() {
  const ac = ensureCtx()
  if (!ac) return
  // El "cha-ching" de la caja.
  ding(ac, 1318.5, 0, 0.5)      // E6  — "cha"
  ding(ac, 1975.5, 0.1, 0.6)    // B6  — "ching"
  // Cascada de monedas: ~14 clinks brillantes, cada uno con un segundo tono metálico encima,
  // repartidos en el tiempo y con volumen que baja, como monedas cayendo en cadena.
  const base = [2637, 3136, 2489, 2960, 3520, 2794, 3322, 2349, 2960, 3136, 2637, 3520, 2793, 3136]
  base.forEach((f, i) => {
    const t = 0.22 + i * 0.055
    const vol = 0.2 * (1 - i / (base.length + 4))
    blip(ac, f, t, vol, 0.05)
    blip(ac, f * 1.5, t + 0.012, vol * 0.5, 0.04)
  })
}
