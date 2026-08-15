import { zodResolver } from '@hookform/resolvers/zod'
import { Edit3, MapPin, MessageCircle, Plus, Search, Trash2, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { Modal } from '../../components/ui/Modal'
import { DEMO_CLIENTES } from '../../data/demo'
import { isSupabaseConfigured } from '../../lib/supabase'
import { eliminarCliente, guardarCliente, listarClientes, type ClienteInput } from '../../services/clientes.service'
import type { Cliente } from '../../types/domain'
import { whatsappUrl } from '../../utils/whatsapp'

const schema = z.object({
  nombre: z.string().trim().min(2, 'Escribe el nombre completo.'),
  whatsapp: z.string().trim().min(7, 'Escribe un número válido.'),
  correo: z.string().trim().email('Correo inválido.').or(z.literal('')),
  departamento: z.string(), ciudad: z.string(), referencia: z.string(), notas: z.string(),
})
type FormValues = z.infer<typeof schema>
const emptyValues: FormValues = { nombre: '', whatsapp: '', correo: '', departamento: '', ciudad: '', referencia: '', notas: '' }

export function ClientesPage() {
  const [clientes, setClientes] = useState<Cliente[]>(isSupabaseConfigured ? [] : DEMO_CLIENTES)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Cliente | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!isSupabaseConfigured) return
    void listarClientes(setClientes)
      .then(setClientes)
      .catch(() => toast.error('No se pudieron cargar los clientes.'))
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim()
    return clientes.filter((client) => [client.nombre, client.whatsapp, client.ciudad].some((value) => value?.toLowerCase().includes(term)))
  }, [clientes, search])

  const openNew = () => { setEditing(null); setOpen(true) }
  const openEdit = (cliente: Cliente) => { setEditing(cliente); setOpen(true) }
  const remove = async (cliente: Cliente) => {
    if (!window.confirm(`¿Eliminar a ${cliente.nombre}? Esta acción no se puede deshacer.`)) return
    try {
      if (isSupabaseConfigured) await eliminarCliente(cliente.id)
      setClientes((current) => current.filter((item) => item.id !== cliente.id))
      toast.success('Cliente eliminado.')
    } catch { toast.error('No se puede eliminar un cliente con pedidos relacionados.') }
  }

  return <div>
    {!isSupabaseConfigured && <PreviewBanner />}
    <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Directorio</p><h1 className="page-title">Clientes</h1><p className="page-subtitle">Información de contacto y pedidos por cliente.</p></div><button className="primary-button px-5" onClick={openNew}><Plus size={18} /> Nuevo cliente</button></div>
    <div className="mt-7 flex items-center gap-3"><div className="relative max-w-md flex-1"><Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" size={18} /><input className="search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre, WhatsApp o ciudad" /></div><span className="hidden text-xs text-muted sm:block">{filtered.length} clientes</span></div>

    {loading ? <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[1,2,3].map((n) => <div key={n} className="h-44 animate-pulse rounded-2xl border border-line bg-panel" />)}</div> : filtered.length === 0 ? <EmptyClients onAdd={openNew} /> : <>
      <div className="mt-5 grid gap-3 md:hidden">{filtered.map((client) => <ClientCard key={client.id} client={client} onEdit={() => openEdit(client)} onDelete={() => void remove(client)} />)}</div>
      <div className="mt-5 hidden overflow-hidden rounded-2xl border border-line bg-panel md:block"><table className="data-table"><thead><tr><th>Cliente</th><th>WhatsApp</th><th>Ciudad</th><th>Creado</th><th aria-label="Acciones" /></tr></thead><tbody>{filtered.map((client) => <tr key={client.id}><td><strong>{client.nombre}</strong><span>{client.notas || 'Sin notas internas'}</span></td><td><span>{client.whatsapp}</span></td><td><span>{[client.ciudad, client.departamento].filter(Boolean).join(', ') || 'Sin ubicación'}</span></td><td><span>{new Intl.DateTimeFormat('es-NI').format(new Date(client.created_at))}</span></td><td><div className="flex justify-end gap-1.5"><a className="table-action table-action-whatsapp" href={whatsappUrl(client.whatsapp)} target="_blank" rel="noreferrer" aria-label="Abrir WhatsApp"><MessageCircle size={17} /></a><button className="table-action table-action-edit" onClick={() => openEdit(client)} aria-label="Editar"><Edit3 size={17} /></button><button className="table-action table-action-danger" onClick={() => void remove(client)} aria-label="Eliminar"><Trash2 size={17} /></button></div></td></tr>)}</tbody></table></div>
    </>}

    <ClienteModal open={open} cliente={editing} onClose={() => setOpen(false)} onSaved={(saved) => { setClientes((current) => editing ? current.map((item) => item.id === saved.id ? saved : item) : [saved, ...current]); setOpen(false) }} />
  </div>
}

