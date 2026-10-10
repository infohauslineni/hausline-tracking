// Color de acento del PANEL (botones, menú activo, resaltados). El panel es oscuro; el acento se
// elige en Configuración → Apariencia y se recuerda en este navegador. Todos los tonos son lo
// bastante claros para llevar texto negro encima (los botones usan tinta oscura).
export type TemaPanel = { id: string; nombre: string; color: string }

export const TEMAS_PANEL: TemaPanel[] = [
  { id: 'azul', nombre: 'Azul eléctrico', color: '#4f9dff' },
  { id: 'violeta', nombre: 'Violeta', color: '#a394ff' },
  { id: 'rosa', nombre: 'Rosa', color: '#ff7eb0' },
  { id: 'naranja', nombre: 'Naranja', color: '#ff8f45' },
  { id: 'dorado', nombre: 'Dorado', color: '#f2c14e' },
  { id: 'turquesa', nombre: 'Turquesa', color: '#34d6c0' },
  { id: 'crema', nombre: 'Crema', color: '#f2ece0' },
]
export const TEMA_PANEL_DEFECTO = 'azul'
const CLAVE = 'hausline_tema_panel'

export function temaPanelGuardado(): string {
  try { const id = localStorage.getItem(CLAVE); if (id && TEMAS_PANEL.some((t) => t.id === id)) return id } catch { /* sin almacenamiento */ }
  return TEMA_PANEL_DEFECTO
}

export function aplicarTemaPanel(id: string = temaPanelGuardado()) {
  const tema = TEMAS_PANEL.find((t) => t.id === id) ?? TEMAS_PANEL[0]
  document.documentElement.style.setProperty('--color-accent', tema.color)
  return tema
}

export function guardarTemaPanel(id: string) {
  try { localStorage.setItem(CLAVE, id) } catch { /* solo esta sesión */ }
  return aplicarTemaPanel(id)
}
