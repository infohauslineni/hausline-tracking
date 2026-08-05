import { CheckCircle2, Clapperboard, Clock3, Link2, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Modal } from '../../components/ui/Modal'
import { cambiarEstadoIdea, eliminarIdeaContenido, guardarIdeaContenido, listarIdeasContenido } from '../../services/contenido.service'
import { listarPedidos } from '../../services/pedidos.service'
import type { IdeaContenido, Pedido } from '../../types/domain'

const emptyForm = {
  titulo: '',
  pedido_id: '',
  formato: 'reel' as IdeaContenido['formato'],
  descripcion: '',
  estado: 'pendiente_grabacion' as IdeaContenido['estado'],
  notas: '',
}

const formatLabels: Record<IdeaContenido['formato'], string> = {
  reel: 'Reel',
  historia: 'Historia',
  foto: 'Foto',
  tiktok: 'TikTok',
  otro: 'Otro',
}

export function ContenidoPage() {
  const [ideas, setIdeas] = useState<IdeaContenido[]>([])
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'todos' | IdeaContenido['estado']>('todos')
  const [editing, setEditing] = useState<IdeaContenido | null>(null)
  const [open, setOpen] = useState(false)

  const load = () => void Promise.all([listarIdeasContenido(), listarPedidos()])
    .then(([content, orders]) => { setIdeas(content); setPedidos(orders) })
    .catch(() => toast.error('No se pudo cargar el contenido privado.'))

  useEffect(load, [])

  const ordersById = useMemo(() => new Map(pedidos.map((order) => [order.id, order])), [pedidos])
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return ideas.filter((idea) => {
      const order = idea.pedido_id ? ordersById.get(idea.pedido_id) : null
      const matchesState = filter === 'todos' || idea.estado === filter
      const matchesSearch = !term || [idea.titulo, idea.descripcion, idea.notas, order?.codigo, order?.clientes?.nombre]
        .some((value) => value?.toLowerCase().includes(term))
      return matchesState && matchesSearch
    })
    // Los pendientes de grabación quedan arriba y los ya grabados se van al fondo.
    .sort((a, b) => (a.estado === 'grabado' ? 1 : 0) - (b.estado === 'grabado' ? 1 : 0))
  }, [filter, ideas, ordersById, search])

  const toggleStatus = async (idea: IdeaContenido) => {
    const next = idea.estado === 'grabado' ? 'pendiente_grabacion' : 'grabado'
    try {
      const saved = await cambiarEstadoIdea(idea.id, next)
      setIdeas((all) => all.map((item) => item.id === saved.id ? saved : item))
      toast.success(next === 'grabado' ? 'Contenido marcado como grabado.' : 'Volvió a pendientes.')
    } catch {
      toast.error('No se pudo actualizar el estado.')
    }
  }

  const remove = async (idea: IdeaContenido) => {
    if (!confirm(`¿Eliminar la idea “${idea.titulo}”?`)) return
    try {
      await eliminarIdeaContenido(idea.id)
      setIdeas((all) => all.filter((item) => item.id !== idea.id))
      toast.success('Idea eliminada.')
    } catch {
      toast.error('No se pudo eliminar la idea.')
    }
  }

  const pending = ideas.filter((idea) => idea.estado === 'pendiente_grabacion').length
  const recorded = ideas.length - pending

  return <div>
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="eyebrow">Plan de contenido</p><h1 className="page-title">Contenido privado</h1><p className="page-subtitle">Guarda qué quieres grabar y asócialo al pedido que usarás.</p></div>
      <button className="primary-button px-5" onClick={() => { setEditing(null); setOpen(true) }}><Plus size={17} /> Nueva idea</button>
    </div>

    <section className="mt-7 grid gap-3 sm:grid-cols-3">
      <Metric icon={Clapperboard} label="Ideas totales" value={ideas.length} />
      <Metric icon={Clock3} label="Pendientes de grabación" value={pending} accent />
      <Metric icon={CheckCircle2} label="Grabadas" value={recorded} green />
    </section>

    <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_240px]">
      <div className="relative"><Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" size={18} /><input className="search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Idea, pedido o cliente" /></div>
      <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
        <option value="todos">Todos los estados</option>
        <option value="pendiente_grabacion">Pendiente de grabación</option>
        <option value="grabado">Grabado</option>
      </select>
    </div>

    <section className="mt-5 grid gap-4 lg:grid-cols-2">
      {filtered.map((idea) => {
        const order = idea.pedido_id ? ordersById.get(idea.pedido_id) : null
        return <article className="panel-card flex flex-col" key={idea.id}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><span className="rounded-full bg-accent/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-accent">{formatLabels[idea.formato]}</span><h2 className="mt-3 text-lg font-semibold">{idea.titulo}</h2></div>
            <div className="flex shrink-0 gap-1"><button className="table-action" aria-label="Editar idea" onClick={() => { setEditing(idea); setOpen(true) }}><Pencil size={15} /></button><button className="table-action hover:text-red-300" aria-label="Eliminar idea" onClick={() => void remove(idea)}><Trash2 size={15} /></button></div>
          </div>
          <p className="mt-3 whitespace-pre-line text-sm leading-6 text-muted">{idea.descripcion}</p>
          {order && <Link to={`/pedidos/${order.id}`} className="mt-4 flex items-center gap-2 rounded-xl border border-line bg-white/[0.02] p-3 text-xs transition hover:border-accent/40"><Link2 size={15} className="text-accent" /><span><strong>{order.codigo}</strong><span className="ml-2 text-muted">{order.clientes?.nombre}</span></span></Link>}
          {idea.notas && <p className="mt-3 border-l border-accent/40 pl-3 text-xs text-muted">{idea.notas}</p>}
          <button className={`mt-5 flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-3 text-xs font-semibold transition ${idea.estado === 'grabado' ? 'border-green-400/25 bg-green-400/10 text-green-300' : 'border-amber-300/25 bg-amber-300/10 text-amber-200'}`} onClick={() => void toggleStatus(idea)}>
            {idea.estado === 'grabado' ? <><CheckCircle2 size={16} /> Grabado · volver a pendiente</> : <><Clock3 size={16} /> Pendiente · marcar grabado</>}
          </button>
        </article>
      })}
      {filtered.length === 0 && <div className="col-span-full rounded-2xl border border-dashed border-line py-14 text-center text-sm text-muted">No hay ideas de contenido en esta vista.</div>}
    </section>

    <IdeaModal open={open} item={editing} pedidos={pedidos} onClose={() => setOpen(false)} onSaved={(saved) => {
      setIdeas((all) => editing ? all.map((item) => item.id === saved.id ? saved : item) : [saved, ...all])
      setOpen(false)
    }} />
  </div>
}

