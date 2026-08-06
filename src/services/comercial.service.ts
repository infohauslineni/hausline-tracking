import { supabase } from '../lib/supabase'
import catalogoInicial from '../data/catalogo-productos.json'
import type { CajaMes, Deuda, Gasto, Inversion, MovimientoCuenta, Pago, Producto, Proveedor, ResumenComercial } from '../types/domain'
import { cachedQuery, invalidateCache } from '../utils/queryCache'
import { obtenerGananciaDisponibleActual } from './finanzas.service'

function client() { if (!supabase) throw new Error('Supabase no está configurado.'); return supabase }

export async function obtenerTipoCambio(): Promise<number> {
  const { data, error } = await client().from('configuracion').select('valor_json').eq('clave', 'moneda').maybeSingle()
  if (error) throw error
  const tc = Number((data?.valor_json as { tipo_cambio?: number } | null)?.tipo_cambio ?? 37)
  return tc > 0 ? tc : 37
}
export async function guardarTipoCambio(tipoCambio: number) {
  const { error } = await client().from('configuracion').upsert({ clave: 'moneda', valor_json: { tipo_cambio: tipoCambio } }, { onConflict: 'clave' })
  if (error) throw error
}

function normalizarCaja(value: Partial<CajaMes>, periodo: string): CajaMes {
  return { periodo: String(value.periodo ?? periodo), sugerido: Number(value.sugerido ?? 0), apertura: value.apertura == null ? null : Number(value.apertura), opening: Number(value.opening ?? 0), movimientos_mes: Number(value.movimientos_mes ?? 0), saldo_mes: Number(value.saldo_mes ?? 0), confirmada: Boolean(value.confirmada) }
}
export async function obtenerCajaMes(periodo: string): Promise<CajaMes> {
  const { data, error } = await client().rpc('obtener_apertura_caja', { p_periodo: periodo })
  if (error) throw error
  return normalizarCaja(data as Partial<CajaMes>, periodo)
}
export async function guardarAperturaCaja(periodo: string, monto: number, nota?: string): Promise<CajaMes> {
  const { data, error } = await client().rpc('guardar_apertura_caja', { p_periodo: periodo, p_monto: monto, p_nota: nota ?? null })
  if (error) throw error
  return normalizarCaja(data as Partial<CajaMes>, periodo)
}

export async function obtenerResumenComercial(desde?: string, hasta?: string) {
  const { data, error } = await client().rpc('obtener_resumen_comercial', { p_desde: desde || null, p_hasta: hasta || null })
  if (error) throw error
  const value = data as Partial<ResumenComercial>
  return { ventas: Number(value.ventas ?? 0), cobrado: Number(value.cobrado ?? 0), por_cobrar: Number(value.por_cobrar ?? 0), gastos: Number(value.gastos ?? 0), costos_productos: Number(value.costos_productos ?? 0), saldo_cuenta: Number(value.saldo_cuenta ?? 0), pedidos: Number(value.pedidos ?? 0) } satisfies ResumenComercial
}

