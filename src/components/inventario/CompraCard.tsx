import { Bookmark, Camera, ChevronDown, ExternalLink, Eye, EyeOff, Link2, PackageCheck, Pencil, Printer, Send, Tag, Trash2, Truck, Wallet, X, Zap } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Inversion } from '../../types/domain'
import { resolverImagenCatalogo } from '../../utils/catalogoImagen'
import { ETAPAS_COMPRA, etapaDeCompra, nombreEtapa, type EtapaCompra } from '../../utils/compraEtapa'
import { ProductoImg } from '../ui/ProductoImg'
import { abrirPostInstagramPorCodigo } from '../../utils/instagramPost'

// Tarjeta de una compra libre (Compras libres). Ordenada en bloques: cabecera (foto, código,
// estado, nombre) → números (costo / venta / ganancia) → etiquetas de estado → acciones
// principales (Vender / Apartar) → barra de herramientas con íconos y nombre.

const ESTADO_LABEL: Record<Inversion['estado'], string> = { en_transito: 'En camino', en_inventario: 'Disponible', reservado: 'Apartado', vendido: 'Vendido', descartado: 'Descartado' }
// Lo que viene en camino se ve por etapas, como un pedido (En preparación, Control de calidad…).
export type EstadoCompra = Inversion['estado'] | EtapaCompra
const etiquetaEstado = (item: Pick<Inversion, 'estado' | 'tracking' | 'etapa'>) => { const e = etapaDeCompra(item); return e ? nombreEtapa(e) : ESTADO_LABEL[item.estado] }
const ESTADO_TONO: Record<Inversion['estado'], string> = {
  en_transito: 'border-amber-300/35 bg-amber-300/10 text-amber-200',
  en_inventario: 'border-accent/35 bg-accent/10 text-accent',
  reservado: 'border-sky-400/35 bg-sky-400/10 text-sky-300',
  vendido: 'border-green-400/35 bg-green-400/10 text-green-300',
  descartado: 'border-white/15 bg-white/[.04] text-muted',
}

type Props = {
  item: Inversion
  // Dentro de la ficha "Ver detalles" (modal): sin marco propio y foto más grande.
  enModal?: boolean
  costo: number
  /** Lo que falta pagarle al proveedor (descuenta adelantos). */
  pendiente?: number
  gastosAsociados: number
  enEI: boolean
  enCaminoPublicado: boolean
  fotos: number
  quitandoEI: boolean
  imprimiendo: boolean
  onEstado: (estado: EstadoCompra) => void
  onVer: () => void
  onEditar: () => void
  onEliminar: () => void
  onPagar: () => void
  onFotos: () => void
  onEntregaInmediata: () => void
  onQuitarEI: () => void
  onVender: () => void
  onApartar: () => void
  onVerPedido: () => void
  onImprimir: () => void
  // Imagen "está disponible, esperando ser apartado" para mandar al cliente (sin costo ni ganancia).
  onFicha?: () => void
  // Link de pago del checkout (compra inmediata, ya en Nicaragua).
  onLinkPago?: () => void
  // Mostrar u ocultar la compra en la tienda (sin cambiar su estado).
  onMostrarTienda?: (mostrar: boolean) => void
}

