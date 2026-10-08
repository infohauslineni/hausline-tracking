import { Bookmark, Camera, ChevronDown, ExternalLink, Eye, Link2, PackageCheck, Pencil, Printer, Send, Tag, Trash2, Truck, Wallet, X, Zap } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Inversion } from '../../types/domain'
import { resolverImagenCatalogo } from '../../utils/catalogoImagen'
import { ProductoImg } from '../ui/ProductoImg'

// Tarjeta de una compra libre (Compras libres). Ordenada en bloques: cabecera (foto, código,
// estado, nombre) → números (costo / venta / ganancia) → etiquetas de estado → acciones
// principales (Vender / Apartar) → barra de herramientas con íconos y nombre.

const ESTADO_LABEL: Record<Inversion['estado'], string> = { en_transito: 'En camino', en_inventario: 'Disponible', reservado: 'Apartado', vendido: 'Vendido', descartado: 'Descartado' }
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
  gastosAsociados: number
  enEI: boolean
  enCaminoPublicado: boolean
  fotos: number
  quitandoEI: boolean
  imprimiendo: boolean
  onEstado: (estado: Inversion['estado']) => void
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
}

const usd = (n: number) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function Chip({ tono, children, onQuitar, tituloQuitar }: { tono: string; children: ReactNode; onQuitar?: () => void; tituloQuitar?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${tono}`}>
    {children}
    {onQuitar && <button className="-mr-1 grid size-4 place-items-center rounded-full hover:bg-white/15" onClick={onQuitar} title={tituloQuitar} aria-label={tituloQuitar}><X size={11} /></button>}
  </span>
}

function Herramienta({ icon, label, onClick, activo, peligro, disabled }: { icon: ReactNode; label: string; onClick: () => void; activo?: boolean; peligro?: boolean; disabled?: boolean }) {
  return <button disabled={disabled} onClick={onClick} title={label} style={{ fontSize: 11 }}
    className={`flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10px] font-medium transition disabled:opacity-40 ${peligro ? 'text-muted hover:bg-red-400/10 hover:text-red-300' : activo ? 'text-accent hover:bg-accent/10' : 'text-muted hover:bg-white/[.05] hover:text-white'}`}>
    {icon}<span className="leading-none">{label}</span>
  </button>
}

export function CompraCard(p: Props) {
  const { item } = p
  const unidades = Number(item.cantidad) || 1
  const venta = Number(item.precio_venta_estimado) * unidades
  const ganancia = venta - p.costo
  const margen = venta > 0 ? Math.round((ganancia / venta) * 100) : 0
  const cerrado = item.estado === 'vendido' || item.estado === 'descartado'
  const activo = !cerrado
  const porPagar = item.pagado === false && item.estado !== 'descartado'
  const codigo = (item.codigo ?? '').trim()
  const img = item.imagen ? resolverImagenCatalogo(item.imagen) : ''

  return <article className={`flex flex-col ${p.enModal ? '-mx-4 -mt-2' : `rounded-2xl border border-line bg-panel transition hover:border-white/15 ${cerrado ? 'opacity-70' : ''}`}`}>
    {/* Cabecera */}
    <div className="flex gap-3.5 p-4 pb-3">
      <button className={`grid ${p.enModal ? 'size-28' : 'size-[76px]'} shrink-0 place-items-center overflow-hidden rounded-xl bg-white`} onClick={p.onVer} aria-label={`Ver ${item.producto}`}>
        {img ? <ProductoImg src={img} alt={item.producto} className="size-full" /> : <PackageCheck size={22} className="text-black/40" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-mono text-[11px] font-semibold tracking-wider text-accent">{codigo || 'SIN CÓDIGO'}</span>
          {/* Se ve la etiqueta de color; el <select> real va invisible encima (con 16px para que
              el iPhone no haga zoom al tocarlo). */}
          <label className={`relative inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full border py-0.5 pl-2.5 pr-2 text-[10.5px] font-bold uppercase tracking-wider ${ESTADO_TONO[item.estado]}`}>
            {ESTADO_LABEL[item.estado]}<ChevronDown size={11} />
            <select aria-label="Cambiar estado" value={item.estado} onChange={(e) => p.onEstado(e.target.value as Inversion['estado'])}
              className="absolute inset-0 cursor-pointer opacity-0" style={{ fontSize: 16 }}>
              {Object.entries(ESTADO_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </div>
        <strong className="mt-1 line-clamp-2 block text-[15px] leading-snug">{item.producto}</strong>
        <p className="mt-0.5 truncate text-[11.5px] text-muted">{[item.marca, item.talla_color && `Talla ${item.talla_color}`, `${unidades} ${unidades === 1 ? 'unidad' : 'unidades'}`].filter(Boolean).join(' · ')}</p>
      </div>
    </div>

    {/* Números */}
    <div className="mx-4 grid grid-cols-3 divide-x divide-line rounded-xl border border-line bg-white/[.02] text-center">
      <div className="px-2 py-2.5"><p className="text-[9.5px] uppercase tracking-wider text-muted">Costo</p><p className="mt-0.5 font-mono text-[13px] font-semibold">{usd(p.costo)}</p></div>
      <div className="px-2 py-2.5"><p className="text-[9.5px] uppercase tracking-wider text-muted">Venta</p><p className="mt-0.5 font-mono text-[13px] font-semibold text-accent">{usd(venta)}</p></div>
      <div className="px-2 py-2.5"><p className="text-[9.5px] uppercase tracking-wider text-muted">Ganancia</p><p className={`mt-0.5 font-mono text-[13px] font-semibold ${ganancia >= 0 ? 'text-green-300' : 'text-red-300'}`}>{usd(ganancia)}{venta > 0 && <span className="ml-1 text-[10px] font-normal text-muted">{margen}%</span>}</p></div>
    </div>
    {p.gastosAsociados > 0 && <p className="mx-4 mt-1.5 text-[10.5px] text-muted">Incluye {usd(p.gastosAsociados)} de envío u otros gastos.</p>}

    {/* Etiquetas */}
    {(p.enEI || p.fotos > 0 || item.estado === 'en_transito' || porPagar) && <div className="mx-4 mt-3 flex flex-wrap gap-1.5">
      {porPagar && <Chip tono="border-amber-300/35 bg-amber-300/10 text-amber-200"><Wallet size={11} /> Por pagar al proveedor</Chip>}
      {p.enEI && <Chip tono="border-accent/35 bg-accent/10 text-accent" onQuitar={p.quitandoEI ? undefined : p.onQuitarEI} tituloQuitar="Quitar de Entrega inmediata"><Zap size={11} /> {p.quitandoEI ? 'Quitando…' : 'En Entrega inmediata'}</Chip>}
      {item.estado === 'en_transito' && (p.enCaminoPublicado
        ? <Chip tono="border-amber-300/35 bg-amber-300/10 text-amber-200"><Truck size={11} /> En la tienda · Apártelo ya{item.llega_aprox ? ` · llega aprox. ${item.llega_aprox.split('-').reverse().slice(0, 2).join('/')}` : ''}</Chip>
        : <Chip tono="border-line bg-white/[.03] text-muted"><Truck size={11} /> {codigo ? 'Publicándose en la tienda…' : 'Sin código: no sale en la tienda'}</Chip>)}
      {p.fotos > 0 && <Chip tono="border-sky-400/35 bg-sky-400/10 text-sky-300"><Camera size={11} /> {p.fotos} {p.fotos === 1 ? 'foto' : 'fotos'} de calidad</Chip>}
    </div>}

    {item.tracking && <div className="mx-4 mt-3 flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-[11px]">
      <span className="min-w-0 truncate"><b>{item.transportista || 'Tracking'}:</b> <span className="font-mono">{item.tracking}</span></span>
      {item.url_tracking && <a className="text-accent" href={item.url_tracking} target="_blank" rel="noreferrer" aria-label="Abrir tracking"><Link2 size={14} /></a>}
    </div>}
    {item.notas && <p className="mx-4 mt-3 line-clamp-2 border-l-2 border-accent/40 pl-2.5 text-[11px] leading-4 text-muted">{item.notas}</p>}

    <div className="mt-auto" />

    {/* Acciones principales */}
    <div className="px-4 pt-4">
      {porPagar && <button className="mb-2 flex w-full items-center justify-center gap-2 rounded-xl border border-amber-300/30 bg-amber-300/[.07] py-2.5 text-xs font-semibold text-amber-200 transition hover:bg-amber-300/[.13]" onClick={p.onPagar}><Wallet size={15} /> Registrar pago al proveedor · {usd(p.costo)}</button>}
      {activo && <div className={`grid gap-2 ${item.estado === 'en_transito' || item.estado === 'en_inventario' ? 'grid-cols-1' : 'grid-cols-2'}`}>
        {item.estado !== 'en_transito' && <button className="primary-button justify-center py-2.5" style={{ fontSize: 13 }} onClick={p.onVender}><Tag size={15} /> Vender ahora</button>}
        {item.estado !== 'en_inventario' && <button className={`${item.estado === 'en_transito' ? 'primary-button' : 'subtle-button'} justify-center py-2.5`} style={{ fontSize: 13 }} onClick={p.onApartar}><Bookmark size={15} /> Apartar (50%)</button>}
      </div>}
      {(item.estado === 'en_transito' || item.estado === 'en_inventario') && p.onFicha && <button className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-line py-2.5 text-xs font-semibold text-white/85 transition hover:border-white/20 hover:bg-white/[.04]" onClick={p.onFicha}><Send size={14} /> Ficha para el cliente</button>}
      {item.estado === 'en_inventario' && p.onLinkPago && <button className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-accent/30 bg-accent/[.06] py-2.5 text-xs font-semibold text-accent transition hover:bg-accent/[.12]" onClick={p.onLinkPago}><Link2 size={14} /> Enviar link de pago{(item.notas ?? '').includes('[LINK_PAGO]') ? ' · ya enviado' : ''}</button>}
      {item.estado === 'vendido' && <div className="grid grid-cols-2 gap-2">
        {item.pedido_id
          ? <button className="flex items-center justify-center gap-1.5 rounded-xl border border-green-400/25 bg-green-400/[.07] py-2.5 text-xs font-semibold text-green-300 hover:bg-green-400/[.12]" onClick={p.onVerPedido}><ExternalLink size={14} /> Pedido {item.pedidos?.codigo ?? ''}</button>
          : <span className="flex items-center justify-center rounded-xl border border-green-400/25 bg-green-400/[.07] py-2.5 text-xs font-semibold text-green-300">Vendido</span>}
        <button className="subtle-button justify-center py-2.5 text-xs" onClick={p.onImprimir} disabled={p.imprimiendo}><Printer size={15} /> {p.imprimiendo ? 'Generando…' : 'Recibo'}</button>
      </div>}
    </div>

    {/* Herramientas */}
    <div className="mt-3 grid grid-cols-5 border-t border-line px-2 py-1">
      <Herramienta icon={<Camera size={17} />} label="Calidad" activo={p.fotos > 0} onClick={p.onFotos} disabled={item.estado === 'descartado'} />
      <Herramienta icon={<Zap size={17} />} label={p.enEI ? 'Tallas EI' : 'Inmediata'} activo={p.enEI} onClick={p.onEntregaInmediata} disabled={item.estado !== 'en_inventario' && !p.enEI} />
      <Herramienta icon={<Eye size={17} />} label="Ver" onClick={p.onVer} />
      <Herramienta icon={<Pencil size={17} />} label="Editar" onClick={p.onEditar} />
      <Herramienta icon={<Trash2 size={17} />} label="Eliminar" peligro onClick={p.onEliminar} />
    </div>

    {item.estado === 'en_transito' && p.enCaminoPublicado && <a className="mx-4 mb-3 -mt-1 text-center text-[11px] font-semibold text-amber-200/90 hover:underline" href={`https://hauslineshopni.es/admin.html?ig=${encodeURIComponent(codigo)}&modo=encamino`} target="_blank" rel="noopener noreferrer">📸 Crear post e historia "En camino"</a>}
  </article>
}

