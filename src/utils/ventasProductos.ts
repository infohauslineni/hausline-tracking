import { esLineaEnvio } from '../services/pedidos.service'
import type { Inversion, Pedido, PedidoItem, Producto } from '../types/domain'

// Análisis de "Productos más vendidos" (Reportes). TODO sale de los pedidos reales del panel
// (pedidos + pedido_items) con la MISMA regla de venta que el resto de Reportes:
//   · cuenta todo pedido que NO esté cancelado (ni archivado: activo = false), por su fecha_pedido;
//   · no cuenta las líneas que no son producto: envío rápido / "Envío / delivery" (esLineaEnvio)
//     ni los cargos de servicio (cargo por bodega, categoría "Servicio").
// Ingresos = unidades × precio unitario de la línea (el descuento de cupón es del pedido entero y
// no se reparte por producto).

export type LineaVenta = {
  pedidoId: string
  fecha: string // YYYY-MM-DD (fecha_pedido)
  clave: string
  codigo: string | null
  nombre: string
  marca: string | null
  categoria: string
  talla: string
  cantidad: number
  ingreso: number
  imagen: string | null
}

export type Tendencia = 'aumento' | 'estable' | 'baja'
export type NivelDemanda = 'alta' | 'media' | 'baja'

export type ResumenProducto = {
  clave: string
  codigo: string | null
  nombre: string
  marca: string | null
  categoria: string
  imagen: string | null
  precio: number | null
  unidades: number
  ingresos: number
  pedidos: number
  ultimaVenta: string | null
  tallas: { talla: string; unidades: number; pct: number }[]
  tallaTop: string | null
  anterior: number // unidades del período anterior (mismo largo, justo antes)
  tendencia: Tendencia
  demanda: NivelDemanda
  historicas: number // unidades de todos los tiempos
  ultimaHistorica: string | null
}

export const SIN_TALLA = 'Sin talla'

// Más vendidas primero; si empatan, de menor a mayor talla (40 antes que 42) para que el orden
// sea siempre el mismo.
const ordenTallas = (a: { talla: string; unidades: number }, b: { talla: string; unidades: number }) =>
  b.unidades - a.unidades || a.talla.localeCompare(b.talla, 'es', { numeric: true })

// "EUR 41", "talla 41 " y "41" son la misma talla.
export function normalizarTalla(talla: string | null | undefined) {
  const t = String(talla ?? '').trim().replace(/^(talla|size|eur|us)\s*[:.-]?\s*/i, '').replace(/\s+/g, ' ').toUpperCase()
  return t || SIN_TALLA
}

function esLineaProducto(item: PedidoItem) {
  if (esLineaEnvio(item)) return false
  if (/^cargo por bodega/i.test(item.producto ?? '')) return false
  if ((item.categoria ?? '').trim().toLowerCase() === 'servicio') return false
  return Number(item.cantidad || 0) > 0
}

const norm = (v: unknown) => String(v ?? '').trim().toUpperCase()

// Pedidos que cuentan como venta (misma regla que ReportesGenerales).
export function esVenta(p: Pedido) {
  return p.estado !== 'cancelado' && p.activo !== false
}

export function lineasDeVenta(pedidos: Pedido[], productos: Producto[]): LineaVenta[] {
  const porCodigo = new Map(productos.map((p) => [norm(p.codigo), p]))
  const out: LineaVenta[] = []
  for (const p of pedidos) {
    if (!esVenta(p)) continue
    const fecha = (p.fecha_pedido || '').slice(0, 10)
    for (const it of p.pedido_items ?? []) {
      if (!esLineaProducto(it)) continue
      const codigo = norm(it.codigo_producto) || null
      const cat = codigo ? porCodigo.get(codigo) : undefined
      const cantidad = Number(it.cantidad || 1)
      out.push({
        pedidoId: p.id,
        fecha,
        clave: codigo ?? `N:${(it.producto || '').trim().toLowerCase()}`,
        codigo,
        nombre: cat?.nombre || it.producto,
        marca: cat?.marca ?? it.marca ?? null,
        categoria: (cat?.categoria || it.categoria || 'Otras').trim() || 'Otras',
        talla: normalizarTalla(it.talla),
        cantidad,
        ingreso: cantidad * Number(it.precio_unitario || 0),
        imagen: it.imagen || cat?.imagen || null,
      })
    }
  }
  return out
}

/* ------------------------------ Períodos ------------------------------ */
export type Preset = 'hoy' | '7' | '30' | '90' | 'anio' | 'custom'
export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const aFecha = (s: string) => new Date(`${s}T12:00:00`)
export const diasEntre = (desde: string, hasta: string) => Math.round((aFecha(hasta).getTime() - aFecha(desde).getTime()) / 86_400_000) + 1

