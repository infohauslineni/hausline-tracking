import { ArrowLeft, Copy, ExternalLink, Camera, ImagePlus, LoaderCircle, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '../../contexts/AuthContext'
import {
  actualizarCache, borrarProductoTienda, CATEGORIAS, codigosOcupados, conectadoCatalogo, costoDe, disponibilidad, guardarAnticipo, guardarCosto, guardarPrecioTracking, ETIQUETAS, estadoDe, guardarProductoTienda, linkProducto,
  listarProductosTienda, ordenarTallas, productosEnCache, SUBCATEGORIAS, sugerirCodigo, TALLAS_CALZADO, TALLAS_ROPA, TIPOS_ROPA,
  type DatosTienda, type EstadoTienda, type FotoTienda, type ProductoTienda,
} from '../../services/productosTienda.service'
import { costosDeCompras, DATOS_PRECIO_DEFECTO, obtenerDatosPrecio, sugerirPrecios, tipoDeTienda, type CostoCompra, type DatosPrecio } from '../../services/preciosSugeridos.service'
import { resolverImagenCatalogo } from '../../utils/catalogoImagen'
import { TIPOS_PRODUCTO } from '../../utils/repartoCompra'
import { abrirPostInstagram } from '../../utils/instagramPost'
import { EstadoChip } from './TiendaProductosPage'
import { ConectarTienda } from './VentaLibrePage'
import { EncuadreFotoModal } from '../../components/tienda/EncuadreFotoModal'
import { FotosOrdenables } from '../../components/tienda/FotosOrdenables'

// FICHA DEL PRODUCTO (estilo Shopify). Columna principal: título, descripción, fotos, precio,
// tallas y disponibilidad, tiempos. Columna lateral: estado, organización, etiquetas y la tarjeta
// tal como se ve en la tienda. Al cambiar algo aparece "Cambios sin guardar · Descartar · Guardar"
// (arriba en computadora, abajo en el teléfono, al alcance del dedo).

type EstadoTalla = 'encargo' | 'ei'
const usd = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`
const vacio = (): DatosTienda => ({ codigo: '', nombre: '', marca: '', categoria: 'Hombre', subcategoria: 'Calzado', precio: 0, cotizar: false, precioOferta: 0, promocionHasta: '', descripcion: '', tallas: [], colores: [], imagen: '', imagenes: [], destacadoNuevo: true, entregaInmediata: false, tallasEntregaInmediata: [], coloresEntregaInmediata: [] })
const num = (v: string) => (v.trim() === '' ? 0 : Number(v.replace(',', '.')) || 0)
// Campo de dinero: guarda el texto mientras se escribe (si no, "170." se volvía 170 y no dejaba poner .99).
function InputDinero({ valor, onValor, ...resto }: { valor: number | null | undefined; onValor: (n: number) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [texto, setTexto] = useState(valor ? String(valor) : '')
  useEffect(() => { setTexto((t) => (num(t) === (valor || 0) ? t : valor ? String(valor) : '')) }, [valor])
  return <input {...resto} inputMode="decimal" value={texto} onChange={(e) => { const v = e.target.value.replace(/[^0-9.,]/g, ''); setTexto(v); onValor(num(v)) }} />
}

export function ProductoTiendaPage() {
  const { codigo: param = '' } = useParams()
  const esNuevo = param === 'nuevo'
  const navigate = useNavigate()
  const { user } = useAuth()
  const [conectado, setConectado] = useState<boolean | null>(null)
  const [todos, setTodos] = useState<ProductoTienda[]>(productosEnCache() ?? [])
  const [previo, setPrevio] = useState<ProductoTienda | null>(null)
  const [listo, setListo] = useState(false)

  // Formulario
  const [d, setD] = useState<DatosTienda>(vacio())
  const [estado, setEstado] = useState<EstadoTienda>('activo')
  const [fotos, setFotos] = useState<FotoTienda[]>([])
  const [encuadrando, setEncuadrando] = useState<number | null>(null)
  const [tallas, setTallas] = useState<Record<string, EstadoTalla>>({})
  const [unidades, setUnidades] = useState<Record<string, number>>({})
  const [tallaExtra, setTallaExtra] = useState('')
  const [colorNuevo, setColorNuevo] = useState('')
  // Costo del proveedor (productos.precio_compra del panel). costoBase = como estaba al abrir.
  const [costoTxt, setCostoTxt] = useState('')
  const [costoBase, setCostoBase] = useState(0)
  const costo = num(costoTxt)
  // Márgenes y envío estimado para el precio sugerido y el mayorista (solo panel).
  const [datosPrecio, setDatosPrecio] = useState<DatosPrecio>(DATOS_PRECIO_DEFECTO)
  useEffect(() => { void obtenerDatosPrecio().then(setDatosPrecio).catch(() => undefined) }, [])
  // Último costo real pagado (pedido o Compra libre), para llenar la ficha si no tiene costo.
  const [costosCompra, setCostosCompra] = useState<Map<string, CostoCompra>>(new Map())
  useEffect(() => { void costosDeCompras().then(setCostosCompra).catch(() => undefined) }, [])
  const [sucio, setSucio] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [confirmarBorrar, setConfirmarBorrar] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const cargarEn = (p: ProductoTienda | null) => {
    const datos = p ? { ...vacio(), ...p.datos } : vacio()
    setPrevio(p); setD(datos); setEstado(p ? estadoDe(p) : 'borrador')
    setFotos((datos.imagenes?.length ? datos.imagenes : datos.imagen ? [datos.imagen] : []).map((url) => ({ url })))
    const t: Record<string, EstadoTalla> = {}, u: Record<string, number> = {}
    for (const x of datos.tallas ?? []) t[x] = 'encargo'
    for (const x of datos.tallasEntregaInmediata ?? []) { t[x] = 'ei'; u[x] = (u[x] ?? 0) + 1 }
    setTallas(t); setUnidades(u); setSucio(false); setListo(true)
    setCostoTxt(''); setCostoBase(0)
    if (p) void costoDe(p.codigo).then((c) => { setCostoBase(c); setCostoTxt(c ? String(c) : '') })
  }

  useEffect(() => {
    void conectadoCatalogo().then(async (ok) => {
      setConectado(ok)
      if (!ok) return
      let lista = productosEnCache()
      if (!lista) { try { lista = await listarProductosTienda() } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo cargar.'); return } }
      setTodos(lista)
      if (esNuevo) cargarEn(null)
      else {
        const p = lista.find((x) => x.codigo.toUpperCase() === decodeURIComponent(param).toUpperCase())
        if (!p) { toast.error('No se encontró ese producto.'); navigate('/tienda'); return }
        cargarEn(p)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [param])

  // Con cambios sin guardar, el menú de abajo del teléfono se esconde: ahí va "Guardar".
  useEffect(() => {
    document.body.classList.toggle('sin-nav-movil', sucio)
    return () => document.body.classList.remove('sin-nav-movil')
  }, [sucio])

  // Avisa si se quiere salir con cambios sin guardar (recargar / cerrar pestaña).
  useEffect(() => {
    if (!sucio) return
    const fn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', fn)
    return () => window.removeEventListener('beforeunload', fn)
  }, [sucio])

  const cambiar = <K extends keyof DatosTienda>(k: K, v: DatosTienda[K]) => { setD((x) => ({ ...x, [k]: v })); setSucio(true) }
  const esRopa = /ropa/i.test(d.subcategoria)
  const esCalzado = /calzado/i.test(d.subcategoria)
  const grilla = esCalzado ? TALLAS_CALZADO : esRopa ? TALLAS_ROPA : []
  const extras = ordenarTallas(Object.keys(tallas).filter((t) => !grilla.includes(t)))
  const marcas = useMemo(() => [...new Set(todos.map((p) => String(p.datos.marca || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [todos])

  // Tocar una talla la pone o la quita. "En Nicaragua" se marca aparte (en la tabla de abajo) para
  // que nunca quede en Entrega inmediata por un toque de más.
  const tocarTalla = (t: string) => {
    setTallas((x) => { const n = { ...x }; if (n[t]) delete n[t]; else n[t] = 'encargo'; return n })
    setSucio(true)
  }
  const alternarNicaragua = (t: string) => {
    setTallas((x) => ({ ...x, [t]: x[t] === 'ei' ? 'encargo' : 'ei' }))
    setUnidades((u) => ({ ...u, [t]: u[t] || 1 }))
    setSucio(true)
  }
  const agregarTallaExtra = () => { const t = tallaExtra.trim(); if (!t) return; setTallas((x) => ({ ...x, [t]: x[t] ?? 'encargo' })); setTallaExtra(''); setSucio(true) }
  const agregarColor = () => { const c = colorNuevo.trim(); if (!c || d.colores.includes(c)) return; cambiar('colores', [...d.colores, c]); setColorNuevo('') }
  const quitarColor = (c: string) => { cambiar('colores', d.colores.filter((x) => x !== c)); cambiar('coloresEntregaInmediata', (d.coloresEntregaInmediata ?? []).filter((x) => x !== c)) }
  const alternarColorEI = (c: string) => { const l = d.coloresEntregaInmediata ?? []; cambiar('coloresEntregaInmediata', l.includes(c) ? l.filter((x) => x !== c) : [...l, c]) }

  const agregarFotos = (files: FileList | null) => {
    if (!files?.length) return
    const nuevas = Array.from(files).filter((f) => f.type.startsWith('image/')).map((file) => ({ url: URL.createObjectURL(file), file }))
    setFotos((f) => [...f, ...nuevas]); setSucio(true)
  }
  const quitarFoto = (i: number) => { setFotos((f) => f.filter((_, j) => j !== i)); setSucio(true) }

  // Tallas → campos que lee la tienda. Una talla en Nicaragua cuenta también como talla del producto;
  // "2 unidades" = la talla repetida 2 veces en tallasEntregaInmediata (así la descuenta al vender).
  const armar = (): DatosTienda => {
    const todas = ordenarTallas(Object.keys(tallas))
    const enNic = todas.filter((t) => tallas[t] === 'ei').flatMap((t) => Array.from({ length: Math.max(1, unidades[t] || 1) }, () => t))
    const sinTallas = !todas.length
    return { ...d, tallas: todas, tallasEntregaInmediata: enNic, entregaInmediata: sinTallas ? Boolean(d.entregaInmediata) : enNic.length > 0, coloresEntregaInmediata: (d.coloresEntregaInmediata ?? []).filter((c) => d.colores.includes(c)) }
  }

  const guardar = async () => {
    setGuardando(true)
    try {
      const datos = await guardarProductoTienda(armar(), fotos, estado, previo, todos)
      // El costo va al panel (misma tabla de la ganancia y los pedidos).
      if (Math.abs(costo - costoBase) > 0.004) { try { await guardarCosto(datos, costo); setCostoBase(costo) } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo guardar el costo.') } }
      // El anticipo fijo también va directo a la base del panel (la que crea el encargo), sin esperar la sincronización.
      if ((Number(datos.anticipo) || 0) !== (Number(previo?.datos.anticipo) || 0)) await guardarAnticipo(datos)
      // El precio también pasa ya a Compras libres (las compras que siguen a la venta toman el precio nuevo).
      try { await guardarPrecioTracking(datos) } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo actualizar el precio en Compras libres.') }
      const prod: ProductoTienda = { codigo: datos.codigo, datos, origen: previo?.origen === 'original' ? 'editado' : previo?.origen ?? 'nuevo', activo: estado === 'activo', id: previo?.id ?? null, creado: previo?.creado ?? new Date().toISOString() }
      actualizarCache(prod, previo?.codigo)
      setTodos((l) => [prod, ...l.filter((x) => x.codigo.toUpperCase() !== (previo?.codigo ?? datos.codigo).toUpperCase())])
      toast.success(estado === 'activo' ? 'Guardado. Ya se ve en la tienda.' : estado === 'borrador' ? 'Guardado como borrador (no se ve en la tienda).' : 'Guardado. Está oculto en la tienda.')
      setSucio(false)
      // Al guardar vuelve a la lista de productos.
      navigate('/tienda')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo guardar.') }
    finally { setGuardando(false) }
  }
  const borrar = async () => {
    if (!previo) return
    try { await borrarProductoTienda(previo); actualizarCache(null, previo.codigo); toast.success('Producto eliminado.'); setSucio(false); navigate('/tienda') }
    catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo borrar.') }
  }

  // CÓDIGO AUTOMÁTICO (producto nuevo): al elegir la marca se pone solo el siguiente (GG056 → GG057),
  // saltando los que ya se usaron en pedidos o Compras libres. Si lo escribe a mano, se respeta.
  const [ocupados, setOcupados] = useState<Set<string>>(new Set())
  const codigoManual = useRef(false)
  useEffect(() => { if (esNuevo) void codigosOcupados().then(setOcupados).catch(() => undefined) }, [esNuevo, todos])
  const codigoSugerido = esNuevo && d.marca.trim() ? sugerirCodigo(d.marca, todos, d.categoria === 'Dama', ocupados) : ''
  useEffect(() => {
    if (esNuevo && !codigoManual.current && codigoSugerido) setD((x) => (x.codigo === codigoSugerido ? x : { ...x, codigo: codigoSugerido }))
  }, [esNuevo, codigoSugerido])

  if (conectado === false) return <div><Volver onClick={() => navigate('/tienda')} /><ConectarTienda email={user?.email ?? ''} onOk={() => window.location.reload()} /></div>
  if (!listo) return <div className="space-y-3"><div className="h-10 w-64 animate-pulse rounded-lg bg-white/[0.04]" /><div className="h-64 animate-pulse rounded-xl bg-white/[0.04]" /></div>

  const f = armar()
  const precio = Number(d.precio) || 0, oferta = Number(d.precioOferta) || 0
  const venta = d.cotizar ? 0 : oferta > 0 && oferta < precio ? oferta : precio
  const ganancia = venta - costo, margen = venta > 0 ? Math.round((ganancia / venta) * 100) : 0
  const disp = disponibilidad(f)
  const fotoPrev = fotos[0] ? resolverImagenCatalogo(fotos[0].url) : ''

  return <div className="pb-6">
    {/* Cambios sin guardar: arriba en computadora (tapa la barra superior), abajo en el teléfono. */}
    {sucio && <div className="fixed inset-x-0 bottom-0 z-[60] flex items-center gap-2 bg-[#1a1a1a] px-3 pt-2.5 text-[#fff] shadow-[0_-6px_20px_rgba(0,0,0,.25)] [padding-bottom:calc(10px+env(safe-area-inset-bottom,0px))] lg:bottom-auto lg:top-0 lg:h-14 lg:py-0 lg:shadow-none">
      <b className="mr-auto text-sm">Cambios sin guardar</b>
      <button type="button" disabled={guardando} className="min-h-10 rounded-lg bg-[#303030] px-4 text-sm font-semibold text-[#fff]" onClick={() => (previo || !esNuevo ? cargarEn(previo) : navigate('/tienda'))}>Descartar</button>
      <button type="button" disabled={guardando} className="min-h-10 rounded-lg bg-[#fff] px-4 text-sm font-semibold text-[#1a1a1a]" onClick={() => void guardar()}>{guardando ? 'Guardando…' : 'Guardar'}</button>
    </div>}

    <div className="flex flex-wrap items-center gap-2">
      <Volver onClick={() => { if (sucio && !confirmarSalir()) return; navigate('/tienda') }} />
      <h1 className="min-w-0 flex-1 truncate text-lg font-bold sm:text-xl">{esNuevo ? 'Agregar producto' : d.nombre || previo?.codigo}</h1>
      {!esNuevo && previo && <EstadoChip estado={estadoDe(previo)} />}
      {!esNuevo && previo && <div className="sin-barra flex w-full gap-2 overflow-x-auto sm:w-auto">
        <a className="subtle-button min-h-10 shrink-0 px-3" href={linkProducto(previo.codigo)} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Ver en la tienda</a>
        <button type="button" className="subtle-button min-h-10 shrink-0 px-3" onClick={() => void abrirPostInstagram(previo.datos, disp.tipo === 'ei' ? 'inmediata' : disp.tipo === 'encamino' ? 'encamino' : 'nuevo')}><Camera size={15} /> Post de Instagram</button>
        <button type="button" className="subtle-button min-h-10 shrink-0 px-3" onClick={() => { void navigator.clipboard?.writeText(linkProducto(previo.codigo)).then(() => toast.success('Link copiado.')).catch(() => toast.info(linkProducto(previo.codigo))) }}><Copy size={15} /> Copiar link</button>
      </div>}
    </div>

    <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
      <div className="grid min-w-0 gap-4">
        <Seccion>
          <Campo label="Título"><input className="campo" value={d.nombre} onChange={(e) => cambiar('nombre', e.target.value)} placeholder="Ej.: Sneaker Vintage Star Blanco/Negro" /></Campo>
          <Campo label="Descripción"><textarea className="campo min-h-28" value={d.descripcion} onChange={(e) => cambiar('descripcion', e.target.value)} placeholder="Materiales, detalles, cómo le queda…" /></Campo>
        </Seccion>

        <Seccion titulo="Fotos" ayuda="La primera es la principal. Arrastrá las fotos para ordenarlas (en el teléfono: mantené apretada una foto y movela) o tocá la estrella para hacerla principal.">
          <FotosOrdenables fotos={fotos} onOrden={(nuevas) => { setFotos(nuevas); setSucio(true) }} onQuitar={quitarFoto} onEncuadrar={(i) => setEncuadrando(i)}
            extra={<button type="button" onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); agregarFotos(e.dataTransfer.files) }} className="grid aspect-square place-items-center rounded-xl border-2 border-dashed border-line p-2 text-center text-xs font-medium text-muted hover:border-accent hover:text-accent">
              <span><ImagePlus size={22} className="mx-auto mb-1" />Agregar fotos</span>
            </button>} />
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { agregarFotos(e.target.files); e.target.value = '' }} />
          <EncuadreFotoModal src={encuadrando !== null && fotos[encuadrando] ? resolverImagenCatalogo(fotos[encuadrando].url) : null} onClose={() => setEncuadrando(null)}
            onListo={(file) => {
              const i = encuadrando
              if (i === null) return
              setFotos((f) => f.map((x, j) => (j === i ? { url: URL.createObjectURL(file), file } : x)))
              // La foto principal ya viene encuadrada: se quitan los ajustes viejos de zoom/posición de la tarjeta.
              if (i === 0) setD((x) => ({ ...x, posicionImagen: '', escalaImagen: null }))
              setSucio(true); setEncuadrando(null)
              toast.success('Foto encuadrada. Se sube al guardar.')
            }} />
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm"><span className="text-muted">Cómo se muestra la foto:</span>
            <select className="campo w-auto" value={d.imagenFit === 'contain' ? 'contain' : ''} onChange={(e) => cambiar('imagenFit', e.target.value)}><option value="">Llenar el recuadro (recorta)</option><option value="contain">Foto completa (sin recortar)</option></select>
          </div>
        </Seccion>

        <Seccion titulo="Precio">
          <label className="mb-3 flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={d.cotizar} onChange={(e) => cambiar('cotizar', e.target.checked)} /> Precio a consultar (botón "Cotizar por WhatsApp")</label>
          <div className="grid gap-3 sm:grid-cols-3">
            <Campo label="Precio (US$)"><InputDinero className="campo" disabled={d.cotizar} valor={d.precio} onValor={(n) => cambiar('precio', n)} placeholder="0.00" /></Campo>
            <Campo label="Precio de oferta"><InputDinero className="campo" disabled={d.cotizar} valor={d.precioOferta} onValor={(n) => cambiar('precioOferta', n)} placeholder="Sin oferta" /></Campo>
            <Campo label="Oferta hasta"><input className="campo" type="date" disabled={!oferta} value={String(d.promocionHasta || '').slice(0, 10)} onChange={(e) => cambiar('promocionHasta', e.target.value ? `${e.target.value}T23:59:59` : '')} /></Campo>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Campo label="Precio en Entrega inmediata" ayuda="Vacío = el mismo precio"><InputDinero className="campo" valor={d.precioEntregaInmediata} onValor={(n) => cambiar('precioEntregaInmediata', n)} placeholder="Igual al precio" /></Campo>
            <Campo label="Costo (proveedor)" ayuda="Lo que te cuesta · no lo ve el cliente"><input className="campo" inputMode="decimal" value={costoTxt} onChange={(e) => { setCostoTxt(e.target.value); setSucio(true) }} placeholder="0.00" /></Campo>
            <Campo label="Apartar con (US$)" ayuda={`Opcional · vacío = abono del 50 %${venta > 0 ? ` (${usd(Math.round(venta * 50) / 100)})` : ''}`}><InputDinero className="campo" disabled={d.cotizar} valor={d.anticipo} onValor={(n) => cambiar('anticipo', n || null)} placeholder="50 %" /></Campo>
          </div>
          {Number(d.anticipo) > 0 && venta > 0 && <p className="-mt-1 mb-3 text-xs text-muted">En la tienda sale <b>"Apartar con {usd(Math.min(Number(d.anticipo), venta))}"</b> en vez de "Abono 50 %". El cliente paga el resto ({usd(Math.max(0, venta - Number(d.anticipo)))}) antes de la entrega.</p>}
          <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-lg bg-white/[0.03] px-3 py-2.5 text-sm text-muted">
            {costo > 0 && venta > 0 ? <><span>Ganancia por unidad <b className={margen >= 25 ? 'text-emerald-300' : 'text-amber-200'}>{usd(Math.round(ganancia * 100) / 100)}</b></span><span>Margen <b className={margen >= 25 ? 'text-emerald-300' : 'text-amber-200'}>{margen} %</b></span><span>{margen < 25 ? '⚠️ Margen bajo' : '✓ Buen margen'}</span></>
              : <span>Poné el costo para ver tu ganancia y el margen. También se llena solo al registrar el pago al proveedor.</span>}
          </div>
          {(() => {
            const ultima = costo > 0 ? null : costosCompra.get(String(d.codigo || '').trim().toUpperCase())
            if (!ultima) return null
            return <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300/30 bg-amber-300/[.06] px-3 py-2.5 text-sm">
              <span className="mr-auto text-amber-100">La ficha no tiene costo, pero tu última {ultima.fuente === 'pedido' ? 'compra en un pedido' : 'compra libre'} te costó <b>{usd(ultima.costo)}</b> por unidad.</span>
              <button type="button" className="subtle-button min-h-9 px-3 text-xs" onClick={() => { setCostoTxt(String(ultima.costo)); setSucio(true) }}>Usar {usd(ultima.costo)} como costo</button>
            </div>
          })()}
          {(() => {
            const tipo = tipoDeTienda(d), sug = sugerirPrecios(costo, tipo, datosPrecio)
            if (!sug) return null
            return <div className="mt-3 rounded-lg border border-line px-3 py-2.5 text-sm">
              <p className="text-xs text-muted">Costo {usd(costo)} + envío estimado {usd(sug.envio)} ({TIPOS_PRODUCTO[tipo].label.toLowerCase()}) = <b className="text-white">{usd(sug.base)}</b> · solo lo ves vos</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2">
                <span>Precio sugerido ({datosPrecio.margenTienda} %) <b className="text-emerald-300">{usd(sug.tienda)}</b></span>
                {!d.cotizar && Math.abs(precio - sug.tienda) > 0.004 && <button type="button" className="subtle-button min-h-9 px-3 text-xs" onClick={() => cambiar('precio', sug.tienda)}>Usar {usd(sug.tienda)}</button>}
                <span>Mayorista ({datosPrecio.margenMayorista} %) <b className="text-sky-300">{usd(sug.mayorista)}</b></span>
              </div>
            </div>
          })()}
        </Seccion>

        <Seccion titulo="Tallas y disponibilidad" ayuda="Tocá las tallas que se pueden encargar. Si una ya está en Nicaragua, marcala abajo con “En Nicaragua”.">
          {grilla.length > 0 && <div className="flex flex-wrap gap-2">{grilla.map((t) => <BotonTalla key={t} t={t} estado={tallas[t]} onClick={() => tocarTalla(t)} />)}</div>}
          {extras.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{extras.map((t) => <BotonTalla key={t} t={t} estado={tallas[t]} onClick={() => tocarTalla(t)} />)}</div>}
          <div className="mt-3 flex gap-2"><input className="campo max-w-44" value={tallaExtra} onChange={(e) => setTallaExtra(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); agregarTallaExtra() } }} placeholder={grilla.length ? 'Otra talla (ej. 36.5)' : 'Talla (ej. Única)'} /><button type="button" className="subtle-button min-h-10 px-3" onClick={agregarTallaExtra}>Agregar</button></div>
          {Object.keys(tallas).length > 0 ? <div className="mt-4 overflow-hidden rounded-lg border border-line">
            {ordenarTallas(Object.keys(tallas)).map((t) => <div key={t} className="flex min-h-12 items-center gap-3 border-b border-line px-3 py-1.5 last:border-0">
              <b className="w-12">{t}</b>
              <button type="button" onClick={() => alternarNicaragua(t)} aria-pressed={tallas[t] === 'ei'} className={`min-h-9 rounded-lg px-3 text-xs font-semibold ${tallas[t] === 'ei' ? 'bg-[#1a1a1a] text-[#fff]' : 'border border-line text-muted'}`}>{tallas[t] === 'ei' ? '⚡ En Nicaragua · quitar' : 'Por encargo · marcar en Nicaragua'}</button>
              {tallas[t] === 'ei' && <label className="ml-auto flex items-center gap-2 text-xs text-muted">Unidades <input className="campo w-16 text-center" inputMode="numeric" value={unidades[t] || 1} onChange={(e) => { setUnidades((u) => ({ ...u, [t]: Math.max(1, Math.round(num(e.target.value)) || 1) })); setSucio(true) }} /></label>}
            </div>)}
          </div> : <label className="mt-4 flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={Boolean(d.entregaInmediata)} onChange={(e) => cambiar('entregaInmediata', e.target.checked)} /> Está en Nicaragua (Entrega inmediata, producto sin tallas)</label>}
          {f.enCamino && (f.tallasEnCamino ?? []).length > 0 && <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200">🚚 Vienen en camino: {(f.tallasEnCamino ?? []).join(', ')} (lo maneja Compras libres, no se cambia acá).</p>}

          <div className="mt-5"><p className="mb-2 text-sm font-medium">Colores</p>
            <div className="flex flex-wrap gap-2">{d.colores.map((c) => { const ei = (d.coloresEntregaInmediata ?? []).includes(c); return <span key={c} className="inline-flex items-center gap-1 rounded-full border border-line py-1 pl-3 pr-1 text-sm">
              {c}
              {f.entregaInmediata && <button type="button" onClick={() => alternarColorEI(c)} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ei ? 'bg-[#1a1a1a] text-[#fff]' : 'bg-white/[0.06] text-muted'}`} title="¿Este color está en Nicaragua?">{ei ? '⚡ En Nic.' : 'Encargo'}</button>}
              <button type="button" aria-label={`Quitar ${c}`} onClick={() => quitarColor(c)} className="grid size-7 place-items-center rounded-full text-muted hover:text-white"><X size={14} /></button>
            </span> })}</div>
            <div className="mt-2 flex gap-2"><input className="campo max-w-56" value={colorNuevo} onChange={(e) => setColorNuevo(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); agregarColor() } }} placeholder="Ej.: Negro" /><button type="button" className="subtle-button min-h-10 px-3" onClick={agregarColor}>Agregar color</button></div>
          </div>
        </Seccion>

        <Seccion titulo="Tiempos de entrega">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo label="Preparación: desde (días)" ayuda="Vacío = el tiempo general de la tienda"><input className="campo" inputMode="numeric" value={d.prepMin || ''} onChange={(e) => cambiar('prepMin', Math.round(num(e.target.value)))} placeholder="General" /></Campo>
            <Campo label="Preparación: hasta (días)"><input className="campo" inputMode="numeric" value={d.prepMax || ''} onChange={(e) => cambiar('prepMax', Math.round(num(e.target.value)))} placeholder="General" /></Campo>
          </div>
          <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={Boolean(d.demoraExtendida)} onChange={(e) => cambiar('demoraExtendida', e.target.checked)} /> Demora extendida (avisa al cliente y suma días a la entrega)</label>
          {d.demoraExtendida && <div className="mt-2 grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)]">
            <Campo label="Días extra"><input className="campo" inputMode="numeric" value={d.diasExtra || ''} onChange={(e) => cambiar('diasExtra', Math.round(num(e.target.value)))} /></Campo>
            <Campo label="Nota para el cliente"><input className="campo" value={String(d.notaDemora ?? '')} onChange={(e) => cambiar('notaDemora', e.target.value)} placeholder="Ej.: este modelo tarda un poco más" /></Campo>
          </div>}
        </Seccion>

        <Seccion titulo="Vista previa en Google">
          <div className="rounded-lg border border-line p-3"><p className="text-xs text-[#006621]">hauslineshopni.es › p › {d.codigo || 'CODIGO'}</p><p className="mt-0.5 text-base text-[#1a0dab]">{d.nombre || 'Título del producto'} | HAUSLINE Nicaragua</p><p className="text-[13px] text-muted">{(d.descripcion || 'Encárguelo en HAUSLINE: envíos a toda Nicaragua, apartado con el 50 %.').slice(0, 155)}</p></div>
        </Seccion>
      </div>

      <div className="grid min-w-0 gap-4">
        <Seccion titulo="Estado">
          <select className="campo" value={estado} onChange={(e) => { setEstado(e.target.value as EstadoTienda); setSucio(true) }}>
            <option value="activo">Activo · se ve en la tienda</option><option value="borrador">Borrador · todavía no se ve</option><option value="oculto">Oculto · pausado</option>
          </select>
        </Seccion>
        <Seccion titulo="Organización">
          <Campo label="Código" ayuda={!esNuevo ? 'El código no se cambia en productos ya creados.' : codigoSugerido && codigoSugerido !== d.codigo ? undefined : codigoSugerido ? `Se puso solo: el siguiente de ${d.marca.trim()}. Podés cambiarlo.` : 'Elegí la marca y el código se pone solo.'}>
            <input className="campo uppercase" value={d.codigo} disabled={!esNuevo && previo?.origen !== 'nuevo'} onChange={(e) => { const v = e.target.value.toUpperCase().replace(/\s+/g, ''); codigoManual.current = v !== ''; cambiar('codigo', v) }} placeholder="Se genera solo" />
          </Campo>
          {codigoSugerido && codigoSugerido !== d.codigo && <button type="button" className="-mt-1 mb-3 text-left text-xs font-semibold text-accent" onClick={() => { codigoManual.current = false; cambiar('codigo', codigoSugerido) }}>Usar el siguiente de {d.marca}: {codigoSugerido}</button>}
          <Campo label="Marca"><input className="campo" list="marcas-tienda" value={d.marca} onChange={(e) => cambiar('marca', e.target.value)} placeholder="GOLDEN GOOSE" /><datalist id="marcas-tienda">{marcas.map((m) => <option key={m} value={m} />)}</datalist></Campo>
          <Campo label="Categoría"><select className="campo" value={d.categoria} onChange={(e) => { const c = e.target.value; setD((x) => ({ ...x, categoria: c, subcategoria: (SUBCATEGORIAS[c] ?? [])[0] ?? '' })); setSucio(true) }}>{CATEGORIAS.map((c) => <option key={c}>{c}</option>)}</select></Campo>
          {(SUBCATEGORIAS[d.categoria] ?? []).length > 0 && <Campo label={d.categoria === 'Accesorios' ? 'Accesorio de' : 'Subcategoría'}><select className="campo" value={d.subcategoria} onChange={(e) => {
            // En la tienda los accesorios (bolsos, carteras, gorras…) van en Categoría "Accesorios" y
            // la subcategoría dice si son de Hombre o Dama. Elegir "Accesorios" desde Dama/Hombre los mueve ahí.
            const v = e.target.value
            if (v === '__accesorios') { setD((x) => ({ ...x, categoria: 'Accesorios', subcategoria: x.categoria === 'Dama' ? 'Dama' : 'Hombre' })); setSucio(true) }
            else cambiar('subcategoria', v)
          }}>{(SUBCATEGORIAS[d.categoria] ?? []).map((s) => <option key={s}>{s}</option>)}{d.categoria !== 'Accesorios' && d.categoria !== 'Decoración' && <option value="__accesorios">Accesorios (bolsos, carteras, gorras…)</option>}</select>
            {d.categoria === 'Accesorios' && <span className="mt-1 block text-[11px] text-muted">En la tienda sale en Accesorios › {d.subcategoria || 'Hombre'}</span>}</Campo>}
          {esRopa && <Campo label="Tipo de prenda"><select className="campo" value={String(d.tipoPrenda ?? '')} onChange={(e) => cambiar('tipoPrenda', e.target.value)}><option value="">—</option>{TIPOS_ROPA.map((t) => <option key={t}>{t}</option>)}</select></Campo>}
        </Seccion>
        <Seccion titulo="Etiquetas">
          <div className="flex flex-wrap gap-2">
            <Etiqueta texto="Nuevo" on={Boolean(d.destacadoNuevo)} onClick={() => cambiar('destacadoNuevo', !d.destacadoNuevo)} />
            {ETIQUETAS.map(([k, t]) => <Etiqueta key={k} texto={t} on={Boolean(d[k])} onClick={() => cambiar(k, !d[k])} />)}
          </div>
        </Seccion>
        <Seccion titulo="Así se ve en la tienda">
          <div className="mx-auto max-w-64 overflow-hidden rounded-2xl border border-line bg-[#FCFBF9] text-center text-[#171310]">
            <div className="relative aspect-square bg-[#F1EFEA]">{fotoPrev && <img src={fotoPrev} alt="" className={`h-full w-full ${d.imagenFit === 'contain' ? 'object-contain' : 'object-cover'}`} />}
              {disp.tipo === 'ei' ? <i className="absolute left-2 top-2 rounded bg-[#171310] px-1.5 py-0.5 text-[9px] font-semibold not-italic uppercase tracking-wider text-[#fff]">Entrega inmediata</i>
                : !d.cotizar && oferta > 0 && oferta < precio ? <i className="absolute left-2 top-2 rounded bg-[#D8402E] px-1.5 py-0.5 text-[9px] font-semibold not-italic text-[#fff]">-{Math.round((1 - oferta / precio) * 100)}%</i>
                : d.destacadoNuevo ? <i className="absolute left-2 top-2 rounded bg-[#171310] px-1.5 py-0.5 text-[9px] font-semibold not-italic uppercase tracking-wider text-[#fff]">Nuevo</i> : null}
            </div>
            <div className="px-3 pb-3.5 pt-2.5"><small className="block text-[9.5px] font-semibold uppercase tracking-widest text-[#6B655C]">{d.marca || 'Marca'}</small><b className="my-1 block text-[12.5px] uppercase tracking-wide">{d.nombre || 'Nombre del producto'}</b>
              <span className="text-[17px] font-semibold">{d.cotizar ? 'Cotiza el precio' : venta ? usd(venta) : 'Precio'}</span>{!d.cotizar && oferta > 0 && oferta < precio && <s className="ml-1.5 text-[13px] text-[#9C958A]">{usd(precio)}</s>}</div>
          </div>
        </Seccion>
        {previo && <Seccion titulo="Eliminar producto">
          {!confirmarBorrar ? <button type="button" className="subtle-button min-h-10 px-3 text-[#b42318]" onClick={() => setConfirmarBorrar(true)}><Trash2 size={15} /> Eliminar este producto</button>
            : <div className="grid gap-2"><p className="text-sm">¿Seguro? Deja de salir en la tienda y en esta lista. (Si solo querés pausarlo, poné el estado en Oculto.)</p><div className="flex gap-2"><button type="button" className="min-h-10 rounded-lg bg-[#b42318] px-4 text-sm font-semibold text-[#fff]" onClick={() => void borrar()}>Sí, eliminar</button><button type="button" className="subtle-button min-h-10 px-4" onClick={() => setConfirmarBorrar(false)}>Cancelar</button></div></div>}
        </Seccion>}
      </div>
    </div>
    {guardando && <div className="fixed inset-0 z-[70] grid place-items-center bg-black/30"><span className="inline-flex items-center gap-2 rounded-xl bg-panel px-4 py-3 text-sm font-semibold shadow-xl"><LoaderCircle size={18} className="animate-spin" /> Guardando{fotos.some((x) => x.file) ? ' y subiendo fotos' : ''}…</span></div>}
  </div>
}