// Barra horizontal de la lista (como un pedido): foto, código y nombre, estado, etiquetas,
// números y "Ver detalles" (abre la ficha completa con todas las acciones).
export function CompraFila({ item, costo, enEI, enCaminoPublicado, fotos, onDetalles }: { item: Inversion; costo: number; enEI: boolean; enCaminoPublicado: boolean; fotos: number; onDetalles: () => void }) {
  const unidades = Number(item.cantidad) || 1
  const venta = Number(item.precio_venta_estimado) * unidades
  const ganancia = venta - costo
  const cerrado = item.estado === 'vendido' || item.estado === 'descartado'
  const porPagar = item.pagado === false && item.estado !== 'descartado'
  const img = item.imagen ? resolverImagenCatalogo(item.imagen) : ''
  return <article onClick={onDetalles} className={`group grid min-w-0 cursor-pointer grid-cols-[56px_1fr_auto] items-center gap-3 rounded-2xl border border-line bg-panel p-3 transition hover:border-white/20 hover:bg-white/[.025] md:grid-cols-[56px_minmax(0,2.2fr)_130px_minmax(0,1.4fr)_minmax(0,1.6fr)_auto] md:gap-4 ${cerrado ? 'opacity-60' : ''}`}>
    <span className="grid size-14 place-items-center overflow-hidden rounded-xl bg-white">{img ? <ProductoImg src={img} className="size-full" /> : <PackageCheck size={18} className="text-black/40" />}</span>
    <div className="min-w-0">
      <p className="truncate font-mono text-[10.5px] font-semibold tracking-wider text-accent">{(item.codigo ?? '').trim() || 'SIN CÓDIGO'}</p>
      <p className="truncate text-sm font-semibold">{item.producto}</p>
      <p className="truncate text-[11px] text-muted">{[item.marca, item.talla_color && `Talla ${item.talla_color}`, `${unidades} ud`].filter(Boolean).join(' · ')}</p>
      {/* En teléfono: estado y venta debajo del nombre */}
      <div className="mt-1 flex items-center gap-1.5 md:hidden"><span className={`rounded-full border px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider ${ESTADO_TONO[item.estado]}`}>{ESTADO_LABEL[item.estado]}</span><span className="font-mono text-[11px] text-accent">{usd(venta)}</span></div>
    </div>
    <span className={`hidden justify-self-start rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider md:inline-block ${ESTADO_TONO[item.estado]}`}>{ESTADO_LABEL[item.estado]}</span>
    <div className="hidden flex-wrap gap-1 md:flex">
      {porPagar && <span title="Por pagar al proveedor" className="grid size-7 place-items-center rounded-lg border border-amber-300/35 bg-amber-300/10 text-amber-200"><Wallet size={13} /></span>}
      {enEI && <span title="En Entrega inmediata" className="grid size-7 place-items-center rounded-lg border border-accent/35 bg-accent/10 text-accent"><Zap size={13} /></span>}
      {item.estado === 'en_transito' && enCaminoPublicado && <span title="En la tienda como En camino" className="grid size-7 place-items-center rounded-lg border border-amber-300/35 bg-amber-300/10 text-amber-200"><Truck size={13} /></span>}
      {fotos > 0 && <span title={`${fotos} fotos de calidad`} className="inline-flex h-7 items-center gap-1 rounded-lg border border-sky-400/35 bg-sky-400/10 px-1.5 text-[10.5px] font-semibold text-sky-300"><Camera size={13} />{fotos}</span>}
    </div>
    <div className="hidden grid-cols-3 gap-2 text-right md:grid">
      <div><p className="text-[9px] uppercase tracking-wider text-muted">Costo</p><p className="font-mono text-[12px]">{usd(costo)}</p></div>
      <div><p className="text-[9px] uppercase tracking-wider text-muted">Venta</p><p className="font-mono text-[12px] text-accent">{usd(venta)}</p></div>
      <div><p className="text-[9px] uppercase tracking-wider text-muted">Ganancia</p><p className={`font-mono text-[12px] ${ganancia >= 0 ? 'text-green-300' : 'text-red-300'}`}>{usd(ganancia)}</p></div>
    </div>
    <button className="subtle-button shrink-0 px-3 py-2 text-[11px] group-hover:border-white/25 group-hover:text-white" onClick={(e) => { e.stopPropagation(); onDetalles() }}><Eye size={14} /> <span className="hidden sm:inline">Ver detalles</span></button>
  </article>
}
