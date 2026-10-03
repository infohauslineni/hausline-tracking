import { MapPin, Save, Truck } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import type { Cliente } from '../../types/domain'

// Dirección de entrega guardada (la del checkout / la que confirmó el cliente) y su COSTO DE ENVÍO
// PREDETERMINADO (US$). Ese costo sale en el correo de "Disponible para entrega" (total con envío);
// se llena solo con la tarifa de su departamento y aquí se puede cambiar.
export function EnvioClienteCard({ cliente, onGuardado }: { cliente: Cliente; onGuardado?: (c: Cliente) => void }) {
  const [costo, setCosto] = useState(cliente.costo_envio != null ? String(cliente.costo_envio) : '')
  const [guardando, setGuardando] = useState(false)
  const lugar = [cliente.direccion, cliente.referencia, cliente.departamento || cliente.ciudad].filter(Boolean).join(' · ')
  const cambiado = (cliente.costo_envio != null ? String(cliente.costo_envio) : '') !== costo.trim()

  const guardar = async () => {
    if (!supabase) return
    const valor = costo.trim() === '' ? null : Math.max(0, Math.round(Number(costo) * 100) / 100)
    if (costo.trim() !== '' && !Number.isFinite(Number(costo))) return toast.error('Escribí un monto válido.')
    setGuardando(true)
    try {
      const { data, error } = await supabase.from('clientes').update({ costo_envio: valor }).eq('id', cliente.id).select('*').single()
      if (error) throw error
      toast.success(valor == null ? 'Sin costo predeterminado: el envío sale "a cotizar".' : `Envío predeterminado: US$${valor.toFixed(2)}.`)
      onGuardado?.(data as Cliente)
    } catch (e) {
      toast.error(e instanceof Error && /costo_envio/.test(e.message) ? 'Falta aplicar la migración 202610020006.' : 'No se pudo guardar.')
    } finally { setGuardando(false) }
  }

  return <section className="mt-5 rounded-2xl border border-line bg-panel p-4">
    <h2 className="flex items-center gap-2 text-sm font-semibold"><Truck size={16} className="text-accent" /> Entrega</h2>
    <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-muted">Dirección guardada</p>
        <p className="mt-1 flex items-start gap-1.5 text-sm">{lugar ? <><MapPin size={14} className="mt-0.5 shrink-0 text-accent" /> <span className="min-w-0">{lugar}</span></> : <span className="text-muted">Todavía no tiene dirección. Se guarda sola cuando compre o cuando la confirme desde el correo.</span>}</p>
      </div>
      <div className="flex items-end gap-2">
        <label className="form-field w-40"><span>Envío predeterminado (US$)</span><input type="number" min="0" step="0.5" value={costo} onChange={(e) => setCosto(e.target.value)} placeholder="A cotizar" /></label>
        <button className="primary-button px-4" disabled={guardando || !cambiado} onClick={() => void guardar()}><Save size={15} /> {guardando ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </div>
    <p className="mt-2 text-[11px] leading-4 text-muted">Sale en el correo de "Disponible para entrega" con el total a pagar con envío, junto con un botón para que el cliente confirme o corrija la dirección.</p>
  </section>
}
