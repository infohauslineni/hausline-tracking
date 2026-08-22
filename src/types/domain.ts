export type Cliente = {
  id: string
  nombre: string
  whatsapp: string
  correo: string | null
  departamento: string | null
  ciudad: string | null
  direccion: string | null
  referencia: string | null
  notas: string | null
  created_at: string
  updated_at?: string
}

export type EstadoPedido =
  | 'pedido_confirmado' | 'en_preparacion' | 'control_calidad' | 'etiqueta_creada' | 'despachado'
  | 'transito_internacional' | 'recibido_estados_unidos' | 'transito_nicaragua'
  | 'llego_nicaragua' | 'disponible_entrega' | 'entregado' | 'cancelado' | 'incidencia'

export type PedidoItem = {
  id?: string
  producto: string
  marca?: string | null
  categoria?: string | null
  talla?: string | null
  color?: string | null
  cantidad: number
  precio_unitario: number
  subtotal?: number
  imagen?: string | null
  notas?: string | null
  producto_id?: string | null
  codigo_producto?: string | null
  proveedor_id?: string | null
  precio_compra?: number
  envio_internacional?: number
  costo_delivery?: number
  otros_gastos?: number
}

export type Pedido = {
  id: string
  codigo: string
  cliente_id: string
  estado: EstadoPedido
  fecha_pedido: string
  fecha_estimada: string | null
  total: number
  abono: number
  saldo: number
  notas_internas?: string | null
  notas_publicas?: string | null
  metodo_pago?: string | null
  moneda?: string
  envio_rapido?: boolean
  activo: boolean
  created_at: string
  updated_at: string
  clientes?: Pick<Cliente, 'nombre' | 'whatsapp'> | null
  pedido_items?: PedidoItem[]
  gastos?: Gasto[]
}

export type Proveedor = { id: string; nombre: string; contacto: string | null; whatsapp: string | null; notas: string | null; activo: boolean; created_at: string }
export type Producto = { id: string; codigo: string; nombre: string; marca: string | null; categoria: string | null; proveedor_id: string | null; tallas: string[]; precio_compra: number; precio_venta: number; imagen: string | null; descripcion: string | null; activo: boolean; created_at: string; proveedores?: Pick<Proveedor, 'nombre'> | null }
export type Moneda = 'USD' | 'NIO'
export type Pago = { id: string; pedido_id: string; cliente_id: string; fecha: string; tipo: 'abono_inicial' | 'abono' | 'pago_final' | 'reembolso'; monto: number; moneda?: Moneda; monto_original?: number | null; tipo_cambio?: number | null; metodo_pago: string | null; referencia: string | null; observaciones: string | null; created_at: string; pedidos?: Pick<Pedido, 'codigo' | 'saldo'> | null; clientes?: Pick<Cliente, 'nombre'> | null }
export type Gasto = { id: string; fecha: string; categoria: string; monto: number; moneda?: Moneda; monto_original?: number | null; tipo_cambio?: number | null; metodo_pago: string | null; pedido_id: string | null; inversion_id: string | null; proveedor_id: string | null; descripcion: string; observaciones: string | null; created_at: string; pedidos?: Pick<Pedido, 'codigo'> | null; inversiones?: Pick<Inversion, 'producto' | 'codigo'> | null; proveedores?: Pick<Proveedor, 'nombre'> | null }
export type MovimientoCuenta = { id: string; fecha: string; tipo: 'ingreso' | 'retiro' | 'pago_proveedor' | 'gasto' | 'inversion' | 'ajuste_entrada' | 'ajuste_salida'; descripcion: string; monto: number; moneda?: Moneda; monto_original?: number | null; tipo_cambio?: number | null; metodo: string | null; pedido_id: string | null; gasto_id?: string | null; pago_id?: string | null; inversion_id?: string | null; observaciones: string | null; created_at: string; pedidos?: Pick<Pedido, 'codigo'> | null }
export type CajaMes = { periodo: string; sugerido: number; apertura: number | null; opening: number; movimientos_mes: number; saldo_mes: number; confirmada: boolean }
export type Inversion = { id: string; fecha: string; producto_id: string | null; codigo: string | null; producto: string; marca: string | null; talla_color: string | null; cantidad: number; costo_unitario: number; gastos_adicionales: number; precio_venta_estimado: number; estado: 'en_inventario' | 'reservado' | 'vendido' | 'descartado'; notas: string | null; imagen?: string | null; tracking?: string | null; transportista?: string | null; url_tracking?: string | null; estado_tracking?: string | null; pedido_id?: string | null; created_at: string; productos?: Pick<Producto, 'nombre' | 'codigo'> | null; gastos?: Pick<Gasto, 'id' | 'monto' | 'categoria'>[] }
export type Deuda = { id: string; acreedor: string; concepto: string; monto_total: number; monto_pagado: number; fecha_deuda: string; fecha_vencimiento: string | null; estado: 'pendiente' | 'pagada' | 'cancelada'; notas: string | null; created_at: string; pagos_deuda?: PagoDeuda[] }
export type PagoDeuda = { id: string; deuda_id: string; fecha: string; monto: number; metodo: string | null; notas: string | null; desde_ganancia: number; desde_negocio: number; created_at: string }
export type ResumenComercial = { ventas: number; cobrado: number; por_cobrar: number; gastos: number; costos_productos: number; saldo_cuenta: number; pedidos: number }
export type ConfiguracionFinanzas = { dia_inicio_mes: number; dia_retiro: number; porcentaje_reserva_negocio: number }
export type GananciaRealizada = { desde: string; hasta: string; pedidos_entregados: number; cobrado: number; costos: number; ganancia_realizada: number; ganancia_asignada: number; ganancia_disponible: number }
export type MetaCompra = { id: string; nombre: string; monto_objetivo: number; monto_reservado: number; fecha_objetivo: string | null; estado: 'activa' | 'completada' | 'cancelada'; notas: string | null; created_at: string }
export type EstadoContenido = 'pendiente_grabacion' | 'grabado'
export type IdeaContenido = {
  id: string
  titulo: string
  pedido_id: string | null
  formato: 'reel' | 'historia' | 'foto' | 'tiktok' | 'otro'
  descripcion: string
  estado: EstadoContenido
  fecha_grabacion: string | null
  notas: string | null
  created_at: string
  updated_at: string
}