export async function listarProductos() { return cachedQuery('productos', async () => { const { data, error } = await client().from('productos').select('*, proveedores(nombre)').order('created_at', { ascending: false }); if (error) throw error; return data as unknown as Producto[] }) }
export async function guardarProducto(input: Omit<Producto, 'id' | 'created_at' | 'proveedores'>, id?: string) { const query = id ? client().from('productos').update(input).eq('id', id) : client().from('productos').insert(input); const { data, error } = await query.select('*, proveedores(nombre)').single(); if (error) throw error; invalidateCache('productos'); return data as unknown as Producto }
export async function actualizarImagenProducto(id: string, imagen: string | null) { const { data, error } = await client().from('productos').update({ imagen }).eq('id', id).select('*, proveedores(nombre)').single(); if (error) throw error; invalidateCache('productos'); return data as unknown as Producto }
export async function eliminarProducto(id: string) { const { error } = await client().from('productos').update({ activo: false }).eq('id', id); if (error) throw error; invalidateCache('productos') }
export async function sincronizarCatalogo(url = 'https://hauslineshopni.es/catalogo-productos.json') {
  type CatalogItem = { codigo:string; nombre:string; marca?:string|null; categoria?:string|null; tallas?:string[]; precio_venta?:number; precio_oferta?:number; promocion_hasta?:string|null; imagen?:string|null; descripcion?:string|null }
  // Precio que realmente se vende en la web: usa la oferta solo si es válida y NO está vencida.
  // Si la promoción ya venció (promocion_hasta en el pasado) se queda con el precio original.
  const precioVentaWeb = (item: CatalogItem) => {
    const base = Number(item.precio_venta || 0), oferta = Number(item.precio_oferta || 0)
    if (!(oferta > 0 && oferta < base)) return base
    const hasta = String(item.promocion_hasta || '').trim()
    if (hasta) { const fin = new Date(hasta); if (!Number.isNaN(fin.getTime()) && fin.getTime() < Date.now()) return base }
    return oferta
  }
  let catalog = catalogoInicial as CatalogItem[]
  const sources = [
    `/api/catalogo?actualizado=${Date.now()}`,
    `${url}${url.includes('?') ? '&' : '?'}actualizado=${Date.now()}`,
  ]
  for (const source of sources) {
    try {
      const response = await fetch(source, { cache: 'no-store', headers: { accept: 'application/json' } })
      if (!response.ok) continue
      const published = await response.json() as CatalogItem[]
      if (Array.isArray(published) && published.length) {
        catalog = published
        break
      }
    } catch { /* Prueba la siguiente fuente y conserva la copia incluida como respaldo. */ }
  }
  const base = new URL(url)
  const records = catalog
    .filter(item => String(item.codigo ?? '').trim() && String(item.nombre ?? '').trim())
    .map(item => ({ codigo:String(item.codigo).trim().toUpperCase(), nombre:String(item.nombre).trim(), marca:item.marca||null, categoria:item.categoria||null, tallas:Array.isArray(item.tallas) ? item.tallas : [], precio_venta:precioVentaWeb(item), imagen:item.imagen ? new URL(item.imagen, base).href : null, descripcion:item.descripcion||null, activo:true }))
  const uniqueRecords = [...new Map(records.map((item) => [item.codigo, item])).values()]
  for (let index=0; index<uniqueRecords.length; index+=100) { const { error } = await client().from('productos').upsert(uniqueRecords.slice(index,index+100), { onConflict:'codigo', ignoreDuplicates:false }); if(error) throw error }
  invalidateCache('productos')
  return uniqueRecords.length
}

export async function listarProveedores() { return cachedQuery('proveedores', async () => { const { data, error } = await client().from('proveedores').select('*').eq('activo', true).order('nombre'); if (error) throw error; return data as Proveedor[] }) }
export async function guardarProveedor(nombre: string) { const { data, error } = await client().from('proveedores').upsert({ nombre: nombre.trim(), activo: true }, { onConflict: 'nombre' }).select('*').single(); if (error) throw error; invalidateCache('proveedores'); return data as Proveedor }

export async function listarPagos() { const { data, error } = await client().from('pagos').select('*, pedidos(codigo,saldo), clientes(nombre)').order('fecha', { ascending: false }).limit(300); if (error) throw error; return data as unknown as Pago[] }
export async function registrarPago(input: Omit<Pago, 'id' | 'created_at' | 'pedidos' | 'clientes'>) {
  const { data, error } = await client().from('pagos').insert(input).select('*, pedidos(codigo,saldo), clientes(nombre)').single(); if (error) throw error
  if (input.tipo !== 'reembolso') await client().from('movimientos_cuenta').insert({ fecha: `${input.fecha}T12:00:00`, tipo: 'ingreso', descripcion: `Pago de cliente`, monto: input.monto, moneda: input.moneda ?? 'USD', monto_original: input.monto_original ?? input.monto, tipo_cambio: input.tipo_cambio ?? null, metodo: input.metodo_pago, pedido_id: input.pedido_id, pago_id: data.id, observaciones: input.observaciones })
  return data as unknown as Pago
}

