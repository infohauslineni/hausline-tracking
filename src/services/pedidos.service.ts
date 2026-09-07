import { supabase } from '../lib/supabase'
import { notaPublicaEstado, type MotivoCancelacion } from '../constants/orders'
import type { EstadoPedido, Pedido, PedidoItem } from '../types/domain'
import { cachedQuery, invalidateCache, invalidateComercial } from '../utils/queryCache'
import { etiquetaCargoBodega } from '../utils/bodega'
import { ajustarSaldoCuenta } from './cuentas.service'

export type NuevoPedidoInput = {
  cliente_id: string
  estado: EstadoPedido
  fecha_pedido: string
  fecha_estimada: string | null
  abono: number
  notas_internas: string | null
  notas_publicas: string | null
  metodo_pago?: string | null
  envio_rapido?: boolean
  descuento?: number
  cupon_id?: string | null
  cupon_codigo?: string | null
  items: PedidoItem[]
}

export type EditarPedidoInput = Pick<NuevoPedidoInput, 'fecha_estimada' | 'abono' | 'notas_internas' | 'notas_publicas' | 'envio_rapido' | 'items'> & {
  // Costo real / pago al proveedor. Se deja editable porque a veces al comprarle al
  // proveedor sale más caro (o más barato) de lo estimado al crear el pedido.
  costo_proveedor?: number | null
  // Ajuste de la tarjeta de la cuenta por el cambio de costo: `ajuste` ya viene firmado y
  // en la moneda de la cuenta (negativo si salió más plata, positivo si volvió).
  cuentaAjuste?: { cuentaId: string; ajuste: number } | null
}