function IdeaModal({ open, item, pedidos, onClose, onSaved }: { open: boolean; item: IdeaContenido | null; pedidos: Pedido[]; onClose: () => void; onSaved: (idea: IdeaContenido) => void }) {
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setForm(item ? {
      titulo: item.titulo,
      pedido_id: item.pedido_id ?? '',
      formato: item.formato,
      descripcion: item.descripcion,
      estado: item.estado,
      notas: item.notas ?? '',
    } : emptyForm)
  }, [item, open])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!form.titulo.trim() || !form.descripcion.trim()) return toast.error('Completa el título y la idea de grabación.')
    setSaving(true)
    try {
      const saved = await guardarIdeaContenido({ ...form, pedido_id: form.pedido_id || null, notas: form.notas || null }, item?.id)
      onSaved(saved)
      toast.success('Idea de contenido guardada.')
    } catch {
      toast.error('No se pudo guardar la idea.')
    } finally {
      setSaving(false)
    }
  }

  return <Modal open={open} onClose={onClose} title={item ? 'Editar idea de contenido' : 'Nueva idea de contenido'} description="Solo tú puedes ver este catálogo.">
    <form className="form-grid" onSubmit={(event) => void submit(event)}>
      <Field label="Título"><input value={form.titulo} onChange={(event) => setForm({ ...form, titulo: event.target.value })} placeholder="Ej. Unboxing y detalles del producto" /></Field>
      <Field label="Formato"><select value={form.formato} onChange={(event) => setForm({ ...form, formato: event.target.value as IdeaContenido['formato'] })}>{Object.entries(formatLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field>
      <label className="form-field col-span-full"><span>Asociar a un pedido</span><select value={form.pedido_id} onChange={(event) => setForm({ ...form, pedido_id: event.target.value })}><option value="">Sin pedido asociado</option>{pedidos.map((order) => <option value={order.id} key={order.id}>{order.codigo} · {order.clientes?.nombre ?? 'Sin cliente'}</option>)}</select></label>
      <label className="form-field col-span-full"><span>Qué quieres grabar</span><textarea rows={5} value={form.descripcion} onChange={(event) => setForm({ ...form, descripcion: event.target.value })} placeholder="Escenas, tomas, texto o idea principal…" /></label>
      <Field label="Estado"><select value={form.estado} onChange={(event) => setForm({ ...form, estado: event.target.value as IdeaContenido['estado'] })}><option value="pendiente_grabacion">Pendiente de grabación</option><option value="grabado">Grabado</option></select></Field>
      <Field label="Notas opcionales"><input value={form.notas} onChange={(event) => setForm({ ...form, notas: event.target.value })} placeholder="Audio, ubicación, referencias…" /></Field>
      <div className="col-span-full flex justify-end gap-2"><button type="button" className="subtle-button" onClick={onClose}>Cancelar</button><button className="primary-button px-5" disabled={saving}>{saving ? 'Guardando…' : 'Guardar idea'}</button></div>
    </form>
  </Modal>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="form-field"><span>{label}</span>{children}</label>
}

function Metric({ icon: Icon, label, value, accent, green }: { icon: typeof Clapperboard; label: string; value: number; accent?: boolean; green?: boolean }) {
  return <article className="metric-card"><Icon size={20} className={accent ? 'text-accent' : green ? 'text-green-300' : 'text-muted'} /><p className="mt-5 text-xs text-muted">{label}</p><strong className={`mt-1 block text-2xl ${accent ? 'text-accent' : green ? 'text-green-300' : ''}`}>{value}</strong></article>
}
