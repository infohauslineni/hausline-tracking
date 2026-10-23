// Apariencia del PANEL: modo (claro estilo tienda grande, por defecto, u oscuro) y color de
// acento (botones secundarios, enlaces, resaltados). Se eligen en Configuración → Apariencia
// (el modo también con el botón de la barra superior) y se recuerdan en este navegador.
// Cada acento tiene dos tonos: el claro va en modo oscuro (texto negro encima) y el profundo en
// modo claro (texto blanco encima), para que siempre se lea bien.
export type TemaPanel = { id: string; nombre: string; color: string; profundo: string }
export type ModoPanel = 'claro' | 'oscuro'

export const TEMAS_PANEL: TemaPanel[] = [
  { id: 'azul', nombre: 'Azul', color: '#4f9dff', profundo: '#005bd3' },
  { id: 'violeta', nombre: 'Violeta', color: '#a394ff', profundo: '#6e4ff0' },
  { id: 'rosa', nombre: 'Rosa', color: '#ff7eb0', profundo: '#c81e64' },
  { id: 'naranja', nombre: 'Naranja', color: '#ff8f45', profundo: '#c2410c' },
  { id: 'dorado', nombre: 'Dorado', color: '#f2c14e', profundo: '#a16207' },
  { id: 'turquesa', nombre: 'Turquesa', color: '#34d6c0', profundo: '#0f766e' },
  { id: 'crema', nombre: 'Negro / crema', color: '#f2ece0', profundo: '#303030' },
]
export const TEMA_PANEL_DEFECTO = 'azul'
const CLAVE = 'hausline_tema_panel'
const CLAVE_MODO = 'hausline_modo_panel'

export function temaPanelGuardado(): string {
  try { const id = localStorage.getItem(CLAVE); if (id && TEMAS_PANEL.some((t) => t.id === id)) return id } catch { /* sin almacenamiento */ }
  return TEMA_PANEL_DEFECTO
}
export function modoPanelGuardado(): ModoPanel {
  try { if (localStorage.getItem(CLAVE_MODO) === 'oscuro') return 'oscuro' } catch { /* sin almacenamiento */ }
  return 'claro'
}

export function aplicarTemaPanel(id: string = temaPanelGuardado(), modo: ModoPanel = modoPanelGuardado()) {
  const tema = TEMAS_PANEL.find((t) => t.id === id) ?? TEMAS_PANEL[0]
  const raiz = document.documentElement
  raiz.dataset.modo = modo
  raiz.style.colorScheme = modo === 'claro' ? 'light' : 'dark'
  raiz.style.setProperty('--color-accent', modo === 'claro' ? tema.profundo : tema.color)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', modo === 'claro' ? '#1a1a1a' : '#0a0a0a')
  return tema
}

export function guardarTemaPanel(id: string) {
  try { localStorage.setItem(CLAVE, id) } catch { /* solo esta sesión */ }
  return aplicarTemaPanel(id)
}
export function guardarModoPanel(modo: ModoPanel) {
  try { localStorage.setItem(CLAVE_MODO, modo) } catch { /* solo esta sesión */ }
  aplicarTemaPanel(temaPanelGuardado(), modo)
  window.dispatchEvent(new CustomEvent('hausline:modo', { detail: modo }))
}