function requireSupabase() {
  if (!supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

// Envío rápido (14–17 días): recargo único de US$ 15 por pedido. Se cobra como una
// línea real del pedido para que el total, el saldo, la factura, las ventas y la
// contabilidad cuadren solos (el total del pedido = suma de los subtotales de sus
// líneas). Precio de compra 0 → es margen puro (ingreso por el servicio de envío).
export const ENVIO_RAPIDO_RECARGO = 15
// Marca interna para reconocer y no duplicar la línea del envío rápido.
const ENVIO_RAPIDO_NOTA = '__envio_rapido__'

// True si el ítem es la línea automática del envío rápido (no un producto real).
export function esLineaEnvioRapido(item: Pick<PedidoItem, 'notas'>) {
  return item.notas === ENVIO_RAPIDO_NOTA
}

// Quita cualquier línea previa de envío rápido y, si corresponde, agrega una fresca.
// Así, al crear/editar, el recargo lo maneja solo la casilla "envío rápido" y nunca
// se duplica ni queda pegado si se desmarca.
function conLineaEnvioRapido(items: PedidoItem[], envioRapido?: boolean): PedidoItem[] {
  const base = items.filter((item) => !esLineaEnvioRapido(item))
  if (!envioRapido) return base
  return [...base, {
    producto: 'Envío rápido (14–17 días)',
    categoria: 'Servicio',
    cantidad: 1,
    precio_unitario: ENVIO_RAPIDO_RECARGO,
    precio_compra: 0,
    envio_internacional: 0,
    costo_delivery: 0,
    otros_gastos: 0,
    notas: ENVIO_RAPIDO_NOTA,
  }]
}

// Rellena la foto de cada producto del pedido desde el catálogo (tabla productos),
// emparejando por CÓDIGO, cuando el ítem no trae su propia imagen. Se resuelve en
// CADA carga, así que si subís el producto al catálogo —o corregís un código mal
// escrito— DESPUÉS de crear el pedido, la foto aparece sola. No pisa una imagen
// propia del ítem. Complementa al trigger productos_sincronizar_imagen, que solo
// alcanza a los ítems ya enlazados por producto_id (no a los que se registraron
// cuando el producto aún no estaba en el catálogo).
async function adjuntarFotosCatalogo(items: PedidoItem[]) {
  if (!supabase || !items.length) return
  const norm = (valor: unknown) => String(valor ?? '').trim().toUpperCase()
  const sinFoto = items.filter((item) => !item.imagen)
  if (!sinFoto.length) return
  const codigos = [...new Set(sinFoto.map((item) => norm(item.codigo_producto || item.producto)).filter(Boolean))]
  const nombres = [...new Set(sinFoto.map((item) => (item.producto ?? '').trim()).filter(Boolean))]
  // Empareja por CÓDIGO y también por NOMBRE del producto. Así, si el ítem quedó sin
  // código (encargos viejos) pero su nombre coincide con un producto del catálogo, la
  // foto igual aparece en panel, factura y correos.
  // Lee del catálogo por la vista `catalogo_fotos` (código/nombre/foto) en vez de la tabla
  // `productos`: así el operador —que no puede leer productos, para no ver precio_compra—
  // igual obtiene las fotos de los pedidos. El admin también la usa (mismos datos).
  const [porCod, porNom] = await Promise.all([
    codigos.length ? supabase.from('catalogo_fotos').select('codigo, imagen').in('codigo', codigos) : Promise.resolve({ data: [] as { codigo: string; imagen: string | null }[] }),
    nombres.length ? supabase.from('catalogo_fotos').select('nombre, imagen').in('nombre', nombres) : Promise.resolve({ data: [] as { nombre: string; imagen: string | null }[] }),
  ])
  const porCodigo = new Map<string, string>()
  for (const producto of (porCod.data ?? []) as { codigo: string; imagen: string | null }[]) if (producto.imagen) porCodigo.set(norm(producto.codigo), producto.imagen)
  const porNombre = new Map<string, string>()
  for (const producto of (porNom.data ?? []) as { nombre: string; imagen: string | null }[]) if (producto.imagen) porNombre.set(norm(producto.nombre), producto.imagen)
  if (!porCodigo.size && !porNombre.size) return
  for (const item of sinFoto) {
    const foto = porCodigo.get(norm(item.codigo_producto || item.producto)) ?? porNombre.get(norm(item.producto))
    if (foto) item.imagen = foto
  }
}

// Los costos por ítem viven en la tabla hermana solo-admin `pedido_item_costos` (blindaje:
// el operador no los puede leer). Al leer un pedido, se APLANAN de vuelta sobre cada ítem
// para que el costeo (pedidoCosto.ts) siga leyendo item.precio_compra igual que antes. Para
// el operador el embed viene vacío por RLS → los ítems quedan sin costo, sin fuga.
type ItemConCostos = PedidoItem & { pedido_item_costos?: unknown }
function aplanarCostos(items: ItemConCostos[] | undefined) {
  for (const item of items ?? []) {
    const raw = item.pedido_item_costos
    const costo = (Array.isArray(raw) ? raw[0] : raw) as Partial<PedidoItem> | undefined
    if (costo) {
      item.precio_compra = Number(costo.precio_compra || 0)
      item.envio_internacional = Number(costo.envio_internacional || 0)
      item.costo_delivery = Number(costo.costo_delivery || 0)
      item.otros_gastos = Number(costo.otros_gastos || 0)
    }
    delete item.pedido_item_costos
  }
}

// Guarda los costos por ítem en la tabla solo-admin, emparejando por índice con los ítems
// recién insertados (PostgREST devuelve las filas en el mismo orden en que se enviaron).
// Solo inserta filas con algún costo > 0 (los servicios como envío/delivery no llevan costo).
async function guardarCostosItems(client: NonNullable<typeof supabase>, insertados: { id: string }[], origen: PedidoItem[]) {
  const filas = insertados.map((row, i) => ({
    item_id: row.id,
    precio_compra: Number(origen[i]?.precio_compra || 0),
    envio_internacional: Number(origen[i]?.envio_internacional || 0),
    costo_delivery: Number(origen[i]?.costo_delivery || 0),
    otros_gastos: Number(origen[i]?.otros_gastos || 0),
  })).filter((f) => f.precio_compra || f.envio_internacional || f.costo_delivery || f.otros_gastos)
  if (filas.length) {
    const { error } = await client.from('pedido_item_costos').insert(filas)
    if (error) throw error
  }
}

// "Aprende" el costo del producto: si el producto del catálogo AÚN NO tiene costo
// (precio_compra en 0), le guarda el costo unitario que se pagó al proveedor en el
// pedido. NUNCA pisa un costo ya existente. Empareja por producto_id o, si no, por
// código. Así, al registrar el pago al proveedor de un encargo sin costo, el producto
// queda con su costo real (deja de salir en $0.00).
async function aprenderCostoProducto(client: NonNullable<typeof supabase>, item: Pick<PedidoItem, 'producto_id' | 'codigo_producto'>, costoUnitario: number) {
  const costo = Number(costoUnitario)
  if (!(costo > 0)) return
  const codigo = (item.codigo_producto ?? '').trim()
  let query = client.from('productos').select('id, precio_compra')
  if (item.producto_id) query = query.eq('id', item.producto_id)
  else if (codigo) query = query.ilike('codigo', codigo)
  else return
  const { data, error } = await query.limit(1).maybeSingle()
  if (error || !data) return
  if (Number(data.precio_compra || 0) > 0) return // ya tiene costo: no lo tocamos
  await client.from('productos').update({ precio_compra: costo }).eq('id', data.id)
}

// De los ítems de un pedido, devuelve los que son PRODUCTOS reales (con producto_id o
// código), excluyendo servicios como el envío rápido o el delivery cobrado.
function itemsProducto<T extends Pick<PedidoItem, 'producto_id' | 'codigo_producto' | 'notas'>>(items: T[]): T[] {
  return items.filter((it) => !esLineaEnvioRapido(it) && Boolean(it.producto_id || (it.codigo_producto ?? '').trim()))
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
      .select('*, clientes(nombre, whatsapp, departamento, ciudad), pedido_items(*, pedido_item_costos(*)), gastos(id, monto, categoria)')
      .order('created_at', { ascending: false })
    if (error) throw error
    const pedidos = data as unknown as Pedido[]
    for (const pedido of pedidos) aplanarCostos(pedido.pedido_items)
    await adjuntarFotosCatalogo(pedidos.flatMap((pedido) => pedido.pedido_items ?? []))
    return pedidos
  }, 45_000, onFresh)
}

