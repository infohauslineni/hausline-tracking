import { zodResolver } from '@hookform/resolvers/zod'
import { Copy, Edit3, ExternalLink, Images, Plus, Search, Tag, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { Modal } from '../../components/ui/Modal'
import { DEMO_YUPOO } from '../../data/demo'
import { isSupabaseConfigured } from '../../lib/supabase'
import { eliminarLinkYupoo, guardarLinkYupoo, listarLinksYupoo, type LinkYupooInput } from '../../services/yupoo.service'
import type { LinkYupoo } from '../../types/domain'

// Antepone https:// si el link viene sin protocolo, para que siempre sea clickeable
// y compartible (Yupoo se pega a veces como "algo.x.yupoo.com/...").
function normalizarLink(link: string) {
  const limpio = link.trim()
  if (!limpio) return limpio
  return /^https?:\/\//i.test(limpio) ? limpio : `https://${limpio}`
}

const schema = z.object({
  marca: z.string().trim().min(1, 'Escribe la marca.'),
  modelo: z.string().trim().min(1, 'Escribe el modelo o código.'),
  categoria: z.string(),
  link: z.string().trim().min(3, 'Pega el link de Yupoo.'),
  proveedor: z.string(),
  precio: z.string(),
  notas: z.string(),
  foto_url: z.string(),
})
type FormValues = z.infer<typeof schema>
const emptyValues: FormValues = { marca: '', modelo: '', categoria: '', link: '', proveedor: '', precio: '', notas: '', foto_url: '' }

export function LinksYupooPage() {
  const [links, setLinks] = useState<LinkYupoo[]>(isSupabaseConfigured ? [] : DEMO_YUPOO)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [search, setSearch] = useState('')
  const [marca, setMarca] = useState('')
  const [editing, setEditing] = useState<LinkYupoo | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!isSupabaseConfigured) return
    void listarLinksYupoo(setLinks)
      .then(setLinks)
      .catch(() => toast.error('No se pudieron cargar los links de Yupoo.'))
      .finally(() => setLoading(false))
  }, [])

  const marcas = useMemo(() => [...new Set(links.map((l) => l.marca))].sort((a, b) => a.localeCompare(b)), [links])
  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim()
    return links.filter((l) => {
      if (marca && l.marca !== marca) return false
      if (!term) return true
      return [l.marca, l.modelo, l.categoria, l.proveedor, l.notas].some((v) => v?.toLowerCase().includes(term))
    })
  }, [links, search, marca])

  const openNew = () => { setEditing(null); setOpen(true) }
  const openEdit = (link: LinkYupoo) => { setEditing(link); setOpen(true) }
  const copiar = async (link: LinkYupoo) => {
    try { await navigator.clipboard.writeText(normalizarLink(link.link)); toast.success('Link copiado. Pégalo en WhatsApp.') }
    catch { toast.error('No se pudo copiar el link.') }
  }
  const remove = async (link: LinkYupoo) => {
    if (!window.confirm(`¿Eliminar "${link.marca} · ${link.modelo}"? Esta acción no se puede deshacer.`)) return
    try {
      if (isSupabaseConfigured) await eliminarLinkYupoo(link.id)
      setLinks((current) => current.filter((item) => item.id !== link.id))
      toast.success('Link eliminado.')
    } catch { toast.error('No se pudo eliminar el link.') }
  }

  return <div>
    {!isSupabaseConfigured && <PreviewBanner />}
    <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="eyebrow">Catálogo</p><h1 className="page-title">Links Yupoo</h1><p className="page-subtitle">Todos tus álbumes por marca. Busca un modelo y compártelo al instante.</p></div>
      <button className="primary-button px-5" onClick={openNew}><Plus size={18} /> Nuevo link</button>
    </div>

    <div className="mt-7 flex items-center gap-3">
      <div className="relative max-w-md flex-1"><Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" size={18} /><input className="search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Marca, modelo, código o proveedor" /></div>
      <span className="hidden text-xs text-muted sm:block">{filtered.length} de {links.length}</span>
    </div>

    {marcas.length > 0 && <div className="mt-4 flex flex-wrap gap-1.5">
      <FiltroMarca label="Todas" active={marca === ''} onClick={() => setMarca('')} />
      {marcas.map((m) => <FiltroMarca key={m} label={m} active={marca === m} onClick={() => setMarca(m)} />)}
    </div>}

    {loading ? <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((n) => <div key={n} className="h-52 animate-pulse rounded-2xl border border-line bg-panel" />)}</div>
      : filtered.length === 0 ? <EmptyYupoo onAdd={openNew} hayDatos={links.length > 0} />
      : <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{filtered.map((link) => <YupooCard key={link.id} link={link} onOpen={() => openEdit(link)} onCopy={() => void copiar(link)} onDelete={() => void remove(link)} />)}</div>}

    <YupooModal open={open} link={editing} marcas={marcas} onClose={() => setOpen(false)} onSaved={(saved) => { setLinks((current) => editing ? current.map((item) => item.id === saved.id ? saved : item) : [saved, ...current]); setOpen(false) }} />
  </div>
}