function ClienteModal({ open, cliente, onClose, onSaved }: { open: boolean; cliente: Cliente | null; onClose: () => void; onSaved: (client: Cliente) => void }) {
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: emptyValues })
  useEffect(() => { reset(cliente ? { nombre: cliente.nombre, whatsapp: cliente.whatsapp, correo: cliente.correo ?? '', departamento: cliente.departamento ?? '', ciudad: cliente.ciudad ?? '', referencia: cliente.referencia ?? '', notas: cliente.notas ?? '' } : emptyValues) }, [cliente, open, reset])
  const submit = async (values: FormValues) => {
    const input: ClienteInput = { nombre: values.nombre, whatsapp: values.whatsapp, correo: values.correo || null, departamento: values.departamento || null, ciudad: values.ciudad || null, direccion: null, referencia: values.referencia || null, notas: values.notas || null }
    try {
      const saved = isSupabaseConfigured ? await guardarCliente(input, cliente?.id) : { ...input, id: cliente?.id ?? crypto.randomUUID(), created_at: cliente?.created_at ?? new Date().toISOString() }
      onSaved(saved); toast.success(cliente ? 'Cliente actualizado.' : 'Cliente creado.')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo guardar el cliente.') }
  }
  return <Modal open={open} onClose={onClose} title={cliente ? 'Editar cliente' : 'Nuevo cliente'} description="Datos esenciales para pedidos y contacto."><form onSubmit={handleSubmit(submit)} className="form-grid"><FormField label="Nombre completo" error={errors.nombre?.message}><input {...register('nombre')} autoFocus /></FormField><FormField label="WhatsApp" error={errors.whatsapp?.message}><input {...register('whatsapp')} placeholder="+505 8888 0000" /></FormField><FormField label="Correo (para avisos automáticos)" error={errors.correo?.message} wide><input {...register('correo')} type="email" placeholder="cliente@correo.com" /></FormField><FormField label="Departamento"><input {...register('departamento')} /></FormField><FormField label="Ciudad"><input {...register('ciudad')} /></FormField><FormField label="Referencia" wide><input {...register('referencia')} /></FormField><FormField label="Notas internas" wide><textarea {...register('notas')} rows={3} /></FormField><div className="col-span-full flex justify-end gap-2 pt-2"><button type="button" className="subtle-button px-4" onClick={onClose}>Cancelar</button><button className="primary-button px-5" disabled={isSubmitting}>{isSubmitting ? 'Guardando…' : 'Guardar cliente'}</button></div></form></Modal>
}

function FormField({ label, error, wide, children }: { label: string; error?: string; wide?: boolean; children: React.ReactNode }) { return <label className={`form-field ${wide ? 'sm:col-span-2' : ''}`}><span>{label}</span>{children}{error && <small>{error}</small>}</label> }
function ClientCard({ client, onEdit, onDelete }: { client: Cliente; onEdit: () => void; onDelete: () => void }) { return <article className="rounded-2xl border border-line bg-panel p-4"><div className="flex items-start justify-between"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-accent/10 font-semibold text-accent">{client.nombre.charAt(0)}</span><div><h3 className="text-sm font-semibold">{client.nombre}</h3><p className="text-xs text-muted">{client.whatsapp}</p></div></div><button className="table-action table-action-edit" onClick={onEdit} aria-label="Editar"><Edit3 size={17} /></button></div><div className="mt-4 space-y-2 text-xs text-muted"><p className="flex gap-2"><MapPin size={15} />{[client.ciudad, client.departamento].filter(Boolean).join(', ') || 'Sin ubicación'}</p></div><div className="mt-4 flex gap-2"><a className="subtle-button flex-1 text-[#62eaa0]" href={whatsappUrl(client.whatsapp)} target="_blank" rel="noreferrer"><MessageCircle size={16} /> WhatsApp</a><button className="subtle-button" onClick={onDelete}><Trash2 size={16} /></button></div></article> }
function EmptyClients({ onAdd }: { onAdd: () => void }) { return <div className="mt-8 grid min-h-72 place-items-center rounded-2xl border border-dashed border-line text-center"><div><Users className="mx-auto text-muted" /><h2 className="mt-3 font-semibold">No hay clientes</h2><p className="mt-1 text-sm text-muted">Crea el primero para registrar un pedido.</p><button onClick={onAdd} className="primary-button mx-auto mt-5 px-5"><Plus size={17} /> Nuevo cliente</button></div></div> }
function PreviewBanner() { return <div className="mb-6 rounded-xl border border-accent/15 bg-accent/[0.05] px-4 py-3 text-xs text-[#d8ff78]"><strong>Vista previa local:</strong> los cambios se muestran en memoria. Al conectar Supabase se guardarán en la base de datos protegida.</div> }
