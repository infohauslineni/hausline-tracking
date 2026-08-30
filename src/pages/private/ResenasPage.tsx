import { Check, EyeOff, Plus, Star, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { isSupabaseConfigured } from '../../lib/supabase'
import { aprobarResena, crearResena, destacarResena, eliminarResena, listarResenas, type Resena } from '../../services/resenas.service'

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
  const [filtro, setFiltro] = useState<Filtro>('pendientes')
  const [agregando, setAgregando] = useState(false)

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
      {!isSupabaseConfigured && <div className="preview-banner"><strong>Vista previa local:</strong> las reseñas requieren conexión a Supabase.</div>}

      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Reseñas</p>
          <h1 className="page-title">Reseñas de clientes</h1>
          <p className="page-subtitle">Aprobá las reseñas para que salgan en la tienda. Solo las aprobadas se muestran; las destacadas salen primero en el inicio.</p>
        </div>
        <button className="primary-button shrink-0" onClick={() => setAgregando((v) => !v)}>
          {agregando ? <><X size={16} /> Cerrar</> : <><Plus size={16} /> Agregar reseña</>}
        </button>
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
                  <button className="table-action whitespace-nowrap" disabled={busy === r.id} onClick={() => void accion(r.id, () => aprobarResena(r.id, false), 'Reseña ocultada.')}><EyeOff size={15} /> Ocultar</button>
                ) : (
                  <button className="primary-button min-h-9 px-3 text-xs whitespace-nowrap" disabled={busy === r.id} onClick={() => void accion(r.id, () => aprobarResena(r.id, true), 'Reseña aprobada. Ya se ve en la tienda.')}><Check size={15} /> Aprobar</button>
                )}
                <button className="table-action whitespace-nowrap" disabled={busy === r.id} onClick={() => void accion(r.id, () => destacarResena(r.id, !r.destacada), r.destacada ? 'Quitada de destacadas.' : 'Marcada como destacada.')}><Star size={15} className={r.destacada ? 'fill-accent text-accent' : ''} /> {r.destacada ? 'Quitar destacada' : 'Destacar'}</button>
                <button className="table-action table-action-danger ml-auto whitespace-nowrap" disabled={busy === r.id} onClick={() => { if (confirm('¿Eliminar esta reseña? No se puede deshacer.')) void accion(r.id, () => eliminarResena(r.id), 'Reseña eliminada.') }}><Trash2 size={15} /> Eliminar</button>
              </div>
            </div>
          ))}
        </div>
      )}
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
