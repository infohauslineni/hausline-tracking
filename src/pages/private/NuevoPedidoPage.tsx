import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft, CircleDollarSign, PackagePlus, Plus, Save, Trash2, UserPlus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { z } from 'zod'
import { FacturaModal } from '../../components/pedidos/FacturaModal'
import { ESTADOS_PEDIDO } from '../../constants/orders'
import { DEMO_CLIENTES } from '../../data/demo'
import { isSupabaseConfigured } from '../../lib/supabase'
import { guardarCliente, listarClientes } from '../../services/clientes.service'
import { autoSincronizarCatalogo, listarProductos } from '../../services/comercial.service'
import { type FacturaData } from '../../services/factura.service'
import { crearPedido } from '../../services/pedidos.service'
import type { Cliente, EstadoPedido, Producto } from '../../types/domain'

const itemSchema = z.object({ producto: z.string(), producto_id: z.string(), proveedor_id: z.string(), codigo_producto: z.string().trim().min(1, 'Indica el código del producto.'), marca: z.string(), categoria: z.string(), talla: z.string(), color: z.string(), cantidad: z.number().int().min(1), precio_unitario: z.number().min(0, 'Precio inválido.'), precio_compra: z.number().min(0), envio_internacional: z.number().min(0), costo_delivery: z.number().min(0), otros_gastos: z.number().min(0), notas: z.string() })
const schema = z.object({ cliente_id: z.string().uuid('Selecciona un cliente.'), estado: z.enum(['pedido_confirmado','en_preparacion','control_calidad','etiqueta_creada','despachado','transito_internacional','recibido_estados_unidos','transito_nicaragua','llego_nicaragua','disponible_entrega','entregado','cancelado','incidencia']), fecha_pedido: z.string().min(1), fecha_estimada: z.string(), abono: z.number().min(0), metodo_pago: z.string(), notas_internas: z.string(), notas_publicas: z.string(), envio_rapido: z.boolean(), items: z.array(itemSchema).min(1) })
type FormValues = z.infer<typeof schema>
const blankItem = { producto: '', producto_id: '', proveedor_id: '', codigo_producto: '', marca: '', categoria: '', talla: '', color: '', cantidad: 1, precio_unitario: 0, precio_compra: 0, envio_internacional: 0, costo_delivery: 0, otros_gastos: 0, notas: '' }

