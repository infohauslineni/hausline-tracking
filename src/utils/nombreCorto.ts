// Nombre corto del producto para la factura (una sola línea, sin amontonarse).
// Conserva el tipo (primera palabra) y el color del final, y quita detalles del medio
// hasta que quepa. Si al quitar se perdería un color intermedio (p. ej. "Blanco Talón
// Negro"), corta por palabras desde el inicio para no confundir el color.
// Espejo exacto en api/_nombre-corto.js (factura PDF del correo): cambiar ambos juntos.

const COLORES = new Set(['negro', 'blanco', 'azul', 'marino', 'gris', 'rojo', 'rosa', 'verde', 'beige', 'crema', 'marrón', 'marron', 'dorado', 'plata', 'amarillo', 'naranja', 'morado', 'turquesa', 'celeste', 'fucsia', 'burdeos', 'taupe', 'arena', 'claro', 'oscuro', 'metalizado', 'eléctrico', 'neón', 'total', 'tonal', 'multicolor', 'colores', 'cobalto', 'antracita', 'plomo', 'black', 'white', 'blue', 'red', 'grey', 'gray', 'pink', 'green', 'brown'])
// Frases que no se deben partir al resumir.
const FRASES = ['Low Top', 'High Top', 'Manga Larga', 'Art Toy', 'Sock Knit', 'Vintage Star', 'Quarter Zip', 'Full Zip', 'Dos Tiras', 'Paint Splatter', 'Suela Gum', 'Short de Baño', 'Bolso de Viaje']
const NBSP = ' '

const esColor = (palabra: string) => palabra.includes('/') || COLORES.has(palabra.toLowerCase())

export const NOMBRE_CORTO_MAX = 30

export function nombreCorto(nombre: string | null | undefined, max = NOMBRE_CORTO_MAX): string {
  let limpio = String(nombre ?? '').replace(/\s+/g, ' ').trim()
  if (limpio.length <= max) return limpio
  for (const frase of FRASES) limpio = limpio.split(frase).join(frase.replace(/ /g, NBSP))
  const palabras = limpio.split(' ')
  const texto = (arr: string[]) => arr.join(' ')
  let fin = palabras.length
  while (fin > 1 && esColor(palabras[fin - 1])) fin--
  const color = palabras.slice(fin)
  const base = [palabras[0]]
  for (let i = 1; i < fin; i++) { if (texto([...base, palabras[i], ...color]).length <= max) base.push(palabras[i]); else break }
  let resultado: string
  if (palabras.slice(base.length, fin).some(esColor)) {
    const inicio: string[] = []
    for (const palabra of palabras) { if (texto([...inicio, palabra]).length <= max) inicio.push(palabra); else break }
    resultado = texto(inicio.length ? inicio : [palabras[0]])
  } else {
    resultado = texto([...base, ...color])
    if (resultado.length > max) resultado = texto(base)
  }
  resultado = resultado.split(NBSP).join(' ')
  if (resultado.length > max) {
    const corte = resultado.slice(0, max + 1)
    resultado = corte.includes(' ') ? corte.slice(0, corte.lastIndexOf(' ')) : resultado.slice(0, max)
  }
  return resultado.trim()
}