export async function listarGastos() { const { data, error } = await client().from('gastos').select('*, pedidos(codigo), inversiones(producto,codigo), proveedores(nombre)').order('fecha', { ascending: false }).limit(300); if (error) throw error; return data as unknown as Gasto[] }
// Un gasto de categoría "Deuda" es un pago de deuda hecho directamente desde Gastos:
// baja el saldo de caja (como cualquier gasto) y además consume ganancia disponible.
const esDeuda = (categoria: string) => categoria.trim().toLowerCase() === 'deuda'
export async function registrarGasto(input: Omit<Gasto, 'id' | 'created_at' | 'pedidos' | 'proveedores'>) {
  const { data, error } = await client().from('gastos').insert(input).select('*, pedidos(codigo), inversiones(producto,codigo), proveedores(nombre)').single(); if (error) throw error
  await client().from('movimientos_cuenta').insert({ fecha: `${input.fecha}T12:00:00`, tipo: input.categoria.toLowerCase().includes('proveedor') ? 'pago_proveedor' : 'gasto', descripcion: input.descripcion, monto: input.monto, moneda: input.moneda ?? 'USD', monto_original: input.monto_original ?? input.monto, tipo_cambio: input.tipo_cambio ?? null, metodo: input.metodo_pago, pedido_id: input.pedido_id, inversion_id: input.inversion_id, gasto_id: data.id, observaciones: input.observaciones })
  // Deuda: además de bajar el saldo, descuenta la misma cantidad de la ganancia disponible.
  // Se enlaza con gasto_id para revertirla sola al eliminar el gasto (ON DELETE CASCADE).
  if (esDeuda(input.categoria)) {
    const { error: allocationError } = await client().from('asignaciones_ganancia').insert({ fecha: input.fecha, tipo: 'pago_deuda', monto: input.monto, descripcion: `Deuda pagada · ${input.descripcion}`, gasto_id: data.id })
    if (allocationError) { await client().from('gastos').delete().eq('id', data.id); throw allocationError }
  }
  // El costo del envío se refleja dentro del pedido (Costo real del pedido y Ventas),
  // no en el catálogo maestro de Productos.
  invalidateCache('pedidos')
  return data as unknown as Gasto
}

// Edita un gasto ya registrado y mantiene todo sincronizado: el movimiento de caja ligado
// (monto/fecha/método) y, si es de categoría "Deuda", la asignación de ganancia.
export async function actualizarGasto(id: string, input: Omit<Gasto, 'id' | 'created_at' | 'pedidos' | 'proveedores'>) {
  const { data, error } = await client().from('gastos').update(input).eq('id', id).select('*, pedidos(codigo), inversiones(producto,codigo), proveedores(nombre)').single(); if (error) throw error
  await client().from('movimientos_cuenta').update({ fecha: `${input.fecha}T12:00:00`, tipo: input.categoria.toLowerCase().includes('proveedor') ? 'pago_proveedor' : 'gasto', descripcion: input.descripcion, monto: input.monto, moneda: input.moneda ?? 'USD', monto_original: input.monto_original ?? input.monto, tipo_cambio: input.tipo_cambio ?? null, metodo: input.metodo_pago, pedido_id: input.pedido_id, inversion_id: input.inversion_id, observaciones: input.observaciones }).eq('gasto_id', id)
  // Rehace la asignación de ganancia según la categoría actual (deuda o no).
  await client().from('asignaciones_ganancia').delete().eq('gasto_id', id)
  if (esDeuda(input.categoria)) {
    const { error: allocationError } = await client().from('asignaciones_ganancia').insert({ fecha: input.fecha, tipo: 'pago_deuda', monto: input.monto, descripcion: `Deuda pagada · ${input.descripcion}`, gasto_id: id })
    if (allocationError) throw allocationError
  }
  invalidateCache('inversiones'); invalidateCache('pedidos')
  return data as unknown as Gasto
}

// Elimina un gasto y revierte el saldo: borra primero el movimiento de cuenta ligado
// (gasto_id es on delete set null, así que hay que quitarlo a mano para devolver el monto).
// La asignación de ganancia de una deuda se borra sola por ON DELETE CASCADE en gasto_id.
export async function eliminarGasto(id: string) {
  const { error: movError } = await client().from('movimientos_cuenta').delete().eq('gasto_id', id)
  if (movError) throw movError
  const { error } = await client().from('gastos').delete().eq('id', id)
  if (error) throw error
  invalidateCache('inversiones'); invalidateCache('pedidos')
}