// Fuerza una recarga fresca de la lista de pedidos (ignora la caché). Se usa cuando llega
// un cambio por realtime (p. ej. al confirmar un encargo desde otra sesión), para que la
// lista se actualice sola sin recargar la página.
export async function recargarPedidos(onFresh?: (value: Pedido[]) => void) {
  invalidateCache('pedidos')
  return listarPedidos(onFresh)
}

// Realtime: avisa cuando cambia la tabla de pedidos (nuevo encargo confirmado, cambio de
// estado, borrado). El panel de Pedidos se suscribe para reflejarlo en vivo.
export function suscribirPedidos(onChange: () => void) {
  const client = supabase
  if (!client) return () => undefined
  const channel = client.channel('pedidos-panel').on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, onChange).subscribe()
  return () => { void client.removeChannel(channel) }
}

export async function obtenerPedido(id: string) {
  const { data, error } = await requireSupabase()
    .from('pedidos')
    .select('*, clientes(nombre, whatsapp, departamento, ciudad), pedido_items(*, pedido_item_costos(*)), gastos(*)')
    .eq('id', id)
    .single()
  if (error) throw error
  const pedido = data as unknown as Pedido
  aplanarCostos(pedido.pedido_items)
  await adjuntarFotosCatalogo(pedido.pedido_items ?? [])
  return pedido
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

// Orden de las etapas (espejo de api/_track17.js PROGRESO) para nunca retroceder.
const PROGRESO_ESTADOS: EstadoPedido[] = [
  'pedido_confirmado', 'en_preparacion', 'control_calidad', 'etiqueta_creada', 'despachado',
  'transito_internacional', 'recibido_estados_unidos', 'transito_nicaragua',
  'llego_nicaragua', 'disponible_entrega', 'pagado', 'empaquetado', 'entregado',
]

// Al subir las fotos "Recibido en HAUSLINE" (las fotos reales del producto tomadas con el
// teléfono cuando el pedido llega a HAUSLINE, Nicaragua), el pedido avanza solo a
// "Disponible para entrega". Es el evento físico real: el producto ya está en mano y listo
// para coordinar la entrega. No retrocede el pedido ni pisa entregado/cancelado/incidencia,
// y no hace nada si ya estaba en esa etapa o más adelante. El UPDATE dispara el historial y
// el correo automático (con esas fotos). Devuelve el pedido actualizado, o null si no tocaba.
export async function avanzarADisponiblePorRecibido(id: string): Promise<Pedido | null> {
  const client = requireSupabase()
  const { data, error } = await client.from('pedidos').select('estado').eq('id', id).single()
  if (error) throw error
  const actual = data.estado as EstadoPedido
  if (actual === 'entregado' || actual === 'cancelado' || actual === 'incidencia') return null
  const destino: EstadoPedido = 'disponible_entrega'
  if (PROGRESO_ESTADOS.indexOf(actual) >= PROGRESO_ESTADOS.indexOf(destino)) return null
  return actualizarEstadoPedido(id, destino)
}

// Al subir la foto "Empaque para envío", el pedido avanza solo a "Empaquetado, listo para
// envío" (empaquetado). Es el evento físico real: el paquete quedó empacado y va a salir
// (delivery en Managua o bus/Cargotrans a departamentos). Igual que la foto de Miami: no
// retrocede el pedido ni pisa entregado/cancelado/incidencia, y no hace nada si ya estaba
// en esa etapa o más adelante. El UPDATE dispara el historial y el correo automático (con
// la foto del paquete). Devuelve el pedido actualizado, o null si no correspondía avanzar.
export async function avanzarAEmpaquetadoPorFoto(id: string): Promise<Pedido | null> {
  const client = requireSupabase()
  const { data, error } = await client.from('pedidos').select('estado').eq('id', id).single()
  if (error) throw error
  const actual = data.estado as EstadoPedido
  if (actual === 'entregado' || actual === 'cancelado' || actual === 'incidencia') return null
  const destino: EstadoPedido = 'empaquetado'
  if (PROGRESO_ESTADOS.indexOf(actual) >= PROGRESO_ESTADOS.indexOf(destino)) return null
  return actualizarEstadoPedido(id, destino)
}

// Fecha (ISO) en que el pedido entró por primera vez a "disponible_entrega", tomada del
// historial de estados. Sirve para calcular el cargo por bodega en el panel. Devuelve
// null si el pedido nunca estuvo disponible.
export async function obtenerDisponibleDesde(pedidoId: string): Promise<string | null> {
  const { data, error } = await requireSupabase()
    .from('historial_pedidos')
    .select('created_at')
    .eq('pedido_id', pedidoId)
    .eq('estado_nuevo', 'disponible_entrega')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data?.created_at ?? null
}

// Etiqueta de la línea de envío/delivery en el pedido (única, para poder actualizarla
// sin duplicar). No colisiona con "Envío rápido (14–17 días)" que es otra cosa.
const ENVIO_LOCAL_LABEL = 'Envío / delivery'

// Agrega (o actualiza) el costo de envío/delivery del pedido como una línea real, para
// que el total, el saldo, la factura y el mensaje al cliente lo incluyan. Así podés
// calcular el delivery con la agencia y darle al cliente el total ya con envío. Si
// `costo` es 0, quita la línea. Devuelve el pedido actualizado.
export async function agregarEnvioPedido(id: string, costo: number, detalle?: string | null) {
  const client = requireSupabase()
  const monto = Math.round(Math.max(0, Number(costo || 0)) * 100) / 100
  await client.from('pedido_items').delete().eq('pedido_id', id).eq('producto', ENVIO_LOCAL_LABEL)
  if (monto > 0) {
    const { error } = await client.from('pedido_items').insert({ pedido_id: id, producto: ENVIO_LOCAL_LABEL, categoria: 'Servicio', talla: detalle?.trim() || null, cantidad: 1, precio_unitario: monto })
    if (error) throw error
  }
  invalidateComercial()
  return obtenerPedido(id)
}

// Cobra el pedido y avanza su estado (a 'pagado' cuando el cliente paga, o directo a
// 'entregado'). Si `cargoBodega` > 0, primero lo agrega como una línea real del pedido
// ("Cargo por bodega (N días)"), así total/saldo/factura/caja lo incluyen; luego calcula
// el saldo ya con ese cargo dentro. `fecha_entrega` solo se setea al entregar.
export async function cobrarPedido(id: string, montoRecibido: number, metodoPago: string, estadoDestino: EstadoPedido = 'entregado', cargoBodega = 0, diasBodega = 0, destino?: { cuentaId?: string | null; montoCuenta?: number }) {
  const client = requireSupabase()
  const cuentaId = destino?.cuentaId || null
  const cargo = Math.round(Math.max(0, Number(cargoBodega || 0)) * 100) / 100
  if (cargo > 0) {
    const { error } = await client.from('pedido_items').insert({ pedido_id: id, producto: etiquetaCargoBodega(diasBodega), categoria: 'Servicio', cantidad: 1, precio_unitario: cargo })
    if (error) throw error
  }
  const { data: pedido, error: pedidoError } = await client.from('pedidos').select('id,codigo,cliente_id,saldo').eq('id', id).single()
  if (pedidoError) throw pedidoError
  const saldoActual = Math.max(0, Number(pedido.saldo || 0))
  const monto = Math.max(0, Number(montoRecibido || 0))
  const adicionalDelivery = Math.max(0, monto - saldoActual)
  if (adicionalDelivery > 0) {
    const { error } = await client.from('pedido_items').insert({ pedido_id: id, producto: 'Delivery cobrado al cliente', categoria: 'Servicio', cantidad: 1, precio_unitario: adicionalDelivery })
    if (error) throw error
  }
  if (monto > 0) {
    const fecha = new Date().toISOString().slice(0, 10)
    const { data: pago, error } = await client.from('pagos').insert({ pedido_id: id, cliente_id: pedido.cliente_id, fecha, tipo: 'pago_final', monto, metodo_pago: metodoPago || null, observaciones: adicionalDelivery > 0 ? `Incluye USD ${adicionalDelivery.toFixed(2)} cobrados por delivery` : 'Saldo cobrado' }).select('id').single()
    if (error) throw error
    // Un pago final SUMA a la cuenta: delta positivo (se guarda para poder revertirlo si se borra).
    const deltaCuenta = cuentaId ? Math.abs(Number(destino?.montoCuenta ?? monto)) : null
    const { error: movementError } = await client.from('movimientos_cuenta').insert({ fecha: `${fecha}T12:00:00`, tipo: 'ingreso', descripcion: `Pago final ${pedido.codigo}`, monto, metodo: metodoPago || null, pedido_id: id, pago_id: pago.id, cuenta_id: cuentaId, monto_cuenta: deltaCuenta })
    if (movementError) throw movementError
    if (deltaCuenta) await ajustarSaldoCuenta(cuentaId!, deltaCuenta)
  }
  const { data, error } = await client.from('pedidos').update({ estado: estadoDestino, notas_publicas: notaPublicaEstado(estadoDestino), fecha_entrega: estadoDestino === 'entregado' ? new Date().toISOString() : null }).eq('id', id).select('*').single()
  if (error) throw error
  invalidateComercial()
  return data as Pedido
}

// Cancela el pedido guardando el motivo (cliente canceló / no entregado-devolución / otro).
// La devolución del dinero, si aplica, se registra aparte con registrarReembolso.
export async function cancelarPedido(id: string, motivo: MotivoCancelacion) {
  const client = requireSupabase()
  const { data, error } = await client.from('pedidos').update({ estado: 'cancelado', notas_publicas: notaPublicaEstado('cancelado'), motivo_cancelacion: motivo }).eq('id', id).select('*').single()
  if (error) throw error
  invalidateComercial()
  return data as Pedido
}

// Manda los productos de un pedido (cancelado, pero el paquete apareció) al inventario /
// stock. No mueve dinero: el capital ya quedó contabilizado en su momento. Crea una
// entrada de inventario por cada producto real del pedido y devuelve cuántas creó.
export async function pasarPedidoAStock(id: string) {
  const client = requireSupabase()
  const pedido = await obtenerPedido(id)
  const productos = itemsProducto(pedido.pedido_items ?? [])
  const base = productos.length ? productos : (pedido.pedido_items ?? []).filter((it) => !esLineaEnvioRapido(it) && it.producto !== 'Envío / delivery')
  if (!base.length) throw new Error('El pedido no tiene productos para pasar a stock.')
  const fecha = fechaNicaragua()
  const registros = base.map((item) => ({
    fecha,
    producto_id: item.producto_id || null,
    codigo: item.codigo_producto || null,
    producto: item.producto,
    marca: item.marca || null,
    talla_color: [item.talla, item.color].filter(Boolean).join(' · ') || null,
    cantidad: Number(item.cantidad || 1),
    costo_unitario: Number(item.precio_compra || 0),
    gastos_adicionales: 0,
    precio_venta_estimado: Number(item.precio_unitario || 0),
    estado: 'en_inventario' as const,
    notas: `Del pedido ${pedido.codigo} · el paquete apareció tras la cancelación`,
    imagen: item.imagen || null,
  }))
  const { error } = await client.from('inversiones').insert(registros)
  if (error) throw error
  invalidateComercial()
  return registros.length
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

// caja: a qué cuenta bancaria afectar. `proveedor` resta de una cuenta el pago al
// proveedor; `abono` suma a una cuenta el abono inicial que pagó el cliente. Opcional.
type CajaPedido = { proveedor?: { cuentaId: string | null; montoCuenta: number }; abono?: { cuentaId: string | null; montoCuenta: number } }
// opts.desdeInversion: convertir un producto de STOCK (una inversión ya comprada) en un
// pedido normal. En ese caso el costo NO se vuelve a pagar (ya salió de caja cuando se
// registró la inversión), así que se omite el gasto/movimiento de proveedor; el costo real
// igual viaja en pedido_item_costos para que la ganancia salga correcta. Al terminar, la
// inversión se marca como vendida para que salga del inventario disponible.
type OpcionesPedido = { desdeInversion?: string | null }
export async function crearPedido(input: NuevoPedidoInput, caja?: CajaPedido, opts?: OpcionesPedido) {
  const client = requireSupabase()
  const { items: itemsBase, ...pedido } = input
  const items = conLineaEnvioRapido(itemsBase, input.envio_rapido)
  const { data: created, error } = await client.from('pedidos').insert(pedido).select('*').single()
  if (error) throw error

  const { data: itemsCreados, error: itemsError } = await client.from('pedido_items').insert(
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
      imagen: item.imagen || null,
    })),
  ).select('id')
  if (itemsError) {
    await client.from('pedidos').delete().eq('id', created.id)
    throw itemsError
  }
  // Los costos por ítem van a la tabla solo-admin (blindaje). Emparejados por índice con
  // `items` (mismo orden que el insert de arriba).
  try {
    await guardarCostosItems(client, (itemsCreados ?? []) as { id: string }[], items)
  } catch (costosError) {
    await client.from('pedidos').delete().eq('id', created.id)
    throw costosError
  }
  const costoProveedor = items.reduce((sum, item) => sum + Number(item.precio_compra || 0) * Number(item.cantidad || 1), 0)
  // Stock convertido en pedido: el costo ya se pagó al traerlo, no se vuelve a descontar.
  if (costoProveedor > 0 && !opts?.desdeInversion) {
    const proveedores = [...new Set(items.map((item) => item.proveedor_id).filter(Boolean))]
    const { data: expense, error: expenseError } = await client.from('gastos').insert({ fecha: input.fecha_pedido, categoria: 'Proveedor', monto: costoProveedor, metodo_pago: input.metodo_pago || null, pedido_id: created.id, proveedor_id: proveedores.length === 1 ? proveedores[0] : null, descripcion: `Pago a proveedor · ${created.codigo}`, observaciones: 'Generado automáticamente al registrar el pedido' }).select('id').single()
    if (expenseError) { await client.from('pedidos').delete().eq('id', created.id); throw expenseError }
    const cuentaProv = caja?.proveedor?.cuentaId || null
    // El pago al proveedor SALE de la cuenta: delta negativo (guardado para revertirlo si se borra).
    const deltaProv = cuentaProv ? -Math.abs(Number(caja?.proveedor?.montoCuenta ?? costoProveedor)) : null
    const { error: movementError } = await client.from('movimientos_cuenta').insert({ fecha: `${input.fecha_pedido}T12:00:00`, tipo: 'pago_proveedor', descripcion: `Pago a proveedor · ${created.codigo}`, monto: costoProveedor, metodo: input.metodo_pago || null, pedido_id: created.id, gasto_id: expense.id, cuenta_id: cuentaProv, monto_cuenta: deltaProv })
    if (movementError) { await client.from('gastos').delete().eq('id', expense.id); await client.from('pedidos').delete().eq('id', created.id); throw movementError }
    if (deltaProv) await ajustarSaldoCuenta(cuentaProv!, deltaProv)
  }
  if (input.abono > 0) {
    const cuentaAbono = caja?.abono?.cuentaId || null
    const { data: payment, error: paymentError } = await client.from('pagos').insert({ pedido_id: created.id, cliente_id: input.cliente_id, fecha: input.fecha_pedido, tipo: 'abono_inicial', monto: input.abono, metodo_pago: input.metodo_pago || null, observaciones: 'Abono inicial registrado con la venta' }).select('id').single()
    if (paymentError) { await client.from('pedidos').delete().eq('id', created.id); throw paymentError }
    // El abono inicial SUMA a la cuenta: delta positivo (guardado para revertirlo si se borra).
    const deltaAbono = cuentaAbono ? Math.abs(Number(caja?.abono?.montoCuenta ?? input.abono)) : null
    await client.from('movimientos_cuenta').insert({ fecha: `${input.fecha_pedido}T12:00:00`, tipo: 'ingreso', descripcion: `Abono inicial ${created.codigo}`, monto: input.abono, metodo: input.metodo_pago || null, pedido_id: created.id, pago_id: payment.id, cuenta_id: cuentaAbono, monto_cuenta: deltaAbono })
    if (deltaAbono) await ajustarSaldoCuenta(cuentaAbono!, deltaAbono)
  }
  // Aprende el costo del producto si el pedido es de un solo producto y ese producto
  // aún no tiene costo en el catálogo (mismo criterio que al ajustar el costo real).
  const productosCreados = itemsProducto(items)
  const distintosCrear = new Set(productosCreados.map((it) => it.producto_id || (it.codigo_producto ?? '').trim().toUpperCase()))
  if (productosCreados.length && distintosCrear.size === 1) {
    await aprenderCostoProducto(client, productosCreados[0], Number(productosCreados[0].precio_compra || 0))
  }

  // Si viene de un producto de stock, la inversión sale del inventario (queda vendida).
  // No es crítico para el pedido: si fallara, el pedido igual quedó creado.
  if (opts?.desdeInversion) {
    const { error: invError } = await client.from('inversiones').update({ estado: 'vendido' }).eq('id', opts.desdeInversion)
    if (invError) console.error('No se pudo marcar la inversión como vendida:', invError)
  }

  invalidateComercial()
  return created as Pedido
}