const usd = (n: number) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function Chip({ tono, children, onQuitar, tituloQuitar }: { tono: string; children: ReactNode; onQuitar?: () => void; tituloQuitar?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${tono}`}>
    {children}
    {onQuitar && <button className="-mr-1 grid size-4 place-items-center rounded-full hover:bg-white/15" onClick={onQuitar} title={tituloQuitar} aria-label={tituloQuitar}><X size={11} /></button>}
  </span>
}

// Ficha "Detalles de la compra" (estilo página de producto de una tienda grande): a la izquierda
// la información (producto, etapa, dinero, tienda, envío, notas) y a la derecha las acciones.
function Seccion({ titulo, extra, children, oculta }: { titulo?: string; extra?: ReactNode; children: ReactNode; oculta?: boolean }) {
  return <section className={`rounded-xl border border-line bg-white/[.02] p-4 ${oculta ? 'hidden lg:block' : ''}`}>
    {titulo && <div className="mb-3 flex items-center justify-between gap-2"><h3 className="text-[13px] font-semibold">{titulo}</h3>{extra}</div>}
    {children}
  </section>
}
function Fila({ label, valor, fuerte, tono }: { label: ReactNode; valor: string; fuerte?: boolean; tono?: string }) {
  return <div className={`flex items-baseline justify-between gap-3 py-1 text-[13px] ${fuerte ? 'font-semibold' : ''}`}><span className={fuerte ? '' : 'text-muted'}>{label}</span><span className={`tabular-nums ${tono ?? ''}`}>{valor}</span></div>
}
function Accion({ icon, label, detalle, onClick, peligro, disabled, activo }: { icon: ReactNode; label: string; detalle?: string; onClick: () => void; peligro?: boolean; disabled?: boolean; activo?: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled} className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[13px] transition disabled:opacity-40 ${peligro ? 'text-red-300 hover:bg-red-400/10' : 'hover:bg-white/[.05]'}`}>
    <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${peligro ? 'bg-red-400/10' : activo ? 'bg-accent/15 text-accent' : 'bg-white/[.05] text-muted'}`}>{icon}</span>
    <span className="min-w-0 flex-1"><span className="block font-medium">{label}</span>{detalle && <span className="block truncate text-[11px] text-muted">{detalle}</span>}</span>
  </button>
}

// Recorrido de una compra que viene en camino, hasta que ya está disponible en Nicaragua.
const PASOS: [string, string][] = [...ETAPAS_COMPRA.map(([v, l]) => [v, l.replace('En tránsito internacional', 'Tránsito').replace('En tránsito a Nicaragua', 'A Nicaragua').replace('Recibido en Miami', 'Miami').replace('Control de calidad', 'Calidad').replace('En preparación', 'Preparación')] as [string, string]), ['en_inventario', 'Disponible']]

export function CompraCard(p: Props) {
  const { item } = p
  const unidades = Number(item.cantidad) || 1
  const venta = Number(item.precio_venta_estimado) * unidades
  const ganancia = venta - p.costo
  const margen = venta > 0 ? Math.round((ganancia / venta) * 100) : 0
  const cerrado = item.estado === 'vendido' || item.estado === 'descartado'
  const porPagar = item.pagado === false && item.estado !== 'descartado'
  const codigo = (item.codigo ?? '').trim()
  const img = item.imagen ? resolverImagenCatalogo(item.imagen) : ''
  const costoProducto = Number(item.costo_unitario) * unidades
  const otros = Number(item.gastos_adicionales) || 0
  const pendiente = p.pendiente ?? (porPagar ? p.costo : 0)
  const paso = item.estado === 'en_inventario' ? 'en_inventario' : etapaDeCompra(item)
  const iPaso = PASOS.findIndex(([v]) => v === paso)
  const botones = <div className="space-y-2">
    {!cerrado && item.estado !== 'en_transito' && <button className="primary-button w-full" onClick={p.onVender}><Tag size={15} /> Vender ahora</button>}
    {!cerrado && item.estado !== 'en_inventario' && <button className={`${item.estado === 'en_transito' ? 'primary-button' : 'subtle-button'} w-full`} onClick={p.onApartar}><Bookmark size={15} /> Apartar a un cliente (50%)</button>}
    {item.estado === 'en_inventario' && p.onLinkPago && <button className="subtle-button w-full" onClick={p.onLinkPago}><Link2 size={14} /> {(item.notas ?? '').includes('[LINK_PAGO]') ? 'Link de pago · ya enviado' : 'Enviar link de pago'}</button>}
    {(item.estado === 'en_transito' || item.estado === 'en_inventario') && p.onFicha && <button className="subtle-button w-full" onClick={p.onFicha}><Send size={14} /> Ficha para el cliente</button>}
    {item.estado === 'vendido' && (item.pedido_id
      ? <button className="primary-button w-full" onClick={p.onVerPedido}><ExternalLink size={14} /> Ver pedido {item.pedidos?.codigo ?? ''}</button>
      : <p className="rounded-lg bg-green-400/10 px-3 py-2 text-center text-[13px] font-semibold text-green-300">Vendida</p>)}
    {item.estado === 'vendido' && <button className="subtle-button w-full" onClick={p.onImprimir} disabled={p.imprimiendo}><Printer size={14} /> {p.imprimiendo ? 'Generando…' : 'Imprimir recibo'}</button>}
    {item.estado === 'reservado' && item.pedido_id && <button className="subtle-button w-full" onClick={p.onVerPedido}><ExternalLink size={14} /> Ver pedido {item.pedidos?.codigo ?? ''}</button>}
  </div>
  const notas = (item.notas ?? '').replace(/\[[A-Z_]+(?::[\w-]+)?\]\s*/g, '').trim()

  return <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_270px]">
    <div className="min-w-0 space-y-4">
      {/* Producto */}
      <Seccion>
        <div className="flex gap-4">
          <button className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-white sm:size-28" onClick={p.onVer} aria-label={`Ver ${item.producto}`}>
            {img ? <ProductoImg src={img} alt={item.producto} className="size-full" /> : <PackageCheck size={22} className="text-black/40" />}
          </button>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[11px] font-semibold tracking-wider text-muted">{codigo || 'SIN CÓDIGO'}</p>
            <h3 className="mt-0.5 text-[17px] font-semibold leading-snug">{item.producto}</h3>
            <p className="mt-1 text-[13px] text-muted">{[item.marca, item.talla_color && `Talla ${item.talla_color}`, `${unidades} ${unidades === 1 ? 'unidad' : 'unidades'}`].filter(Boolean).join(' · ')}</p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${ESTADO_TONO[item.estado]}`}>{etiquetaEstado(item)}</span>
              {porPagar && <Chip tono="border-amber-300/35 bg-amber-300/10 text-amber-200"><Wallet size={11} /> Por pagar</Chip>}
              {p.enEI && <Chip tono="border-accent/35 bg-accent/10 text-accent" onQuitar={p.quitandoEI ? undefined : p.onQuitarEI} tituloQuitar="Quitar de Entrega inmediata"><Zap size={11} /> {p.quitandoEI ? 'Quitando…' : 'Entrega inmediata'}</Chip>}
              {p.fotos > 0 && <Chip tono="border-sky-400/35 bg-sky-400/10 text-sky-300"><Camera size={11} /> {p.fotos} {p.fotos === 1 ? 'foto' : 'fotos'}</Chip>}
            </div>
          </div>
        </div>
      </Seccion>

      {/* En el celular las acciones van aquí arriba, sin tener que bajar. */}
      <div className="lg:hidden">{botones}</div>

      {/* Etapa: barra de progreso + cambiar estado */}
      <Seccion titulo="Estado" extra={<label className="relative inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium hover:bg-white/[.04]">
        Cambiar<ChevronDown size={13} />
        <select aria-label="Cambiar estado" value={etapaDeCompra(item) ?? item.estado} onChange={(e) => p.onEstado(e.target.value as EstadoCompra)} className="absolute inset-0 cursor-pointer opacity-0" style={{ fontSize: 16 }}>
          {ETAPAS_COMPRA.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          {Object.entries(ESTADO_LABEL).filter(([v]) => v !== 'en_transito').map(([v, l]) => <option key={v} value={v}>{v === 'en_inventario' ? 'Disponible (ya en Nicaragua)' : l}</option>)}
        </select>
      </label>}>
        {iPaso >= 0 ? <div className="flex items-start">
          {PASOS.map(([v, l], i) => <div key={v} className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center">
            <div className="flex w-full items-center">
              <span className={`h-0.5 flex-1 ${i === 0 ? 'opacity-0' : i <= iPaso ? 'bg-accent' : 'bg-line'}`} />
              <span className={`grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${i < iPaso ? 'bg-accent text-app' : i === iPaso ? 'bg-accent text-app ring-4 ring-accent/20' : 'border border-line bg-panel text-muted'}`}>{i < iPaso ? '✓' : i + 1}</span>
              <span className={`h-0.5 flex-1 ${i === PASOS.length - 1 ? 'opacity-0' : i < iPaso ? 'bg-accent' : 'bg-line'}`} />
            </div>
            <span className={`text-[10.5px] leading-3 ${i === iPaso ? 'font-semibold' : 'text-muted'}`}>{l}</span>
          </div>)}
        </div> : <p className="text-[13px] text-muted">{item.estado === 'reservado' ? 'Apartada para un cliente.' : item.estado === 'vendido' ? `Vendida${item.pedidos?.codigo ? ` · pedido ${item.pedidos.codigo}` : ''}.` : 'Descartada.'}</p>}
        {item.llega_aprox && item.estado === 'en_transito' && <p className="mt-3 text-[12px] text-muted">Llega aprox. el <b className="text-white">{new Date(item.llega_aprox + 'T12:00:00').toLocaleDateString('es-NI', { day: 'numeric', month: 'long' })}</b></p>}
      </Seccion>

      {/* Dinero */}
      <Seccion titulo="Dinero">
        <Fila label="Costo del producto" valor={usd(costoProducto)} />
        {otros > 0.004 && <Fila label="Comisión y otros gastos" valor={usd(otros)} />}
        {p.gastosAsociados > 0.004 && <Fila label="Envío a Nicaragua" valor={usd(p.gastosAsociados)} />}
        <div className="my-1.5 border-t border-line" />
        <Fila label="Costo total" valor={usd(p.costo)} fuerte />
        <Fila label="Precio de venta" valor={usd(venta)} />
        <Fila label={<>Ganancia <span className="text-[11px] font-normal text-muted">({margen}%)</span></>} valor={usd(ganancia)} fuerte tono={ganancia >= 0 ? 'text-green-300' : 'text-red-300'} />
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[.06]"><div className={`h-full rounded-full ${ganancia >= 0 ? 'bg-green-400' : 'bg-red-400'}`} style={{ width: `${Math.max(3, Math.min(100, Math.abs(margen)))}%` }} /></div>
        <div className={`mt-4 flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-[13px] ${porPagar ? 'bg-amber-300/10' : 'bg-green-400/10'}`}>
          <span className={porPagar ? 'text-amber-200' : 'text-green-300'}><Wallet size={14} className="mr-1.5 inline -translate-y-px" />{porPagar ? <>Falta pagarle <b>{usd(pendiente)}</b> al proveedor</> : 'Pagado al proveedor'}</span>
          {porPagar && <button type="button" className="subtle-button shrink-0" onClick={p.onPagar}>Pagar</button>}
        </div>
      </Seccion>

      {/* En la tienda */}
      {(item.estado === 'en_transito' || item.estado === 'en_inventario' || p.enEI) && <Seccion titulo="En la tienda">
        {item.estado === 'en_transito' && p.onMostrarTienda && (() => {
          const visible = item.mostrar_tienda !== false
          return <button type="button" role="switch" aria-checked={visible} disabled={!codigo} onClick={() => p.onMostrarTienda?.(!visible)} className="flex w-full items-center gap-3 rounded-lg py-1 text-left disabled:opacity-60">
            <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium">{visible ? 'Se muestra en la tienda' : 'No se muestra en la tienda'}</span>
              <span className="block text-[11.5px] text-muted">{!codigo ? 'Sin código: no puede salir en la tienda' : !visible ? 'Solo la ves vos en el panel.' : p.enCaminoPublicado ? 'Sale como “Llega pronto · Apártelo ya”' : 'Publicándose en la tienda…'}</span></span>
            <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${visible ? 'bg-accent' : 'bg-white/15'}`}><span className="absolute top-0.5 size-5 rounded-full shadow transition-all" style={{ left: visible ? 22 : 2, background: '#fff' }} /></span>
          </button>
        })()}
        <div className={`flex items-center justify-between gap-3 ${item.estado === 'en_transito' ? 'mt-3 border-t border-line pt-3' : ''}`}>
          <span className="min-w-0"><span className="block text-[13px] font-medium">Entrega inmediata</span><span className="block text-[11.5px] text-muted">{p.enEI ? 'Sale en la sección de entrega inmediata' : item.estado === 'en_inventario' ? 'Todavía no está en esa sección' : 'Disponible cuando llegue a Nicaragua'}</span></span>
          <button type="button" className="subtle-button shrink-0" onClick={p.onEntregaInmediata} disabled={item.estado !== 'en_inventario' && !p.enEI}>{p.enEI ? 'Tallas' : 'Poner'}</button>
        </div>
        {item.estado === 'en_transito' && p.enCaminoPublicado && <button type="button" className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-semibold text-accent hover:underline" onClick={() => void abrirPostInstagramPorCodigo(codigo, 'encamino')}><Camera size={13} /> Crear post e historia “Llega pronto”</button>}
      </Seccion>}

      {item.tracking && <Seccion titulo="Envío">
        <div className="flex items-center justify-between gap-2 text-[13px]">
          <span className="min-w-0 truncate"><span className="text-muted">{item.transportista || 'Tracking'}:</span> <span className="font-mono">{item.tracking}</span></span>
          {item.url_tracking && <a className="text-accent" href={item.url_tracking} target="_blank" rel="noreferrer" aria-label="Abrir enlace de la paquetería"><Link2 size={15} /></a>}
        </div>
        {item.estado_tracking && <p className="mt-1 text-[12px] text-muted">Estado: <span className="text-white">{item.estado_tracking === 'Registrado' ? 'Registrándose en 17TRACK…' : item.estado_tracking}</span></p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <a className="subtle-button" href={`https://t.17track.net/es#nums=${encodeURIComponent(item.tracking)}`} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> Ver estado</a>
          <Link className="subtle-button" to={`/logistica?q=${encodeURIComponent(item.tracking)}`}><Truck size={13} /> Ver en Logística</Link>
        </div>
      </Seccion>}

      {notas && <Seccion titulo="Notas"><p className="whitespace-pre-line text-[13px] leading-5 text-muted">{notas}</p></Seccion>}
    </div>

    {/* Columna de acciones */}
    <aside className="space-y-4">
      <Seccion titulo="Acciones" oculta>
        {botones}
      </Seccion>
      <Seccion titulo="Más">
        <div className="-mx-1.5 space-y-0.5">
          <Accion icon={<Camera size={15} />} label="Fotos de calidad" detalle={p.fotos ? `${p.fotos} ${p.fotos === 1 ? 'foto' : 'fotos'}` : 'Sin fotos todavía'} activo={p.fotos > 0} onClick={p.onFotos} disabled={item.estado === 'descartado'} />
          <Accion icon={<Eye size={15} />} label="Vista para el cliente" onClick={p.onVer} />
          <Accion icon={<Pencil size={15} />} label="Editar compra" onClick={p.onEditar} />
          <Accion icon={<Trash2 size={15} />} label="Eliminar" peligro onClick={p.onEliminar} />
        </div>
      </Seccion>
    </aside>
  </div>
}

// Barra horizontal de la lista (como un pedido): foto, código y nombre, estado, etiquetas,
// números y "Ver detalles" (abre la ficha completa con todas las acciones).
// `seleccionado`/`onSeleccionar`: casilla para elegir varias (pagar juntas, repartir envío).
// `lote`: cuántas compras se registraron juntas (compra en conjunto); tocarlo elige todo el lote.
export function CompraFila({ item, costo, enEI, enCaminoPublicado, fotos, onDetalles, seleccionado, onSeleccionar, lote, onLote }: { item: Inversion; costo: number; enEI: boolean; enCaminoPublicado: boolean; fotos: number; onDetalles: () => void; seleccionado?: boolean; onSeleccionar?: () => void; lote?: number; onLote?: () => void }) {
  const unidades = Number(item.cantidad) || 1
  const venta = Number(item.precio_venta_estimado) * unidades
  const ganancia = venta - costo
  const cerrado = item.estado === 'vendido' || item.estado === 'descartado'
  const porPagar = item.pagado === false && item.estado !== 'descartado'
  const img = item.imagen ? resolverImagenCatalogo(item.imagen) : ''
  return <article onClick={onDetalles} className={`group grid ${seleccionado ? 'border-accent/60! bg-accent/[.04]!' : ''} min-w-0 cursor-pointer grid-cols-[56px_1fr_auto] items-center gap-3 rounded-2xl border border-line bg-panel p-3 transition hover:border-white/20 hover:bg-white/[.025] md:grid-cols-[56px_minmax(0,2.2fr)_130px_minmax(0,1.4fr)_minmax(0,1.6fr)_auto] md:gap-4 ${cerrado ? 'opacity-60' : ''}`}>
    <span className="relative grid size-14 place-items-center rounded-xl bg-white"><span className="grid size-full place-items-center overflow-hidden rounded-xl">{img ? <ProductoImg src={img} className="size-full" /> : <PackageCheck size={18} className="text-black/40" />}</span>{onSeleccionar && <button type="button" role="checkbox" aria-checked={!!seleccionado} aria-label="Seleccionar compra" onClick={(e) => { e.stopPropagation(); onSeleccionar() }} className={`absolute -left-1.5 -top-1.5 grid size-6 place-items-center rounded-md border-2 text-[12px] font-black shadow transition ${seleccionado ? 'border-accent bg-accent text-app' : 'border-white/40 bg-app/90 text-transparent opacity-80 hover:opacity-100 group-hover:border-white/70'}`}>✓</button>}</span>
    <div className="min-w-0">
      <p className="truncate font-mono text-[10.5px] font-semibold tracking-wider text-accent">{(item.codigo ?? '').trim() || 'SIN CÓDIGO'}</p>
      <p className="truncate text-sm font-semibold">{item.producto}</p>
      <p className="truncate text-[11px] text-muted">{[item.marca, item.talla_color && `Talla ${item.talla_color}`, `${unidades} ud`].filter(Boolean).join(' · ')}</p>
      {/* En teléfono: estado y venta debajo del nombre */}
      <div className="mt-1 flex items-center gap-1.5 md:hidden"><span className={`rounded-full border px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider ${ESTADO_TONO[item.estado]}`}>{etiquetaEstado(item)}</span><span className="font-mono text-[11px] text-accent">{usd(venta)}</span></div>
    </div>
    <span className={`hidden justify-self-start rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider md:inline-block ${ESTADO_TONO[item.estado]}`}>{etiquetaEstado(item)}</span>
    <div className="hidden flex-wrap gap-1 md:flex">
      {porPagar && <span title="Por pagar al proveedor" className="grid size-7 place-items-center rounded-lg border border-amber-300/35 bg-amber-300/10 text-amber-200"><Wallet size={13} /></span>}
      {enEI && <span title="En Entrega inmediata" className="grid size-7 place-items-center rounded-lg border border-accent/35 bg-accent/10 text-accent"><Zap size={13} /></span>}
      {item.estado === 'en_transito' && item.mostrar_tienda === false && <span title="No sale en la tienda" className="grid size-7 place-items-center rounded-lg border border-line bg-white/[.03] text-muted"><EyeOff size={13} /></span>}
      {item.estado === 'en_transito' && item.mostrar_tienda !== false && enCaminoPublicado && <span title="En la tienda como Llega pronto" className="grid size-7 place-items-center rounded-lg border border-amber-300/35 bg-amber-300/10 text-amber-200"><Truck size={13} /></span>}
      {lote != null && lote > 1 && <button type="button" title="Compra en conjunto: tocá para elegir todo el lote" onClick={(e) => { e.stopPropagation(); onLote?.() }} className="inline-flex h-7 items-center gap-1 rounded-lg border border-violet-400/35 bg-violet-400/10 px-1.5 text-[10.5px] font-semibold text-violet-200 hover:bg-violet-400/20">Lote · {lote}</button>}{fotos > 0 && <span title={`${fotos} fotos de calidad`} className="inline-flex h-7 items-center gap-1 rounded-lg border border-sky-400/35 bg-sky-400/10 px-1.5 text-[10.5px] font-semibold text-sky-300"><Camera size={13} />{fotos}</span>}
    </div>
    <div className="hidden grid-cols-3 gap-2 text-right md:grid">
      <div><p className="text-[9px] uppercase tracking-wider text-muted">Costo</p><p className="font-mono text-[12px]">{usd(costo)}</p></div>
      <div><p className="text-[9px] uppercase tracking-wider text-muted">Venta</p><p className="font-mono text-[12px] text-accent">{usd(venta)}</p></div>
      <div><p className="text-[9px] uppercase tracking-wider text-muted">Ganancia</p><p className={`font-mono text-[12px] ${ganancia >= 0 ? 'text-green-300' : 'text-red-300'}`}>{usd(ganancia)}</p></div>
    </div>
    <button className="subtle-button shrink-0 px-3 py-2 text-[11px] group-hover:border-white/25 group-hover:text-white" onClick={(e) => { e.stopPropagation(); onDetalles() }}><Eye size={14} /> <span className="hidden sm:inline">Ver detalles</span></button>
  </article>
}