export async function listarMovimientos() { const { data, error } = await client().from('movimientos_cuenta').select('*, pedidos(codigo)').order('fecha', { ascending: false }).limit(300); if (error) throw error; return data as unknown as MovimientoCuenta[] }
export async function registrarMovimiento(input: Omit<MovimientoCuenta, 'id' | 'created_at' | 'pedidos'>) { const { data, error } = await client().from('movimientos_cuenta').insert(input).select('*, pedidos(codigo)').single(); if (error) throw error; return data as unknown as MovimientoCuenta }
export async function eliminarMovimiento(id: string) { const { error } = await client().from('movimientos_cuenta').delete().eq('id', id); if (error) throw error }

export async function listarInversiones() { return cachedQuery('inversiones', async () => { const { data, error } = await client().from('inversiones').select('*, productos(nombre,codigo), gastos(id,monto,categoria)').order('fecha', { ascending: false }); if (error) throw error; return data as unknown as Inversion[] }) }
export async function registrarInversion(input: Omit<Inversion, 'id' | 'created_at' | 'productos'>, metodo: string, descontarDeCuenta = true) {
  const { data, error } = await client().from('inversiones').insert(input).select('*, productos(nombre,codigo)').single()
  if (error) throw error
  if (descontarDeCuenta) {
    const monto = Number(input.costo_unitario) * Number(input.cantidad) + Number(input.gastos_adicionales)
    const { error: movementError } = await client().from('movimientos_cuenta').insert({ fecha: `${input.fecha}T12:00:00`, tipo: 'inversion', descripcion: `InversiÃ³n en ${input.producto}`, monto, metodo: metodo || null, inversion_id: data.id, observaciones: input.notas })
    if (movementError) { await client().from('inversiones').delete().eq('id', data.id); throw movementError }
  }
  invalidateCache('inversiones')
  return data as unknown as Inversion
}
export async function cambiarEstadoInversion(id: string, estado: Inversion['estado']) { const { data, error } = await client().from('inversiones').update({ estado }).eq('id', id).select('*, productos(nombre,codigo)').single(); if (error) throw error; invalidateCache('inversiones'); return data as unknown as Inversion }

// Venta directa de stock inmediato: registra el ingreso y marca el producto como vendido,
// SIN crear un pedido de importación ni pasar por el flujo de tracking.
export async function venderStockInmediato(item: Inversion, opts: { fecha: string; precio_venta: number; monto_recibido: number; metodo: string; cliente: string; observaciones: string }) {
  const { data, error } = await client().from('inversiones').update({ precio_venta_estimado: opts.precio_venta, estado: 'vendido' }).eq('id', item.id).select('*, productos(nombre,codigo)').single()
  if (error) throw error
  if (opts.monto_recibido > 0) {
    const detalle = opts.cliente.trim() ? ` · ${opts.cliente.trim()}` : ''
    const { error: movError } = await client().from('movimientos_cuenta').insert({ fecha: `${opts.fecha}T12:00:00`, tipo: 'ingreso', descripcion: `Venta de stock · ${item.producto}${detalle}`, monto: opts.monto_recibido, metodo: opts.metodo || null, inversion_id: item.id, observaciones: opts.observaciones || null })
    if (movError) throw movError
  }
  invalidateCache('inversiones')
  return data as unknown as Inversion
}

// Ventas directas de stock: se guardan como movimientos de ingreso ligados a una inversión.
// Se reconstruyen aquí para poder listarlas junto a las ventas por pedido.
export type VentaStock = { id: string; fecha: string; monto: number; producto: string; codigo: string | null; cliente: string | null; costo: number }
export async function listarVentasStock(): Promise<VentaStock[]> {
  const { data, error } = await client().from('movimientos_cuenta').select('id, fecha, monto, descripcion, inversion_id, inversiones(producto, codigo, costo_unitario, cantidad, gastos_adicionales)').eq('tipo', 'ingreso').not('inversion_id', 'is', null).order('fecha', { ascending: false }).limit(300)
  if (error) throw error
  return (data as unknown as Array<{ id: string; fecha: string; monto: number; descripcion: string | null; inversiones: { producto: string; codigo: string | null; costo_unitario: number; cantidad: number; gastos_adicionales: number } | null }>).map((row) => {
    const partes = (row.descripcion ?? '').split(' · ')
    const inv = row.inversiones
    return { id: row.id, fecha: row.fecha, monto: Number(row.monto), producto: inv?.producto ?? partes[1] ?? 'Producto', codigo: inv?.codigo ?? null, cliente: partes.length >= 3 ? partes.slice(2).join(' · ') : null, costo: inv ? Number(inv.costo_unitario) * Number(inv.cantidad) + Number(inv.gastos_adicionales) : 0 }
  })
}

