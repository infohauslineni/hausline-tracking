import { Eye, EyeOff, ImagePlus, LoaderCircle, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useAuth } from '../../contexts/AuthContext'
import { conectadoCatalogo, vistaPrevia } from '../../services/productosTienda.service'
import { aJpeg, catalogo } from '../../services/ventaLibre.service'
import { ConectarTienda } from './VentaLibrePage'

// BANNERS: el aviso emergente que sale al abrir la tienda (antes en admin.html). Tabla `banners`
// del proyecto del CATÁLOGO; la imagen va al bucket `catalogo` (banners/<ts>.jpg). Desde / Hasta
// opcionales: el banner se prende y se apaga solo (RPC banners_activos de la tienda).
type Banner = { id: string; imagen_url: string; enlace: string | null; titulo: string | null; activo: boolean; inicia_at: string | null; finaliza_at: string | null }

const aLocal = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); if (Number.isNaN(d.getTime())) return ''; const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}` }
const aIso = (v: string) => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString() }
const fecha = (iso: string) => new Date(iso).toLocaleString('es-NI', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
function estado(b: Banner): { texto: string; clase: string } {
  if (!b.activo) return { texto: 'Oculto', clase: 'bg-white/[0.06] text-muted' }
  const ahora = Date.now()
  if (b.inicia_at && new Date(b.inicia_at).getTime() > ahora) return { texto: 'Programado', clase: 'bg-amber-500/15 text-amber-200' }
  if (b.finaliza_at && new Date(b.finaliza_at).getTime() < ahora) return { texto: 'Terminó', clase: 'bg-white/[0.06] text-muted' }
  return { texto: 'Activo', clase: 'bg-emerald-500/15 text-emerald-300' }
}

export function BannersPage() {
  const { user } = useAuth()
  const [conectado, setConectado] = useState<boolean | null>(null)
  const [lista, setLista] = useState<Banner[]>([])
  const [cargando, setCargando] = useState(true)
  const [archivo, setArchivo] = useState<File | null>(null)
  const [titulo, setTitulo] = useState('')
  const [enlace, setEnlace] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [subiendo, setSubiendo] = useState(false)
  const [borrando, setBorrando] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const prev = archivo ? URL.createObjectURL(archivo) : ''

  const cargar = async () => {
    setCargando(true)
    const { data, error } = await catalogo().from('banners').select('id, imagen_url, enlace, titulo, activo, inicia_at, finaliza_at').order('orden', { ascending: true }).order('created_at', { ascending: false })
    if (error) toast.error('No se pudieron cargar los banners.')
    setLista((data ?? []) as Banner[]); setCargando(false)
  }
  useEffect(() => { void conectadoCatalogo().then((ok) => { setConectado(ok); if (ok) void cargar(); else setCargando(false) }) }, [])

  const agregar = async () => {
    if (vistaPrevia) return toast.error('Vista previa local: no se guarda nada.')
    if (!archivo) return toast.error('Elegí una imagen primero.')
    setSubiendo(true)
    try {
      const ruta = `banners/${Date.now()}.jpg`
      const { error: e1 } = await catalogo().storage.from('catalogo').upload(ruta, await aJpeg(archivo), { contentType: 'image/jpeg', upsert: true, cacheControl: '31536000' })
      if (e1) throw e1
      const url = catalogo().storage.from('catalogo').getPublicUrl(ruta).data.publicUrl
      const { error } = await catalogo().from('banners').insert({ imagen_url: url, enlace: enlace.trim() || null, titulo: titulo.trim() || null, inicia_at: aIso(desde), finaliza_at: aIso(hasta) })
      if (error) throw error
      setArchivo(null); setTitulo(''); setEnlace(''); setDesde(''); setHasta('')
      toast.success('Banner agregado. Ya sale en la tienda.')
      void cargar()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo agregar el banner.') }
    finally { setSubiendo(false) }
  }
  const actualizar = async (b: Banner, cambios: Partial<Banner>, aviso: string) => {
    if (vistaPrevia) return toast.error('Vista previa local: no se guarda nada.')
    const { error } = await catalogo().from('banners').update(cambios).eq('id', b.id)
    if (error) return toast.error('No se pudo guardar.')
    setLista((l) => l.map((x) => (x.id === b.id ? { ...x, ...cambios } : x))); toast.success(aviso)
  }
  const borrar = async (b: Banner) => {
    if (vistaPrevia) return toast.error('Vista previa local: no se guarda nada.')
    const { error } = await catalogo().from('banners').delete().eq('id', b.id)
    if (error) return toast.error('No se pudo borrar.')
    setLista((l) => l.filter((x) => x.id !== b.id)); setBorrando(null); toast.success('Banner borrado.')
  }

  const cab = <div><p className="eyebrow">Tienda</p><h1 className="page-title">Banners</h1><p className="page-subtitle">El aviso que sale al abrir la tienda. Subí la imagen, ponele el link y, si querés, desde y hasta cuándo se muestra.</p></div>
  if (conectado === false) return <div>{cab}<ConectarTienda email={user?.email ?? ''} onOk={() => { setConectado(true); void cargar() }} /></div>

  return <div>
    {cab}
    <div className="mt-5 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <section className="rounded-xl border border-line bg-panel p-4">
        <h2 className="text-sm font-semibold">Nuevo banner</h2>
        <button type="button" onClick={() => fileRef.current?.click()} className="mt-3 grid min-h-40 w-full place-items-center overflow-hidden rounded-xl border-2 border-dashed border-line text-sm text-muted hover:border-accent hover:text-accent">
          {prev ? <img src={prev} alt="" className="max-h-72 object-contain" /> : <span className="grid justify-items-center gap-1 p-4"><ImagePlus size={24} />Elegir imagen<small className="text-xs">Ideal vertical, tipo historia (~800 × 1000)</small></span>}
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); e.target.value = '' }} />
        <label className="mt-3 grid gap-1.5 text-sm"><span className="font-medium">Nombre (solo para vos)</span><input className="campo" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej.: Black Friday" /></label>
        <label className="mt-3 grid gap-1.5 text-sm"><span className="font-medium">Link al tocar la imagen</span><input className="campo" value={enlace} onChange={(e) => setEnlace(e.target.value)} placeholder="Ej.: /p/GG001/  o  /?cupon=HAUS10" /></label>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm"><span className="font-medium">Desde (opcional)</span><input className="campo" type="datetime-local" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
          <label className="grid gap-1.5 text-sm"><span className="font-medium">Hasta (opcional)</span><input className="campo" type="datetime-local" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        </div>
        <p className="mt-2 text-xs text-muted">Sin fechas, sale siempre. Con "Hasta", se apaga solo ese día.</p>
        <button type="button" className="primary-button mt-4 min-h-11 w-full" disabled={subiendo} onClick={() => void agregar()}>{subiendo ? <><LoaderCircle size={16} className="animate-spin" /> Subiendo…</> : 'Agregar banner'}</button>
      </section>

      <section className="rounded-xl border border-line bg-panel p-4">
        <h2 className="text-sm font-semibold">Banners</h2>
        {cargando ? <div className="mt-3 space-y-2">{[0, 1].map((i) => <div key={i} className="h-24 animate-pulse rounded-lg bg-white/[0.04]" />)}</div>
          : !lista.length ? <p className="mt-3 text-sm text-muted">Todavía no hay banners.</p>
          : <ul className="mt-2 divide-y divide-line">{lista.map((b) => { const st = estado(b); return <li key={b.id} className="grid gap-3 py-3 sm:grid-cols-[64px_minmax(0,1fr)]">
            <img src={b.imagen_url} alt="" className="h-20 w-16 rounded-lg border border-line object-cover" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><span className={`rounded-md px-2 py-0.5 text-xs font-medium ${st.clase}`}>{st.texto}</span><b className="truncate text-sm">{b.titulo || 'Banner'}</b></div>
              <p className="mt-0.5 truncate text-xs text-muted">{b.enlace || 'Sin link'} · {b.inicia_at || b.finaliza_at ? `${b.inicia_at ? `desde ${fecha(b.inicia_at)}` : 'ya'} ${b.finaliza_at ? `hasta ${fecha(b.finaliza_at)}` : 'sin fin'}` : 'sale siempre'}</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className="grid gap-1 text-xs text-muted">Desde<input className="campo" type="datetime-local" defaultValue={aLocal(b.inicia_at)} onBlur={(e) => { const v = aIso(e.target.value); if (v !== b.inicia_at) void actualizar(b, { inicia_at: v }, 'Fecha guardada.') }} /></label>
                <label className="grid gap-1 text-xs text-muted">Hasta<input className="campo" type="datetime-local" defaultValue={aLocal(b.finaliza_at)} onBlur={(e) => { const v = aIso(e.target.value); if (v !== b.finaliza_at) void actualizar(b, { finaliza_at: v }, 'Fecha guardada.') }} /></label>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className="subtle-button min-h-10 px-3" onClick={() => void actualizar(b, { activo: !b.activo }, b.activo ? 'Banner oculto.' : 'Banner visible.')}>{b.activo ? <><EyeOff size={15} /> Ocultar</> : <><Eye size={15} /> Mostrar</>}</button>
                {borrando === b.id
                  ? <><button type="button" className="min-h-10 rounded-lg bg-[#b42318] px-3 text-sm font-semibold text-[#fff]" onClick={() => void borrar(b)}>Sí, borrar</button><button type="button" className="subtle-button min-h-10 px-3" onClick={() => setBorrando(null)}>No</button></>
                  : <button type="button" className="subtle-button min-h-10 px-3 text-[#b42318]" onClick={() => setBorrando(b.id)}><Trash2 size={15} /> Borrar</button>}
              </div>
            </div>
          </li> })}</ul>}
      </section>
    </div>
  </div>
}