export function rangoPreset(preset: Exclude<Preset, 'custom'>, hoy = new Date()): { desde: string; hasta: string } {
  const h = new Date(hoy); h.setHours(12, 0, 0, 0)
  if (preset === 'hoy') return { desde: iso(h), hasta: iso(h) }
  if (preset === 'anio') return { desde: `${h.getFullYear()}-01-01`, hasta: iso(h) }
  const d = new Date(h); d.setDate(h.getDate() - (Number(preset) - 1))
  return { desde: iso(d), hasta: iso(h) }
}

// El período anterior tiene el MISMO largo y termina justo antes de "desde".
export function periodoAnterior(desde: string, hasta: string) {
  const n = diasEntre(desde, hasta)
  const fin = aFecha(desde); fin.setDate(fin.getDate() - 1)
  const ini = new Date(fin); ini.setDate(fin.getDate() - (n - 1))
  return { desde: iso(ini), hasta: iso(fin) }
}

/* ------------------------------ Reglas ------------------------------ */
// Tendencia: unidades del período vs. el período anterior del mismo largo.
//   · aumento: sube al menos 25 % (o pasa de 0 a 2+ unidades)
//   · baja:    cae al menos 25 % (o pasa de 2+ a 0)
//   · estable: el resto (cambios chicos, o muy pocos datos para decir otra cosa)
export function tendencia(actual: number, anterior: number): Tendencia {
  if (anterior === 0) return actual >= 2 ? 'aumento' : 'estable'
  if (actual === 0) return anterior >= 2 ? 'baja' : 'estable'
  const r = actual / anterior
  if (r >= 1.25 && actual - anterior >= 1) return 'aumento'
  if (r <= 0.75 && anterior - actual >= 1) return 'baja'
  return 'estable'
}

// Demanda en el período elegido, según cuántos PEDIDOS distintos lo incluyeron:
//   · alta:  3 o más pedidos (se vende seguido)
//   · media: 2 pedidos (ocasional pero se repite)
//   · baja:  1 pedido
export function nivelDemanda(pedidos: number): NivelDemanda {
  if (pedidos >= 3) return 'alta'
  if (pedidos === 2) return 'media'
  return 'baja'
}

// Tallas que suman la mayor parte de las ventas del producto: de mayor a menor hasta cubrir
// el 70 % de las unidades con talla (máx. 4). Devuelve también qué % representan.
export function tallasRecomendadas(tallas: { talla: string; unidades: number }[]) {
  const con = tallas.filter((t) => t.talla !== SIN_TALLA).sort(ordenTallas)
  const total = con.reduce((s, t) => s + t.unidades, 0)
  if (!total) return { tallas: [] as string[], pct: 0 }
  const elegidas: string[] = []
  let acum = 0
  for (const t of con) {
    elegidas.push(t.talla); acum += t.unidades
    if (acum / total >= 0.7 || elegidas.length >= 4) break
  }
  return { tallas: elegidas, pct: Math.round((acum / total) * 100) }
}

/* ------------------------------ Agregados ------------------------------ */
type Acum = { base: LineaVenta; unidades: number; ingresos: number; pedidos: Set<string>; ultima: string | null; tallas: Map<string, number> }

function acumular(lineas: LineaVenta[]) {
  const m = new Map<string, Acum>()
  for (const l of lineas) {
    const a = m.get(l.clave) ?? { base: l, unidades: 0, ingresos: 0, pedidos: new Set<string>(), ultima: null, tallas: new Map<string, number>() }
    a.unidades += l.cantidad; a.ingresos += l.ingreso; a.pedidos.add(l.pedidoId)
    if (!a.ultima || l.fecha > a.ultima) a.ultima = l.fecha
    if (!a.base.imagen && l.imagen) a.base = { ...a.base, imagen: l.imagen }
    a.tallas.set(l.talla, (a.tallas.get(l.talla) ?? 0) + l.cantidad)
    m.set(l.clave, a)
  }
  return m
}

