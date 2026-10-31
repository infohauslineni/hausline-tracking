import { Check, EyeOff, Mail, Plus, Share2, Star, Trash2, X } from 'lucide-react'
import { ClientesTabs } from '../../components/layout/LibresTabs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useEstadoVista } from '../../hooks/useEstadoVista'
import { toast } from 'sonner'
import { isSupabaseConfigured } from '../../lib/supabase'
import { aprobarResena, crearResena, destacarResena, eliminarResena, listarResenas, pedirResenasAhora, type Resena, type ResultadoPedirResenas } from '../../services/resenas.service'
import { listarProductos } from '../../services/comercial.service'
import { HistoriaResenaModal } from '../../components/resenas/HistoriaResenaModal'
import type { Producto } from '../../types/domain'

type Filtro = 'pendientes' | 'aprobadas' | 'todas'

const fechaCorta = (iso: string) => new Intl.DateTimeFormat('es-NI', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso))

function Estrellas({ n }: { n: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${n} de 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={14} className={i <= n ? 'fill-accent text-accent' : 'text-muted'} />
      ))}
    </span>
  )
}

export function ResenasPage() {
  const [items, setItems] = useState<Resena[]>([])
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [busy, setBusy] = useState<string | null>(null)
  const [filtro, setFiltro] = useEstadoVista<Filtro>('resenas.filtro', 'pendientes')
  const [agregando, setAgregando] = useState(false)
  // Compartir en historia (Instagram): la reseña elegida + la foto del producto del catálogo.
  const [compartiendo, setCompartiendo] = useState<Resena | null>(null)
  const [productos, setProductos] = useState<Producto[]>([])
  useEffect(() => { if (isSupabaseConfigured) void listarProductos().then(setProductos).catch(() => undefined) }, [])
  const productoCompartido = useMemo(() => { const c = (compartiendo?.producto_codigo ?? '').trim().toUpperCase(); const p = c ? productos.find((x) => (x.codigo ?? '').trim().toUpperCase() === c) : null; return p ? { nombre: p.nombre, marca: p.marca, imagen: p.imagen } : null }, [compartiendo, productos])

  const cargar = useCallback(async (silencioso = false) => {
    if (!isSupabaseConfigured) { setLoading(false); return }
    try { setItems(await listarResenas()) }
    catch { if (!silencioso) toast.error('No se pudieron cargar las reseñas. ¿Aplicaste la migración 202608290001?') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void cargar() }, [cargar])

  const pendientes = useMemo(() => items.filter((r) => !r.aprobada), [items])
  const visibles = useMemo(() => {
    if (filtro === 'pendientes') return pendientes
    if (filtro === 'aprobadas') return items.filter((r) => r.aprobada)
    return items
  }, [items, pendientes, filtro])

  const accion = async (id: string, fn: () => Promise<void>, ok: string) => {
    setBusy(id)
    try { await fn(); toast.success(ok); await cargar(true) }
    catch { toast.error('No se pudo completar la acción.') }
    finally { setBusy(null) }
  }

  return (
    <div>
      <ClientesTabs />
      {!isSupabaseConfigured && <div className="preview-banner"><strong>Vista previa local:</strong> las reseñas requieren conexión a Supabase.</div>}

      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Reseñas</p>
          <h1 className="page-title">Reseñas de clientes</h1>
          <p className="page-subtitle">Aprobá las reseñas para que salgan en la tienda. Solo las aprobadas se muestran; las destacadas salen primero en el inicio.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <PedirResenas />
          <button className="primary-button shrink-0" onClick={() => setAgregando((v) => !v)}>
            {agregando ? <><X size={16} /> Cerrar</> : <><Plus size={16} /> Agregar reseña</>}
          </button>
        </div>
      </div>

      {agregando && <FormAgregar onListo={() => { setAgregando(false); void cargar(true) }} />}

      <div className="mt-6 flex flex-wrap gap-2">
        {([['pendientes', `Pendientes${pendientes.length ? ` (${pendientes.length})` : ''}`], ['aprobadas', 'Aprobadas'], ['todas', 'Todas']] as [Filtro, string][]).map(([v, t]) => (
          <button key={v} className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${filtro === v ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line text-muted hover:text-white'}`} onClick={() => setFiltro(v)}>{t}</button>
        ))}
      </div>

      {loading ? (
        <div className="mt-5 h-64 animate-pulse rounded-2xl border border-line bg-panel" />
      ) : visibles.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-line bg-panel px-6 py-16 text-center">
          <Star size={30} className="mx-auto text-muted" />
          <p className="mt-3 text-sm text-muted">{filtro === 'pendientes' ? 'No hay reseñas pendientes de aprobar.' : 'No hay reseñas todavía.'}</p>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {visibles.map((r) => (
            <div key={r.id} className="rounded-2xl border border-line bg-panel p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Estrellas n={r.estrellas} />
                    <span className="text-sm font-bold">{r.cliente_nombre}</span>
                    {!r.aprobada && <span className="rounded-full bg-amber-400/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-300">Pendiente</span>}
                    {r.destacada && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">Destacada</span>}
                  </div>
                  {r.comentario && <p className="mt-2 text-sm text-muted">{r.comentario}</p>}
                  <p className="mt-2 text-[11px] uppercase tracking-wide text-muted">
                    {[r.producto_codigo ? `Producto ${r.producto_codigo}` : null, r.pedido_codigo ? `Pedido ${r.pedido_codigo}` : null, fechaCorta(r.created_at)].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {r.aprobada ? (
                  <button className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white/[0.02] px-3 py-2 text-xs font-semibold text-muted transition hover:border-white/20 hover:text-white" disabled={busy === r.id} onClick={() => void accion(r.id, () => aprobarResena(r.id, false), 'Reseña ocultada.')}><EyeOff size={15} /> Ocultar</button>
                ) : (
                  <button className="primary-button min-h-9 px-3 text-xs whitespace-nowrap" disabled={busy === r.id} onClick={() => void accion(r.id, () => aprobarResena(r.id, true), 'Reseña aprobada. Ya se ve en la tienda.')}><Check size={15} /> Aprobar</button>
                )}
                <button className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white/[0.02] px-3 py-2 text-xs font-semibold text-muted transition hover:border-white/20 hover:text-white" disabled={busy === r.id} onClick={() => void accion(r.id, () => destacarResena(r.id, !r.destacada), r.destacada ? 'Quitada de destacadas.' : 'Marcada como destacada.')}><Star size={15} className={r.destacada ? 'fill-accent text-accent' : ''} /> {r.destacada ? 'Quitar destacada' : 'Destacar'}</button>
                <button className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white/[0.02] px-3 py-2 text-xs font-semibold text-muted transition hover:border-white/20 hover:text-white" onClick={() => setCompartiendo(r)}><Share2 size={15} /> Compartir en historia</button>
                <button className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-line bg-white/[0.02] px-3 py-2 text-xs font-semibold text-muted transition hover:border-red-400/40 hover:text-red-300" disabled={busy === r.id} onClick={() => { if (confirm('¿Eliminar esta reseña? No se puede deshacer.')) void accion(r.id, () => eliminarResena(r.id), 'Reseña eliminada.') }}><Trash2 size={15} /> Eliminar</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {compartiendo && <HistoriaResenaModal resena={compartiendo} producto={productoCompartido} onClose={() => setCompartiendo(null)} />}
    </div>
  )
}

function FormAgregar({ onListo }: { onListo: () => void }) {
  const [nombre, setNombre] = useState('')
  const [estrellas, setEstrellas] = useState(5)
  const [comentario, setComentario] = useState('')
  const [producto, setProducto] = useState('')
  const [guardando, setGuardando] = useState(false)

  const guardar = async () => {
    if (nombre.trim().length < 2) { toast.error('Escribí el nombre del cliente.'); return }
    setGuardando(true)
    try {
      await crearResena({ cliente_nombre: nombre, estrellas, comentario, producto_codigo: producto })
      toast.success('Reseña agregada y publicada.')
      onListo()
    } catch { toast.error('No se pudo guardar la reseña.') }
    finally { setGuardando(false) }
  }

  return (
    <div className="mt-5 rounded-2xl border border-line bg-panel p-5">
      <p className="mb-4 text-sm font-semibold">Agregar una reseña real (queda publicada)</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="mb-1 block text-xs font-semibold text-muted">Nombre del cliente</span><input className="simple-input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. María G." maxLength={60} /></label>
        <label className="block"><span className="mb-1 block text-xs font-semibold text-muted">Código de producto (opcional)</span><input className="simple-input" value={producto} onChange={(e) => setProducto(e.target.value)} placeholder="Ej. AM005" /></label>
      </div>
      <div className="mt-3">
        <span className="mb-1 block text-xs font-semibold text-muted">Calificación</span>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((i) => (
            <button key={i} type="button" onClick={() => setEstrellas(i)} aria-label={`${i} estrellas`}><Star size={26} className={i <= estrellas ? 'fill-accent text-accent' : 'text-muted'} /></button>
          ))}
        </div>
      </div>
      <label className="mt-3 block"><span className="mb-1 block text-xs font-semibold text-muted">Comentario (opcional)</span><textarea className="simple-input" rows={3} value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Lo que dijo el cliente…" maxLength={500} /></label>
      <div className="mt-4 flex justify-end">
        <button className="primary-button" disabled={guardando} onClick={() => void guardar()}>{guardando ? 'Guardando…' : 'Guardar reseña'}</button>
      </div>
    </div>
  )
}

// "Pedir reseñas ahora": correo a los clientes entregados hace 1–14 días que no dejaron reseña.
// (La automatización lo hace sola cada 15 min de 9 a. m. a 8 p. m.; este botón lo manda ya.)
function PedirResenas() {
  const [enviando, setEnviando] = useState(false)
  const [r, setR] = useState<ResultadoPedirResenas | null>(null)
  const pedir = async () => {
    setEnviando(true)
    try {
      const res = await pedirResenasAhora(); setR(res)
      toast.success(res.enviados.length ? `Listo: se pidió reseña a ${res.enviados.length} ${res.enviados.length === 1 ? 'cliente' : 'clientes'}.` : 'No había clientes nuevos a quienes pedirles reseña.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudieron pedir las reseñas.') }
    finally { setEnviando(false) }
  }
  const linea = (l: { codigo: string; nombre: string }[]) => l.map((x) => `${x.nombre || 'Cliente'} (${x.codigo})`).join(', ')
  return <div className="relative">
    <button type="button" className="subtle-button min-h-10 px-4" disabled={enviando || !isSupabaseConfigured} onClick={() => void pedir()}><Mail size={16} /> {enviando ? 'Enviando…' : 'Pedir reseñas ahora'}</button>
    {r && <div className="absolute right-0 z-20 mt-2 w-[min(92vw,360px)] rounded-xl border border-line bg-panel p-4 text-sm shadow-xl">
      <div className="flex items-start justify-between gap-2"><b>Reseñas pedidas</b><button type="button" aria-label="Cerrar" className="-m-1 grid size-8 place-items-center rounded-lg text-muted" onClick={() => setR(null)}><X size={15} /></button></div>
      <p className="mt-2"><b>{r.enviados.length}</b> {r.enviados.length === 1 ? 'correo enviado' : 'correos enviados'}{r.enviados.length ? `: ${linea(r.enviados)}` : '.'}</p>
      {r.yaPedidas.length > 0 && <p className="mt-1 text-xs text-muted">Ya se les había pedido antes: {linea(r.yaPedidas)}</p>}
      {r.yaTenian.length > 0 && <p className="mt-1 text-xs text-muted">Ya dejaron reseña: {linea(r.yaTenian)}</p>}
      {r.sinCorreo.length > 0 && <p className="mt-1 text-xs text-amber-200">Sin correo registrado: {linea(r.sinCorreo)}</p>}
      <p className="mt-2 text-xs text-muted">Entregados hace 1 a 14 días.</p>
    </div>}
  </div>
}
