import { supabase } from '../lib/supabase'
import { esLineaEnvio } from './pedidos.service'

// TIEMPOS REALES: cuánto tarda DE VERDAD cada producto y cada marca, medido con el historial de
// los pedidos (no con lo que se promete).
//   · Preparación = desde que el pedido entra a "En preparación" (se le paga al proveedor) hasta
//     que pasa a "Control de calidad" (llegaron las fotos). Si no pasó por "En preparación", se
//     cuenta desde que se creó el pedido.
//   · Envío = desde "Control de calidad" hasta que llega a Nicaragua ("Llegó al país" o
//     "Disponible para entrega", lo primero).
// Con esto la tienda puede prometer la preparación real de cada producto (prepMin/prepMax).

const DIA = 86_400_000
export type Medicion = { pedidoId: string; codigoPedido: string; preparacion: number | null; envio: number | null; fecha: string }
export type Estadistica = { n: number; promedio: number; mediana: number; min: number; max: number; desde: number; hasta: number }
export type GrupoTiempos = { clave: string; nombre: string; marca: string; preparacion: Estadistica | null; envio: Estadistica | null; mediciones: Medicion[]; codigos: string[] }

type ItemFila = { codigo_producto: string | null; producto: string; marca: string | null; categoria?: string | null; notas?: string | null }
type PedidoFila = { id: string; codigo: string; created_at: string; estado: string; pedido_items: ItemFila[] | null; historial_pedidos: { estado_nuevo: string; created_at: string }[] | null }

const redondear1 = (n: number) => Math.round(n * 10) / 10
function percentil(ordenados: number[], p: number) {
  if (!ordenados.length) return 0
  const i = (ordenados.length - 1) * p, a = Math.floor(i), b = Math.ceil(i)
  return ordenados[a] + (ordenados[b] - ordenados[a]) * (i - a)
}
// Rango sugerido para la tienda: del 25 % al 75 % de los casos (lo normal), en días enteros.
export function estadistica(valores: number[]): Estadistica | null {
  const v = valores.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b)
  if (!v.length) return null
  const desde = Math.max(1, Math.floor(percentil(v, 0.25)))
  return { n: v.length, promedio: redondear1(v.reduce((s, x) => s + x, 0) / v.length), mediana: redondear1(percentil(v, 0.5)), min: redondear1(v[0]), max: redondear1(v[v.length - 1]), desde, hasta: Math.max(desde, Math.ceil(percentil(v, 0.75))) }
}

function primera(h: { estado_nuevo: string; created_at: string }[], estados: string[]) {
  const t = h.filter((x) => estados.includes(x.estado_nuevo)).map((x) => new Date(x.created_at).getTime()).filter(Number.isFinite).sort((a, b) => a - b)
  return t[0] ?? null
}

export function medirPedido(p: Pick<PedidoFila, 'id' | 'codigo' | 'created_at' | 'historial_pedidos'>): Medicion {
  const h = p.historial_pedidos ?? []
  const inicio = primera(h, ['en_preparacion']) ?? primera(h, ['pedido_confirmado']) ?? new Date(p.created_at).getTime()
  const calidad = primera(h, ['control_calidad'])
  const llegada = primera(h, ['llego_nicaragua', 'disponible_entrega'])
  const preparacion = calidad != null && calidad >= inicio ? redondear1((calidad - inicio) / DIA) : null
  const envio = calidad != null && llegada != null && llegada >= calidad ? redondear1((llegada - calidad) / DIA) : null
  return { pedidoId: p.id, codigoPedido: p.codigo, preparacion, envio, fecha: p.created_at }
}

export async function obtenerTiemposReales(meses = 12): Promise<{ marcas: GrupoTiempos[]; productos: GrupoTiempos[]; general: { preparacion: Estadistica | null; envio: Estadistica | null } }> {
  if (!supabase) return { marcas: [], productos: [], general: { preparacion: null, envio: null } }
  const desde = new Date(Date.now() - meses * 30 * DIA).toISOString()
  const { data, error } = await supabase.from('pedidos')
    .select('id, codigo, created_at, estado, pedido_items(codigo_producto, producto, marca, categoria, notas), historial_pedidos(estado_nuevo, created_at)')
    .neq('estado', 'cancelado').gte('created_at', desde).order('created_at', { ascending: false }).limit(1000)
  if (error) throw error
  const porMarca = new Map<string, GrupoTiempos>(), porProducto = new Map<string, GrupoTiempos>()
  const todas: Medicion[] = []
  const sumar = (mapa: Map<string, GrupoTiempos>, clave: string, nombre: string, marca: string, codigo: string, m: Medicion) => {
    const g = mapa.get(clave) ?? { clave, nombre, marca, preparacion: null, envio: null, mediciones: [], codigos: [] }
    if (!g.mediciones.some((x) => x.pedidoId === m.pedidoId)) g.mediciones.push(m)
    if (codigo && !g.codigos.includes(codigo)) g.codigos.push(codigo)
    mapa.set(clave, g)
  }
  for (const p of (data ?? []) as unknown as PedidoFila[]) {
    const m = medirPedido(p)
    if (m.preparacion == null && m.envio == null) continue
    todas.push(m)
    for (const it of (p.pedido_items ?? []).filter((x) => !esLineaEnvio(x as never))) {
      const codigo = (it.codigo_producto ?? '').trim().toUpperCase()
      const marca = (it.marca ?? '').trim().toUpperCase() || 'SIN MARCA'
      sumar(porMarca, marca, marca, marca, codigo, m)
      if (codigo) sumar(porProducto, codigo, it.producto, marca, codigo, m)
    }
  }
  const cerrar = (g: GrupoTiempos): GrupoTiempos => ({
    ...g,
    preparacion: estadistica(g.mediciones.map((x) => x.preparacion).filter((x): x is number => x != null)),
    envio: estadistica(g.mediciones.map((x) => x.envio).filter((x): x is number => x != null)),
  })
  const orden = (a: GrupoTiempos, b: GrupoTiempos) => (b.preparacion?.n ?? 0) - (a.preparacion?.n ?? 0) || a.nombre.localeCompare(b.nombre)
  return {
    marcas: [...porMarca.values()].map(cerrar).sort(orden),
    productos: [...porProducto.values()].map(cerrar).sort(orden),
    general: {
      preparacion: estadistica(todas.map((x) => x.preparacion).filter((x): x is number => x != null)),
      envio: estadistica(todas.map((x) => x.envio).filter((x): x is number => x != null)),
    },
  }
}
