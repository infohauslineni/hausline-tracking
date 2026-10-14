import { ChevronDown, Clock3, Plane, Search, Store, Timer } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { isSupabaseConfigured } from '../../lib/supabase'
import { obtenerTiemposReales, type Estadistica, type GrupoTiempos } from '../../services/tiemposReales.service'
import { leerPreparacionTienda, type PreparacionTienda } from '../../services/ventaLibre.service'
import { guardarPreparacionReal, obtenerPreparacionReal, type PreparacionReal } from '../../services/preparacionReal.service'

// REPORTES → TIEMPOS REALES. Cuánto tarda de verdad cada marca y cada producto en prepararse
// (En preparación → Control de calidad) y en llegar (Control de calidad → Nicaragua), comparado
// con lo que promete la tienda. "Usar en la tienda" guarda el tiempo real (configuracion
// preparacion_tienda): lo usa la tienda para TODOS esos productos y la fecha estimada de sus pedidos.

const PREP_GENERAL = { min: 4, max: 5 } // lo que la tienda promete sin dato propio (config.js)
const dias = (n: number) => `${n % 1 === 0 ? n : n.toFixed(1)} ${n === 1 ? 'día' : 'días'}`
const rango = (a: number, b: number) => (a === b ? dias(a) : `${a} a ${b} días`)

type Vista = 'marcas' | 'productos'

