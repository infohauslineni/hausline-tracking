import { Check, Copy, CopyPlus, ExternalLink, MessageCircle, Package, Search, ShoppingCart, Trash2, UserRound, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Modal } from '../ui/Modal'
import { listarClientes } from '../../services/clientes.service'
import { obtenerTipoCambio } from '../../services/comercial.service'
import { sugerirPrecios, tipoDeTienda, type DatosPrecio } from '../../services/preciosSugeridos.service'
import { enOferta, ordenarTallas, type ProductoTienda } from '../../services/productosTienda.service'
import { crearCarritoPanel, linkPagoEncargo } from '../../services/solicitudes.service'
import type { Cliente } from '../../types/domain'
import { resolverImagenCatalogo } from '../../utils/catalogoImagen'
import { normalizarTelefonoNicaragua, whatsappUrl } from '../../utils/whatsapp'

// CARRITO PRIVADO: para el cliente que compra varios productos. Se eligen los productos, a cada
// uno se le pone el precio de tienda, el mayorista o uno especial (se pueden mezclar), y se crea
// un carrito con UN código. El cliente recibe por WhatsApp el link de pago de la tienda: ahí ve
// sus productos con esos precios, las cuentas y sube el comprobante. Después se confirma en
// Encargos por confirmar, como cualquier carrito web. El costo y la ganancia solo los ve el panel.

type Modo = 'tienda' | 'mayorista' | 'otro'
type Linea = { key: string; p: ProductoTienda; talla: string; cantidad: number; modo: Modo; otro: string }

