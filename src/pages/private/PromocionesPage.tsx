import { BadgePercent, Layers, Plus, Power, Tag, Trash2, Wallet } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Modal } from '../../components/ui/Modal'
import { isSupabaseConfigured } from '../../lib/supabase'
import { cambiarActivoPromocion, eliminarPromocion, guardarPromocion, listarPromociones } from '../../services/promociones.service'
import type { Promocion, PromocionInput } from '../../types/domain'

const vencido = (p: Pick<Promocion, 'vence_el'>) => !!p.vence_el && p.vence_el < new Date().toISOString().slice(0, 10)
const descuentoLabel = (p: Pick<Promocion, 'tipo' | 'valor'>) => p.tipo === 'porcentaje' ? `${Number(p.valor)}% de descuento` : `US$ ${Number(p.valor).toFixed(2)} de descuento`
const condicionLabel = (p: Pick<Promocion, 'condicion_tipo' | 'condicion_valor'>) =>
  p.condicion_tipo === 'cantidad'
    ? `Si el carrito tiene ${Number(p.condicion_valor)}+ productos`
    : `Si el total pasa de US$ ${Number(p.condicion_valor).toFixed(2)}`

export function PromocionesPage() {
  const [promos, setPromos] = useState<Promocion[]>([])
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Promocion | null>(null)

  const load = () => { if (isSupabaseConfigured) void listarPromociones(setPromos).then(setPromos).catch(() => toast.error('No se pudieron cargar las promociones.')).finally(() => setLoading(false)) }
  useEffect(load, [])

  const toggle = async (p: Promocion) => { try { await cambiarActivoPromocion(p.id, !p.activo); toast.success(p.activo ? 'Promoción desactivada.' : 'Promoción activada.'); load() } catch { toast.error('No se pudo cambiar la promoción.') } }
  const borrar = async (p: Promocion) => { if (!window.confirm(`¿Eliminar la promoción "${p.nombre}"? Esta acción no se puede deshacer.`)) return; try { await eliminarPromocion(p.id); setPromos((x) => x.filter((y) => y.id !== p.id)); toast.success('Promoción eliminada.') } catch { toast.error('No se pudo eliminar.') } }

  return <div>
    <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="eyebrow">Marketing</p><h1 className="page-title">Promociones automáticas</h1><p className="page-subtitle">Descuentos que se aplican SOLOS en el checkout cuando el carrito cumple una condición (sin código).</p></div>
      <button className="primary-button px-5" onClick={() => { setEditing(null); setOpen(true) }}><Plus size={18} /> Nueva promoción</button>
    </div>

    <div className="mt-6 rounded-xl border border-accent/15 bg-accent/[0.04] px-4 py-3 text-xs text-muted">
      💡 <strong className="text-white">Un cupón por código tiene prioridad.</strong> Si el cliente no usa un código, se aplica sola la promoción que más le convenga entre las que cumpla. No se acumulan entre sí.
    </div>

    {loading ? <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[1,2,3].map((n) => <div key={n} className="h-40 animate-pulse rounded-2xl border border-line bg-panel" />)}</div>
      : promos.length === 0 ? <div className="mt-8 grid min-h-64 place-items-center rounded-2xl border border-dashed border-line text-center"><div><BadgePercent className="mx-auto text-muted" /><h2 className="mt-3 font-semibold">Sin promociones todavía</h2><p className="mt-1 text-sm text-muted">Creá una regla como “4+ productos = 10%” o “+$100 = 8%”.</p><button onClick={() => { setEditing(null); setOpen(true) }} className="primary-button mx-auto mt-5 px-5"><Plus size={17} /> Nueva promoción</button></div></div>
      : <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{promos.map((p) => {
          const inactivo = !p.activo || vencido(p)
          const motivo = !p.activo ? 'Desactivada' : vencido(p) ? 'Vencida' : null
          return <article key={p.id} className={`rounded-2xl border p-4 ${inactivo ? 'border-line bg-panel/50 opacity-70' : 'border-accent/25 bg-panel'}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2"><Tag size={16} className="shrink-0 text-accent" /><strong className="truncate text-base">{p.nombre}</strong></div>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-white/90"><BadgePercent size={13} className="text-muted" /> {descuentoLabel(p)}</p>
              </div>
              {motivo && <span className="shrink-0 rounded-full bg-red-400/10 px-2 py-0.5 text-[11px] font-semibold text-red-300">{motivo}</span>}
            </div>
            <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-white/[0.04] px-2.5 py-2 text-[12px] text-muted">
              {p.condicion_tipo === 'cantidad' ? <Layers size={13} className="shrink-0" /> : <Wallet size={13} className="shrink-0" />} {condicionLabel(p)}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
              {p.vence_el && <span className={`rounded-full px-2 py-0.5 ${vencido(p) ? 'bg-red-400/10 text-red-300' : 'bg-white/[0.06] text-muted'}`}>vence {p.vence_el}</span>}
            </div>
            {p.nota && <p className="mt-3 border-t border-line pt-2 text-xs text-muted">{p.nota}</p>}
            <div className="mt-3 flex flex-wrap justify-end gap-1.5 border-t border-line pt-3">
              <button className="subtle-button px-3 py-1.5 text-xs" onClick={() => { setEditing(p); setOpen(true) }}>Editar</button>
              <button className="subtle-button px-3 py-1.5 text-xs" onClick={() => void toggle(p)}><Power size={14} /> {p.activo ? 'Desactivar' : 'Activar'}</button>
              <button className="table-action table-action-danger" onClick={() => void borrar(p)} aria-label="Eliminar"><Trash2 size={16} /></button>
            </div>
          </article>
        })}</div>}

    <PromocionModal open={open} promo={editing} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); load() }} />
  </div>
}

function PromocionModal({ open, promo, onClose, onSaved }: { open: boolean; promo: Promocion | null; onClose: () => void; onSaved: (p: Promocion) => void }) {
  const [nombre, setNombre] = useState('')
  const [condicionTipo, setCondicionTipo] = useState<'cantidad' | 'monto'>('cantidad')
  const [condicionValor, setCondicionValor] = useState(4)
  const [tipo, setTipo] = useState<'porcentaje' | 'monto'>('porcentaje')
  const [valor, setValor] = useState(10)
  const [venceEl, setVenceEl] = useState('')
  const [nota, setNota] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    if (promo) {
      setNombre(promo.nombre); setCondicionTipo(promo.condicion_tipo); setCondicionValor(Number(promo.condicion_valor))
      setTipo(promo.tipo); setValor(Number(promo.valor)); setVenceEl(promo.vence_el ?? ''); setNota(promo.nota ?? '')
    } else {
      setNombre(''); setCondicionTipo('cantidad'); setCondicionValor(4); setTipo('porcentaje'); setValor(10); setVenceEl(''); setNota('')
    }
  }, [open, promo])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (nombre.trim().length < 2) return toast.error('Ponle un nombre a la promoción.')
    if (!(condicionValor > 0)) return toast.error('Indica la condición (cantidad o monto).')
    if (!(valor > 0)) return toast.error('Indica el valor del descuento.')
    if (tipo === 'porcentaje' && valor > 100) return toast.error('El porcentaje no puede pasar de 100.')
    setSaving(true)
    try {
      const input: PromocionInput = { nombre: nombre.trim(), condicion_tipo: condicionTipo, condicion_valor: Number(condicionValor), tipo, valor: Number(valor), vence_el: venceEl || null, nota: nota.trim() || null }
      const saved = await guardarPromocion(input, promo?.id)
      toast.success(promo ? 'Promoción actualizada.' : 'Promoción creada.')
      onSaved(saved)
    } catch { toast.error('No se pudo guardar la promoción.') } finally { setSaving(false) }
  }

  return <Modal open={open} onClose={onClose} title={promo ? 'Editar promoción' : 'Nueva promoción'} description="Se aplica sola en el checkout cuando el carrito cumple la condición. Ej: “4+ productos = 10%” o “+$100 = US$10”.">
    <form onSubmit={(e) => void submit(e)} className="form-grid">
      <label className="form-field sm:col-span-2"><span>Nombre</span><input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. 4+ productos 10%" /></label>
      <label className="form-field"><span>Condición</span><select value={condicionTipo} onChange={(e) => setCondicionTipo(e.target.value as 'cantidad' | 'monto')}><option value="cantidad">Por cantidad de productos</option><option value="monto">Por monto del total (US$)</option></select></label>
      <label className="form-field"><span>{condicionTipo === 'cantidad' ? 'Mínimo de productos' : 'Monto mínimo (US$)'}</span><input type="number" min="1" step={condicionTipo === 'cantidad' ? '1' : '0.01'} value={condicionValor} onChange={(e) => setCondicionValor(Number(e.target.value))} /></label>
      <label className="form-field"><span>Tipo de descuento</span><select value={tipo} onChange={(e) => setTipo(e.target.value as 'porcentaje' | 'monto')}><option value="porcentaje">Porcentaje (%)</option><option value="monto">Monto fijo (US$)</option></select></label>
      <label className="form-field"><span>{tipo === 'porcentaje' ? 'Porcentaje (%)' : 'Monto (US$)'}</span><input type="number" min="0" step={tipo === 'porcentaje' ? '1' : '0.01'} value={valor} onChange={(e) => setValor(Number(e.target.value))} /></label>
      <label className="form-field sm:col-span-2"><span>Vence (opcional)</span><input type="date" value={venceEl} onChange={(e) => setVenceEl(e.target.value)} /></label>
      <label className="form-field sm:col-span-2"><span>Nota (opcional)</span><input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej: promo de fin de mes" /></label>
      <div className="col-span-full flex justify-end gap-2 pt-1"><button type="button" className="subtle-button px-4" onClick={onClose}>Cancelar</button><button className="primary-button px-5" disabled={saving}>{saving ? 'Guardando…' : 'Guardar promoción'}</button></div>
    </form>
  </Modal>
}
