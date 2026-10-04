import { Check, Copy, ExternalLink, MessageCircle, Package, Search, UserRound, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Modal } from '../ui/Modal'
import { listarClientes } from '../../services/clientes.service'
import { listarProductos, obtenerTipoCambio } from '../../services/comercial.service'
import { crearEncargoPanel, linkPagoEncargo } from '../../services/solicitudes.service'
import type { Cliente, Producto } from '../../types/domain'
import { resolverImagenCatalogo } from '../../utils/catalogoImagen'
import { normalizarTelefonoNicaragua, whatsappUrl } from '../../utils/whatsapp'

// "Compra directa": para el cliente que no logra comprar solo en la tienda. El equipo le arma
// el encargo (producto, talla, precio, envío, 50% o total) y le manda por WhatsApp el link de
// pago de la tienda: ahí ve las cuentas y sube el comprobante. Cae en "Encargos por confirmar"
// como cualquier encargo web y se confirma igual.

// Mismos tiempos y recargo que la tienda (HAUSLINE_ENVIO en config.js de hausline-web).
const ENVIOS = {
  estandar: { etiqueta: 'Estándar', dias: '20 a 25 días', recargo: 0 },
  rapido: { etiqueta: 'Rápido', dias: '15 a 20 días', recargo: 15 },
} as const
type Envio = keyof typeof ENVIOS

