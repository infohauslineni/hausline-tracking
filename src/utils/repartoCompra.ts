// REPARTO de un monto entre varios productos de una misma compra (compra en conjunto):
// lo que se pagó con la comisión de PayPal, o el envío a Nicaragua de un paquete donde vienen
// zapatos y camisas juntos. Siempre cuadra al centavo: lo que sobra del redondeo va al último.

export type ModoReparto = 'igual' | 'precio' | 'peso'

export const MODOS_REPARTO: Record<ModoReparto, { titulo: string; ayuda: string }> = {
  igual: { titulo: 'Igual para todos', ayuda: 'Todos cuestan lo mismo' },
  precio: { titulo: 'Según el precio', ayuda: 'El que cuesta más carga más' },
  peso: { titulo: 'Según el peso', ayuda: 'Zapatos pesan más que camisas' },
}

// Peso aproximado por tipo de producto (libras), para repartir el envío. Editable en cada fila.
export const TIPOS_PRODUCTO = {
  zapatos: { label: 'Zapatos', lb: 3 },
  ropa: { label: 'Ropa', lb: 0.7 },
  bolso: { label: 'Bolso', lb: 2 },
  accesorio: { label: 'Accesorio', lb: 0.5 },
} as const
export type TipoProducto = keyof typeof TIPOS_PRODUCTO

const r2 = (n: number) => Math.round(n * 100) / 100

// Adivina el tipo por el nombre/categoría (para proponer el peso).
export function tipoDeProducto(texto: string | null | undefined): TipoProducto {
  const t = String(texto ?? '').toLowerCase()
  if (/camis|shirt|hoodie|sudader|pantal|short|jean|chaqueta|jacket|polo|ropa|tee|suéter|sueter|vestido|falda/.test(t)) return 'ropa'
  if (/bolso|bag|cartera|mochila|backpack|tote/.test(t)) return 'bolso'
  if (/gorra|cap|cinturón|cinturon|belt|lentes|gafas|billetera|wallet|reloj|calcet|media|accesorio/.test(t)) return 'accesorio'
  return 'zapatos'
}

// Reparte `total` en partes proporcionales a `pesos` (si todos son 0, en partes iguales).
// Devuelve una parte por elemento, sumando exactamente `total`.
export function repartir(total: number, pesos: number[]): number[] {
  const n = pesos.length
  if (!n) return []
  const limpios = pesos.map((p) => (Number.isFinite(p) && p > 0 ? p : 0))
  const suma = limpios.reduce((s, p) => s + p, 0)
  const base = suma > 0 ? limpios : limpios.map(() => 1)
  const sumaBase = suma > 0 ? suma : n
  const partes = base.map((p) => Math.floor((total * p / sumaBase) * 100) / 100)
  const sobra = r2(total - partes.reduce((s, p) => s + p, 0))
  partes[n - 1] = r2(partes[n - 1] + sobra)
  return partes
}

// Pesos según el modo: 'igual' → 1 cada uno; 'precio' → su precio; 'peso' → sus libras.
export function pesosDe<T>(filas: T[], modo: ModoReparto, precio: (f: T) => number, libras: (f: T) => number) {
  return filas.map((f) => (modo === 'igual' ? 1 : modo === 'precio' ? Math.max(0, precio(f)) : Math.max(0, libras(f))))
}

// Compras que se registraron juntas (compra en conjunto) llevan la marca [LOTE:xxxx] en las
// notas: así se ven agrupadas y se pueden seleccionar de una vez.
export const nuevoLote = () => `${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6)}`
export const loteDe = (notas: string | null | undefined) => /\[LOTE:([\w-]+)\]/.exec(String(notas ?? ''))?.[1] ?? null
export const sinMarcas = (notas: string | null | undefined) => String(notas ?? '').replace(/\[[A-Z_]+(?::[\w-]+)?\]\s*/g, '').trim()