export async function actualizarPedidoCompleto(id: string, input: EditarPedidoInput) {
  const client = requireSupabase()
  const { data: anteriores, error: anterioresError } = await client.from('pedido_items').select('*').eq('pedido_id', id)
  if (anterioresError) throw anterioresError

  const itemsConEnvio = conLineaEnvioRapido(input.items, input.envio_rapido)
  const nuevos = itemsConEnvio.map((item) => ({
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
    imagen: item.imagen || null,
  }))

  // Borrar los ítems viejos arrastra sus costos por la FK on delete cascade.
  const { error: deleteError } = await client.from('pedido_items').delete().eq('pedido_id', id)
  if (deleteError) throw deleteError

  const { data: itemsCreados, error: insertError } = await client.from('pedido_items').insert(nuevos).select('id')
  if (insertError) {
    const respaldo = (anteriores ?? []).map(({ id: _id, subtotal: _subtotal, created_at: _createdAt, updated_at: _updatedAt, ...item }) => item)
    if (respaldo.length) await client.from('pedido_items').insert(respaldo)
    throw insertError
  }
  // Reescribir los costos por ítem en la tabla solo-admin (mismo orden que `nuevos`).
  await guardarCostosItems(client, (itemsCreados ?? []) as { id: string }[], itemsConEnvio)

  const { error: pedidoError } = await client.from('pedidos').update({
    fecha_estimada: input.fecha_estimada,
    abono: input.abono,
    notas_internas: input.notas_internas,
    notas_publicas: input.notas_publicas,
    ...(input.envio_rapido != null ? { envio_rapido: input.envio_rapido } : {}),
  }).eq('id', id)
  if (pedidoError) throw pedidoError

  if (input.costo_proveedor != null) await ajustarCostoProveedor(client, id, Number(input.costo_proveedor))
  // Baja/sube la tarjeta de la cuenta por la diferencia de costo (si se eligió una).
  if (input.cuentaAjuste?.cuentaId && Number(input.cuentaAjuste.ajuste)) await ajustarSaldoCuenta(input.cuentaAjuste.cuentaId, Number(input.cuentaAjuste.ajuste))

  invalidateComercial()
  return obtenerPedido(id)
}

// Deja el costo real del pedido en el monto indicado, actualizando (o creando) el gasto
// "Proveedor" y el movimiento de caja asociado para que la ganancia y la caja cuadren.
async function ajustarCostoProveedor(client: NonNullable<typeof supabase>, pedidoId: string, monto: number) {
  const nuevoCosto = Math.max(0, monto)

  // Si el pedido tiene UN SOLO producto y ese producto aún no tiene costo en el
  // catálogo, le aprendemos el costo pagado al proveedor (costo unitario = monto /
  // cantidad). Solo con un producto para no repartir mal en pedidos de varios.
  if (nuevoCosto > 0) {
    const { data: itemsPedido } = await client.from('pedido_items').select('producto_id, codigo_producto, cantidad, notas').eq('pedido_id', pedidoId)
    const productos = itemsProducto(itemsPedido ?? [])
    const distintos = new Set(productos.map((it) => it.producto_id || (it.codigo_producto ?? '').trim().toUpperCase()))
    if (productos.length && distintos.size === 1) {
      const cantidad = productos.reduce((sum, it) => sum + Number(it.cantidad || 1), 0) || 1
      await aprenderCostoProducto(client, productos[0], nuevoCosto / cantidad)
    }
  }

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