export type EstadoTrayecto = 'pendiente' | 'etiqueta_creada' | 'en_transito' | 'aduana' | 'entrega_fallida' | 'entregado' | 'cancelado' | 'incidencia'

export type Transportista = {
  id: string
  nombre: string
  codigo: string | null
  logo?: string | null
  url_tracking: string | null
  tipo_integracion: 'manual' | 'aftership' | 'ship24' | 'track17'
  activo: boolean
}

export type TrackingEvento = {
  id: string
  trayecto_id: string
  estado_normalizado: EstadoTrayecto | null
  descripcion_original: string | null
  descripcion_publica: string | null
  ubicacion: string | null
  fecha_evento: string
  visible_cliente: boolean
  fuente: string
}

export type Trayecto = {
  id: string
  pedido_id: string
  transportista_id: string | null
  tipo_trayecto: string
  pais_origen: string | null
  pais_destino: string | null
  tracking: string | null
  url_tracking: string | null
  estado: EstadoTrayecto
  ultima_ubicacion: string | null
  ultimo_evento: string | null
  fecha_envio: string | null
  fecha_estimada: string | null
  fecha_entrega: string | null
  peso: number | null
  costo_envio: number | null
  numero_paquete: string | null
  notas_internas: string | null
  visible_cliente: boolean
  orden: number
  activo: boolean
  created_at: string
  updated_at: string
  pedidos?: Pick<Pedido, 'codigo' | 'estado'> & { clientes?: Pick<Cliente, 'nombre'> | null }
  transportistas?: Transportista | null
  tracking_eventos?: TrackingEvento[]
}

export type TipoArchivo = 'producto' | 'control_calidad' | 'comprobante' | 'entrega' | 'recepcion_miami' | 'recibido_local'
export type ArchivoPedido = {
  id: string
  pedido_id: string
  tipo: TipoArchivo
  storage_path: string
  nombre: string
  mime_type: 'image/jpeg' | 'image/png' | 'image/webp'
  tamano_bytes: number
  orden: number
  es_principal: boolean
  visible_cliente: boolean
  created_at: string
  signed_url?: string
}

export type PrioridadAlerta = 'baja' | 'media' | 'alta' | 'critica'
export type Alerta = {
  id: string
  pedido_id: string
  trayecto_id: string | null
  tipo: string
  titulo: string
  descripcion: string | null
  prioridad: PrioridadAlerta
  resuelta: boolean
  fecha_resuelta: string | null
  created_at: string
  updated_at: string
  pedidos?: Pick<Pedido, 'id' | 'codigo' | 'estado' | 'fecha_estimada' | 'updated_at'> & { clientes?: Pick<Cliente, 'nombre'> | null }
}
