import { supabase } from '../lib/supabase'
import { notaPublicaEstado } from '../constants/orders'
import type { EstadoPedido, Pedido, PedidoItem } from '../types/domain'
import { cachedQuery, invalidateComercial } from '../utils/queryCache'

export type NuevoPedidoInput = {
  cliente_id: string
  estado: EstadoPedido
  fecha_pedido: string
  fecha_estimada: string | null
  abono: number
  notas_internas: string | null
  notas_publicas: string | null
  metodo_pago?: string | null
  items: PedidoItem[]
}

export type EditarPedidoInput = Pick<NuevoPedidoInput, 'fecha_estimada' | 'abono' | 'notas_internas' | 'notas_publicas' | 'items'> & {
  // Costo real / pago al proveedor. Se deja editable porque a veces al comprarle al
  // proveedor sale más caro (o más barato) de lo estimado al crear el pedido.
  costo_proveedor?: number | null
}

function requireSupabase() {
  if (!supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

function fechaNicaragua() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Managua',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function sumarDias(fecha: string, dias: number) {
  const [year, month, day] = fecha.split('-').map(Number)
  const result = new Date(Date.UTC(year, month - 1, day))
  result.setUTCDate(result.getUTCDate() + dias)
  return result.toISOString().slice(0, 10)
}

export async function listarPedidos(onFresh?: (value: Pedido[]) => void) {
  return cachedQuery('pedidos', async () => {
    const { data, error } = await requireSupabase()
      .from('pedidos')
      .select('*, clientes(nombre, whatsapp), pedido_items(*), gastos(id, monto, categoria)')
      .order('created_at', { ascending: false })
    if (error) throw error
    return data as unknown as Pedido[]
  }, 45_000, onFresh)
}

export async function obtenerPedido(id: string) {
  const { data, error } = await requireSupabase()
    .from('pedidos')
    .select('*, clientes(nombre, whatsapp), pedido_items(*), gastos(*)')
    .eq('id', id)
    .single()
  if (error) throw error
  return data as unknown as Pedido
}

export async function actualizarEstadoPedido(id: string, estado: EstadoPedido) {
  const client = requireSupabase()
  const { data, error } = await client
    .from('pedidos')
    .update({
      estado,
      notas_publicas: notaPublicaEstado(estado),
      fecha_entrega: estado === 'entregado' ? new Date().toISOString() : null,
    })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error

  let updated = data as Pedido
  if (estado === 'llego_nicaragua') {
    const { data: dated, error: dateError } = await client
      .from('pedidos')
      .update({ fecha_estimada: sumarDias(fechaNicaragua(), 2) })
      .eq('id', id)
      .select('*')
      .single()
    if (dateError) throw dateError
    updated = dated as Pedido
  }

  invalidateComercial()
  return updated
}

export async function entregarPedidoConPago(id: string, montoRecibido: number, metodoPago: string) {
  const client = requireSupabase()
  const { data: pedido, error: pedidoError } = await client.from('pedidos').select('id,codigo,cliente_id,saldo').eq('id', id).single()
  if (pedidoError) throw pedidoError
  const saldoActual = Math.max(0, Number(pedido.saldo || 0))
  const monto = Math.max(0, Number(montoRecibido || 0))
  const adicionalDelivery = Math.max(0, monto - saldoActual)
  if (adicionalDelivery > 0) {
    const { error } = await client.from('pedido_items').insert({ pedido_id: id, producto: 'Delivery cobrado al cliente', categoria: 'Servicio', cantidad: 1, precio_unitario: adicionalDelivery, precio_compra: 0, envio_internacional: 0, costo_delivery: 0, otros_gastos: 0 })
    if (error) throw error
  }
  if (monto > 0) {
    const fecha = new Date().toISOString().slice(0, 10)
    const { data: pago, error } = await client.from('pagos').insert({ pedido_id: id, cliente_id: pedido.cliente_id, fecha, tipo: 'pago_final', monto, metodo_pago: metodoPago || null, observaciones: adicionalDelivery > 0 ? `Incluye USD ${adicionalDelivery.toFixed(2)} cobrados por delivery` : 'Saldo cobrado al entregar' }).select('id').single()
    if (error) throw error
    const { error: movementError } = await client.from('movimientos_cuenta').insert({ fecha: `${fecha}T12:00:00`, tipo: 'ingreso', descripcion: `Pago final ${pedido.codigo}`, monto, metodo: metodoPago || null, pedido_id: id, pago_id: pago.id })
    if (movementError) throw movementError
  }
  const { data, error } = await client.from('pedidos').update({ estado: 'entregado', notas_publicas: notaPublicaEstado('entregado'), fecha_entrega: new Date().toISOString() }).eq('id', id).select('*').single()
  if (error) throw error
  invalidateComercial()
  return data as Pedido
}

export async function eliminarPedido(id: string) {
  const client = requireSupabase()
  const { data: files, error: filesError } = await client.from('archivos_pedido').select('storage_path').eq('pedido_id', id)
  if (filesError) throw filesError
  const { error } = await client.from('pedidos').delete().eq('id', id)
  if (error) throw error
  invalidateComercial()
  const paths = (files ?? []).map((file) => file.storage_path).filter(Boolean)
  if (paths.length) await client.storage.from('pedidos').remove(paths)
}

export async function crearPedido(input: NuevoPedidoInput) {
  const client = requireSupabase()
  const { items, ...pedido } = input
  const { data: created, error } = await client.from('pedidos').insert(pedido).select('*').single()
  if (error) throw error

  const { error: itemsError } = await client.from('pedido_items').insert(
    items.map((item) => ({
      pedido_id: created.id,
      producto: item.producto,
      marca: item.marca || null,
      categoria: item.categoria || null,
      talla: item.talla || null,
      color: item.color || null,
      cantidad: item.cantidad,
      precio_unitario: item.precio_unitario,
      notas: item.notas || null,
      producto_id: item.producto_id || null,
      codigo_producto: item.codigo_producto || null,
      proveedor_id: item.proveedor_id || null,
      precio_compra: item.precio_compra || 0,
      envio_internacional: item.envio_internacional || 0,
      costo_delivery: item.costo_delivery || 0,
      otros_gastos: item.otros_gastos || 0,
      imagen: item.imagen || null,
    })),
  )
  if (itemsError) {
    await client.from('pedidos').delete().eq('id', created.id)
    throw itemsError
  }
  const costoProveedor = items.reduce((sum, item) => sum + Number(item.precio_compra || 0) * Number(item.cantidad || 1), 0)
  if (costoProveedor > 0) {
    const proveedores = [...new Set(items.map((item) => item.proveedor_id).filter(Boolean))]
    const { data: expense, error: expenseError } = await client.from('gastos').insert({ fecha: input.fecha_pedido, categoria: 'Proveedor', monto: costoProveedor, metodo_pago: input.metodo_pago || null, pedido_id: created.id, proveedor_id: proveedores.length === 1 ? proveedores[0] : null, descripcion: `Pago a proveedor · ${created.codigo}`, observaciones: 'Generado automáticamente al registrar el pedido' }).select('id').single()
    if (expenseError) { await client.from('pedidos').delete().eq('id', created.id); throw expenseError }
    const { error: movementError } = await client.from('movimientos_cuenta').insert({ fecha: `${input.fecha_pedido}T12:00:00`, tipo: 'pago_proveedor', descripcion: `Pago a proveedor · ${created.codigo}`, monto: costoProveedor, metodo: input.metodo_pago || null, pedido_id: created.id, gasto_id: expense.id })
    if (movementError) { await client.from('gastos').delete().eq('id', expense.id); await client.from('pedidos').delete().eq('id', created.id); throw movementError }
  }
  if (input.abono > 0) {
    const { data: payment, error: paymentError } = await client.from('pagos').insert({ pedido_id: created.id, cliente_id: input.cliente_id, fecha: input.fecha_pedido, tipo: 'abono_inicial', monto: input.abono, metodo_pago: input.metodo_pago || null, observaciones: 'Abono inicial registrado con la venta' }).select('id').single()
    if (paymentError) { await client.from('pedidos').delete().eq('id', created.id); throw paymentError }
    await client.from('movimientos_cuenta').insert({ fecha: `${input.fecha_pedido}T12:00:00`, tipo: 'ingreso', descripcion: `Abono inicial ${created.codigo}`, monto: input.abono, metodo: input.metodo_pago || null, pedido_id: created.id, pago_id: payment.id })
  }
  invalidateComercial()
  return created as Pedido
}

export async function actualizarPedidoCompleto(id: string, input: EditarPedidoInput) {
  const client = requireSupabase()
  const { data: anteriores, error: anterioresError } = await client.from('pedido_items').select('*').eq('pedido_id', id)
  if (anterioresError) throw anterioresError

  const nuevos = input.items.map((item) => ({
    pedido_id: id,
    producto: item.producto.trim(),
    marca: item.marca?.trim() || null,
    categoria: item.categoria?.trim() || null,
    talla: item.talla?.trim() || null,
    color: item.color?.trim() || null,
    cantidad: item.cantidad,
    precio_unitario: item.precio_unitario,
    notas: item.notas?.trim() || null,
    producto_id: item.producto_id || null,
    codigo_producto: item.codigo_producto?.trim() || null,
    proveedor_id: item.proveedor_id || null,
    precio_compra: item.precio_compra || 0,
    envio_internacional: item.envio_internacional || 0,
    costo_delivery: item.costo_delivery || 0,
    otros_gastos: item.otros_gastos || 0,
    imagen: item.imagen || null,
  }))

  const { error: deleteError } = await client.from('pedido_items').delete().eq('pedido_id', id)
  if (deleteError) throw deleteError

  const { error: insertError } = await client.from('pedido_items').insert(nuevos)
  if (insertError) {
    const respaldo = (anteriores ?? []).map(({ id: _id, subtotal: _subtotal, created_at: _createdAt, updated_at: _updatedAt, ...item }) => item)
    if (respaldo.length) await client.from('pedido_items').insert(respaldo)
    throw insertError
  }

  const { error: pedidoError } = await client.from('pedidos').update({
    fecha_estimada: input.fecha_estimada,
    abono: input.abono,
    notas_internas: input.notas_internas,
    notas_publicas: input.notas_publicas,
  }).eq('id', id)
  if (pedidoError) throw pedidoError

  if (input.costo_proveedor != null) await ajustarCostoProveedor(client, id, Number(input.costo_proveedor))

  invalidateComercial()
  return obtenerPedido(id)
}

// Deja el costo real del pedido en el monto indicado, actualizando (o creando) el gasto
// "Proveedor" y el movimiento de caja asociado para que la ganancia y la caja cuadren.
async function ajustarCostoProveedor(client: NonNullable<typeof supabase>, pedidoId: string, monto: number) {
  const nuevoCosto = Math.max(0, monto)
  const { data: gasto, error: gastoError } = await client.from('gastos').select('id').eq('pedido_id', pedidoId).ilike('categoria', '%proveedor%').maybeSingle()
  if (gastoError) throw gastoError

  if (gasto) {
    if (nuevoCosto > 0) {
      const { error: updateError } = await client.from('gastos').update({ monto: nuevoCosto }).eq('id', gasto.id)
      if (updateError) throw updateError
      const { error: movError } = await client.from('movimientos_cuenta').update({ monto: nuevoCosto }).eq('gasto_id', gasto.id)
      if (movError) throw movError
    } else {
      await client.from('movimientos_cuenta').delete().eq('gasto_id', gasto.id)
      await client.from('gastos').delete().eq('id', gasto.id)
    }
    return
  }

  if (nuevoCosto <= 0) return
  const { data: pedido, error: pedidoError } = await client.from('pedidos').select('codigo, fecha_pedido, metodo_pago').eq('id', pedidoId).single()
  if (pedidoError) throw pedidoError
  const { data: expense, error: expenseError } = await client.from('gastos').insert({ fecha: pedido.fecha_pedido, categoria: 'Proveedor', monto: nuevoCosto, metodo_pago: pedido.metodo_pago || null, pedido_id: pedidoId, descripcion: `Pago a proveedor · ${pedido.codigo}`, observaciones: 'Costo real ajustado manualmente' }).select('id').single()
  if (expenseError) throw expenseError
  const { error: movError } = await client.from('movimientos_cuenta').insert({ fecha: `${pedido.fecha_pedido}T12:00:00`, tipo: 'pago_proveedor', descripcion: `Pago a proveedor · ${pedido.codigo}`, monto: nuevoCosto, metodo: pedido.metodo_pago || null, pedido_id: pedidoId, gasto_id: expense.id })
  if (movError) throw movError
}