function FiltroMarca({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button onClick={onClick} className={`rounded-full border px-3 py-1 text-xs font-medium transition ${active ? 'border-accent bg-accent text-app' : 'border-line bg-panel text-muted hover:text-white'}`}>{label}</button>
}

function YupooCard({ link, onOpen, onCopy, onDelete }: { link: LinkYupoo; onOpen: () => void; onCopy: () => void; onDelete: () => void }) {
  return <article className="flex flex-col rounded-2xl border border-line bg-panel p-4">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent"><Tag size={11} />{link.marca}</span>
        <h3 className="mt-2 truncate text-sm font-semibold">{link.modelo}</h3>
        <p className="mt-0.5 truncate text-xs text-muted">{[link.categoria, link.proveedor].filter(Boolean).join(' · ') || 'Sin categoría'}</p>
      </div>
      {link.precio != null && <span className="shrink-0 rounded-lg bg-white/[0.04] px-2 py-1 text-sm font-semibold">${link.precio}</span>}
    </div>
    {link.foto_url && <img src={link.foto_url} alt={link.modelo} loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none' }} className="mt-3 h-32 w-full rounded-xl border border-line object-cover" />}
    {link.notas && <p className="mt-3 line-clamp-2 text-xs text-muted">{link.notas}</p>}
    <div className="mt-4 flex items-center gap-2">
      <a className="subtle-button flex-1 justify-center text-accent" href={normalizarLink(link.link)} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Abrir Yupoo</a>
      <button className="table-action table-action-edit" onClick={onCopy} aria-label="Copiar link"><Copy size={17} /></button>
      <button className="table-action table-action-edit" onClick={onOpen} aria-label="Editar"><Edit3 size={17} /></button>
      <button className="table-action table-action-danger" onClick={onDelete} aria-label="Eliminar"><Trash2 size={17} /></button>
    </div>
  </article>
}

function YupooModal({ open, link, marcas, onClose, onSaved }: { open: boolean; link: LinkYupoo | null; marcas: string[]; onClose: () => void; onSaved: (value: LinkYupoo) => void }) {
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: emptyValues })
  useEffect(() => { reset(link ? { marca: link.marca, modelo: link.modelo, categoria: link.categoria ?? '', link: link.link, proveedor: link.proveedor ?? '', precio: link.precio != null ? String(link.precio) : '', notas: link.notas ?? '', foto_url: link.foto_url ?? '' } : emptyValues) }, [link, open, reset])

  const submit = async (values: FormValues) => {
    const precioNum = values.precio.trim() ? Number(values.precio.trim().replace(',', '.')) : null
    const input: LinkYupooInput = {
      marca: values.marca.trim(),
      modelo: values.modelo.trim(),
      categoria: values.categoria.trim() || null,
      link: normalizarLink(values.link),
      proveedor: values.proveedor.trim() || null,
      precio: precioNum != null && Number.isFinite(precioNum) ? precioNum : null,
      notas: values.notas.trim() || null,
      foto_url: values.foto_url.trim() || null,
    }
    try {
      const saved = isSupabaseConfigured ? await guardarLinkYupoo(input, link?.id) : { ...input, id: link?.id ?? crypto.randomUUID(), created_at: link?.created_at ?? new Date().toISOString() }
      onSaved(saved); toast.success(link ? 'Link actualizado.' : 'Link agregado.')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo guardar el link.') }
  }

  return <Modal open={open} onClose={onClose} title={link ? 'Editar link' : 'Nuevo link de Yupoo'} description="Guárdalo por marca para encontrarlo y compartirlo rápido.">
    <form onSubmit={handleSubmit(submit)} className="form-grid">
      <datalist id="marcas-yupoo">{marcas.map((m) => <option key={m} value={m} />)}</datalist>
      <FormField label="Marca" error={errors.marca?.message}><input {...register('marca')} list="marcas-yupoo" placeholder="Nike, Gucci…" autoFocus /></FormField>
      <FormField label="Modelo o código" error={errors.modelo?.message}><input {...register('modelo')} placeholder="Dunk Low Panda" /></FormField>
      <FormField label="Link de Yupoo" error={errors.link?.message} wide><input {...register('link')} placeholder="https://…yupoo.com/albums/…" /></FormField>
      <FormField label="Categoría"><input {...register('categoria')} placeholder="Zapatos, bolsos…" /></FormField>
      <FormField label="Proveedor"><input {...register('proveedor')} placeholder="Nombre del proveedor" /></FormField>
      <FormField label="Precio de referencia (opcional)"><input {...register('precio')} inputMode="decimal" placeholder="40" /></FormField>
      <FormField label="Foto de portada (URL, opcional)"><input {...register('foto_url')} placeholder="https://…" /></FormField>
      <FormField label="Notas (tallas, stock…)" wide><textarea {...register('notas')} rows={2} /></FormField>
      <div className="col-span-full flex justify-end gap-2 pt-2"><button type="button" className="subtle-button px-4" onClick={onClose}>Cancelar</button><button className="primary-button px-5" disabled={isSubmitting}>{isSubmitting ? 'Guardando…' : 'Guardar link'}</button></div>
    </form>
  </Modal>
}

function FormField({ label, error, wide, children }: { label: string; error?: string; wide?: boolean; children: ReactNode }) {
  return <label className={`form-field ${wide ? 'sm:col-span-2' : ''}`}><span>{label}</span>{children}{error && <small>{error}</small>}</label>
}
function EmptyYupoo({ onAdd, hayDatos }: { onAdd: () => void; hayDatos: boolean }) {
  return <div className="mt-8 grid min-h-72 place-items-center rounded-2xl border border-dashed border-line text-center"><div><Images className="mx-auto text-muted" /><h2 className="mt-3 font-semibold">{hayDatos ? 'Sin resultados' : 'Aún no hay links'}</h2><p className="mt-1 text-sm text-muted">{hayDatos ? 'Prueba con otra marca o término de búsqueda.' : 'Agrega tu primer álbum de Yupoo para encontrarlo rápido.'}</p>{!hayDatos && <button onClick={onAdd} className="primary-button mx-auto mt-5 px-5"><Plus size={17} /> Nuevo link</button>}</div></div>
}
function PreviewBanner() { return <div className="mb-6 rounded-xl border border-accent/15 bg-accent/[0.05] px-4 py-3 text-xs text-[#d8ff78]"><strong>Vista previa local:</strong> los cambios se muestran en memoria. Al conectar Supabase se guardarán en la base de datos protegida.</div> }
