import type { ConfiguracionFinanzas, Pedido } from '../types/domain'
import { TIPOS_PRODUCTO, tipoDeProducto, type TipoProducto } from '../utils/repartoCompra'
import { guardarConfiguracionFinanzas, obtenerConfiguracionFinanzas } from './finanzas.service'
import { listarPedidos } from './pedidos.service'

// PRECIO SUGERIDO (tienda) y PRECIO MAYORISTA de cada producto, solo para el panel:
//   base = costo (lo que se le paga al proveedor) + envío a Nicaragua estimado
//   precio = base ÷ (1 − margen)   → con 40 %: $28.50 de base sale a $48; con 25 % a $38.
// El envío estimado por tipo (zapatos, ropa…) sale del promedio real de los pedidos (envío
// internacional por unidad); si hay pocos datos, uno fijo. Márgenes y envío se cambian en
// Productos → "Precios sugeridos" y se guardan en configuracion.finanzas.
export const MARGEN_TIENDA_DEFECTO = 40
export const MARGEN_MAYORISTA_DEFECTO = 25
export const ENVIO_DEFECTO: Record<TipoProducto, number> = { zapatos: 15, ropa: 4, bolso: 10, accesorio: 3 }
const MIN_MUESTRAS = 3

export type DatosPrecio = {
  margenTienda: number
  margenMayorista: number
  envio: Record<TipoProducto, number> // el que se usa
  real: Record<TipoProducto, { promedio: number; muestras: number }> // promedio de los pedidos
  fijo: Partial<Record<TipoProducto, number>> // el que se puso a mano (gana sobre el promedio)
}
export type Sugerido = { envio: number; base: number; tienda: number; mayorista: number }

const r2 = (n: number) => Math.round(n * 100) / 100
const TIPOS = Object.keys(TIPOS_PRODUCTO) as TipoProducto[]

// Tipo de un producto de la tienda: por categoría/subcategoría y, si no, por el nombre.
export function tipoDeTienda(d: { nombre?: string; categoria?: string; subcategoria?: string; tipoPrenda?: string }): TipoProducto {
  if (d.categoria === 'Accesorios') return tipoDeProducto(d.nombre) === 'bolso' ? 'bolso' : 'accesorio'
  if (d.subcategoria === 'Ropa' || d.tipoPrenda) return 'ropa'
  if (d.subcategoria === 'Calzado') return 'zapatos'
  return tipoDeProducto(`${d.nombre ?? ''} ${d.categoria ?? ''}`)
}

// Redondea hacia arriba al dólar entero (precios limpios).
export const conMargen = (base: number, margen: number) => base > 0 ? Math.ceil(base / (1 - Math.min(90, Math.max(0, margen)) / 100)) : 0

export function sugerirPrecios(costo: number, tipo: TipoProducto, datos: DatosPrecio): Sugerido | null {
  if (!(costo > 0)) return null
  const envio = datos.envio[tipo] ?? ENVIO_DEFECTO[tipo]
  const base = r2(costo + envio)
  return { envio, base, tienda: conMargen(base, datos.margenTienda), mayorista: conMargen(base, datos.margenMayorista) }
}

// Promedio real del envío internacional por unidad, por tipo (últimos 30 de cada tipo).
export function envioRealPorTipo(pedidos: Pedido[]): DatosPrecio['real'] {
  const montos: Record<TipoProducto, number[]> = { zapatos: [], ropa: [], bolso: [], accesorio: [] }
  for (const p of pedidos) for (const it of p.pedido_items ?? []) {
    const e = Number(it.envio_internacional || 0)
    if (e <= 0) continue
    const lista = montos[tipoDeProducto(`${it.producto} ${it.categoria ?? ''}`)]
    if (lista.length < 30) lista.push(e)
  }
  return Object.fromEntries(TIPOS.map((t) => [t, { promedio: montos[t].length ? r2(montos[t].reduce((s, m) => s + m, 0) / montos[t].length) : 0, muestras: montos[t].length }])) as DatosPrecio['real']
}

function armar(config: Partial<ConfiguracionFinanzas>, real: DatosPrecio['real']): DatosPrecio {
  const fijo = config.envio_estimado ?? {}
  const envio = Object.fromEntries(TIPOS.map((t) => {
    const f = Number(fijo[t])
    return [t, f > 0 ? f : real[t].muestras >= MIN_MUESTRAS ? real[t].promedio : ENVIO_DEFECTO[t]]
  })) as Record<TipoProducto, number>
  const mt = Number(config.margen_tienda), mm = Number(config.margen_mayorista)
  return { margenTienda: mt > 0 ? mt : MARGEN_TIENDA_DEFECTO, margenMayorista: mm > 0 ? mm : MARGEN_MAYORISTA_DEFECTO, envio, real, fijo }
}

export const DATOS_PRECIO_DEFECTO: DatosPrecio = armar({}, envioRealPorTipo([]))

let cache: Promise<DatosPrecio> | null = null
export function obtenerDatosPrecio(refrescar = false): Promise<DatosPrecio> {
  if (!cache || refrescar) {
    cache = Promise.all([obtenerConfiguracionFinanzas().catch(() => ({})), listarPedidos().catch(() => [] as Pedido[])])
      .then(([config, pedidos]) => armar(config, envioRealPorTipo(pedidos)))
    cache.catch(() => { cache = null })
  }
  return cache
}

export async function guardarDatosPrecio(cambios: { margenTienda: number; margenMayorista: number; envioFijo: Partial<Record<TipoProducto, number>> }) {
  const actual = await obtenerConfiguracionFinanzas()
  const envio = Object.fromEntries(Object.entries(cambios.envioFijo).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, r2(Number(v))]))
  await guardarConfiguracionFinanzas({
    ...actual,
    margen_tienda: Math.min(90, Math.max(1, Math.round(cambios.margenTienda))),
    margen_mayorista: Math.min(90, Math.max(1, Math.round(cambios.margenMayorista))),
    envio_estimado: envio,
  })
  cache = null
  return obtenerDatosPrecio(true)
}
