import type { Pedido, PedidoItem } from '../types/domain'
import { porPagarInversion } from '../utils/compraPago'
import { listarInversiones, listarProductos, obtenerTipoCambio } from './comercial.service'
import { listarCuentas } from './cuentas.service'
import { listarGastosFijos } from './gastosFijos.service'
import { dineroLibre, listarMinimos, type LibreCuenta } from './minimosCuentas.service'
import { esLineaEnvio, listarPedidos } from './pedidos.service'
import { listarReembolsos } from './reembolsos.service'

// ¿CUÁNTO PUEDO INVERTIR? El dinero libre de verdad (saldo de las cuentas por encima de su mínimo)
// menos todo lo que YA está comprometido y va a salir: pedidos que falta comprarle al proveedor,
// envíos internacionales por pagar, compras libres por pagar, devoluciones pendientes y gastos
// fijos del mes. Lo que queda es lo que se puede usar para comprar stock sin quedarse corto.
// Lo que deben los clientes (saldos) se muestra aparte: todavía no entró.

const r2 = (n: number) => Math.round(n * 100) / 100
export type LineaCompromiso = { etiqueta: string; monto: number; pedidoId?: string }
export type Compromiso = { clave: string; titulo: string; ayuda: string; monto: number; aprox: boolean; lineas: LineaCompromiso[] }
export type ResumenInversion = {
  libreReal: number | null
  cuentas: LibreCuenta[]
  compromisos: Compromiso[]
  totalCompromisos: number
  puedeInvertir: number | null
  porCobrar: number
  sinCosto: string[] // pedidos por comprar cuyo costo no se sabe (no entran en la suma)
  envioPromedio: number
}

const ANTES_DE_COMPRAR = ['pedido_confirmado', 'en_preparacion', 'control_calidad']
const EN_CAMINO = ['etiqueta_creada', 'despachado', 'transito_internacional', 'recibido_estados_unidos', 'transito_nicaragua', 'llego_nicaragua']
const tieneGasto = (p: Pedido, patron: RegExp) => (p.gastos ?? []).some((g) => patron.test(String(g.categoria ?? '')) && Number(g.monto || 0) > 0)

