import { Check, ChevronRight, ExternalLink, ImageOff, Plus, RefreshCw, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '../../contexts/AuthContext'
import { useEstadoVista } from '../../hooks/useEstadoVista'
import { cambiarEstadoProductos, conectadoCatalogo, costosTracking, disponibilidad, enOferta, estadoDe, listarProductosTienda, productosEnCache, type EstadoTienda, type ProductoTienda } from '../../services/productosTienda.service'
import { resolverImagenCatalogo } from '../../utils/catalogoImagen'
import { ConectarTienda } from './VentaLibrePage'

// PRODUCTOS DE LA TIENDA: lista estilo Shopify (pestañas, búsqueda, filtros, acciones en grupo).
// En el teléfono cada producto es una tarjeta. Tocar un producto abre su ficha (/tienda/:codigo).
type Tab = 'todos' | 'activo' | 'ei' | 'encamino' | 'revisar' | 'oferta' | 'sinfoto' | 'sincosto'
type Orden = 'nuevos' | 'precio-asc' | 'precio-desc' | 'nombre'
const POR_PAGINA = 60
const usd = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`
const ESTADO: Record<EstadoTienda, { texto: string; clase: string }> = {
  activo: { texto: 'Activo', clase: 'bg-emerald-500/15 text-emerald-300' },
  borrador: { texto: 'Borrador', clase: 'bg-sky-500/15 text-sky-300' },
  oculto: { texto: 'Oculto', clase: 'bg-white/[0.06] text-muted' },
}

export function EstadoChip({ estado }: { estado: EstadoTienda }) {
  return <span className={`inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-medium ${ESTADO[estado].clase}`}>{ESTADO[estado].texto}</span>
}
function Disponibilidad({ p }: { p: ProductoTienda }) {
  const d = disponibilidad(p.datos)
  if (d.tipo === 'ei') return <span className="inline-flex items-center gap-1 rounded-md bg-[#1a1a1a] px-2 py-0.5 text-xs font-medium text-[#fff]">⚡ Entrega inmediata{d.tallas.length ? ` · ${d.tallas.join(', ')}` : ''}</span>
  if (d.tipo === 'encamino') return <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-200">🚚 Llega pronto · {d.tallas.join(', ')}</span>
  return <span className="text-xs text-muted">Por encargo{d.tallas.length ? ` · ${d.tallas.length} ${d.tallas.length === 1 ? 'talla' : 'tallas'}` : ''}</span>
}

export function TiendaProductosPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [conectado, setConectado] = useState<boolean | null>(null)
  const [items, setItems] = useState<ProductoTienda[]>(productosEnCache() ?? [])
  const [cargando, setCargando] = useState(!productosEnCache())
  const [tab, setTab] = useEstadoVista<Tab>('tienda.tab', 'todos')
  const [q, setQ] = useEstadoVista('tienda.q', '')
  const [marca, setMarca] = useEstadoVista('tienda.marca', '')
  const [categoria, setCategoria] = useEstadoVista('tienda.cat', '')
  const [orden, setOrden] = useEstadoVista<Orden>('tienda.orden', 'nuevos')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [pagina, setPagina] = useState(1)
  const [trabajando, setTrabajando] = useState(false)
  // Costos del panel (productos.precio_compra) por código: se muestran con el margen.
  const [costos, setCostos] = useState<Map<string, number>>(new Map())
  const costoDe = (p: ProductoTienda) => costos.get(p.codigo.toUpperCase()) ?? 0
  const ventaDe = (p: ProductoTienda) => (p.datos.cotizar ? 0 : enOferta(p.datos) ? Number(p.datos.precioOferta) : Number(p.datos.precio) || 0)

  const cargar = () => { setCargando(true); void costosTracking().then(setCostos).catch(() => undefined); void listarProductosTienda().then(setItems).catch((e) => { toast.error(e instanceof Error ? e.message : 'No se pudieron cargar los productos.'); if (/sesión/i.test(String(e?.message))) setConectado(false) }).finally(() => setCargando(false)) }
  useEffect(() => { void conectadoCatalogo().then((ok) => { setConectado(ok); if (ok) cargar(); else setCargando(false) }) }, [])
  useEffect(() => { setPagina(1) }, [tab, q, marca, categoria, orden])

  const cuenta = useMemo(() => ({
    todos: items.length,
    activo: items.filter((p) => estadoDe(p) === 'activo').length,
    ei: items.filter((p) => disponibilidad(p.datos).tipo === 'ei').length,
    encamino: items.filter((p) => disponibilidad(p.datos).tipo === 'encamino').length,
    revisar: items.filter((p) => estadoDe(p) !== 'activo').length,
    oferta: items.filter((p) => enOferta(p.datos)).length,
    sinfoto: items.filter((p) => !p.datos.imagen).length,
    sincosto: items.filter((p) => estadoDe(p) === 'activo' && !(costos.get(p.codigo.toUpperCase()) ?? 0)).length,
  }), [items, costos])
  const marcas = useMemo(() => [...new Set(items.map((p) => String(p.datos.marca || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [items])
  const categorias = useMemo(() => [...new Set(items.map((p) => p.datos.categoria).filter(Boolean))].sort(), [items])

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase()
    const r = items.filter((p) => {
      const est = estadoDe(p), d = disponibilidad(p.datos).tipo
      if (tab === 'activo' && est !== 'activo') return false
      if (tab === 'ei' && d !== 'ei') return false
      if (tab === 'encamino' && d !== 'encamino') return false
      if (tab === 'revisar' && est === 'activo') return false
      if (tab === 'oferta' && !enOferta(p.datos)) return false
      if (tab === 'sinfoto' && p.datos.imagen) return false
      if (tab === 'sincosto' && (est !== 'activo' || (costos.get(p.codigo.toUpperCase()) ?? 0) > 0)) return false
      if (marca && String(p.datos.marca).trim() !== marca) return false
      if (categoria && p.datos.categoria !== categoria) return false
      return !t || `${p.datos.nombre} ${p.codigo} ${p.datos.marca}`.toLowerCase().includes(t)
    })
    if (orden === 'precio-asc') r.sort((a, b) => Number(a.datos.precio) - Number(b.datos.precio))
    else if (orden === 'precio-desc') r.sort((a, b) => Number(b.datos.precio) - Number(a.datos.precio))
    else if (orden === 'nombre') r.sort((a, b) => a.datos.nombre.localeCompare(b.datos.nombre))
    return r
  }, [items, tab, q, marca, categoria, orden, costos])
  const visibles = filtrados.slice(0, pagina * POR_PAGINA)
  const todosSel = visibles.length > 0 && visibles.every((p) => sel.has(p.codigo))
  const alternar = (c: string) => setSel((s) => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n })

  const masivo = async (estado: EstadoTienda) => {
    const elegidos = items.filter((p) => sel.has(p.codigo))
    setTrabajando(true)
    try { await cambiarEstadoProductos(elegidos, estado); toast.success(`${elegidos.length} ${elegidos.length === 1 ? 'producto' : 'productos'}: ${estado === 'activo' ? 'activados' : estado === 'oculto' ? 'ocultos' : 'en borrador'}.`); setSel(new Set()); cargar() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo cambiar.') } finally { setTrabajando(false) }
  }

  if (conectado === false) return <div><Cabecera /><ConectarTienda email={user?.email ?? ''} onOk={() => { setConectado(true); cargar() }} /></div>

  const TABS: [Tab, string][] = [['todos', 'Todos'], ['activo', 'Activos'], ['ei', 'Entrega inmediata'], ['encamino', 'Llega pronto'], ['revisar', 'Borradores y ocultos'], ['oferta', 'En oferta'], ['sincosto', 'Sin costo'], ['sinfoto', 'Sin foto']]
  return <div>
    <Cabecera onRecargar={cargar} cargando={cargando} />
    <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {[['Productos activos', cuenta.activo, 'en la tienda'], ['Entrega inmediata', cuenta.ei, 'ya en Nicaragua'], ['Llega pronto', cuenta.encamino, 'vienen en camino'], ['Para revisar', cuenta.revisar, 'borradores u ocultos']].map(([t, n, s]) =>
        <div key={String(t)} className="rounded-xl border border-line bg-panel p-3.5"><p className="text-xs font-medium text-muted">{t}</p><p className="mt-0.5 text-xl font-bold">{cargando && !items.length ? '…' : n}</p><p className="text-[11px] text-muted">{s}</p></div>)}
    </div>

    <div className="mt-4 overflow-hidden rounded-xl border border-line bg-panel">
      <div className="sin-barra flex gap-1 overflow-x-auto border-b border-line px-2 pt-2">
        {TABS.map(([id, t]) => <button key={id} type="button" onClick={() => setTab(id)} className={`min-h-10 shrink-0 rounded-t-lg px-3 text-sm font-medium ${tab === id ? 'bg-white/[0.06] text-white' : 'text-muted hover:text-white'}`}>{t} <span className="ml-1 rounded-full bg-white/[0.08] px-1.5 text-[11px]">{cuenta[id]}</span></button>)}
      </div>
      <div className="grid grid-cols-2 gap-2 border-b border-line p-2.5 sm:flex sm:flex-wrap">
        <label className="relative col-span-2 sm:min-w-56 sm:flex-1"><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input className="search-input w-full pl-9" placeholder="Buscar por nombre, código o marca" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <select className="min-h-10 rounded-lg border border-line bg-panel px-2.5 text-sm" value={marca} onChange={(e) => setMarca(e.target.value)} aria-label="Marca"><option value="">Todas las marcas</option>{marcas.map((m) => <option key={m}>{m}</option>)}</select>
        <select className="min-h-10 rounded-lg border border-line bg-panel px-2.5 text-sm" value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Categoría"><option value="">Todas las categorías</option>{categorias.map((c) => <option key={c}>{c}</option>)}</select>
        <select className="col-span-2 min-h-10 rounded-lg border border-line bg-panel px-2.5 text-sm sm:col-span-1" value={orden} onChange={(e) => setOrden(e.target.value as Orden)} aria-label="Ordenar"><option value="nuevos">Más nuevos</option><option value="precio-asc">Precio: menor a mayor</option><option value="precio-desc">Precio: mayor a menor</option><option value="nombre">Nombre A–Z</option></select>
      </div>
      {sel.size > 0 && <div className="sin-barra flex items-center gap-2 overflow-x-auto border-b border-line bg-white/[0.02] px-3 py-2">
        <b className="shrink-0 text-sm">{sel.size} {sel.size === 1 ? 'seleccionado' : 'seleccionados'}</b>
        <button type="button" disabled={trabajando} className="subtle-button min-h-10 shrink-0 px-3" onClick={() => void masivo('activo')}>Activar</button>
        <button type="button" disabled={trabajando} className="subtle-button min-h-10 shrink-0 px-3" onClick={() => void masivo('oculto')}>Ocultar</button>
        <button type="button" disabled={trabajando} className="subtle-button min-h-10 shrink-0 px-3" onClick={() => void masivo('borrador')}>Pasar a borrador</button>
        <button type="button" className="subtle-button min-h-10 shrink-0 px-3" onClick={() => setSel(new Set())}>Quitar selección</button>
      </div>}

      {cargando && !items.length ? <div className="space-y-2 p-3">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-white/[0.04]" />)}</div>
        : !filtrados.length ? <p className="p-8 text-center text-sm text-muted">No hay productos con ese filtro.</p>
        : <>
          {/* Encabezado (solo computadora) */}
          <div className="hidden grid-cols-[32px_minmax(0,2.4fr)_110px_minmax(0,1.6fr)_minmax(0,1fr)_120px_20px] items-center gap-3 border-b border-line bg-white/[0.02] px-3 py-2 text-xs font-medium text-muted lg:grid">
            <button type="button" aria-label={todosSel ? 'Quitar todos' : 'Elegir todos'} onClick={() => setSel(todosSel ? new Set() : new Set(visibles.map((p) => p.codigo)))} className={`grid size-5 place-items-center rounded border ${todosSel ? 'border-accent bg-accent text-[#fff]' : 'border-line'}`}>{todosSel && <Check size={13} />}</button>
            <span>Producto</span><span>Estado</span><span>Disponibilidad</span><span>Categoría · marca</span><span className="text-right">Precio</span><span />
          </div>
          <ul className="divide-y divide-line">
            {visibles.map((p) => {
              const on = sel.has(p.codigo), oferta = enOferta(p.datos)
              return <li key={p.codigo} className={`grid cursor-pointer grid-cols-[28px_minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 px-3 py-3 hover:bg-white/[0.02] lg:grid-cols-[32px_minmax(0,2.4fr)_110px_minmax(0,1.6fr)_minmax(0,1fr)_120px_20px] lg:items-center lg:py-2.5 ${on ? 'bg-accent/[0.05]' : ''}`} onClick={() => navigate(`/tienda/${encodeURIComponent(p.codigo)}`)}>
                <button type="button" aria-label={on ? 'Quitar de la selección' : 'Elegir'} onClick={(e) => { e.stopPropagation(); alternar(p.codigo) }} className="row-span-3 -m-2 mt-1 grid size-10 place-items-center self-start lg:row-span-1 lg:-m-2.5 lg:self-center"><span className={`grid size-5 place-items-center rounded border ${on ? 'border-accent bg-accent text-[#fff]' : 'border-line'}`}>{on && <Check size={13} />}</span></button>
                <div className="flex min-w-0 items-center gap-3">
                  {p.datos.imagen ? <img src={resolverImagenCatalogo(p.datos.imagen)} alt="" loading="lazy" className="size-12 shrink-0 rounded-lg border border-line object-cover lg:size-10" /> : <span className="grid size-12 shrink-0 place-items-center rounded-lg border border-dashed border-line text-muted lg:size-10"><ImageOff size={16} /></span>}
                  <div className="min-w-0"><b className="line-clamp-2 text-sm font-semibold lg:line-clamp-1">{p.datos.nombre}</b><span className="text-xs text-muted">{p.codigo}{p.origen === 'original' ? ' · de fábrica' : ''}</span></div>
                </div>
                <div className="text-right lg:order-last lg:col-start-6 lg:row-start-1"><b className="text-sm">{p.datos.cotizar ? 'Cotizar' : usd(oferta ? Number(p.datos.precioOferta) : Number(p.datos.precio))}</b>{oferta && <span className="block text-[11px] text-muted line-through">{usd(Number(p.datos.precio))}</span>}{(() => { const c = costoDe(p), v = ventaDe(p); if (!c) return <span className="block text-[11px] text-muted">sin costo</span>; const m = v > 0 ? Math.round(((v - c) / v) * 100) : 0; return <span className={`block text-[11px] ${m < 25 ? 'text-amber-200' : 'text-muted'}`}>costo {usd(c)} · {m} %</span> })()}</div>
                <div className="col-start-2 lg:col-start-3 lg:row-start-1"><EstadoChip estado={estadoDe(p)} /></div>
                <div className="col-span-2 col-start-2 lg:col-span-1 lg:col-start-4 lg:row-start-1"><Disponibilidad p={p} /></div>
                <span className="hidden truncate text-xs text-muted lg:col-start-5 lg:row-start-1 lg:block">{p.datos.categoria}{p.datos.marca ? ` · ${p.datos.marca}` : ''}</span>
                <ChevronRight size={16} className="hidden text-muted lg:col-start-7 lg:row-start-1 lg:block" />
              </li>
            })}
          </ul>
          {visibles.length < filtrados.length && <div className="border-t border-line p-3 text-center"><button type="button" className="subtle-button min-h-10 px-5" onClick={() => setPagina((n) => n + 1)}>Ver más ({filtrados.length - visibles.length})</button></div>}
        </>}
    </div>
  </div>
}

function Cabecera({ onRecargar, cargando }: { onRecargar?: () => void; cargando?: boolean }) {
  return <div className="flex flex-wrap items-end gap-3">
    <div className="mr-auto"><p className="eyebrow">Tienda</p><h1 className="page-title">Productos</h1><p className="page-subtitle">Lo que se ve en hauslineshopni.es: cargá, editá y ordená tus productos.</p></div>
    {onRecargar && <button type="button" className="subtle-button min-h-10 px-3" onClick={onRecargar} disabled={cargando} aria-label="Recargar"><RefreshCw size={15} className={cargando ? 'animate-spin' : ''} /></button>}
    <a className="subtle-button min-h-10 px-3" href="https://hauslineshopni.es" target="_blank" rel="noreferrer"><ExternalLink size={15} /> Ver tienda</a>
    <Link to="/tienda/nuevo" className="primary-button min-h-10 px-4"><Plus size={16} /> Agregar producto</Link>
  </div>
}
