import { Pencil, Plus, Target, Trash2 } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Modal } from '../../components/ui/Modal'
import { actualizarMetaCompra, aportarMeta, crearMetaCompra, eliminarMetaCompra, listarMetasCompra } from '../../services/finanzas.service'
import type { MetaCompra } from '../../types/domain'

const EMPTY_FORM = { nombre: '', monto: '', fecha: '', notas: '' }

export function MetasPage() {
  const [items, setItems] = useState<MetaCompra[]>([])
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<MetaCompra | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)

  const load = () => void listarMetasCompra().then(setItems).catch(() => toast.error('No se pudieron cargar los fondos.'))
  useEffect(load, [])

  const openNew = () => { setEditing(null); setForm(EMPTY_FORM); setOpen(true) }
  const openEdit = (item: MetaCompra) => {
    setEditing(item)
    setForm({ nombre: item.nombre, monto: String(item.monto_objetivo), fecha: item.fecha_objetivo ?? '', notas: item.notas ?? '' })
    setOpen(true)
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    const target = Number(form.monto)
    if (!form.nombre.trim() || target <= 0) return toast.error('Completa el nombre y el monto.')
    if (editing && target < Number(editing.monto_reservado)) return toast.error(`El objetivo no puede ser menor que los USD ${Number(editing.monto_reservado).toFixed(2)} ya reservados.`)
    setSaving(true)
    const input = { nombre: form.nombre.trim(), monto_objetivo: target, fecha_objetivo: form.fecha || null, notas: form.notas.trim() || null }
    try {
      if (editing) {
        const saved = await actualizarMetaCompra(editing.id, input)
        setItems((all) => all.map((item) => item.id === saved.id ? saved : item))
        toast.success('Fondo actualizado.')
      } else {
        const saved = await crearMetaCompra(input)
        setItems((all) => [saved, ...all])
        toast.success('Fondo creado.')
      }
      setOpen(false)
    } catch {
      toast.error(editing ? 'No se pudo actualizar el fondo.' : 'No se pudo crear el fondo.')
    } finally { setSaving(false) }
  }

  const remove = async (item: MetaCompra) => {
    if (!confirm(`¿Eliminar el fondo “${item.nombre}”? Esta acción no se puede deshacer.`)) return
    try {
      await eliminarMetaCompra(item.id)
      setItems((all) => all.filter((candidate) => candidate.id !== item.id))
      toast.success('Fondo eliminado.')
    } catch { toast.error('No se pudo eliminar el fondo.') }
  }

  const contribute = async (meta: MetaCompra) => {
    const raw = prompt(`¿Cuánto de tu ganancia realizada quieres reservar para ${meta.nombre}?`)
    if (raw === null) return
    const amount = Number(raw)
    if (!amount || amount <= 0) return toast.error('Monto inválido.')
    try {
      await aportarMeta(meta, amount, new Date().toISOString().slice(0, 10))
      toast.success('Aporte reservado desde tu ganancia.')
      load()
    } catch { toast.error('No se pudo registrar el aporte. Revisa que haya ganancia disponible.') }
  }

  return <div>
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="eyebrow">Objetivos</p><h1 className="page-title">Fondos para compras</h1><p className="page-subtitle">Separa parte de tu ganancia para un iPad, equipo u otra compra sin confundirla con el saldo operativo.</p></div>
      <button className="primary-button px-5" onClick={openNew}><Plus size={17} /> Nueva meta</button>
    </div>
    <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => {
        const pct = Math.min(100, Number(item.monto_reservado) / Number(item.monto_objetivo) * 100)
        return <article className="panel-card" key={item.id}>
          <div className="flex items-start justify-between gap-3">
            <span className="grid size-11 place-items-center rounded-xl bg-accent/10 text-accent"><Target size={20} /></span>
            <div className="flex items-center gap-1"><button type="button" className="icon-button" onClick={() => openEdit(item)} aria-label={`Editar ${item.nombre}`} title="Editar"><Pencil size={16} /></button><button type="button" className="icon-button hover:text-red-300" onClick={() => void remove(item)} aria-label={`Eliminar ${item.nombre}`} title="Eliminar"><Trash2 size={16} /></button></div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3"><h2 className="font-semibold">{item.nombre}</h2><span className="text-xs text-muted">{item.estado === 'completada' ? 'Completada' : 'En progreso'}</span></div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full bg-accent" style={{ width: `${pct}%` }} /></div>
          <div className="mt-3 flex justify-between text-sm"><b className="text-accent">USD {Number(item.monto_reservado).toFixed(2)}</b><span className="text-muted">de USD {Number(item.monto_objetivo).toFixed(2)}</span></div>
          {item.fecha_objetivo && <p className="mt-3 text-xs text-muted">Fecha objetivo: {item.fecha_objetivo}</p>}
          {item.estado === 'activa' && <button className="subtle-button mt-5 w-full justify-center" onClick={() => void contribute(item)}>Aportar desde mi ganancia</button>}
        </article>
      })}
    </div>
    {!items.length && <div className="mt-6 rounded-2xl border border-dashed border-line p-10 text-center text-sm text-muted">Crea tu primer fondo, por ejemplo: “iPad para registrar pedidos”.</div>}
    <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Editar fondo de compra' : 'Nueva meta de compra'}>
      <form className="form-grid" onSubmit={(event) => void save(event)}>
        <Field label="Qué quieres comprar"><input value={form.nombre} onChange={(event) => setForm({ ...form, nombre: event.target.value })} placeholder="iPad para pedidos" /></Field>
        <Field label="Monto objetivo"><input type="number" min=".01" step=".01" value={form.monto} onChange={(event) => setForm({ ...form, monto: event.target.value })} /></Field>
        <Field label="Fecha objetivo (opcional)"><input type="date" value={form.fecha} onChange={(event) => setForm({ ...form, fecha: event.target.value })} /></Field>
        <Field label="Notas"><input value={form.notas} onChange={(event) => setForm({ ...form, notas: event.target.value })} /></Field>
        <div className="col-span-full flex justify-end gap-2"><button type="button" className="subtle-button" onClick={() => setOpen(false)}>Cancelar</button><button className="primary-button px-5" disabled={saving}>{saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Crear fondo'}</button></div>
      </form>
    </Modal>
  </div>
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="form-field"><span>{label}</span>{children}</label> }
