// ESENCIA DE LA TIENDA (hauslineshopni.es) para todo lo que se le manda al CLIENTE desde el panel:
// fichas, facturas, recibos, historias y cupones. Fondo crema, tinta negra, Jost + Cormorant
// Garamond. El panel es oscuro; lo que ve el cliente se ve como la tienda.
export const TIENDA = {
  fondo: '#FCFBF9', // fondo de página
  fondo2: '#F4F1EB', // bandas / notas
  tarjeta: '#FFFFFF',
  linea: '#E7E3DC',
  lineaFuerte: '#D8D2C8',
  tinta: '#171310', // texto y bloques oscuros
  tinta2: '#6B655C', // texto secundario
  tinta3: '#9C958A', // etiquetas
  crema: '#F7F3EC', // texto sobre tinta
  foto: '#F1EFEA',
} as const

export const SANS_TIENDA = 'Jost, "Segoe UI", Arial, Helvetica, sans-serif'
export const SERIF_TIENDA = '"Cormorant Garamond", Georgia, "Times New Roman", serif'

// Carga las fuentes de la tienda para dibujarlas en un canvas. Si no llegan a tiempo (sin red),
// el canvas usa las del sistema: nunca bloquea la generación más de ~2,5 s.
let fuentes: Promise<void> | null = null
export function asegurarFuentesTienda(): Promise<void> {
  if (fuentes) return fuentes
  fuentes = (async () => {
    try {
      if (!document.getElementById('hl-fuentes-tienda')) {
        const link = document.createElement('link'); link.id = 'hl-fuentes-tienda'; link.rel = 'stylesheet'
        link.href = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Jost:wght@400;500;600;700&display=swap'
        document.head.appendChild(link)
        await new Promise((r) => { link.onload = r; link.onerror = r; setTimeout(r, 2500) })
      }
      await Promise.race([
        Promise.all(['600 40px "Cormorant Garamond"', '400 20px Jost', '500 20px Jost', '600 20px Jost', '700 20px Jost'].map((x) => document.fonts.load(x))),
        new Promise((r) => setTimeout(r, 2500)),
      ])
    } catch { /* sin red: fuentes del sistema */ }
  })()
  return fuentes
}
