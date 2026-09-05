import { Copy, Percent, Plus, Power, Share2, Ticket, Trash2, Users } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Modal } from '../../components/ui/Modal'
import { isSupabaseConfigured } from '../../lib/supabase'
import { listarClientes } from '../../services/clientes.service'
import { cambiarActivoCupon, eliminarCupon, generarCodigo, guardarCupon, listarCupones, type CuponInput } from '../../services/cupones.service'
import { compartirHistoriaCupon } from '../../utils/cuponHistoria'
import type { Cliente, Cupon } from '../../types/domain'

// Descripción legible del descuento: "10%" o "US$ 5.00".
const valorLabel = (c: Pick<Cupon, 'tipo' | 'valor'>) => c.tipo === 'porcentaje' ? `${Number(c.valor)}%` : `US$ ${Number(c.valor).toFixed(2)}`
const usosLabel = (c: Pick<Cupon, 'usos_max' | 'usos_confirmados'>) => c.usos_max == null ? `${c.usos_confirmados} usos · ilimitado` : `${c.usos_confirmados} / ${c.usos_max} usos`
const vencido = (c: Pick<Cupon, 'vence_el'>) => !!c.vence_el && c.vence_el < new Date().toISOString().slice(0, 10)
const agotado = (c: Pick<Cupon, 'usos_max' | 'usos_confirmados'>) => c.usos_max != null && c.usos_confirmados >= c.usos_max

