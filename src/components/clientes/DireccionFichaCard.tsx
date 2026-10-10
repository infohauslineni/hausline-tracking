import { MapPin, Pencil, Save, Truck } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import type { Cliente } from '../../types/domain'

// En el pedido: la dirección que quedó en la FICHA del cliente (cuando no tiene direcciones en su
// cuenta web), con su costo de envío para definirlo ahí mismo y agregarlo al pedido.
type Ficha = Pick<Cliente, 'direccion' | 'referencia' | 'ciudad' | 'departamento' | 'costo_envio'>

export function DireccionFichaCard({ clienteId, cliente, admin, onCosto, onUsar }: {
  clienteId: string
  cliente: Ficha
  /** El operador ve la dirección, pero no cambia el costo ni entra a Clientes. */
  admin: boolean
  onCosto: (costo: number | null) => void
  onUsar?: (costoUsd: number | null, detalle: string) => void
}) {
  const [editando, setEditando] = useState(false)
  const [valor, setValor] = useState('')
  const [guardando, setGuardando] = useState(false)
  const lineas = [cliente.direccion, cliente.referencia].filter(Boolean) as string[]
  const zona = [...new Set([cliente.ciudad, cliente.departamento].filter(Boolean))].join(', ')
  const costo = cliente.costo_envio != null ? Number(cliente.costo_envio) : null

  const guardar = async () => {
    if (!supabase) return
    const limpio = valor.trim()
    const nuevo = limpio === '' ? null : Math.max(0, Math.round(Number(limpio) * 100) / 100)
    if (limpio !== '' && !Number.isFinite(Number(limpio))) return toast.error('Escribí un monto válido.')
    setGuardando(true)
    try {
      const { error } = await supabase.from('clientes').update({ costo_envio: nuevo }).eq('id', clienteId)
      if (error) throw error
      onCosto(nuevo); setEditando(false)
      toast.success(nuevo == null ? 'Sin costo fijo: el envío queda a cotizar.' : `Envío de este cliente: US$ ${nuevo.toFixed(2)}.`)
    } catch { toast.error('No se pudo guardar el costo.') } finally { setGuardando(false) }
  }

  return <section className="form-section">
    <h2 className="flex items-center gap-2 font-semibold"><MapPin size={18} className="text-accent" /> Dirección de su ficha</h2>
    <div className="mt-3 rounded-xl border border-line bg-white/[.02] p-3 text-sm">
      {lineas.length ? lineas.map((x, i) => <p key={i} className={i === 0 ? 'font-semibold text-white' : 'text-white/75'}>{x}</p>) : <p className="text-amber-200">Solo tenemos la zona: falta la dirección exacta.</p>}
      {zona && <p className="text-muted">{zona}</p>}
      {editando
        ? <div className="mt-3 flex items-end gap-2"><label className="form-field flex-1"><span>Costo del envío (US$)</span><input type="number" min="0" step="0.5" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="A cotizar" autoFocus /></label><button className="primary-button px-4" disabled={guardando} onClick={() => void guardar()}><Save size={15} /> {guardando ? 'Guardando…' : 'Guardar'}</button></div>
        : <p className="mt-2">Envío: <strong>{costo != null ? `US$ ${costo.toFixed(2)}` : 'A cotizar'}</strong> <span className="text-[11px] text-muted">{costo != null ? '(el de este cliente)' : '(sin definir)'}</span></p>}
      {admin && <div className="mt-3 flex flex-wrap gap-2">
        {!editando && <button className="subtle-button" onClick={() => { setValor(costo != null ? String(costo) : ''); setEditando(true) }}><Pencil size={14} /> {costo != null ? 'Cambiar costo' : 'Definir costo'}</button>}
        <Link className="subtle-button" to={`/clientes/${clienteId}`}>Editar dirección</Link>
      </div>}
      {onUsar && !editando && <button className="primary-button mt-2 w-full" onClick={() => onUsar(costo, `${zona && /managua/i.test(zona) ? 'Delivery' : 'Envío'} a ${lineas[0] ?? (zona || 'su dirección')}`)}><Truck size={16} /> Agregar este envío al pedido</button>}
    </div>
  </section>
}