// Elimina un producto de stock/inversión y revierte el capital: borra el movimiento
// automático de inversión (si lo hubo) para devolver ese monto al saldo de Mi cuenta.
export async function eliminarInversion(id: string) {
  await client().from('movimientos_cuenta').delete().eq('inversion_id', id).eq('tipo', 'inversion')
  const { error } = await client().from('inversiones').delete().eq('id', id)
  if (error) throw error
  invalidateCache('inversiones')
}
export async function actualizarInversion(id: string, input: Partial<Omit<Inversion, 'id'|'created_at'|'productos'>>) {
  const { data, error } = await client().from('inversiones').update(input).eq('id', id).select('*, productos(nombre,codigo)').single()
  if (error) throw error
  if (input.costo_unitario !== undefined || input.cantidad !== undefined || input.gastos_adicionales !== undefined || input.producto !== undefined) {
    const updated = data as unknown as Inversion
    await client().from('movimientos_cuenta').update({ descripcion: `Inversión en ${updated.producto}`, monto: Number(updated.costo_unitario) * Number(updated.cantidad) + Number(updated.gastos_adicionales), observaciones: updated.notas }).eq('inversion_id', id)
  }
  invalidateCache('inversiones')
  return data as unknown as Inversion
}

export async function listarDeudas() { const { data, error } = await client().from('deudas').select('*, pagos_deuda(*)').order('created_at', { ascending: false }); if (error) throw error; return data as unknown as Deuda[] }
export async function registrarDeuda(input: Omit<Deuda, 'id' | 'monto_pagado' | 'estado' | 'created_at' | 'pagos_deuda'>) { const { data, error } = await client().from('deudas').insert({ ...input, monto_pagado: 0, estado: 'pendiente' }).select('*, pagos_deuda(*)').single(); if (error) throw error; return data as unknown as Deuda }
export async function registrarPagoDeuda(deuda: Deuda, montoSolicitado: number, fecha: string, metodo: string, notas: string, desdeGanancia = 0) {
  const saldo = Math.max(0, Number(deuda.monto_total) - Number(deuda.monto_pagado))
  const monto = Math.min(saldo, Math.max(0, Number(montoSolicitado)))
  if (!monto) throw new Error('Indica un monto válido.')
  const ganancia = Math.min(monto, Math.max(0, Number(desdeGanancia)))
  if (ganancia > 0) { const disponible = await obtenerGananciaDisponibleActual(); if (ganancia > disponible.ganancia_disponible) throw new Error(`Solo tienes USD ${disponible.ganancia_disponible.toFixed(2)} de ganancia disponible.`) }
  const negocio = monto - ganancia
  const { data: pago, error } = await client().from('pagos_deuda').insert({ deuda_id: deuda.id, fecha, monto, metodo: metodo || null, notas: notas || null, desde_ganancia: ganancia, desde_negocio: negocio }).select('*').single()
  if (error) throw error
  const nuevoPagado = Number(deuda.monto_pagado) + monto
  const { error: updateError } = await client().from('deudas').update({ monto_pagado: nuevoPagado, estado: nuevoPagado >= Number(deuda.monto_total) ? 'pagada' : 'pendiente' }).eq('id', deuda.id)
  if (updateError) { await client().from('pagos_deuda').delete().eq('id', pago.id); throw updateError }
  const { error: movementError } = await client().from('movimientos_cuenta').insert({ fecha: `${fecha}T12:00:00`, tipo: 'gasto', descripcion: `Pago de deuda · ${deuda.acreedor}`, monto, metodo: metodo || null, observaciones: deuda.concepto })
  if (movementError) throw movementError
  if (ganancia > 0) {
    const { error: allocationError } = await client().from('asignaciones_ganancia').insert({ fecha, tipo: 'pago_deuda', monto: ganancia, descripcion: `Ganancia usada para deuda · ${deuda.acreedor}`, deuda_id: deuda.id })
    if (allocationError) throw allocationError
  }
  const { data: updated, error: reloadError } = await client().from('deudas').select('*, pagos_deuda(*)').eq('id', deuda.id).single()
  if (reloadError) throw reloadError
  return updated as unknown as Deuda
}
