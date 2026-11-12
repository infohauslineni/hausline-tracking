import { ArrowLeft, Check, Copy, CopyPlus, Download, Eye, ExternalLink, MessageCircle, Package, Search, ShoppingCart, Trash2, UserRound, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Modal } from '../ui/Modal'
import { HauslineLogo } from '../ui/HauslineLogo'
import { descargarOCompartirCotizacion, fechaCot, NEON, notasCotizacion, SITIO, usdCot, type CotizacionData } from '../../services/cotizacionImagen.service'
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
// Producto con lista de tallas: se eligen VARIAS tallas, cada una con su cantidad (porTalla).
// Producto sin lista de tallas: talla escrita a mano (opcional) + cantidad.
type Linea = { key: string; p: ProductoTienda; talla: string; cantidad: number; porTalla: Record<string, number>; modo: Modo; otro: string }
const tallasDe = (l: Linea) => ordenarTallas(l.p.datos.tallas ?? [])
const conTallas = (l: Linea) => tallasDe(l).length > 0
// Tallas elegidas, en el orden de la lista (S, M, L…), con su cantidad.
const elegidas = (l: Linea) => tallasDe(l).filter((t) => t in l.porTalla).map((t) => ({ talla: t, cantidad: l.porTalla[t] || 0 }))
// Cantidad del producto = suma de sus tallas (o la cantidad escrita si no tiene tallas).
const cantidadDe = (l: Linea) => (conTallas(l) ? elegidas(l).reduce((s, x) => s + x.cantidad, 0) : l.cantidad)
const MEDIA_DOCENA = 6

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
    return { key: nuevaKey(), p, talla: talla || (tallas.length === 1 ? tallas[0] : ''), cantidad: 1, porTalla: tallas.length === 1 ? { [tallas[0]]: 1 } : {}, modo: sugeridoDe(p) ? 'mayorista' : precioTienda(p) > 0 ? 'tienda' : 'otro', otro: '' }
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
  const [vistaCliente, setVistaCliente] = useState(false)
  const [exportando, setExportando] = useState(false)
  // N.º de cotización: fecha + 3 cifras (para que el cliente la pueda nombrar).
  const [numeroCot] = useState(() => { const d = new Date(); const z = (n: number) => String(n).padStart(2, '0'); return `${String(d.getFullYear()).slice(2)}${z(d.getMonth() + 1)}${z(d.getDate())}-${Math.floor(Math.random() * 900) + 100}` })

  useEffect(() => {
    void listarClientes().then(setClientes).catch(() => {})
    void obtenerTipoCambio().then(setTc).catch(() => {})
  }, [])

  const precioDe = (l: Linea) => l.modo === 'tienda' ? precioTienda(l.p) : l.modo === 'mayorista' ? (sugeridoDe(l.p)?.mayorista ?? 0) : num(l.otro)
  const cambiar = (key: string, cambio: Partial<Linea>) => setLineas((ls) => ls.map((l) => (l.key === key ? { ...l, ...cambio } : l)))
  // Tallas: tocar una la agrega (con 1) o la quita; cada una tiene su cantidad.
  const alternarTalla = (key: string, t: string) => setLineas((ls) => ls.map((l) => {
    if (l.key !== key) return l
    const porTalla = { ...l.porTalla }
    if (t in porTalla) delete porTalla[t]; else porTalla[t] = 1
    return { ...l, porTalla }
  }))
  const cantidadTalla = (key: string, t: string, valor: string) => setLineas((ls) => ls.map((l) => (l.key === key ? { ...l, porTalla: { ...l.porTalla, [t]: Math.min(200, Math.max(0, Math.round(Number(valor) || 0))) } } : l)))
  // Al salir del campo, una talla elegida no queda en 0.
  const asegurarTalla = (key: string, t: string) => setLineas((ls) => ls.map((l) => (l.key === key && t in l.porTalla && !(l.porTalla[t] > 0) ? { ...l, porTalla: { ...l.porTalla, [t]: 1 } } : l)))
  // "Media docena": 6 en total, repartidas entre las tallas elegidas (después se ajusta a mano).
  const mediaDocena = (key: string) => {
    const l = lineas.find((x) => x.key === key)
    if (!l) return
    if (!conTallas(l)) { cambiar(key, { cantidad: MEDIA_DOCENA }); return }
    const sel = elegidas(l).map((x) => x.talla)
    if (!sel.length) { toast.error('Elegí primero las tallas y después tocá "Media docena".'); return }
    if (sel.length > MEDIA_DOCENA) { toast.error(`Hay ${sel.length} tallas elegidas: con más de 6 ajustá las cantidades a mano.`); return }
    const base = Math.floor(MEDIA_DOCENA / sel.length), resto = MEDIA_DOCENA % sel.length
    cambiar(key, { porTalla: Object.fromEntries(sel.map((t, i) => [t, base + (i < resto ? 1 : 0)])) })
  }
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

  const unidades = lineas.reduce((s, l) => s + cantidadDe(l), 0)
  const total = r2(lineas.reduce((s, l) => s + precioDe(l) * cantidadDe(l), 0))
  const ahora = pago === '50' ? r2(total * 0.5) : total
  const ganancia = r2(lineas.reduce((s, l) => { const sug = sugeridoDe(l.p); return sug ? s + (precioDe(l) - sug.base) * cantidadDe(l) : s }, 0))
  const sinCosto = lineas.filter((l) => !sugeridoDe(l.p)).length
  const cs = (n: number) => `C$${(Math.ceil((n * tc) / 10) * 10).toLocaleString('en-US')}`
  const datosCliente = cliente ? { nombre: cliente.nombre, whatsapp: cliente.whatsapp, correo: cliente.correo } : { nombre: nuevo.nombre.trim(), whatsapp: normalizarTelefonoNicaragua(nuevo.whatsapp), correo: nuevo.correo.trim() || null }
  const faltaTalla = lineas.filter((l) => conTallas(l) && !elegidas(l).length)
  const faltaCantidad = lineas.filter((l) => !faltaTalla.includes(l) && (cantidadDe(l) <= 0 || elegidas(l).some((x) => x.cantidad <= 0)))
  const faltaPrecio = lineas.filter((l) => precioDe(l) <= 0)
  const listo = lineas.length > 0 && datosCliente.nombre.length >= 2 && datosCliente.whatsapp.length >= 8 && !faltaTalla.length && !faltaCantidad.length && !faltaPrecio.length
  // Texto de tallas de una línea ("S×1, M×2" o "Talla 40").
  const tallasLinea = (l: Linea) => (conTallas(l) ? elegidas(l).filter((x) => x.cantidad > 0).map((x) => `${x.talla}×${x.cantidad}`).join(', ') : l.talla.trim() ? `Talla ${l.talla.trim()}` : '')

  // Cotización para el cliente: SOLO lo que él puede ver (sin costo, ganancia, código ni "mayorista/tienda").
  const cotizacion: CotizacionData = useMemo(() => {
    const hoy = new Date()
    const desde = new Date(hoy.getTime() + 20 * 86400000), hasta = new Date(hoy.getTime() + 25 * 86400000)
    const mes = (d: Date) => new Intl.DateTimeFormat('es-NI', { month: 'long' }).format(d)
    // "entre el 2 y el 7 de diciembre" (o "entre el 28 de noviembre y el 3 de diciembre").
    const rango = desde.getMonth() === hasta.getMonth() ? `entre el ${desde.getDate()} y el ${hasta.getDate()} de ${mes(hasta)}` : `entre el ${desde.getDate()} de ${mes(desde)} y el ${hasta.getDate()} de ${mes(hasta)}`
    const visibles = lineas.filter((l) => precioDe(l) > 0 && cantidadDe(l) > 0)
    const tot = r2(visibles.reduce((s, l) => s + precioDe(l) * cantidadDe(l), 0))
    const aPagar = pago === '50' ? r2(tot * 0.5) : tot
    return {
      numero: numeroCot, fecha: hoy, cliente: datosCliente.nombre.length >= 2 ? datosCliente.nombre : null,
      lineas: visibles.map((l) => ({
        nombre: l.p.datos.nombre, imagen: l.p.datos.imagen || null,
        tallas: conTallas(l) ? elegidas(l).filter((x) => x.cantidad > 0) : l.talla.trim() ? [{ talla: l.talla.trim(), cantidad: l.cantidad }] : [],
        cantidad: cantidadDe(l), precio: precioDe(l), subtotal: r2(precioDe(l) * cantidadDe(l)),
      })),
      total: tot, totalCs: cs(tot), pago, aPagar, aPagarCs: cs(aPagar),
      entrega: `20 a 25 días con envío estándar (aprox. ${rango})`,
    }
  }, [lineas, pago, numeroCot, datosCliente.nombre, tc]) // eslint-disable-line react-hooks/exhaustive-deps
  const descargarImagen = async () => {
    setExportando(true)
    try {
      const r = await descargarOCompartirCotizacion(cotizacion)
      if (r === 'descargada') toast.success('Imagen descargada. Mandala por WhatsApp al cliente.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo crear la imagen.') } finally { setExportando(false) }
  }

  const armarMensaje = (cod: string) => [
    `Hola ${primerNombre(datosCliente.nombre)} 👋 Le saluda el equipo de HAUSLINE. Le dejamos listo su pedido con precio especial:`,
    '',
    ...lineas.map((l) => { const c = cantidadDe(l); return `🛍️ ${l.p.datos.nombre}${[tallasLinea(l), c > 1 && `${c} unidades`].filter(Boolean).map((x) => ` · ${x}`).join('')} — ${usd(precioDe(l))}${c > 1 ? ` c/u = ${usd(r2(precioDe(l) * c))}` : ''}` }),
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
        // Una línea del carrito por cada talla (así cada talla lleva su cantidad).
        items: lineas.flatMap((l) => {
          const base = { producto: l.p.datos.nombre, productoCodigo: l.p.codigo, marca: l.p.datos.marca || null, precioUnitario: precioDe(l), imagen: l.p.datos.imagen || null }
          return conTallas(l) ? elegidas(l).filter((x) => x.cantidad > 0).map((x) => ({ ...base, talla: x.talla, cantidad: x.cantidad })) : [{ ...base, talla: l.talla.trim() || null, cantidad: l.cantidad }]
        }),
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

  if (vistaCliente) return <Modal open onClose={onClose} ancho="amplio" title="Vista cliente" description="Así la ve el cliente. Descargala como imagen y mandásela por WhatsApp.">
    <div className="space-y-3">
      <VistaCotizacion d={cotizacion} />
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" className="primary-button justify-center" disabled={exportando || !cotizacion.lineas.length} onClick={() => void descargarImagen()}><Download size={16} /> {exportando ? 'Creando imagen…' : 'Descargar imagen'}</button>
        <button type="button" className="subtle-button justify-center" onClick={() => setVistaCliente(false)}><ArrowLeft size={15} /> Volver a editar</button>
      </div>
      <p className="text-center text-[11px] text-muted">En el celular, "Descargar imagen" abre compartir para mandarla directo por WhatsApp.</p>
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
            const tallas = tallasDe(l), cant = cantidadDe(l), sel = elegidas(l)
            const gana = sug && precio > 0 ? r2(precio - sug.base) : null
            const boton = (m: Modo, texto: string, deshab = false) => <button type="button" disabled={deshab} onClick={() => cambiar(l.key, { modo: m })} className={`rounded-lg border px-2.5 py-1.5 text-left text-xs disabled:opacity-35 ${l.modo === m ? 'border-accent bg-accent/10' : 'border-line hover:border-white/25'}`}>{texto}</button>
            return <div key={l.key} className="rounded-xl border border-line p-3">
              <div className="flex items-start gap-3">
                {l.p.datos.imagen ? <img src={resolverImagenCatalogo(l.p.datos.imagen)} alt="" className="size-16 shrink-0 rounded-lg bg-white object-contain" /> : <span className="grid size-16 shrink-0 place-items-center rounded-lg bg-white/[.05]"><Package size={18} /></span>}
                <div className="min-w-0 flex-1">
                  <strong className="line-clamp-2 block">{l.p.datos.nombre}</strong>
                  <span className="block text-xs text-muted">{l.p.codigo}{l.p.datos.marca ? ` · ${l.p.datos.marca}` : ''}{sug ? ` · costo + envío ${usd(sug.base)}` : ' · sin costo'}</span>
                </div>
                <button type="button" className="table-action" title="Duplicar (mismo producto con otro precio)" aria-label="Duplicar producto" onClick={() => setLineas((ls) => { const i = ls.findIndex((x) => x.key === l.key); const copia = { ...l, key: nuevaKey(), talla: '', porTalla: {} }; return [...ls.slice(0, i + 1), copia, ...ls.slice(i + 1)] })}><CopyPlus size={15} /></button>
                <button type="button" className="table-action" title="Quitar" aria-label="Quitar" onClick={() => setLineas((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 size={15} /></button>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div>
                  {tallas.length ? <>
                    <p className="mb-1.5 text-[11px] text-muted">Tallas (podés elegir varias)</p>
                    <div className="flex flex-wrap gap-1.5">{tallas.map((t) => <button key={t} type="button" aria-pressed={t in l.porTalla} className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${t in l.porTalla ? 'border-accent bg-accent/15 text-accent' : 'border-line text-white/80 hover:border-white/30'}`} onClick={() => alternarTalla(l.key, t)}>{t}</button>)}</div>
                    {sel.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{sel.map((x) => <label key={x.talla} className="flex items-center gap-1.5 rounded-lg border border-accent/35 bg-accent/[.06] py-1 pl-2.5 pr-1 text-xs">
                      <b className="min-w-5">{x.talla}</b>
                      <input type="number" inputMode="numeric" min={1} max={200} aria-label={`Cantidad talla ${x.talla}`} className="simple-input w-14! py-1! text-center" value={x.cantidad || ''} onFocus={(e) => e.target.select()} onChange={(e) => cantidadTalla(l.key, x.talla, e.target.value)} onBlur={() => asegurarTalla(l.key, x.talla)} />
                    </label>)}</div>}
                  </> : <input className="simple-input" placeholder="Talla (opcional)" value={l.talla} onChange={(e) => cambiar(l.key, { talla: e.target.value })} />}
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end">
                  {tallas.length ? <span className="text-xs text-muted">Cantidad <b className="ml-1 text-sm text-white">{cant}</b></span>
                    : <label className="flex items-center gap-2 text-xs text-muted">Cantidad <input type="number" min={1} max={200} className="simple-input w-20!" value={l.cantidad} onChange={(e) => cambiar(l.key, { cantidad: Math.min(200, Math.max(1, Math.round(Number(e.target.value) || 1))) })} /></label>}
                  <button type="button" className="subtle-button min-h-8 px-2.5 text-xs" onClick={() => mediaDocena(l.key)} title="6 en total, repartidas entre las tallas elegidas">Media docena</button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {boton('mayorista', sug ? `Mayorista ${usd(sug.mayorista)}` : 'Mayorista (sin costo)', !sug)}
                {boton('tienda', tienda ? `Tienda ${usd(tienda)}` : 'Tienda (cotizar)', !tienda)}
                {boton('otro', 'Otro precio')}
                {l.modo === 'otro' && <input autoFocus inputMode="decimal" className="simple-input w-24!" placeholder="US$" value={l.otro} onChange={(e) => cambiar(l.key, { otro: e.target.value })} />}
                <span className="ml-auto text-right text-xs">{precio > 0 && <b className="block font-mono text-sm">{usd(r2(precio * cant))}</b>}{precio > 0 && cant > 1 && <span className="block text-muted">{cant} × {usd(precio)}</span>}{gana !== null && <span className={gana < 0 ? 'text-red-300' : 'text-emerald-300'}>gana {usd(r2(gana * cant))}</span>}</span>
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
      {faltaCantidad.length > 0 && <p className="text-xs text-amber-300">Falta la cantidad de: {faltaCantidad.map((l) => l.p.datos.nombre).join(', ')}</p>}
      {faltaPrecio.length > 0 && <p className="text-xs text-amber-300">Falta el precio de: {faltaPrecio.map((l) => l.p.datos.nombre).join(', ')}</p>}
      <button type="button" className="subtle-button w-full justify-center" disabled={!cotizacion.lineas.length} onClick={() => setVistaCliente(true)}><Eye size={15} /> Vista cliente (cotización para mandar)</button>
      <button type="button" className="primary-button w-full justify-center" disabled={!listo || creando} onClick={() => void crear()}>{creando ? 'Creando…' : <><ShoppingCart size={16} /> Crear carrito y armar mensaje</>}</button>
      {!lineas.length && <p className="text-center text-xs text-muted"><Check size={12} className="inline" /> Agregá al menos un producto.</p>}
    </div>
  </Modal>
}

// VISTA CLIENTE: la cotización limpia, igual a la imagen que se descarga. Sin costo, ganancia,
// códigos internos ni "mayorista/tienda". Estilo HAUSLINE: fondo oscuro y verde neón.
function VistaCotizacion({ d }: { d: CotizacionData }) {
  const unidades = d.lineas.reduce((s, l) => s + l.cantidad, 0)
  return <div className="overflow-hidden rounded-2xl border border-white/10 p-5 sm:p-7" style={{ background: 'radial-gradient(circle at 90% 0%, rgba(54,251,161,.14), transparent 55%), #0a0a0a', color: '#fff' }}>
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-center gap-3">
        <span className="shrink-0" style={{ ['--color-accent' as string]: NEON } as React.CSSProperties}><HauslineLogo size={42} /></span>
        <div><b className="font-display block text-xl leading-none tracking-tight sm:text-2xl">HAUSLINE</b><span className="text-xs" style={{ color: '#a3a09a' }}>King of Shoes</span></div>
      </div>
      <div className="text-right">
        <p className="text-[11px] font-bold tracking-[.18em]" style={{ color: NEON }}>COTIZACIÓN</p>
        <p className="font-display whitespace-nowrap text-base font-bold sm:text-lg">N.º {d.numero}</p>
        <p className="whitespace-nowrap text-[11px] sm:text-xs" style={{ color: '#a3a09a' }}>{fechaCot(d.fecha)}</p>
      </div>
    </div>
    <div className="my-5 h-[2px] rounded" style={{ background: NEON }} />
    {d.cliente && <div className="mb-4"><p className="text-[11px] font-semibold tracking-[.14em]" style={{ color: '#a3a09a' }}>PREPARADA PARA</p><p className="text-lg font-bold">{d.cliente}</p></div>}
    <div className="space-y-2.5">
      {d.lineas.map((l, i) => <div key={i} className="flex gap-3 rounded-xl p-3" style={{ background: '#141414' }}>
        {l.imagen ? <img src={resolverImagenCatalogo(l.imagen)} alt="" className="size-16 shrink-0 rounded-lg bg-white object-cover sm:size-20" /> : <span className="size-16 shrink-0 rounded-lg sm:size-20" style={{ background: '#1f1f1f' }} />}
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 font-bold leading-tight">{l.nombre}</p>
          {l.tallas.length > 0 && <p className="mt-1 flex flex-wrap gap-x-2.5 text-sm font-semibold" style={{ color: NEON }}>{l.tallas.map((t) => <span key={t.talla} className="whitespace-nowrap">{t.talla} × {t.cantidad}</span>)}</p>}
          <p className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 text-xs" style={{ color: '#a3a09a' }}><span className="whitespace-nowrap">{l.cantidad} {l.cantidad === 1 ? 'unidad' : 'unidades'} × {usdCot(l.precio)}</span><b className="font-display text-base font-extrabold sm:hidden" style={{ color: '#fff' }}>{usdCot(l.subtotal)}</b></p>
        </div>
        <p className="font-display hidden shrink-0 text-lg font-extrabold sm:block">{usdCot(l.subtotal)}</p>
      </div>)}
    </div>
    <div className="mt-4 flex items-end justify-between gap-3 rounded-2xl px-5 py-4" style={{ background: NEON, color: '#0a0a0a' }}>
      <div><p className="whitespace-nowrap text-xs font-bold tracking-wide">TOTAL</p><p className="whitespace-nowrap text-xs">{unidades} {unidades === 1 ? 'unidad' : 'unidades'} · {d.totalCs}</p></div>
      <p className="font-display text-2xl font-extrabold leading-none sm:text-3xl">{usdCot(d.total)}</p>
    </div>
    <p className="mt-5 text-[11px] font-bold tracking-[.14em]" style={{ color: '#a3a09a' }}>NOTAS</p>
    <ul className="mt-2 space-y-1.5 text-sm">
      {notasCotizacion(d).map((n) => <li key={n} className="flex gap-2"><span className="mt-[7px] size-2 shrink-0 rounded-full" style={{ background: NEON }} />{n}</li>)}
    </ul>
    <div className="mt-6 border-t pt-4 text-center" style={{ borderColor: '#262626' }}>
      <p className="font-display text-lg font-extrabold" style={{ color: NEON }}>{SITIO}</p>
      <p className="text-xs" style={{ color: '#6e6b66' }}>Gracias por preferir HAUSLINE</p>
    </div>
  </div>
}