export function CuponesPage() {
  const [cupones, setCupones] = useState<Cupon[]>([])
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Cupon | null>(null)

  const load = () => { if (isSupabaseConfigured) void listarCupones(setCupones).then(setCupones).catch(() => toast.error('No se pudieron cargar los cupones.')).finally(() => setLoading(false)) }
  useEffect(load, [])

  const copiar = async (codigo: string) => { try { await navigator.clipboard.writeText(codigo); toast.success(`Código ${codigo} copiado.`) } catch { toast.error('No se pudo copiar.') } }
  const compartir = async (c: Cupon) => {
    try {
      const r = await compartirHistoriaCupon(c)
      if (r === 'downloaded') toast.success('Imagen 9:16 descargada. Súbela como historia en Instagram.')
      else if (r === 'shared') toast.success('Historia lista para compartir.')
    } catch { toast.error('No se pudo generar la imagen.') }
  }
  const toggle = async (c: Cupon) => { try { await cambiarActivoCupon(c.id, !c.activo); toast.success(c.activo ? 'Cupón desactivado.' : 'Cupón activado.'); load() } catch { toast.error('No se pudo cambiar el cupón.') } }
  const borrar = async (c: Cupon) => { if (!window.confirm(`¿Eliminar el cupón ${c.codigo}? Esta acción no se puede deshacer.`)) return; try { await eliminarCupon(c.id); setCupones((x) => x.filter((y) => y.id !== c.id)); toast.success('Cupón eliminado.') } catch { toast.error('No se pudo eliminar.') } }

  return <div>
    <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="eyebrow">Marketing</p><h1 className="page-title">Cupones y descuentos</h1><p className="page-subtitle">Descuentos por cliente o códigos sueltos para redes. Se aplican en el checkout y al registrar la venta.</p></div>
      <button className="primary-button px-5" onClick={() => { setEditing(null); setOpen(true) }}><Plus size={18} /> Nuevo cupón</button>
    </div>

    <div className="mt-6 rounded-xl border border-accent/15 bg-accent/[0.04] px-4 py-3 text-xs text-muted">
      💡 <strong className="text-white">Los cupones solo se “queman” cuando el cliente paga.</strong> Si escribe el código y hace el pedido pero no transfiere, el cupón sigue disponible.
    </div>

    {loading ? <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[1,2,3].map((n) => <div key={n} className="h-40 animate-pulse rounded-2xl border border-line bg-panel" />)}</div>
      : cupones.length === 0 ? <div className="mt-8 grid min-h-64 place-items-center rounded-2xl border border-dashed border-line text-center"><div><Ticket className="mx-auto text-muted" /><h2 className="mt-3 font-semibold">Sin cupones todavía</h2><p className="mt-1 text-sm text-muted">Crea un descuento para un cliente o un código para regalar en redes.</p><button onClick={() => { setEditing(null); setOpen(true) }} className="primary-button mx-auto mt-5 px-5"><Plus size={17} /> Nuevo cupón</button></div></div>
      : <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{cupones.map((c) => {
          const inactivo = !c.activo || vencido(c) || agotado(c)
          const motivo = !c.activo ? 'Desactivado' : vencido(c) ? 'Vencido' : agotado(c) ? 'Agotado' : null
          return <article key={c.id} className={`rounded-2xl border p-4 ${inactivo ? 'border-line bg-panel/50 opacity-70' : 'border-accent/25 bg-panel'}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2"><Ticket size={16} className="shrink-0 text-accent" /><strong className="truncate font-mono text-base tracking-wide">{c.codigo}</strong></div>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-white/90"><Percent size={13} className="text-muted" /> {valorLabel(c)} de descuento</p>
              </div>
              <button className="table-action" onClick={() => void copiar(c.codigo)} aria-label="Copiar código" title="Copiar código"><Copy size={16} /></button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
              {c.cliente_id ? <span className="inline-flex items-center gap-1 rounded-full bg-sky-400/10 px-2 py-0.5 text-sky-300"><Users size={12} /> {c.clientes?.nombre ?? 'Cliente'}</span> : <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] px-2 py-0.5 text-muted">Código para redes</span>}
              <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-muted">{usosLabel(c)}</span>
              {c.vence_el && <span className={`rounded-full px-2 py-0.5 ${vencido(c) ? 'bg-red-400/10 text-red-300' : 'bg-white/[0.06] text-muted'}`}>vence {c.vence_el}</span>}
              {motivo && <span className="rounded-full bg-red-400/10 px-2 py-0.5 font-semibold text-red-300">{motivo}</span>}
            </div>
            {c.nota && <p className="mt-3 border-t border-line pt-2 text-xs text-muted">{c.nota}</p>}
            <div className="mt-3 flex flex-wrap justify-end gap-1.5 border-t border-line pt-3">
              <button className="subtle-button px-3 py-1.5 text-xs text-accent" onClick={() => void compartir(c)} title="Descargar/compartir imagen 9:16 para historia de Instagram"><Share2 size={14} /> Historia</button>
              <button className="subtle-button px-3 py-1.5 text-xs" onClick={() => { setEditing(c); setOpen(true) }}>Editar</button>
              <button className="subtle-button px-3 py-1.5 text-xs" onClick={() => void toggle(c)}><Power size={14} /> {c.activo ? 'Desactivar' : 'Activar'}</button>
              <button className="table-action table-action-danger" onClick={() => void borrar(c)} aria-label="Eliminar"><Trash2 size={16} /></button>
            </div>
          </article>
        })}</div>}

    <CuponModal open={open} cupon={editing} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); load() }} />
  </div>
}

// Modal para crear/editar un cupón. Reutilizable desde la ficha del cliente pasando
// `clientePreset` (deja fijado a ese cliente).
export function CuponModal({ open, cupon, clientePreset, onClose, onSaved }: { open: boolean; cupon: Cupon | null; clientePreset?: Pick<Cliente, 'id' | 'nombre'> | null; onClose: () => void; onSaved: (c: Cupon) => void }) {
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [codigo, setCodigo] = useState('')
  const [tipo, setTipo] = useState<'porcentaje' | 'monto'>('porcentaje')
  const [valor, setValor] = useState(10)
  const [clienteId, setClienteId] = useState('')
  const [usos, setUsos] = useState<'1' | 'varios' | 'ilimitado'>('1')
  const [usosMax, setUsosMax] = useState(20)
  const [venceEl, setVenceEl] = useState('')
  const [nota, setNota] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (open && isSupabaseConfigured) void listarClientes(setClientes).then(setClientes).catch(() => undefined) }, [open])
  useEffect(() => {
    if (!open) return
    if (cupon) {
      setCodigo(cupon.codigo); setTipo(cupon.tipo); setValor(Number(cupon.valor)); setClienteId(cupon.cliente_id ?? '')
      setUsos(cupon.usos_max == null ? 'ilimitado' : cupon.usos_max === 1 ? '1' : 'varios'); setUsosMax(cupon.usos_max && cupon.usos_max > 1 ? cupon.usos_max : 20)
      setVenceEl(cupon.vence_el ?? ''); setNota(cupon.nota ?? '')
    } else {
      const preset = clientePreset ?? null
      setCodigo(generarCodigo(preset ? preset.nombre.split(' ')[0] : 'HAUS'))
      setTipo('porcentaje'); setValor(10); setClienteId(preset?.id ?? ''); setUsos(preset ? '1' : 'ilimitado'); setUsosMax(20); setVenceEl(''); setNota('')
    }
  }, [open, cupon, clientePreset])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (codigo.trim().length < 3) return toast.error('El código es muy corto.')
    if (!(valor > 0)) return toast.error('Indica el valor del descuento.')
    if (tipo === 'porcentaje' && valor > 100) return toast.error('El porcentaje no puede pasar de 100.')
    setSaving(true)
    try {
      const input: CuponInput = { codigo: codigo.trim(), tipo, valor: Number(valor), cliente_id: clienteId || null, usos_max: usos === 'ilimitado' ? null : usos === '1' ? 1 : Number(usosMax), vence_el: venceEl || null, nota: nota.trim() || null }
      const saved = await guardarCupon(input, cupon?.id)
      toast.success(cupon ? 'Cupón actualizado.' : 'Cupón creado.')
      onSaved(saved)
    } catch (err) { toast.error(err instanceof Error && err.message.includes('duplicate') ? 'Ese código ya existe.' : 'No se pudo guardar el cupón.') } finally { setSaving(false) }
  }

  return <Modal open={open} onClose={onClose} title={cupon ? 'Editar cupón' : 'Nuevo cupón'} description="El descuento se aplica al total del pedido. Un cupón por cliente se ofrece en su próxima compra; sin cliente, es un código suelto para redes.">
    <form onSubmit={(e) => void submit(e)} className="form-grid">
      <label className="form-field sm:col-span-2"><span>Código</span><div className="flex gap-2"><input className="min-w-0 flex-1 font-mono uppercase" value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} placeholder="HAUS-XXXXX" /><button type="button" className="subtle-button shrink-0 px-3" onClick={() => setCodigo(generarCodigo(clienteId && clientes.find((c) => c.id === clienteId) ? clientes.find((c) => c.id === clienteId)!.nombre.split(' ')[0] : 'HAUS'))}>Generar</button></div></label>
      <label className="form-field"><span>Tipo de descuento</span><select value={tipo} onChange={(e) => setTipo(e.target.value as 'porcentaje' | 'monto')}><option value="porcentaje">Porcentaje (%)</option><option value="monto">Monto fijo (US$)</option></select></label>
      <label className="form-field"><span>{tipo === 'porcentaje' ? 'Porcentaje (%)' : 'Monto (US$)'}</span><input type="number" min="0" step={tipo === 'porcentaje' ? '1' : '0.01'} value={valor} onChange={(e) => setValor(Number(e.target.value))} /></label>
      <label className="form-field sm:col-span-2"><span>¿Para un cliente? (opcional)</span><select value={clienteId} onChange={(e) => setClienteId(e.target.value)} disabled={!!clientePreset}><option value="">Código suelto (para redes)</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre} · {c.whatsapp}</option>)}</select></label>
      <label className="form-field"><span>Usos</span><select value={usos} onChange={(e) => setUsos(e.target.value as '1' | 'varios' | 'ilimitado')}><option value="1">Un solo uso</option><option value="varios">Varios (con tope)</option><option value="ilimitado">Ilimitado</option></select></label>
      {usos === 'varios' ? <label className="form-field"><span>Tope de usos</span><input type="number" min="1" step="1" value={usosMax} onChange={(e) => setUsosMax(Number(e.target.value))} /></label> : <label className="form-field"><span>Vence (opcional)</span><input type="date" value={venceEl} onChange={(e) => setVenceEl(e.target.value)} /></label>}
      {usos === 'varios' && <label className="form-field sm:col-span-2"><span>Vence (opcional)</span><input type="date" value={venceEl} onChange={(e) => setVenceEl(e.target.value)} /></label>}
      <label className="form-field sm:col-span-2"><span>Nota (opcional)</span><input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej: promo del Día de las Madres" /></label>
      <div className="col-span-full flex justify-end gap-2 pt-1"><button type="button" className="subtle-button px-4" onClick={onClose}>Cancelar</button><button className="primary-button px-5" disabled={saving}>{saving ? 'Guardando…' : 'Guardar cupón'}</button></div>
    </form>
  </Modal>
}
