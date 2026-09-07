import { zodResolver } from '@hookform/resolvers/zod'
import { resolverImagenCatalogo } from '../../utils/catalogoImagen'
import { ArrowLeft, CircleDollarSign, PackagePlus, Plus, Save, Ticket, Trash2, UserPlus, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { z } from 'zod'
import { CuentaSelect, type DestinoPago } from '../../components/finanzas/CuentaSelect'
import { IngresoEnCuenta, INGRESO_VACIO, type Ingreso } from '../../components/finanzas/IngresoEnCuenta'
import { FacturaModal } from '../../components/pedidos/FacturaModal'
import { ESTADOS_PEDIDO } from '../../constants/orders'
import { DEPARTAMENTOS_NI } from '../../constants/nicaragua'
import { DEMO_CLIENTES } from '../../data/demo'
import { isSupabaseConfigured } from '../../lib/supabase'
import { guardarCliente, listarClientes } from '../../services/clientes.service'
import { autoSincronizarCatalogo, listarProductos, obtenerTipoCambio } from '../../services/comercial.service'
import { cuponActivoDeCliente, registrarUsoCupon, validarCupon } from '../../services/cupones.service'
import { type FacturaData } from '../../services/factura.service'
import { crearPedido, ENVIO_RAPIDO_RECARGO } from '../../services/pedidos.service'
import type { Cliente, Cupon, EstadoPedido, Producto } from '../../types/domain'

// Descuento aplicado al pedido: un cupón validado, la sugerencia del cliente, o uno manual.
type CuponAplicado = { id?: string; codigo: string; tipo: 'porcentaje' | 'monto'; valor: number }

// Precarga al "Apartar / Convertir en pedido" un producto de stock (viene por el estado de
// navegación desde Inventario). El costo ya se pagó al traerlo, así que no se cobra otra vez.
type PrefillStock = {
  inversionId: string
  producto: string
  marca: string
  codigo_producto: string
  talla_color: string
  precio_unitario: number
  precio_compra: number
  imagen: string | null
}

const itemSchema = z.object({ producto: z.string(), producto_id: z.string(), proveedor_id: z.string(), codigo_producto: z.string().trim().min(1, 'Indica el código del producto.'), marca: z.string(), categoria: z.string(), talla: z.string(), color: z.string(), cantidad: z.number().int().min(1), precio_unitario: z.number().min(0, 'Precio inválido.'), precio_compra: z.number().min(0), envio_internacional: z.number().min(0), costo_delivery: z.number().min(0), otros_gastos: z.number().min(0), notas: z.string() })
const schema = z.object({ cliente_id: z.string().uuid('Selecciona un cliente.'), estado: z.enum(['pedido_confirmado','en_preparacion','control_calidad','etiqueta_creada','despachado','transito_internacional','recibido_estados_unidos','transito_nicaragua','llego_nicaragua','disponible_entrega','pagado','empaquetado','entregado','cancelado','incidencia']), fecha_pedido: z.string().min(1), fecha_estimada: z.string(), abono: z.number().min(0), metodo_pago: z.string(), notas_internas: z.string(), notas_publicas: z.string(), envio_rapido: z.boolean(), items: z.array(itemSchema).min(1) })
type FormValues = z.infer<typeof schema>
const blankItem = { producto: '', producto_id: '', proveedor_id: '', codigo_producto: '', marca: '', categoria: '', talla: '', color: '', cantidad: 1, precio_unitario: 0, precio_compra: 0, envio_internacional: 0, costo_delivery: 0, otros_gastos: 0, notas: '' }

export function NuevoPedidoPage() {
  const navigate = useNavigate()
  const location = useLocation()
  // Si venimos de "Apartar" desde Inventario, este objeto trae el producto de stock a convertir.
  const prefill = (location.state as { prefill?: PrefillStock } | null)?.prefill ?? null
  const [clientes, setClientes] = useState<Cliente[]>(isSupabaseConfigured ? [] : DEMO_CLIENTES)
  const [productos, setProductos] = useState<Producto[]>([])
  const [quickOpen, setQuickOpen] = useState(false)
  const [quick, setQuick] = useState({ nombre: '', whatsapp: '', correo: '', departamento: '' })
  const [factura, setFactura] = useState<FacturaData | null>(null)
  const [tipoCambio, setTipoCambio] = useState(37)
  const [cuentaProveedor, setCuentaProveedor] = useState<DestinoPago>({ cuentaId: null, montoCuenta: 0 })
  // Abono inicial: la cuenta manda la moneda (córdobas o dólares). El monto en dólares (para
  // el saldo del pedido) se calcula solo y se refleja en el campo `abono` del formulario.
  const [ingresoAbono, setIngresoAbono] = useState<Ingreso>(INGRESO_VACIO)
  const { register, control, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { cliente_id: '', estado: 'pedido_confirmado', fecha_pedido: new Date().toISOString().slice(0, 10), fecha_estimada: '', abono: 0, metodo_pago: 'Transferencia', notas_internas: '', notas_publicas: '', envio_rapido: false, items: [blankItem] } })
  const { fields, append, remove } = useFieldArray({ control, name: 'items' })
  const items = useWatch({ control, name: 'items' })
  const abono = useWatch({ control, name: 'abono' }) || 0
  const envioRapido = useWatch({ control, name: 'envio_rapido' }) || false
  const totalProductos = useMemo(() => (items ?? []).reduce((sum, item) => sum + (Number(item.cantidad) || 0) * (Number(item.precio_unitario) || 0), 0), [items])
  const recargoEnvio = envioRapido ? ENVIO_RAPIDO_RECARGO : 0
  const total = totalProductos + recargoEnvio
  const costo = useMemo(() => (items ?? []).reduce((sum, item) => sum + (Number(item.precio_compra) || 0), 0), [items])
  const clienteId = useWatch({ control, name: 'cliente_id' })

  // Cupón / descuento aplicado. El descuento se recalcula solo si cambian los productos (para
  // porcentajes). Se aplica sobre el total del pedido (productos + envío) y nunca lo pasa.
  const [cuponAplicado, setCuponAplicado] = useState<CuponAplicado | null>(null)
  const [codigoInput, setCodigoInput] = useState('')
  const [manualInput, setManualInput] = useState(0)
  const [validando, setValidando] = useState(false)
  const [sugerencia, setSugerencia] = useState<Cupon | null>(null)
  const descuento = useMemo(() => {
    if (!cuponAplicado) return 0
    const bruto = cuponAplicado.tipo === 'porcentaje' ? total * cuponAplicado.valor / 100 : cuponAplicado.valor
    return Math.min(Math.round(bruto * 100) / 100, total)
  }, [cuponAplicado, total])
  const totalConDescuento = Math.max(0, Math.round((total - descuento) * 100) / 100)

  // Al elegir cliente, buscamos si tiene un cupón personal activo para ofrecerlo.
  useEffect(() => { setSugerencia(null); if (!isSupabaseConfigured || !clienteId) return; void cuponActivoDeCliente(clienteId).then(setSugerencia).catch(() => undefined) }, [clienteId])

  const aplicarCodigo = async (codigo: string) => {
    if (!codigo.trim()) return
    setValidando(true)
    try {
      const r = await validarCupon(codigo, total)
      if (!r.valido) { toast.error(r.motivo || 'Código no válido.'); return }
      setCuponAplicado({ id: r.id, codigo: r.codigo!, tipo: r.tipo!, valor: Number(r.valor) })
      setCodigoInput('')
      toast.success(`Cupón ${r.codigo} aplicado.`)
    } catch { toast.error('No se pudo validar el cupón.') } finally { setValidando(false) }
  }
  const aplicarManual = (monto: number) => { if (monto > 0) { setCuponAplicado({ codigo: 'Descuento manual', tipo: 'monto', valor: monto }); toast.success('Descuento manual aplicado.') } }

  useEffect(() => { if (isSupabaseConfigured) void Promise.all([listarClientes(setClientes), listarProductos((products) => setProductos(products.filter((p) => p.activo)))]).then(([clients, products]) => { setClientes(clients); setProductos(products.filter((p) => p.activo)) }).catch(() => toast.error('No se pudieron cargar clientes y productos.')) }, [])
  // En segundo plano sincroniza el catálogo web (máx. 1 vez cada 15 min) para que los
  // precios/fotos del selector estén frescos al crear el pedido; recarga si sincronizó.
  useEffect(() => { if (isSupabaseConfigured) void autoSincronizarCatalogo().then((did) => { if (did) void listarProductos((products) => setProductos(products.filter((p) => p.activo))) }) }, [])
  useEffect(() => { if (isSupabaseConfigured) void obtenerTipoCambio().then(setTipoCambio).catch(() => undefined) }, [])
  // El abono del pedido siempre se guarda en dólares (moneda del saldo). Lo mantenemos al día
  // con el equivalente que calcula el bloque de "Abono inicial" según la cuenta elegida.
  useEffect(() => { setValue('abono', ingresoAbono.montoUsd) }, [ingresoAbono.montoUsd, setValue])

  // Apartado desde stock: precarga el producto de la inversión en el primer ítem del pedido.
  // El precio de compra lleva el costo real (para que la ganancia salga bien), pero ese costo
  // NO se vuelve a descontar de caja (ver `desdeInversion` al guardar).
  useEffect(() => {
    if (!prefill) return
    setValue('estado', 'pedido_confirmado')
    setValue('items.0.producto', prefill.producto, { shouldValidate: true })
    setValue('items.0.codigo_producto', prefill.codigo_producto, { shouldValidate: true })
    setValue('items.0.marca', prefill.marca)
    setValue('items.0.talla', prefill.talla_color)
    setValue('items.0.precio_unitario', prefill.precio_unitario)
    setValue('items.0.precio_compra', prefill.precio_compra)
  }, [prefill, setValue])

  const selectProduct = (index: number, productId: string) => {
    const product = productos.find((item) => item.id === productId)
    setValue(`items.${index}.producto_id`, productId)
    if (!product) return
    setValue(`items.${index}.proveedor_id`, product.proveedor_id ?? '')
    setValue(`items.${index}.codigo_producto`, product.codigo)
    setValue(`items.${index}.producto`, product.nombre, { shouldValidate: true })
    setValue(`items.${index}.marca`, product.marca ?? '')
    setValue(`items.${index}.categoria`, product.categoria ?? '')
    setValue(`items.${index}.precio_compra`, Number(product.precio_compra))
    setValue(`items.${index}.precio_unitario`, Number(product.precio_venta))
  }

  const completeFromCode = (index: number, code: string) => {
    const product = productos.find((item) => item.codigo.toLowerCase() === code.trim().toLowerCase())
    if (product) selectProduct(index, product.id)
    else setValue(`items.${index}.producto`, code.trim())
  }

  const createQuickClient = async () => {
    if (quick.nombre.trim().length < 2 || quick.whatsapp.replace(/\D/g, '').length < 7) return toast.error('Completa nombre y WhatsApp.')
    if (quick.correo.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(quick.correo.trim())) return toast.error('El correo no parece válido.')
    try {
      const input = { nombre: quick.nombre.trim(), whatsapp: quick.whatsapp.trim(), correo: quick.correo.trim() || null, departamento: quick.departamento || null, ciudad: null, direccion: null, referencia: null, notas: null }
      const created = isSupabaseConfigured ? await guardarCliente(input) : { ...input, id: crypto.randomUUID(), created_at: new Date().toISOString() }
      setClientes((current) => [created, ...current]); setValue('cliente_id', created.id, { shouldValidate: true }); setQuickOpen(false); setQuick({ nombre: '', whatsapp: '', correo: '', departamento: '' }); toast.success('Cliente creado y seleccionado.')
    } catch { toast.error('No se pudo crear el cliente.') }
  }

  const submit = async (values: FormValues) => {
    try {
      const normalizedItems = values.items.map((item, index) => ({ ...item, producto: item.producto || item.codigo_producto, cantidad: 1, color: (item.color ?? '').trim(), envio_internacional: 0, costo_delivery: 0, otros_gastos: 0, notas: '', imagen: productos.find((product) => product.id === item.producto_id)?.imagen ?? (index === 0 ? prefill?.imagen ?? null : null) }))
      if (!isSupabaseConfigured) { toast.success('Pedido validado en la vista previa.'); navigate('/pedidos'); return }
      if (!prefill && costo > 0 && !cuentaProveedor.cuentaId) return toast.error('Elegí de qué cuenta pagaste al proveedor.')
      if (values.abono > 0 && !ingresoAbono.cuentaId) return toast.error('Elegí a qué cuenta entró el abono.')
      const created = await crearPedido({ cliente_id: values.cliente_id, estado: values.estado as EstadoPedido, fecha_pedido: values.fecha_pedido, fecha_estimada: values.fecha_estimada || null, abono: values.abono, metodo_pago: values.metodo_pago || null, notas_internas: values.notas_internas || null, notas_publicas: values.notas_publicas || null, envio_rapido: values.envio_rapido, descuento, cupon_id: cuponAplicado?.id ?? null, cupon_codigo: cuponAplicado?.codigo ?? null, items: normalizedItems }, {
        proveedor: !prefill && costo > 0 ? cuentaProveedor : undefined,
        abono: values.abono > 0 ? { cuentaId: ingresoAbono.cuentaId, montoCuenta: ingresoAbono.montoCuenta } : undefined,
      }, prefill ? { desdeInversion: prefill.inversionId } : undefined)
      // El cupón solo se "quema" si el cliente pagó (hubo abono). Si no transfirió, sigue vivo.
      if (cuponAplicado?.id && values.abono > 0) { try { await registrarUsoCupon(cuponAplicado.id) } catch { /* no crítico */ } }
      toast.success('Pedido creado correctamente.')
      const cliente = clientes.find((client) => client.id === values.cliente_id)
      const facturaItems = normalizedItems.map((item) => ({ producto: item.producto, detalle: [item.marca, item.talla, item.color].filter(Boolean).join(' · ') || undefined, cantidad: 1, precio: Number(item.precio_unitario || 0), codigo: item.codigo_producto || undefined, imagen: item.imagen ?? null }))
      // El envío rápido va como una línea más de la factura (mismo criterio que el pedido).
      if (values.envio_rapido) facturaItems.push({ producto: 'Envío rápido (14–17 días)', detalle: undefined, cantidad: 1, precio: ENVIO_RAPIDO_RECARGO, codigo: undefined, imagen: null })
      const ventaBruta = facturaItems.reduce((sum, item) => sum + item.cantidad * item.precio, 0)
      if (descuento > 0) facturaItems.push({ producto: `Descuento${cuponAplicado?.codigo ? ` (${cuponAplicado.codigo})` : ''}`, detalle: undefined, cantidad: 1, precio: -descuento, codigo: undefined, imagen: null })
      const ventaTotal = Math.max(0, ventaBruta - descuento)
      setFactura({
        codigo: created.codigo,
        cliente: cliente?.nombre ?? 'Cliente',
        whatsapp: cliente?.whatsapp ?? null,
        fecha: values.fecha_pedido,
        items: facturaItems,
        total: ventaTotal,
        abono: Number(values.abono || 0),
        saldo: ventaTotal - Number(values.abono || 0),
      })
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo crear el pedido.') }
  }

  return <div className="mx-auto max-w-5xl">
    <Link to="/pedidos" className="mb-5 inline-flex items-center gap-2 text-xs text-muted transition hover:text-white"><ArrowLeft size={16} /> Volver a pedidos</Link>
    {!isSupabaseConfigured && <div className="preview-banner"><strong>Vista previa local:</strong> el formulario valida y calcula, pero no persiste hasta conectar Supabase.</div>}
    {prefill && <div className="mb-4 rounded-xl border border-accent/30 bg-accent/[.06] p-3 text-[12px] leading-5 text-accent"><strong>Apartado de stock:</strong> estás convirtiendo <strong>{prefill.producto}</strong> en un pedido. Elegí el cliente y el abono (ej. el 50%). El costo ya se pagó al traerlo, así que no se descuenta otra vez; al guardar, el producto sale del inventario.</div>}
    <div><p className="eyebrow">Nuevo registro</p><h1 className="page-title">Registrar venta y pedido</h1><p className="page-subtitle">Guarda la venta una sola vez; el código público HS se genera automáticamente.</p></div>
    <form onSubmit={handleSubmit(submit)} className="mt-7 space-y-5">
      <section className="form-section"><SectionTitle number="01" title="Cliente y estado" /><div className="form-grid mt-5"><label className="form-field sm:col-span-2"><span>Cliente</span><div className="flex gap-2"><select className="min-w-0 flex-1" {...register('cliente_id')}><option value="">Selecciona un cliente</option>{clientes.map((client) => <option key={client.id} value={client.id}>{client.nombre} · {client.whatsapp}</option>)}</select><button type="button" className="subtle-button shrink-0 px-3" onClick={() => setQuickOpen((value) => !value)}><UserPlus size={17} /><span className="hidden sm:inline">Nuevo</span></button></div>{errors.cliente_id && <small>{errors.cliente_id.message}</small>}</label>
        {quickOpen && <div className="col-span-full grid gap-3 rounded-xl border border-accent/15 bg-accent/[0.035] p-3 sm:grid-cols-2"><input className="simple-input" placeholder="Nombre completo" value={quick.nombre} onChange={(e) => setQuick({ ...quick, nombre: e.target.value })} /><input className="simple-input" placeholder="WhatsApp" value={quick.whatsapp} onChange={(e) => setQuick({ ...quick, whatsapp: e.target.value })} /><input className="simple-input" type="email" inputMode="email" autoComplete="email" placeholder="Correo (para la factura)" value={quick.correo} onChange={(e) => setQuick({ ...quick, correo: e.target.value })} /><select className="simple-input" value={quick.departamento} onChange={(e) => setQuick({ ...quick, departamento: e.target.value })}><option value="">Departamento (define el envío)…</option>{DEPARTAMENTOS_NI.map((depto) => <option key={depto} value={depto}>{depto}</option>)}</select><button type="button" className="primary-button col-span-full px-4 sm:col-auto" onClick={() => void createQuickClient()}>Crear cliente</button></div>}
        <Field label="Estado"><select {...register('estado')}>{ESTADOS_PEDIDO.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field><Field label="Fecha de venta"><input type="date" {...register('fecha_pedido')} /></Field><Field label="Llegada estimada"><input type="date" {...register('fecha_estimada')} /></Field><Field label="Método de pago"><input {...register('metodo_pago')} placeholder="Transferencia" /></Field>
        <label className="col-span-full flex cursor-pointer items-center gap-3 rounded-xl border border-line bg-white/[0.02] p-3 transition hover:border-accent/40"><input type="checkbox" className="size-4 shrink-0 accent-accent" {...register('envio_rapido')} /><span className="flex flex-col"><span className="text-sm font-medium">El cliente quiere envío rápido</span><span className="text-[11px] text-muted">Llega en 14 a 17 días en vez de 20 a 25. Suma US$15 al total del pedido (una sola vez) y aparece como línea en la factura.</span></span></label></div></section>

      <section className="form-section"><div className="flex items-center justify-between gap-3"><SectionTitle number="02" title="Productos" /><button type="button" className="subtle-button" onClick={() => append(blankItem)}><Plus size={16} /> Agregar producto</button></div><p className="mt-2 text-xs text-muted">Escribe un código, por ejemplo CL0007, y se completan solos el nombre, la marca, el precio de venta y la foto del catálogo. El precio de compra se llena solo si lo tienes guardado en Productos; si no, escríbelo aquí (se guarda solo en este pedido). El envío internacional, delivery y otros costos se agregan después desde Gastos.</p><div className="mt-5 space-y-4">{fields.map((field, index) => { const watched = items?.[index]; const matched = watched?.producto_id ? productos.find((p) => p.id === watched.producto_id) : undefined; const codigoEscrito = (watched?.codigo_producto ?? '').trim(); return <article key={field.id} className="rounded-xl border border-line bg-black/10 p-4"><div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-2"><PackagePlus size={17} className="text-accent" /><strong className="text-sm">Producto {index + 1}</strong></div>{fields.length > 1 && <button type="button" className="table-action hover:text-red-300" onClick={() => remove(index)}><Trash2 size={17} /></button>}</div><div className="form-grid"><input type="hidden" {...register(`items.${index}.producto`)} /><input type="hidden" {...register(`items.${index}.producto_id`)} /><input type="hidden" {...register(`items.${index}.proveedor_id`)} /><Field label="Código de producto" error={errors.items?.[index]?.codigo_producto?.message}><input list={`productos-pedido-${index}`} autoComplete="off" {...register(`items.${index}.codigo_producto`)} onChange={(e) => { const code = e.target.value; setValue(`items.${index}.codigo_producto`, code, { shouldDirty: true }); const product = productos.find((item) => item.codigo.toLowerCase() === code.trim().toLowerCase()); if (product) selectProduct(index, product.id) }} onBlur={(e) => completeFromCode(index, e.target.value)} /><datalist id={`productos-pedido-${index}`}>{productos.map((product) => <option key={product.id} value={product.codigo}>{product.nombre}{product.marca ? ` · ${product.marca}` : ''}</option>)}</datalist></Field><Field label="Marca"><input {...register(`items.${index}.marca`)} /></Field><Field label="Categoría"><input {...register(`items.${index}.categoria`)} /></Field><Field label="Talla"><input {...register(`items.${index}.talla`)} /></Field><Field label="Color (solo si aplica)"><input placeholder="Ej: Negro" {...register(`items.${index}.color`)} /></Field><Field label="Precio de compra"><input type="number" min="0" step="0.01" {...register(`items.${index}.precio_compra`, { valueAsNumber: true })} /></Field><Field label="Precio de venta"><input type="number" min="0" step="0.01" {...register(`items.${index}.precio_unitario`, { valueAsNumber: true })} /></Field></div>{matched ? <div className="mt-4 flex items-center gap-3 rounded-xl border border-accent/25 bg-accent/[0.04] p-3">{resolverImagenCatalogo(matched.imagen) ? <img src={resolverImagenCatalogo(matched.imagen)} alt={matched.nombre} className="size-14 shrink-0 rounded-lg object-cover" /> : <span className="grid size-14 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-muted"><PackagePlus size={20} /></span>}<div className="min-w-0 flex-1"><strong className="block truncate text-sm">{matched.nombre}</strong><span className="block truncate text-[11px] text-muted">{[matched.marca, matched.categoria].filter(Boolean).join(' · ') || 'Sin marca ni categoría en el catálogo'}</span><span className="mt-1 block text-[11px] text-accent">{matched.imagen ? '✓ La foto del catálogo se adjuntará automáticamente al pedido' : 'Este código no tiene foto en el catálogo'}</span></div></div> : (prefill && index === 0) ? <div className="mt-4 flex items-center gap-3 rounded-xl border border-accent/25 bg-accent/[0.04] p-3">{prefill.imagen ? <img src={prefill.imagen} alt={prefill.producto} className="size-14 shrink-0 rounded-lg object-cover" /> : <span className="grid size-14 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-muted"><PackagePlus size={20} /></span>}<div className="min-w-0 flex-1"><strong className="block truncate text-sm">{prefill.producto}</strong><span className="mt-1 block text-[11px] text-accent">✓ Producto de tu stock · datos cargados desde el inventario. Se guardará tal cual (su foto también).</span></div></div> : codigoEscrito.length > 0 ? <div className="mt-4 rounded-xl border border-amber-400/25 bg-amber-400/[0.05] p-3 text-[11px] leading-5 text-amber-200/90">No encontramos <strong>{codigoEscrito}</strong> en el catálogo. Escribe los datos a mano, o abre <strong>Productos → Sincronizar catálogo</strong> y vuelve a intentar.</div> : null}</article> })}</div></section>

      <section className="form-section"><SectionTitle number="03" title="Resumen de venta" /><div className="form-grid mt-5"><Field label="Notas internas"><textarea rows={4} {...register('notas_internas')} /></Field><Field label="Notas visibles para el cliente"><textarea rows={4} {...register('notas_publicas')} /></Field></div>

        <div className="mt-5 rounded-xl border border-line bg-white/[.02] p-4">
          <div className="flex items-center gap-2 text-sm font-medium"><Ticket size={16} className="text-accent" /> Cupón o descuento</div>
          {sugerencia && (!cuponAplicado || cuponAplicado.id !== sugerencia.id) && <button type="button" onClick={() => setCuponAplicado({ id: sugerencia.id, codigo: sugerencia.codigo, tipo: sugerencia.tipo, valor: Number(sugerencia.valor) })} className="mt-3 flex w-full items-center justify-between gap-2 rounded-lg border border-sky-400/30 bg-sky-400/[.06] px-3 py-2 text-left text-xs">
            <span>💳 Este cliente tiene un cupón: <strong className="text-white">{sugerencia.codigo}</strong> ({sugerencia.tipo === 'porcentaje' ? `${sugerencia.valor}%` : `US$ ${Number(sugerencia.valor).toFixed(2)}`})</span><span className="shrink-0 font-semibold text-sky-300">Aplicar</span></button>}
          {cuponAplicado ? <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-accent/30 bg-accent/[.06] px-3 py-2 text-sm"><span className="flex items-center gap-2"><Ticket size={14} className="text-accent" /> <strong>{cuponAplicado.codigo}</strong> · −${descuento.toFixed(2)}</span><button type="button" onClick={() => setCuponAplicado(null)} className="table-action" aria-label="Quitar descuento"><X size={16} /></button></div>
            : <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <div className="flex flex-1 gap-2"><input className="simple-input flex-1 uppercase" placeholder="Código de descuento" value={codigoInput} onChange={(e) => setCodigoInput(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void aplicarCodigo(codigoInput) } }} /><button type="button" className="subtle-button px-4" disabled={validando} onClick={() => void aplicarCodigo(codigoInput)}>{validando ? '…' : 'Aplicar'}</button></div>
                <div className="flex gap-2"><input className="simple-input w-32" type="number" min="0" step="0.01" placeholder="Manual US$" value={manualInput || ''} onChange={(e) => setManualInput(Number(e.target.value))} /><button type="button" className="subtle-button px-3" onClick={() => aplicarManual(manualInput)}>Descontar</button></div>
              </div>}
        </div>

        <div className="mt-3 grid gap-3 rounded-xl border border-line bg-white/[0.025] p-4 sm:grid-cols-3 lg:grid-cols-6"><Money label="Venta" value={total} /><Money label="Descuento" value={descuento} /><Money label="Costo" value={costo} /><Money label="Ganancia" value={totalConDescuento - costo} accent /><Money label="Abono" value={abono} /><Money label="Saldo" value={totalConDescuento - abono} /></div><div className="mt-3 grid gap-3 rounded-xl border border-line bg-white/[.02] p-4">{costo > 0 && !prefill && <CuentaSelect requerido proposito="comprar" montoUsd={costo} tipoCambio={tipoCambio} value={cuentaProveedor} onChange={setCuentaProveedor} modo="resta" label="¿De qué cuenta pagaste al proveedor?" />}{prefill && <p className="text-[11px] leading-5 text-muted">El costo (US$ {costo.toFixed(2)}) ya salió de caja cuando trajiste el producto para stock; no se descuenta de nuevo.</p>}<IngresoEnCuenta tipoCambio={tipoCambio} value={ingresoAbono} onChange={setIngresoAbono} label="Abono inicial (dejá el monto en 0 si aún no ha pagado)" /></div>{envioRapido && <p className="mt-2 text-[11px] text-muted">La venta incluye US$15 de envío rápido (14–17 días).</p>}</section>
      <div className="sticky bottom-3 z-10 flex items-center justify-between gap-3 rounded-2xl border border-line bg-[#121512]/95 p-3 shadow-2xl backdrop-blur-xl"><div className="hidden items-center gap-2 text-xs text-muted sm:flex"><CircleDollarSign size={17} className="text-accent" /> Total: <strong className="text-white">${totalConDescuento.toFixed(2)}</strong>{descuento > 0 && <span className="text-[10px] text-muted">(−${descuento.toFixed(2)})</span>}</div><button type="button" className="subtle-button px-5" onClick={() => navigate('/pedidos')}>Cancelar</button><button disabled={isSubmitting} className="primary-button flex-1 px-6 sm:flex-none"><Save size={17} /> {isSubmitting ? 'Guardando…' : 'Guardar pedido'}</button></div>
    </form>
    <FacturaModal factura={factura} onClose={() => { setFactura(null); navigate('/pedidos') }} />
  </div>
}

function SectionTitle({ number, title }: { number: string; title: string }) { return <div className="flex items-center gap-3"><span className="text-xs font-bold text-accent">{number}</span><h2 className="font-semibold">{title}</h2></div> }
function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) { return <label className="form-field"><span>{label}</span>{children}{error && <small>{error}</small>}</label> }
function Money({ label, value, accent }: { label: string; value: number; accent?: boolean }) { return <div><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</span><strong className={`mt-1 block text-xl ${accent ? value > 0 ? 'text-amber-300' : 'text-accent' : ''}`}>${Number.isFinite(value) ? value.toFixed(2) : '0.00'}</strong></div> }