const sinAcento = (v: string | null | undefined) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`
const primerNombre = (n: string) => n.trim().split(/\s+/)[0] ?? ''

export function CompraDirectaModal({ open, onClose, cliente: clienteInicial, onCreada }: { open: boolean; onClose: () => void; cliente?: Cliente | null; onCreada?: (codigo: string) => void }) {
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [tc, setTc] = useState(37)
  const [cliente, setCliente] = useState<Cliente | null>(clienteInicial ?? null)
  const [buscaCliente, setBuscaCliente] = useState('')
  const [nuevo, setNuevo] = useState({ nombre: '', whatsapp: '', correo: '' })
  const [producto, setProducto] = useState<Producto | null>(null)
  const [buscaProducto, setBuscaProducto] = useState('')
  const [nombreLibre, setNombreLibre] = useState('')
  const [talla, setTalla] = useState('')
  const [color, setColor] = useState('')
  const [cantidad, setCantidad] = useState(1)
  const [precio, setPrecio] = useState('')
  const [envio, setEnvio] = useState<Envio>('estandar')
  const [pago, setPago] = useState<'50' | 'total'>('50')
  const [creando, setCreando] = useState(false)
  const [codigo, setCodigo] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState('')

  useEffect(() => {
    if (!open) return
    void listarClientes().then(setClientes).catch(() => {})
    void listarProductos().then((p) => setProductos(p.filter((x) => x.activo))).catch(() => {})
    void obtenerTipoCambio().then(setTc).catch(() => {})
  }, [open])

  const clientesFiltrados = useMemo(() => {
    const t = sinAcento(buscaCliente.trim()); const dig = buscaCliente.replace(/\D/g, '')
    if (!t) return []
    return clientes.filter((c) => sinAcento(c.nombre).includes(t) || (dig.length >= 3 && String(c.whatsapp).replace(/\D/g, '').includes(dig))).slice(0, 6)
  }, [clientes, buscaCliente])
  const productosFiltrados = useMemo(() => {
    const t = sinAcento(buscaProducto.trim())
    if (!t) return []
    return productos.filter((p) => [p.codigo, p.nombre, p.marca].some((v) => sinAcento(v).includes(t))).slice(0, 8)
  }, [productos, buscaProducto])

  const elegirProducto = (p: Producto) => {
    setProducto(p); setBuscaProducto(''); setNombreLibre('')
    setPrecio(p.precio_venta > 0 ? String(p.precio_venta) : '')
    setTalla(p.tallas?.length === 1 ? p.tallas[0] : '')
  }

  const nombreProducto = producto?.nombre ?? nombreLibre.trim()
  const precioNum = Math.max(0, Number(precio) || 0)
  const recargo = ENVIOS[envio].recargo * cantidad
  const total = Math.round((precioNum * cantidad + recargo) * 100) / 100
  const ahora = pago === '50' ? Math.round(total * 50) / 100 : total
  const cs = (n: number) => `C$${(Math.ceil((n * tc) / 10) * 10).toLocaleString('en-US')}`
  const datosCliente = cliente ? { nombre: cliente.nombre, whatsapp: cliente.whatsapp, correo: cliente.correo } : { nombre: nuevo.nombre.trim(), whatsapp: normalizarTelefonoNicaragua(nuevo.whatsapp), correo: nuevo.correo.trim() || null }
  const faltaTalla = !!producto?.tallas?.length && !talla.trim()
  const listo = datosCliente.nombre.length >= 2 && datosCliente.whatsapp.length >= 8 && nombreProducto.length >= 2 && precioNum > 0 && !faltaTalla

  const armarMensaje = (cod: string) => {
    const detalle = [talla.trim() && `Talla ${talla.trim()}`, color.trim(), cantidad > 1 && `x${cantidad}`].filter(Boolean).join(' · ')
    return [
      `Hola ${primerNombre(datosCliente.nombre)} 👋 Le saluda el equipo de HAUSLINE. Le dejamos listo su pedido:`,
      '',
      `🛍️ ${nombreProducto}${detalle ? ` — ${detalle}` : ''}`,
      `🚚 Envío ${ENVIOS[envio].etiqueta.toLowerCase()} (${ENVIOS[envio].dias})`,
      `💵 Total: ${usd(total)} (${cs(total)})`,
      '',
      `Para confirmarlo solo debe transferir ${pago === '50' ? 'el 50%' : 'el total'}: *${usd(ahora)}* (${cs(ahora)})${pago === '50' ? `. El resto (${usd(Math.round((total - ahora) * 100) / 100)}) lo paga al recibir.` : ''}`,
      '👉 En este enlace puede ver las cuentas y subir su comprobante:',
      linkPagoEncargo(cod),
      '',
      'El enlace vence en 48 horas. Cualquier duda, con gusto le atendemos por aquí 🙌',
    ].join('\n')
  }

  const crear = async () => {
    if (!listo) return
    setCreando(true)
    try {
      const cod = await crearEncargoPanel({
        nombre: datosCliente.nombre, whatsapp: datosCliente.whatsapp, correo: datosCliente.correo,
        ciudad: cliente?.departamento || cliente?.ciudad || null, direccion: cliente?.direccion || null,
        producto: nombreProducto, productoCodigo: producto?.codigo ?? null, marca: producto?.marca ?? null,
        talla: talla.trim() || null, color: color.trim() || null, cantidad, precioUnitario: precioNum,
        envio, recargo, pago, imagen: producto?.imagen ?? null, clienteId: cliente?.id ?? null,
      })
      setCodigo(cod); setMensaje(armarMensaje(cod)); onCreada?.(cod)
      toast.success(`Encargo ${cod} creado.`)
    } catch (e) {
      const m = e instanceof Error ? e.message : ''
      toast.error(/crear_encargo_panel|schema cache/i.test(m) ? 'Falta aplicar la migración 202610030002.' : m || 'No se pudo crear el encargo.')
    } finally { setCreando(false) }
  }
  const copiar = async (texto: string, ok: string) => { try { await navigator.clipboard.writeText(texto); toast.success(ok) } catch { toast.error('No se pudo copiar.') } }

  if (codigo) return <Modal open={open} onClose={onClose} title={`Encargo ${codigo} listo`} description="Mandale el mensaje: con el link ve las cuentas, transfiere y sube el comprobante. Después lo confirmás en Encargos por confirmar.">
    <div className="space-y-3">
      <label className="form-field"><span>Mensaje para WhatsApp (lo podés editar)</span><textarea rows={13} value={mensaje} onChange={(e) => setMensaje(e.target.value)} className="font-sans text-sm leading-5" /></label>
      <div className="grid gap-2 sm:grid-cols-3">
        <a className="primary-button justify-center" href={whatsappUrl(datosCliente.whatsapp, mensaje)} target="_blank" rel="noreferrer"><MessageCircle size={16} /> Abrir WhatsApp</a>
        <button className="subtle-button justify-center" onClick={() => void copiar(mensaje, 'Mensaje copiado.')}><Copy size={15} /> Copiar mensaje</button>
        <a className="subtle-button justify-center" href={linkPagoEncargo(codigo)} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Ver lo que ve</a>
      </div>
    </div>
  </Modal>

  return <Modal open={open} onClose={onClose} title="Compra directa" description="Le armás el pedido al cliente y le mandás el link para que solo transfiera.">
    <div className="space-y-5 text-sm">
      {/* 1. Cliente */}
      <section>
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted"><UserRound size={13} /> Cliente</p>
        {cliente ? <div className="flex items-center gap-3 rounded-xl border border-accent/35 bg-accent/[.05] p-3">
          <div className="min-w-0 flex-1"><strong className="block truncate">{cliente.nombre}</strong><span className="block truncate font-mono text-xs text-muted">{cliente.whatsapp}{cliente.correo ? ` · ${cliente.correo}` : ''}</span></div>
          <button className="table-action" onClick={() => setCliente(null)} title="Cambiar cliente" aria-label="Cambiar cliente"><X size={15} /></button>
        </div> : <>
          <div className="relative"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input className="simple-input" style={{ paddingLeft: "2.25rem" }} placeholder="Buscar cliente por nombre o WhatsApp" value={buscaCliente} onChange={(e) => setBuscaCliente(e.target.value)} /></div>
          {clientesFiltrados.length > 0 && <ul className="mt-1.5 divide-y divide-line/60 rounded-xl border border-line">
            {clientesFiltrados.map((c) => <li key={c.id}><button className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/[.04]" onClick={() => { setCliente(c); setBuscaCliente('') }}><span className="min-w-0 flex-1 truncate">{c.nombre}</span><span className="font-mono text-xs text-muted">{c.whatsapp}</span></button></li>)}
          </ul>}
          <p className="mt-3 text-[11px] text-muted">¿Es nuevo? Escribí sus datos:</p>
          <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
            <input className="simple-input" placeholder="Nombre" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
            <input className="simple-input" placeholder="WhatsApp" inputMode="tel" value={nuevo.whatsapp} onChange={(e) => setNuevo({ ...nuevo, whatsapp: e.target.value })} />
            <input className="simple-input" placeholder="Correo (opcional)" type="email" value={nuevo.correo} onChange={(e) => setNuevo({ ...nuevo, correo: e.target.value })} />
          </div>
        </>}
      </section>

      {/* 2. Producto */}
      <section>
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted"><Package size={13} /> Producto</p>
        {producto ? <div className="flex items-center gap-3 rounded-xl border border-accent/35 bg-accent/[.05] p-3">
          {producto.imagen ? <img src={resolverImagenCatalogo(producto.imagen)} alt="" className="size-14 shrink-0 rounded-lg bg-white object-contain" /> : <span className="grid size-14 shrink-0 place-items-center rounded-lg bg-white/[.05]"><Package size={18} /></span>}
          <div className="min-w-0 flex-1"><strong className="block truncate">{producto.nombre}</strong><span className="block truncate text-xs text-muted">{producto.codigo}{producto.marca ? ` · ${producto.marca}` : ''} · {usd(producto.precio_venta)}</span></div>
          <button className="table-action" onClick={() => { setProducto(null); setTalla('') }} title="Cambiar producto" aria-label="Cambiar producto"><X size={15} /></button>
        </div> : <>
          <div className="relative"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input className="simple-input" style={{ paddingLeft: "2.25rem" }} placeholder="Buscar por código, nombre o marca" value={buscaProducto} onChange={(e) => setBuscaProducto(e.target.value)} /></div>
          {buscaProducto.trim() && <ul className="mt-1.5 divide-y divide-line/60 rounded-xl border border-line">
            {productosFiltrados.map((p) => <li key={p.id}><button className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-white/[.04]" onClick={() => elegirProducto(p)}>
              {p.imagen ? <img src={resolverImagenCatalogo(p.imagen)} alt="" loading="lazy" className="size-10 shrink-0 rounded-md bg-white object-contain" /> : <span className="size-10 shrink-0 rounded-md bg-white/[.05]" />}
              <span className="min-w-0 flex-1"><span className="block truncate">{p.nombre}</span><span className="block truncate text-xs text-muted">{p.codigo}{p.marca ? ` · ${p.marca}` : ''}</span></span>
              <span className="font-mono text-xs">{usd(p.precio_venta)}</span>
            </button></li>)}
            <li><button className="w-full px-3 py-2 text-left text-xs text-accent hover:bg-white/[.04]" onClick={() => { setNombreLibre(buscaProducto.trim()); setBuscaProducto('') }}>Usar “{buscaProducto.trim()}” como producto (fuera del catálogo)</button></li>
          </ul>}
          {nombreLibre && <p className="mt-2 flex items-center gap-2 rounded-xl border border-line bg-white/[.02] px-3 py-2"><Package size={14} className="text-accent" /> <span className="min-w-0 flex-1 truncate">{nombreLibre}</span><button className="table-action" onClick={() => setNombreLibre('')} aria-label="Quitar"><X size={14} /></button></p>}
        </>}

        {(producto || nombreLibre) && <div className="mt-3 space-y-3">
          {producto?.tallas?.length ? <div><p className="mb-1.5 text-[11px] text-muted">Talla</p><div className="flex flex-wrap gap-1.5">{producto.tallas.map((t) => <button key={t} className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${talla === t ? 'border-accent bg-accent/15 text-accent' : 'border-line text-white/80 hover:border-white/30'}`} onClick={() => setTalla(t)}>{t}</button>)}</div></div> : null}
          <div className="grid gap-2 sm:grid-cols-4">
            {!producto?.tallas?.length && <label className="form-field"><span>Talla (opcional)</span><input value={talla} onChange={(e) => setTalla(e.target.value)} /></label>}
            <label className="form-field"><span>Color (opcional)</span><input value={color} onChange={(e) => setColor(e.target.value)} /></label>
            <label className="form-field"><span>Cantidad</span><input type="number" min={1} max={50} value={cantidad} onChange={(e) => setCantidad(Math.min(50, Math.max(1, Math.round(Number(e.target.value) || 1))))} /></label>
            <label className="form-field"><span>Precio c/u (US$)</span><input type="number" min={0} step="0.5" value={precio} onChange={(e) => setPrecio(e.target.value)} /></label>
          </div>
        </div>}
      </section>

      {/* 3. Envío y pago */}
      <section className="grid gap-3 sm:grid-cols-2">
        <div><p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Envío</p><div className="grid grid-cols-2 gap-1.5">
          {(Object.keys(ENVIOS) as Envio[]).map((k) => <button key={k} className={`rounded-xl border px-3 py-2 text-left ${envio === k ? 'border-accent bg-accent/10' : 'border-line hover:border-white/25'}`} onClick={() => setEnvio(k)}><b className="block text-xs">{ENVIOS[k].etiqueta}</b><span className="text-[11px] text-muted">{ENVIOS[k].dias}{ENVIOS[k].recargo ? ` · +$${ENVIOS[k].recargo} c/u` : ' · gratis'}</span></button>)}
        </div></div>
        <div><p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Paga ahora</p><div className="grid grid-cols-2 gap-1.5">
          {([['50', '50% anticipo', 'El resto al recibir'], ['total', 'Total', 'Todo de una vez']] as const).map(([k, t, n]) => <button key={k} className={`rounded-xl border px-3 py-2 text-left ${pago === k ? 'border-accent bg-accent/10' : 'border-line hover:border-white/25'}`} onClick={() => setPago(k)}><b className="block text-xs">{t}</b><span className="text-[11px] text-muted">{n}</span></button>)}
        </div></div>
      </section>

      {/* Resumen */}
      <div className="rounded-xl border border-line bg-white/[.02] p-3">
        <div className="flex justify-between text-xs text-muted"><span>{cantidad} × {usd(precioNum)}{recargo ? ` + envío rápido ${usd(recargo)}` : ''}</span><span>Total {usd(total)} · {cs(total)}</span></div>
        <div className="mt-1.5 flex items-baseline justify-between"><span className="font-semibold">Transfiere ahora</span><span className="text-lg font-bold text-accent">{usd(ahora)} <span className="text-xs font-normal text-muted">{cs(ahora)}</span></span></div>
      </div>

      {faltaTalla && <p className="text-xs text-amber-300">Elegí la talla.</p>}
      <button className="primary-button w-full justify-center" disabled={!listo || creando} onClick={() => void crear()}><Check size={16} /> {creando ? 'Creando…' : 'Crear encargo y armar mensaje'}</button>
    </div>
  </Modal>
}