function confirmarSalir() { return window.confirm('Tenés cambios sin guardar. ¿Salir igual?') }
function Volver({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} aria-label="Volver a productos" className="grid size-10 shrink-0 place-items-center rounded-lg border border-line bg-panel"><ArrowLeft size={18} /></button>
}
function Seccion({ titulo, ayuda, children }: { titulo?: string; ayuda?: string; children: React.ReactNode }) {
  return <section className="rounded-xl border border-line bg-panel p-4">{titulo && <h2 className="text-sm font-semibold">{titulo}</h2>}{ayuda && <p className="mt-0.5 text-xs text-muted">{ayuda}</p>}<div className={titulo ? 'mt-3' : ''}>{children}</div></section>
}
function Campo({ label, ayuda, children }: { label: string; ayuda?: string; children: React.ReactNode }) {
  return <label className="mb-3 grid gap-1.5 text-sm"><span className="font-medium">{label}</span>{children}{ayuda && <span className="text-xs text-muted">{ayuda}</span>}</label>
}
function BotonTalla({ t, estado, onClick }: { t: string; estado?: EstadoTalla; onClick: () => void }) {
  const cls = estado === 'ei' ? 'border-[#1a1a1a] bg-[#1a1a1a] text-[#fff] ring-2 ring-[#1a1a1a] ring-offset-2 ring-offset-panel' : estado === 'encargo' ? 'border-2 border-[#303030] bg-panel text-white' : 'border-line bg-panel text-muted'
  return <button type="button" onClick={onClick} aria-pressed={Boolean(estado)} title={estado === 'ei' ? 'En Nicaragua' : estado === 'encargo' ? 'Por encargo' : 'No disponible'} className={`min-h-11 min-w-12 rounded-lg border px-2 text-sm font-semibold ${cls}`}>{t}</button>
}
function Etiqueta({ texto, on, onClick }: { texto: string; on: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} aria-pressed={on} className={`min-h-10 rounded-full border px-3 text-sm ${on ? 'border-[#1a1a1a] bg-[#1a1a1a] text-[#fff]' : 'border-line text-muted'}`}>{on ? '✓ ' : ''}{texto}</button>
}