const r2 = (n: number) => Math.round(n * 100) / 100
const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`
const num = (s: string) => Math.max(0, Number(String(s).replace(',', '.')) || 0)
const sinAcento = (v: string | null | undefined) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const primerNombre = (n: string) => n.trim().split(/\s+/)[0] ?? ''
const precioTienda = (p: ProductoTienda) => (p.datos.cotizar ? 0 : enOferta(p.datos) ? Number(p.datos.precioOferta) : Number(p.datos.precio) || 0)
let siguiente = 0
const nuevaKey = () => `l${++siguiente}`

export function CarritoPrivadoModal({ iniciales, todos, costos, datosPrecio, onClose }: { iniciales: ProductoTienda[]; todos: ProductoTienda[]; costos: Map<string, number>; datosPrecio: DatosPrecio; onClose: () => void }) {
  const sugeridoDe = (p: ProductoTienda) => sugerirPrecios(costos.get(p.codigo.toUpperCase()) ?? 0, tipoDeTienda(p.datos), datosPrecio)
  const lineaDe = (p: ProductoTienda, talla = ''): Linea => {
    const tallas = p.datos.tallas ?? []
    return { key: nuevaKey(), p, talla: talla || (tallas.length === 1 ? tallas[0] : ''), cantidad: 1, modo: sugeridoDe(p) ? 'mayorista' : precioTienda(p) > 0 ? 'tienda' : 'otro', otro: '' }
  }
  const [lineas, setLineas] = useState<Linea[]>(() => iniciales.map((p) => lineaDe(p)))
  const [buscaProducto, setBuscaProducto] = useState('')
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [buscaCliente, setBuscaCliente] = useState('')
  const [nuevo, setNuevo] = useState({ nombre: '', whatsapp: '', correo: '' })
  const [pago, setPago] = useState<'50' | 'total'>('50')
  const [tc, setTc] = useState(37)
  const [creando, setCreando] = useState(false)
  const [codigo, setCodigo] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState('')

  useEffect(() => {
    void listarClientes().then(setClientes).catch(() => {})
    void obtenerTipoCambio().then(setTc).catch(() => {})
  }, [])

  const precioDe = (l: Linea) => l.modo === 'tienda' ? precioTienda(l.p) : l.modo === 'mayorista' ? (sugeridoDe(l.p)?.mayorista ?? 0) : num(l.otro)
  const cambiar = (key: string, cambio: Partial<Linea>) => setLineas((ls) => ls.map((l) => (l.key === key ? { ...l, ...cambio } : l)))
  const todasA = (modo: Modo) => setLineas((ls) => ls.map((l) => (modo === 'mayorista' && !sugeridoDe(l.p)) || (modo === 'tienda' && !precioTienda(l.p)) ? l : { ...l, modo }))

  const productosFiltrados = useMemo(() => {
    const t = sinAcento(buscaProducto.trim())
    if (!t) return []
    return todos.filter((p) => [p.codigo, p.datos.nombre, p.datos.marca].some((v) => sinAcento(v).includes(t))).slice(0, 8)
  }, [todos, buscaProducto])
  const clientesFiltrados = useMemo(() => {
    const t = sinAcento(buscaCliente.trim()); const dig = buscaCliente.replace(/\D/g, '')
    if (!t) return []
    return clientes.filter((c) => sinAcento(c.nombre).includes(t) || (dig.length >= 3 && String(c.whatsapp).replace(/\D/g, '').includes(dig))).slice(0, 6)
  }, [clientes, buscaCliente])

  const unidades = lineas.reduce((s, l) => s + l.cantidad, 0)
  const total = r2(lineas.reduce((s, l) => s + precioDe(l) * l.cantidad, 0))
  const ahora = pago === '50' ? r2(total * 0.5) : total
  const ganancia = r2(lineas.reduce((s, l) => { const sug = sugeridoDe(l.p); return sug ? s + (precioDe(l) - sug.base) * l.cantidad : s }, 0))
  const sinCosto = lineas.filter((l) => !sugeridoDe(l.p)).length
  const cs = (n: number) => `C$${(Math.ceil((n * tc) / 10) * 10).toLocaleString('en-US')}`
  const datosCliente = cliente ? { nombre: cliente.nombre, whatsapp: cliente.whatsapp, correo: cliente.correo } : { nombre: nuevo.nombre.trim(), whatsapp: normalizarTelefonoNicaragua(nuevo.whatsapp), correo: nuevo.correo.trim() || null }
  const faltaTalla = lineas.filter((l) => (l.p.datos.tallas ?? []).length > 0 && !l.talla.trim())
  const faltaPrecio = lineas.filter((l) => precioDe(l) <= 0)
  const listo = lineas.length > 0 && datosCliente.nombre.length >= 2 && datosCliente.whatsapp.length >= 8 && !faltaTalla.length && !faltaPrecio.length

  const armarMensaje = (cod: string) => [
    `Hola ${primerNombre(datosCliente.nombre)} 👋 Le saluda el equipo de HAUSLINE. Le dejamos listo su pedido con precio especial:`,
    '',
    ...lineas.map((l) => `🛍️ ${l.p.datos.nombre}${[l.talla.trim() && `Talla ${l.talla.trim()}`, l.cantidad > 1 && `x${l.cantidad}`].filter(Boolean).map((x) => ` · ${x}`).join('')} — ${usd(precioDe(l))}${l.cantidad > 1 ? ' c/u' : ''}`),
    '',
    `💵 Total: ${usd(total)} (${cs(total)}) · ${unidades} ${unidades === 1 ? 'producto' : 'productos'}`,
    '',
    `Para confirmarlo solo debe transferir ${pago === '50' ? 'el 50%' : 'el total'}: *${usd(ahora)}* (${cs(ahora)})${pago === '50' ? `. El resto (${usd(r2(total - ahora))}) lo paga al recibir.` : ''}`,
    '👉 En este enlace ve su pedido, las cuentas y sube su comprobante:',
    linkPagoEncargo(cod),
    '',
    'El enlace vence en 48 horas. Cualquier duda, con gusto le atendemos por aquí 🙌',
  ].join('\n')

  const crear = async () => {
    if (!listo) return
    setCreando(true)
    try {
      const cod = await crearCarritoPanel({
        nombre: datosCliente.nombre, whatsapp: datosCliente.whatsapp, correo: datosCliente.correo,
        ciudad: cliente?.departamento || cliente?.ciudad || null, direccion: cliente?.direccion || null, pago, clienteId: cliente?.id ?? null,
        items: lineas.map((l) => ({ producto: l.p.datos.nombre, productoCodigo: l.p.codigo, marca: l.p.datos.marca || null, talla: l.talla.trim() || null, cantidad: l.cantidad, precioUnitario: precioDe(l), imagen: l.p.datos.imagen || null })),
      })
      setCodigo(cod); setMensaje(armarMensaje(cod))
      toast.success(`Carrito ${cod} creado.`)
    } catch (e) {
      const m = e instanceof Error ? e.message : ''
      toast.error(/crear_carrito_panel|schema cache|function/i.test(m) ? 'Falta correr el SQL 202611050001_carrito_privado_panel en Supabase.' : m || 'No se pudo crear el carrito.')
    } finally { setCreando(false) }
  }
  const copiar = async (texto: string, ok: string) => { try { await navigator.clipboard.writeText(texto); toast.success(ok) } catch { toast.error('No se pudo copiar.') } }

  if (codigo) return <Modal open onClose={onClose} title={`Carrito ${codigo} listo`} description="Mandale el mensaje: con el link ve sus productos y precios, transfiere y sube el comprobante. Después lo confirmás en Encargos por confirmar.">
    <div className="space-y-3">
      <label className="form-field"><span>Mensaje para WhatsApp (lo podés editar)</span><textarea rows={14} value={mensaje} onChange={(e) => setMensaje(e.target.value)} className="font-sans text-sm leading-5" /></label>
      <div className="grid gap-2 sm:grid-cols-3">
        <a className="primary-button justify-center" href={whatsappUrl(datosCliente.whatsapp, mensaje)} target="_blank" rel="noreferrer"><MessageCircle size={16} /> Abrir WhatsApp</a>
        <button className="subtle-button justify-center" onClick={() => void copiar(mensaje, 'Mensaje copiado.')}><Copy size={15} /> Copiar mensaje</button>
        <a className="subtle-button justify-center" href={linkPagoEncargo(codigo)} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Ver lo que ve</a>
      </div>
    </div>
  </Modal>

  return <Modal open onClose={onClose} ancho="amplio" title="Carrito privado" description="Elegí el precio de cada producto (mayorista, de tienda o uno especial) y mandale el link al cliente. El costo y la ganancia solo los ves vos.">
    <div className="space-y-5 text-sm">
      {/* 1. Productos */}
      <section>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <p className="mr-auto flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted"><Package size={13} /> Productos</p>
          {lineas.length > 1 && <>
            <button type="button" className="subtle-button min-h-8 px-2.5 text-xs" onClick={() => todasA('mayorista')}>Todo a mayorista</button>
            <button type="button" className="subtle-button min-h-8 px-2.5 text-xs" onClick={() => todasA('tienda')}>Todo a precio tienda</button>
          </>}
        </div>
        <div className="space-y-2">
          {lineas.map((l) => {
            const sug = sugeridoDe(l.p), tienda = precioTienda(l.p), precio = precioDe(l)
            const tallas = ordenarTallas(l.p.datos.tallas ?? [])
            const gana = sug && precio > 0 ? r2(precio - sug.base) : null
            const boton = (m: Modo, texto: string, deshab = false) => <button type="button" disabled={deshab} onClick={() => cambiar(l.key, { modo: m })} className={`rounded-lg border px-2.5 py-1.5 text-left text-xs disabled:opacity-35 ${l.modo === m ? 'border-accent bg-accent/10' : 'border-line hover:border-white/25'}`}>{texto}</button>
            return <div key={l.key} className="rounded-xl border border-line p-3">
              <div className="flex items-start gap-3">
                {l.p.datos.imagen ? <img src={resolverImagenCatalogo(l.p.datos.imagen)} alt="" className="size-16 shrink-0 rounded-lg bg-white object-contain" /> : <span className="grid size-16 shrink-0 place-items-center rounded-lg bg-white/[.05]"><Package size={18} /></span>}
                <div className="min-w-0 flex-1">
                  <strong className="line-clamp-2 block">{l.p.datos.nombre}</strong>
                  <span className="block text-xs text-muted">{l.p.codigo}{l.p.datos.marca ? ` · ${l.p.datos.marca}` : ''}{sug ? ` · costo + envío ${usd(sug.base)}` : ' · sin costo'}</span>
                </div>
                <button type="button" className="table-action" title="Otra talla del mismo producto" aria-label="Otra talla del mismo producto" onClick={() => setLineas((ls) => { const i = ls.findIndex((x) => x.key === l.key); const copia = { ...l, key: nuevaKey(), talla: '' }; return [...ls.slice(0, i + 1), copia, ...ls.slice(i + 1)] })}><CopyPlus size={15} /></button>
                <button type="button" className="table-action" title="Quitar" aria-label="Quitar" onClick={() => setLineas((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 size={15} /></button>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div>
                  {tallas.length ? <div className="flex flex-wrap gap-1.5">{tallas.map((t) => <button key={t} type="button" className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${l.talla === t ? 'border-accent bg-accent/15 text-accent' : 'border-line text-white/80 hover:border-white/30'}`} onClick={() => cambiar(l.key, { talla: t })}>{t}</button>)}</div>
                    : <input className="simple-input" placeholder="Talla (opcional)" value={l.talla} onChange={(e) => cambiar(l.key, { talla: e.target.value })} />}
                </div>
                <label className="flex items-center gap-2 text-xs text-muted">Cantidad <input type="number" min={1} max={200} className="simple-input w-20!" value={l.cantidad} onChange={(e) => cambiar(l.key, { cantidad: Math.min(200, Math.max(1, Math.round(Number(e.target.value) || 1))) })} /></label>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {boton('mayorista', sug ? `Mayorista ${usd(sug.mayorista)}` : 'Mayorista (sin costo)', !sug)}
                {boton('tienda', tienda ? `Tienda ${usd(tienda)}` : 'Tienda (cotizar)', !tienda)}
                {boton('otro', 'Otro precio')}
                {l.modo === 'otro' && <input autoFocus inputMode="decimal" className="simple-input w-24!" placeholder="US$" value={l.otro} onChange={(e) => cambiar(l.key, { otro: e.target.value })} />}
                <span className="ml-auto text-right text-xs">{precio > 0 && <b className="block font-mono text-sm">{usd(r2(precio * l.cantidad))}</b>}{gana !== null && <span className={gana < 0 ? 'text-red-300' : 'text-emerald-300'}>gana {usd(r2(gana * l.cantidad))}</span>}</span>
              </div>
            </div>
          })}
        </div>
        <div className="relative mt-2"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input className="simple-input" style={{ paddingLeft: '2.25rem' }} placeholder="Agregar otro producto (código, nombre o marca)" value={buscaProducto} onChange={(e) => setBuscaProducto(e.target.value)} /></div>
        {productosFiltrados.length > 0 && <ul className="mt-1.5 divide-y divide-line/60 rounded-xl border border-line">
          {productosFiltrados.map((p) => <li key={p.codigo}><button type="button" className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-white/[.04]" onClick={() => { setLineas((ls) => [...ls, lineaDe(p)]); setBuscaProducto('') }}>
            {p.datos.imagen ? <img src={resolverImagenCatalogo(p.datos.imagen)} alt="" loading="lazy" className="size-10 shrink-0 rounded-md bg-white object-contain" /> : <span className="size-10 shrink-0 rounded-md bg-white/[.05]" />}
            <span className="min-w-0 flex-1"><span className="block truncate">{p.datos.nombre}</span><span className="block truncate text-xs text-muted">{p.codigo}{p.datos.marca ? ` · ${p.datos.marca}` : ''}</span></span>
          </button></li>)}
        </ul>}
      </section>

      {/* 2. Cliente */}
      <section>
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted"><UserRound size={13} /> Cliente</p>
        {cliente ? <div className="flex items-center gap-3 rounded-xl border border-accent/35 bg-accent/[.05] p-3">
          <div className="min-w-0 flex-1"><strong className="block truncate">{cliente.nombre}</strong><span className="block truncate font-mono text-xs text-muted">{cliente.whatsapp}{cliente.correo ? ` · ${cliente.correo}` : ''}</span></div>
          <button type="button" className="table-action" onClick={() => setCliente(null)} title="Cambiar cliente" aria-label="Cambiar cliente"><X size={15} /></button>
        </div> : <>
          <div className="relative"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input className="simple-input" style={{ paddingLeft: '2.25rem' }} placeholder="Buscar cliente por nombre o WhatsApp" value={buscaCliente} onChange={(e) => setBuscaCliente(e.target.value)} /></div>
          {clientesFiltrados.length > 0 && <ul className="mt-1.5 divide-y divide-line/60 rounded-xl border border-line">
            {clientesFiltrados.map((c) => <li key={c.id}><button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/[.04]" onClick={() => { setCliente(c); setBuscaCliente('') }}><span className="min-w-0 flex-1 truncate">{c.nombre}</span><span className="font-mono text-xs text-muted">{c.whatsapp}</span></button></li>)}
          </ul>}
          <p className="mt-3 text-[11px] text-muted">¿Es nuevo? Escribí sus datos:</p>
          <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
            <input className="simple-input" placeholder="Nombre" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
            <input className="simple-input" placeholder="WhatsApp" inputMode="tel" value={nuevo.whatsapp} onChange={(e) => setNuevo({ ...nuevo, whatsapp: e.target.value })} />
            <input className="simple-input" placeholder="Correo (opcional)" type="email" value={nuevo.correo} onChange={(e) => setNuevo({ ...nuevo, correo: e.target.value })} />
          </div>
        </>}
      </section>

      {/* 3. Pago */}
      <section>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Paga ahora</p>
        <div className="grid grid-cols-2 gap-1.5 sm:max-w-sm">
          {([['50', '50% anticipo', 'El resto al recibir'], ['total', 'Total', 'Todo de una vez']] as const).map(([k, t, n]) => <button type="button" key={k} className={`rounded-xl border px-3 py-2 text-left ${pago === k ? 'border-accent bg-accent/10' : 'border-line hover:border-white/25'}`} onClick={() => setPago(k)}><b className="block text-xs">{t}</b><span className="text-[11px] text-muted">{n}</span></button>)}
        </div>
      </section>

      {/* Resumen */}
      <div className="rounded-xl border border-line bg-white/[.02] p-3">
        <div className="flex justify-between text-xs text-muted"><span>{unidades} {unidades === 1 ? 'producto' : 'productos'} · envío estándar</span><span>Total {usd(total)} · {cs(total)}</span></div>
        <div className="mt-1.5 flex items-baseline justify-between"><span className="font-semibold">Transfiere ahora</span><span className="text-lg font-bold text-accent">{usd(ahora)} <span className="text-xs font-normal text-muted">{cs(ahora)}</span></span></div>
        {lineas.length > 0 && <p className="mt-1.5 text-xs text-muted">Tu ganancia estimada: <b className={ganancia < 0 ? 'text-red-300' : 'text-emerald-300'}>{usd(ganancia)}</b>{sinCosto ? ` (sin contar ${sinCosto} sin costo)` : ''} · solo la ves vos</p>}
      </div>

      {faltaTalla.length > 0 && <p className="text-xs text-amber-300">Falta la talla de: {faltaTalla.map((l) => l.p.datos.nombre).join(', ')}</p>}
      {faltaPrecio.length > 0 && <p className="text-xs text-amber-300">Falta el precio de: {faltaPrecio.map((l) => l.p.datos.nombre).join(', ')}</p>}
      <button type="button" className="primary-button w-full justify-center" disabled={!listo || creando} onClick={() => void crear()}>{creando ? 'Creando…' : <><ShoppingCart size={16} /> Crear carrito y armar mensaje</>}</button>
      {!lineas.length && <p className="text-center text-xs text-muted"><Check size={12} className="inline" /> Agregá al menos un producto.</p>}
    </div>
  </Modal>
}