export function resumirProductos(todas: LineaVenta[], desde: string, hasta: string, productos: Producto[]): ResumenProducto[] {
  const ant = periodoAnterior(desde, hasta)
  const actual = acumular(todas.filter((l) => l.fecha >= desde && l.fecha <= hasta))
  const previo = acumular(todas.filter((l) => l.fecha >= ant.desde && l.fecha <= ant.hasta))
  const historico = acumular(todas)
  const porCodigo = new Map(productos.map((p) => [norm(p.codigo), p]))
  return [...actual.values()].map((a) => {
    const tallas = [...a.tallas.entries()].map(([talla, unidades]) => ({ talla, unidades, pct: Math.round((unidades / a.unidades) * 100) })).sort(ordenTallas)
    const top = tallas.find((t) => t.talla !== SIN_TALLA) ?? null
    const anterior = previo.get(a.base.clave)?.unidades ?? 0
    const h = historico.get(a.base.clave)
    const cat = a.base.codigo ? porCodigo.get(a.base.codigo) : undefined
    return {
      clave: a.base.clave, codigo: a.base.codigo, nombre: a.base.nombre, marca: a.base.marca, categoria: a.base.categoria,
      imagen: a.base.imagen, precio: cat ? Number(cat.precio_venta || 0) || null : null,
      unidades: a.unidades, ingresos: a.ingresos, pedidos: a.pedidos.size, ultimaVenta: a.ultima,
      tallas, tallaTop: top?.talla ?? null, anterior, tendencia: tendencia(a.unidades, anterior), demanda: nivelDemanda(a.pedidos.size),
      historicas: h?.unidades ?? a.unidades, ultimaHistorica: h?.ultima ?? a.ultima,
    }
  }).sort((x, y) => y.unidades - x.unidades || y.ingresos - x.ingresos || x.nombre.localeCompare(y.nombre))
}

// Productos del catálogo con 0, 1 o pocas (2) unidades vendidas en el período.
export function productosPocasVentas(resumen: ResumenProducto[], productos: Producto[], todas: LineaVenta[]) {
  const vendidos = new Map(resumen.filter((r) => r.codigo).map((r) => [r.codigo as string, r]))
  const historico = acumular(todas)
  return productos.filter((p) => p.activo !== false && p.codigo).map((p) => {
    const codigo = norm(p.codigo)
    const r = vendidos.get(codigo)
    const h = historico.get(codigo)
    return { codigo, nombre: p.nombre, marca: p.marca, categoria: p.categoria || 'Otras', imagen: p.imagen, unidades: r?.unidades ?? 0, historicas: h?.unidades ?? 0, ultimaHistorica: h?.ultima ?? null }
  }).filter((p) => p.unidades <= 2).sort((a, b) => a.unidades - b.unidades || a.historicas - b.historicas || a.nombre.localeCompare(b.nombre))
}

export function ventasPorCategoria(lineas: LineaVenta[]) {
  const m = new Map<string, { categoria: string; unidades: number; ingresos: number; pedidos: Set<string> }>()
  for (const l of lineas) {
    const c = m.get(l.categoria) ?? { categoria: l.categoria, unidades: 0, ingresos: 0, pedidos: new Set<string>() }
    c.unidades += l.cantidad; c.ingresos += l.ingreso; c.pedidos.add(l.pedidoId); m.set(l.categoria, c)
  }
  const total = [...m.values()].reduce((s, c) => s + c.unidades, 0) || 1
  return [...m.values()].map((c) => ({ categoria: c.categoria, unidades: c.unidades, ingresos: c.ingresos, pedidos: c.pedidos.size, pct: Math.round((c.unidades / total) * 100) })).sort((a, b) => b.unidades - a.unidades)
}

// Serie de ventas del producto: por semana (lunes) si el período es de hasta 120 días; si no, por mes.
export function serieVentas(lineas: LineaVenta[], desde: string, hasta: string) {
  const porMes = diasEntre(desde, hasta) > 120
  const clave = (f: string) => {
    if (porMes) return f.slice(0, 7)
    const d = aFecha(f); const dia = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dia); return iso(d)
  }
  const m = new Map<string, number>()
  for (const l of lineas) m.set(clave(l.fecha), (m.get(clave(l.fecha)) ?? 0) + l.cantidad)
  return { porMes, puntos: [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([periodo, unidades]) => ({ periodo, unidades })) }
}

// Stock REAL: lo que hay en "Compras libres" (inversiones) para ese código, por talla/color.
// En inventario y reservado = está en HAUSLINE; en tránsito = comprado, todavía en camino.
export function stockDeProducto(inversiones: Inversion[], codigo: string | null) {
  if (!codigo) return null
  const suyas = inversiones.filter((i) => norm(i.codigo) === codigo && ['en_inventario', 'reservado', 'en_transito'].includes(i.estado))
  if (!suyas.length) return null
  const porTalla = new Map<string, { disponible: number; reservado: number; enCamino: number }>()
  for (const i of suyas) {
    const t = normalizarTalla(i.talla_color)
    const cur = porTalla.get(t) ?? { disponible: 0, reservado: 0, enCamino: 0 }
    if (i.estado === 'en_inventario') cur.disponible += Number(i.cantidad || 0)
    else if (i.estado === 'reservado') cur.reservado += Number(i.cantidad || 0)
    else cur.enCamino += Number(i.cantidad || 0)
    porTalla.set(t, cur)
  }
  return [...porTalla.entries()].map(([talla, v]) => ({ talla, ...v }))
}