export function NuevoPedidoPage() {
  const navigate = useNavigate()
  const [clientes, setClientes] = useState<Cliente[]>(isSupabaseConfigured ? [] : DEMO_CLIENTES)
  const [productos, setProductos] = useState<Producto[]>([])
  const [quickOpen, setQuickOpen] = useState(false)
  const [quick, setQuick] = useState({ nombre: '', whatsapp: '', correo: '' })
  const [factura, setFactura] = useState<FacturaData | null>(null)
  const { register, control, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { cliente_id: '', estado: 'pedido_confirmado', fecha_pedido: new Date().toISOString().slice(0, 10), fecha_estimada: '', abono: 0, metodo_pago: 'Transferencia', notas_internas: '', notas_publicas: '', envio_rapido: false, items: [blankItem] } })
  const { fields, append, remove } = useFieldArray({ control, name: 'items' })
  const items = useWatch({ control, name: 'items' })
  const abono = useWatch({ control, name: 'abono' }) || 0
  const total = useMemo(() => (items ?? []).reduce((sum, item) => sum + (Number(item.cantidad) || 0) * (Number(item.precio_unitario) || 0), 0), [items])
  const costo = useMemo(() => (items ?? []).reduce((sum, item) => sum + (Number(item.precio_compra) || 0), 0), [items])

  useEffect(() => { if (isSupabaseConfigured) void Promise.all([listarClientes(setClientes), listarProductos((products) => setProductos(products.filter((p) => p.activo)))]).then(([clients, products]) => { setClientes(clients); setProductos(products.filter((p) => p.activo)) }).catch(() => toast.error('No se pudieron cargar clientes y productos.')) }, [])
  // En segundo plano sincroniza el catálogo web (máx. 1 vez cada 15 min) para que los
  // precios/fotos del selector estén frescos al crear el pedido; recarga si sincronizó.
  useEffect(() => { if (isSupabaseConfigured) void autoSincronizarCatalogo().then((did) => { if (did) void listarProductos((products) => setProductos(products.filter((p) => p.activo))) }) }, [])

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
      const input = { nombre: quick.nombre.trim(), whatsapp: quick.whatsapp.trim(), correo: quick.correo.trim() || null, departamento: null, ciudad: null, direccion: null, referencia: null, notas: null }
      const created = isSupabaseConfigured ? await guardarCliente(input) : { ...input, id: crypto.randomUUID(), created_at: new Date().toISOString() }
      setClientes((current) => [created, ...current]); setValue('cliente_id', created.id, { shouldValidate: true }); setQuickOpen(false); setQuick({ nombre: '', whatsapp: '', correo: '' }); toast.success('Cliente creado y seleccionado.')
    } catch { toast.error('No se pudo crear el cliente.') }
  }

  const submit = async (values: FormValues) => {
    try {
      const normalizedItems = values.items.map((item) => ({ ...item, producto: item.producto || item.codigo_producto, cantidad: 1, color: '', envio_internacional: 0, costo_delivery: 0, otros_gastos: 0, notas: '', imagen: productos.find((product) => product.id === item.producto_id)?.imagen ?? null }))
      if (!isSupabaseConfigured) { toast.success('Pedido validado en la vista previa.'); navigate('/pedidos'); return }
      const created = await crearPedido({ cliente_id: values.cliente_id, estado: values.estado as EstadoPedido, fecha_pedido: values.fecha_pedido, fecha_estimada: values.fecha_estimada || null, abono: values.abono, metodo_pago: values.metodo_pago || null, notas_internas: values.notas_internas || null, notas_publicas: values.notas_publicas || null, envio_rapido: values.envio_rapido, items: normalizedItems })
      toast.success('Pedido creado correctamente.')
      const cliente = clientes.find((client) => client.id === values.cliente_id)
      const ventaTotal = normalizedItems.reduce((sum, item) => sum + Number(item.precio_unitario || 0), 0)
      setFactura({
        codigo: created.codigo,
        cliente: cliente?.nombre ?? 'Cliente',
        whatsapp: cliente?.whatsapp ?? null,
        fecha: values.fecha_pedido,
        items: normalizedItems.map((item) => ({ producto: item.producto, detalle: [item.marca, item.talla].filter(Boolean).join(' · ') || undefined, cantidad: 1, precio: Number(item.precio_unitario || 0) })),
        total: ventaTotal,
        abono: Number(values.abono || 0),
        saldo: ventaTotal - Number(values.abono || 0),
      })
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo crear el pedido.') }
  }

  return <div className="mx-auto max-w-5xl">
    <Link to="/pedidos" className="mb-5 inline-flex items-center gap-2 text-xs text-muted transition hover:text-white"><ArrowLeft size={16} /> Volver a pedidos</Link>
    {!isSupabaseConfigured && <div className="preview-banner"><strong>Vista previa local:</strong> el formulario valida y calcula, pero no persiste hasta conectar Supabase.</div>}
    <div><p className="eyebrow">Nuevo registro</p><h1 className="page-title">Registrar venta y pedido</h1><p className="page-subtitle">Guarda la venta una sola vez; el código público HS se genera automáticamente.</p></div>
    <form onSubmit={handleSubmit(submit)} className="mt-7 space-y-5">
      <section className="form-section"><SectionTitle number="01" title="Cliente y estado" /><div className="form-grid mt-5"><label className="form-field sm:col-span-2"><span>Cliente</span><div className="flex gap-2"><select className="min-w-0 flex-1" {...register('cliente_id')}><option value="">Selecciona un cliente</option>{clientes.map((client) => <option key={client.id} value={client.id}>{client.nombre} · {client.whatsapp}</option>)}</select><button type="button" className="subtle-button shrink-0 px-3" onClick={() => setQuickOpen((value) => !value)}><UserPlus size={17} /><span className="hidden sm:inline">Nuevo</span></button></div>{errors.cliente_id && <small>{errors.cliente_id.message}</small>}</label>
        {quickOpen && <div className="col-span-full grid gap-3 rounded-xl border border-accent/15 bg-accent/[0.035] p-3 sm:grid-cols-[1fr_1fr_1fr_auto]"><input className="simple-input" placeholder="Nombre completo" value={quick.nombre} onChange={(e) => setQuick({ ...quick, nombre: e.target.value })} /><input className="simple-input" placeholder="WhatsApp" value={quick.whatsapp} onChange={(e) => setQuick({ ...quick, whatsapp: e.target.value })} /><input className="simple-input" type="email" inputMode="email" autoComplete="email" placeholder="Correo (para la factura)" value={quick.correo} onChange={(e) => setQuick({ ...quick, correo: e.target.value })} /><button type="button" className="primary-button px-4" onClick={() => void createQuickClient()}>Crear</button></div>}
        <Field label="Estado"><select {...register('estado')}>{ESTADOS_PEDIDO.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field><Field label="Fecha de venta"><input type="date" {...register('fecha_pedido')} /></Field><Field label="Llegada estimada"><input type="date" {...register('fecha_estimada')} /></Field><Field label="Abono inicial"><input type="number" min="0" step="0.01" {...register('abono', { valueAsNumber: true })} /></Field><Field label="Método de pago"><input {...register('metodo_pago')} placeholder="Transferencia" /></Field>
        <label className="col-span-full flex cursor-pointer items-center gap-3 rounded-xl border border-line bg-white/[0.02] p-3 transition hover:border-accent/40"><input type="checkbox" className="size-4 shrink-0 accent-accent" {...register('envio_rapido')} /><span className="flex flex-col"><span className="text-sm font-medium">El cliente quiere envío rápido</span><span className="text-[11px] text-muted">Llega en 14 a 17 días en vez de 20 a 25 (en la tienda cuesta $15 extra). Solo para tenerlo presente en el pedido.</span></span></label></div></section>

      <section className="form-section"><div className="flex items-center justify-between gap-3"><SectionTitle number="02" title="Productos" /><button type="button" className="subtle-button" onClick={() => append(blankItem)}><Plus size={16} /> Agregar producto</button></div><p className="mt-2 text-xs text-muted">Escribe un código, por ejemplo CL0007, y se completan solos el nombre, la marca, el precio de venta y la foto del catálogo. El precio de compra se llena solo si lo tienes guardado en Productos; si no, escríbelo aquí (se guarda solo en este pedido). El envío internacional, delivery y otros costos se agregan después desde Gastos.</p><div className="mt-5 space-y-4">{fields.map((field, index) => { const watched = items?.[index]; const matched = watched?.producto_id ? productos.find((p) => p.id === watched.producto_id) : undefined; const codigoEscrito = (watched?.codigo_producto ?? '').trim(); return <article key={field.id} className="rounded-xl border border-line bg-black/10 p-4"><div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-2"><PackagePlus size={17} className="text-accent" /><strong className="text-sm">Producto {index + 1}</strong></div>{fields.length > 1 && <button type="button" className="table-action hover:text-red-300" onClick={() => remove(index)}><Trash2 size={17} /></button>}</div><div className="form-grid"><input type="hidden" {...register(`items.${index}.producto`)} /><input type="hidden" {...register(`items.${index}.producto_id`)} /><input type="hidden" {...register(`items.${index}.proveedor_id`)} /><Field label="Código de producto" error={errors.items?.[index]?.codigo_producto?.message}><input list={`productos-pedido-${index}`} autoComplete="off" {...register(`items.${index}.codigo_producto`)} onChange={(e) => { const code = e.target.value; setValue(`items.${index}.codigo_producto`, code, { shouldDirty: true }); const product = productos.find((item) => item.codigo.toLowerCase() === code.trim().toLowerCase()); if (product) selectProduct(index, product.id) }} onBlur={(e) => completeFromCode(index, e.target.value)} /><datalist id={`productos-pedido-${index}`}>{productos.map((product) => <option key={product.id} value={product.codigo}>{product.nombre}{product.marca ? ` · ${product.marca}` : ''}</option>)}</datalist></Field><Field label="Marca"><input {...register(`items.${index}.marca`)} /></Field><Field label="Categoría"><input {...register(`items.${index}.categoria`)} /></Field><Field label="Talla"><input {...register(`items.${index}.talla`)} /></Field><Field label="Precio de compra"><input type="number" min="0" step="0.01" {...register(`items.${index}.precio_compra`, { valueAsNumber: true })} /></Field><Field label="Precio de venta"><input type="number" min="0" step="0.01" {...register(`items.${index}.precio_unitario`, { valueAsNumber: true })} /></Field></div>{matched ? <div className="mt-4 flex items-center gap-3 rounded-xl border border-accent/25 bg-accent/[0.04] p-3">{matched.imagen ? <img src={matched.imagen} alt={matched.nombre} className="size-14 shrink-0 rounded-lg object-cover" /> : <span className="grid size-14 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-muted"><PackagePlus size={20} /></span>}<div className="min-w-0 flex-1"><strong className="block truncate text-sm">{matched.nombre}</strong><span className="block truncate text-[11px] text-muted">{[matched.marca, matched.categoria].filter(Boolean).join(' · ') || 'Sin marca ni categoría en el catálogo'}</span><span className="mt-1 block text-[11px] text-accent">{matched.imagen ? '✓ La foto del catálogo se adjuntará automáticamente al pedido' : 'Este código no tiene foto en el catálogo'}</span></div></div> : codigoEscrito.length > 0 ? <div className="mt-4 rounded-xl border border-amber-400/25 bg-amber-400/[0.05] p-3 text-[11px] leading-5 text-amber-200/90">No encontramos <strong>{codigoEscrito}</strong> en el catálogo. Escribe los datos a mano, o abre <strong>Productos → Sincronizar catálogo</strong> y vuelve a intentar.</div> : null}</article> })}</div></section>

      <section className="form-section"><SectionTitle number="03" title="Resumen de venta" /><div className="form-grid mt-5"><Field label="Notas internas"><textarea rows={4} {...register('notas_internas')} /></Field><Field label="Notas visibles para el cliente"><textarea rows={4} {...register('notas_publicas')} /></Field></div><div className="mt-5 grid gap-3 rounded-xl border border-line bg-white/[0.025] p-4 sm:grid-cols-5"><Money label="Venta" value={total} /><Money label="Costo" value={costo} /><Money label="Ganancia" value={total - costo} accent /><Money label="Abono" value={abono} /><Money label="Saldo" value={total - abono} /></div></section>
      <div className="sticky bottom-3 z-10 flex items-center justify-between gap-3 rounded-2xl border border-line bg-[#121512]/95 p-3 shadow-2xl backdrop-blur-xl"><div className="hidden items-center gap-2 text-xs text-muted sm:flex"><CircleDollarSign size={17} className="text-accent" /> Total: <strong className="text-white">${total.toFixed(2)}</strong></div><button type="button" className="subtle-button px-5" onClick={() => navigate('/pedidos')}>Cancelar</button><button disabled={isSubmitting} className="primary-button flex-1 px-6 sm:flex-none"><Save size={17} /> {isSubmitting ? 'Guardando…' : 'Guardar pedido'}</button></div>
    </form>
    <FacturaModal factura={factura} onClose={() => { setFactura(null); navigate('/pedidos') }} />
  </div>
}

function SectionTitle({ number, title }: { number: string; title: string }) { return <div className="flex items-center gap-3"><span className="text-xs font-bold text-accent">{number}</span><h2 className="font-semibold">{title}</h2></div> }
function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) { return <label className="form-field"><span>{label}</span>{children}{error && <small>{error}</small>}</label> }
function Money({ label, value, accent }: { label: string; value: number; accent?: boolean }) { return <div><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</span><strong className={`mt-1 block text-xl ${accent ? value > 0 ? 'text-amber-300' : 'text-accent' : ''}`}>${Number.isFinite(value) ? value.toFixed(2) : '0.00'}</strong></div> }