export async function obtenerResumenInversion(): Promise<ResumenInversion> {
  const [pedidos, productos, inversiones, reembolsos, cuentas, minimos, tipoCambio, fijos] = await Promise.all([
    listarPedidos().catch(() => [] as Pedido[]), listarProductos().catch(() => []), listarInversiones().catch(() => []),
    listarReembolsos().catch(() => []), listarCuentas().catch(() => []), listarMinimos().catch(() => ({})),
    obtenerTipoCambio().catch(() => 37), listarGastosFijos().catch(() => []),
  ])
  const tc = tipoCambio > 0 ? tipoCambio : 37
  const libre = dineroLibre(cuentas, minimos, tc)
  const activos = pedidos.filter((p) => p.activo !== false && p.estado !== 'cancelado')

  // 1. Pedidos que falta comprarle al proveedor (sin "pago a proveedor" registrado).
  const costoCatalogo = (it: PedidoItem) => {
    const cod = (it.codigo_producto ?? '').trim().toUpperCase()
    const prod = productos.find((x) => (it.producto_id && x.id === it.producto_id) || (cod && (x.codigo ?? '').trim().toUpperCase() === cod))
    return Number(prod?.precio_compra || 0)
  }
  const sinCosto: string[] = []
  const proveedor: LineaCompromiso[] = []
  for (const p of activos.filter((x) => ANTES_DE_COMPRAR.includes(x.estado) && !tieneGasto(x, /proveedor/i))) {
    let costo = 0, falta = false
    for (const it of (p.pedido_items ?? []).filter((x) => !esLineaEnvio(x))) {
      const propio = Number(it.precio_compra || 0) + Number(it.otros_gastos || 0)
      const unidad = propio > 0 ? propio : costoCatalogo(it)
      if (unidad > 0) costo += unidad * Number(it.cantidad || 1); else falta = true
    }
    if (falta && costo <= 0) { sinCosto.push(p.codigo); continue }
    proveedor.push({ etiqueta: `${p.codigo}${p.clientes?.nombre ? ` · ${p.clientes.nombre}` : ''}${falta ? ' (falta el costo de un producto)' : ''}`, monto: r2(costo), pedidoId: p.id })
  }

  // 2. Envíos internacionales por pagar: pedidos que todavía no lo tienen. Se estima con el promedio
  //    de los últimos envíos registrados.
  const envios = pedidos.flatMap((p) => (p.gastos ?? []).filter((g) => /internacional/i.test(String(g.categoria ?? ''))).map((g) => Number(g.monto || 0))).filter((m) => m > 0)
  const ultimos = envios.slice(0, 20)
  const envioPromedio = ultimos.length ? r2(ultimos.reduce((s, m) => s + m, 0) / ultimos.length) : 18
  const enviosLineas: LineaCompromiso[] = activos
    .filter((p) => (EN_CAMINO.includes(p.estado) || ANTES_DE_COMPRAR.includes(p.estado)) && !tieneGasto(p, /internacional/i))
    .map((p) => ({ etiqueta: `${p.codigo} · ${EN_CAMINO.includes(p.estado) ? 'en camino' : 'cuando salga'}`, monto: envioPromedio, pedidoId: p.id }))

  // 3. Compras libres por pagar al proveedor (lo que falta, descontando adelantos).
  const compras: LineaCompromiso[] = inversiones.filter((i) => i.pagado === false && i.estado !== 'descartado').map((i) => {
    const costo = Number(i.costo_unitario) * Number(i.cantidad) + Number(i.gastos_adicionales)
    return { etiqueta: `${i.codigo ? `${i.codigo} · ` : ''}${i.producto}${i.talla_color ? ` · ${i.talla_color}` : ''}`, monto: porPagarInversion(i, costo) }
  }).filter((l) => l.monto > 0.005)

  // 4. Devoluciones pendientes (si las aprobás, sale lo que el cliente pagó).
  const devoluciones: LineaCompromiso[] = reembolsos.filter((s) => s.estado === 'pendiente').map((s) => ({ etiqueta: `${s.codigo ?? 'Pedido'} · solicitud de cancelación`, monto: r2(Number(s.monto_pagado || s.pedidos?.abono || 0)) })).filter((l) => l.monto > 0)

  // 5. Gastos fijos que faltan pagar este mes.
  const mes = new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 7)
  const fijosLineas: LineaCompromiso[] = fijos.filter((g) => g.activo && g.desde <= mes && !(g.ultimo && g.ultimo >= mes))
    .map((g) => ({ etiqueta: `${g.descripcion} · día ${g.dia}`, monto: r2(g.moneda === 'NIO' ? g.monto / tc : g.monto) }))

  const suma = (l: LineaCompromiso[]) => r2(l.reduce((s, x) => s + x.monto, 0))
  const compromisos: Compromiso[] = [
    { clave: 'proveedor', titulo: 'Por comprarle al proveedor', ayuda: 'Pedidos confirmados sin pago al proveedor (costo del catálogo).', monto: suma(proveedor), aprox: false, lineas: proveedor },
    { clave: 'envios', titulo: 'Envíos internacionales por pagar', ayuda: `Pedidos sin envío registrado · aprox. US$ ${envioPromedio.toFixed(2)} cada uno (tu promedio).`, monto: suma(enviosLineas), aprox: true, lineas: enviosLineas },
    { clave: 'compras', titulo: 'Compras libres por pagar', ayuda: 'Stock que todavía le debés al proveedor.', monto: suma(compras), aprox: false, lineas: compras },
    { clave: 'devoluciones', titulo: 'Devoluciones pendientes', ayuda: 'Solicitudes de cancelación: si las aprobás, sale lo que pagó el cliente.', monto: suma(devoluciones), aprox: false, lineas: devoluciones },
    { clave: 'fijos', titulo: 'Gastos fijos que faltan este mes', ayuda: 'Del negocio y de tu ganancia.', monto: suma(fijosLineas), aprox: false, lineas: fijosLineas },
  ].filter((c) => c.monto > 0.005)
  const totalCompromisos = r2(compromisos.reduce((s, c) => s + c.monto, 0))
  const libreReal = libre.porCuenta.length ? libre.libreUsd : null
  const porCobrar = r2(activos.filter((p) => p.estado !== 'cancelado').reduce((s, p) => s + Math.max(0, Number(p.saldo || 0)), 0))
  return { libreReal, cuentas: libre.porCuenta, compromisos, totalCompromisos, puedeInvertir: libreReal == null ? null : r2(libreReal - totalCompromisos), porCobrar, sinCosto, envioPromedio }
}