export function TiemposReales() {
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof obtenerTiemposReales>> | null>(null)
  const [tienda, setTienda] = useState<PreparacionTienda[] | null>(null)
  const [vista, setVista] = useState<Vista>('marcas')
  const [buscar, setBuscar] = useState('')
  const [abierto, setAbierto] = useState<string | null>(null)
  const [guardando, setGuardando] = useState<string | null>(null)
  const [prep, setPrep] = useState<PreparacionReal | null>(null)

  useEffect(() => {
    if (!isSupabaseConfigured) return
    void obtenerTiemposReales().then(setDatos).catch(() => toast.error('No se pudieron leer los tiempos.'))
    void leerPreparacionTienda().then(setTienda).catch(() => setTienda([]))
    void obtenerPreparacionReal().then(setPrep).catch(() => setPrep({ marcas: {}, productos: {} }))
  }, [])

  const tiendaPorCodigo = useMemo(() => new Map((tienda ?? []).map((t) => [t.codigo, t])), [tienda])
  // Lo que promete HOY la tienda. Orden (igual que la tienda): tiempo real del producto → tiempo
  // real de la marca → "Preparación aprox." del admin → general (4 a 5 días).
  const promesa = (g: GrupoTiempos, deMarca: boolean) => {
    const real = deMarca ? prep?.marcas[g.marca] : (prep?.productos[g.codigos[0]] ?? prep?.marcas[g.marca])
    const propio = deMarca ? prep?.marcas[g.marca] : prep?.productos[g.codigos[0]]
    if (real) return { texto: `${rango(real.min, real.max)}`, min: real.min, origen: propio ? 'tiempo real' : 'tiempo real de la marca', guardado: !!propio }
    const filas = deMarca ? (tienda ?? []).filter((t) => t.marca === g.marca) : g.codigos.map((c) => tiendaPorCodigo.get(c)).filter((t): t is PreparacionTienda => !!t)
    const conDato = filas.filter((t) => t.prepMin > 0)
    if (!conDato.length) return { texto: rango(PREP_GENERAL.min, PREP_GENERAL.max), min: PREP_GENERAL.min, origen: 'general', guardado: false }
    const textos = [...new Set(conDato.map((t) => rango(t.prepMin, Math.max(t.prepMin, t.prepMax))))]
    return { texto: textos.length === 1 && conDato.length === filas.length ? textos[0] : 'Varía por producto', min: Math.min(...conDato.map((t) => t.prepMin)), origen: 'admin de la tienda', guardado: false }
  }

  const usarEnTienda = async (g: GrupoTiempos, deMarca: boolean, quitar = false) => {
    const p = g.preparacion
    if (!p && !quitar) return
    const clave = deMarca ? g.marca : g.codigos[0]
    if (!quitar && !window.confirm(`¿Que la tienda prometa ${rango(p!.desde, p!.hasta)} de preparación para ${deMarca ? `todos los productos de ${g.nombre}` : g.nombre}? También se usa para la fecha estimada de sus pedidos.`)) return
    setGuardando(g.clave)
    try {
      setPrep(await guardarPreparacionReal(deMarca ? 'marcas' : 'productos', clave, quitar ? null : { min: p!.desde, max: p!.hasta }))
      toast.success(quitar ? 'Listo: vuelve a lo del admin de la tienda (o al tiempo general).' : `Listo: ${deMarca ? g.nombre : clave} ahora promete ${rango(p!.desde, p!.hasta)} de preparación.`)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo guardar.') } finally { setGuardando(null) }
  }

  if (!isSupabaseConfigured) return <p className="text-sm text-muted">Disponible con la base conectada.</p>
  if (!datos) return <div className="h-40 animate-pulse rounded-2xl border border-line bg-panel" />
  const lista = (vista === 'marcas' ? datos.marcas : datos.productos)
    .filter((g) => !buscar.trim() || `${g.nombre} ${g.marca} ${g.codigos.join(' ')}`.toLowerCase().includes(buscar.trim().toLowerCase()))

  return <div>
    <p className="max-w-3xl text-sm text-muted">Cuánto tarda <b className="text-white">de verdad</b> cada producto, medido con tus pedidos: la <b className="text-white">preparación</b> va desde que el pedido pasa a <i>En preparación</i> hasta que lo marcás <i>Control de calidad</i>; el <b className="text-white">envío</b>, desde Control de calidad hasta que llega a Nicaragua.</p>

    <section className="mt-4 grid gap-3 sm:grid-cols-2">
      <Resumen icon={Timer} titulo="Preparación real (todos)" e={datos.general.preparacion} promesa={`La tienda promete ${rango(PREP_GENERAL.min, PREP_GENERAL.max)} en general`} />
      <Resumen icon={Plane} titulo="Envío real (todos)" e={datos.general.envio} promesa="La tienda promete 20 a 25 días en total (preparación + envío, estándar)" />
    </section>

    <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="inline-flex rounded-xl border border-line bg-white/[.02] p-1">
        {(['marcas', 'productos'] as Vista[]).map((v) => <button key={v} type="button" onClick={() => { setVista(v); setAbierto(null) }} className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition ${vista === v ? 'bg-accent text-black' : 'text-muted hover:text-white'}`}>{v === 'marcas' ? 'Por marca' : 'Por producto'}</button>)}
      </div>
      <div className="relative sm:w-64"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} /><input className="search-input" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder={vista === 'marcas' ? 'Buscar marca' : 'Código o producto'} /></div>
    </div>

    <div className="mt-3 space-y-2">
      {lista.map((g) => {
        const p = g.preparacion, prom = promesa(g, vista === 'marcas')
        const diferencia = p ? p.mediana - prom.min : 0
        const tono = !p ? 'text-muted' : diferencia >= 2 ? 'text-amber-200' : diferencia <= -2 ? 'text-emerald-300' : 'text-white'
        const abiertoAqui = abierto === g.clave
        return <article key={g.clave} className="rounded-2xl border border-line bg-panel">
          <button type="button" onClick={() => setAbierto(abiertoAqui ? null : g.clave)} className="grid w-full gap-3 p-4 text-left sm:grid-cols-[minmax(0,1.4fr)_1fr_1fr_1fr_auto] sm:items-center">
            <div className="min-w-0"><strong className="block truncate text-sm">{g.nombre}</strong><span className="text-[11px] text-muted">{vista === 'productos' ? `${g.codigos[0]} · ${g.marca} · ` : ''}{g.mediciones.length} {g.mediciones.length === 1 ? 'pedido medido' : 'pedidos medidos'}{p && p.n < 3 ? ' · pocos datos' : ''}</span></div>
            <Dato etiqueta="Preparación real" valor={p ? `${dias(p.mediana)}` : '—'} sub={p ? `normal ${rango(p.desde, p.hasta)}` : 'sin Control de calidad aún'} tono={tono} />
            <Dato etiqueta="La tienda promete" valor={prom.texto} sub={`${prom.origen}${p && Math.abs(diferencia) >= 2 ? (diferencia > 0 ? ` · tarda ~${dias(Math.round(diferencia))} más` : ` · tarda ~${dias(Math.round(-diferencia))} menos`) : ''}`} tono={tono} />
            <Dato etiqueta="Envío real" valor={g.envio ? dias(g.envio.mediana) : '—'} sub={g.envio ? `normal ${rango(g.envio.desde, g.envio.hasta)}` : 'aún no llega'} />
            <ChevronDown size={16} className={`justify-self-end text-muted transition ${abiertoAqui ? 'rotate-180' : ''}`} />
          </button>
          {abiertoAqui && <div className="border-t border-line p-4">
            {p && <div className="mb-3 flex flex-col gap-2 rounded-xl border border-accent/25 bg-accent/[.05] p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-white/85"><Store size={13} className="mr-1 inline text-accent" />Prometer en la tienda <b>{rango(p.desde, p.hasta)}</b> de preparación{vista === 'marcas' ? ` a todos los productos de ${g.nombre}` : ''} y usarlo en la fecha estimada de sus pedidos. {p.n < 3 && <span className="text-amber-200">Con pocos pedidos todavía puede cambiar.</span>}</p>
              <div className="flex shrink-0 gap-2">{prom.guardado && <button type="button" className="subtle-button px-3 text-xs" disabled={guardando === g.clave} onClick={() => void usarEnTienda(g, vista === 'marcas', true)}>Quitar</button>}<button type="button" className="primary-button px-4 text-xs" disabled={guardando === g.clave} onClick={() => void usarEnTienda(g, vista === 'marcas')}>{guardando === g.clave ? 'Guardando…' : prom.guardado ? 'Actualizar' : 'Usar en la tienda'}</button></div>
            </div>}
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Pedidos medidos</p>
            <div className="grid gap-1 text-xs sm:grid-cols-2">
              {g.mediciones.slice(0, 30).map((m) => <Link key={m.pedidoId} to={`/pedidos/${m.pedidoId}`} className="flex justify-between gap-3 rounded-lg px-2 py-1 hover:bg-white/[.04]"><span className="font-mono text-white/85">{m.codigoPedido}</span><span className="text-muted"><Clock3 size={11} className="mr-1 inline" />{m.preparacion != null ? `prep. ${dias(m.preparacion)}` : 'prep. —'} · {m.envio != null ? `envío ${dias(m.envio)}` : 'envío —'}</span></Link>)}
            </div>
          </div>}
        </article>
      })}
      {!lista.length && <p className="rounded-2xl border border-dashed border-line p-8 text-center text-sm text-muted">Todavía no hay pedidos que hayan pasado de En preparación a Control de calidad{buscar ? ' con esa búsqueda' : ''}.</p>}
    </div>
  </div>
}

function Resumen({ icon: Icon, titulo, e, promesa }: { icon: typeof Timer; titulo: string; e: Estadistica | null; promesa: string }) {
  return <div className="rounded-2xl border border-line bg-panel p-4">
    <p className="flex items-center gap-2 text-xs font-semibold text-muted"><Icon size={15} className="text-accent" /> {titulo}</p>
    <strong className="mt-2 block text-2xl tabular-nums">{e ? dias(e.mediana) : '—'}</strong>
    <p className="mt-1 text-[11px] text-muted">{e ? `Lo normal: ${rango(e.desde, e.hasta)} · ${e.n} pedidos · más rápido ${dias(e.min)}, más lento ${dias(e.max)}` : 'Sin datos todavía'}</p>
    <p className="mt-1 text-[11px] text-muted">{promesa}</p>
  </div>
}

function Dato({ etiqueta, valor, sub, tono = 'text-white' }: { etiqueta: string; valor: string; sub?: string; tono?: string }) {
  return <div><span className="block text-[10px] uppercase tracking-wider text-muted">{etiqueta}</span><b className={`block text-sm ${tono}`}>{valor}</b>{sub && <span className="block text-[11px] text-muted">{sub}</span>}</div>
}
