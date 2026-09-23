import { Plus, Save, Trash2, Truck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { DEPARTAMENTOS_NI } from '../../constants/nicaragua'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'

type Fila = { zona: string; costo: string; nueva?: boolean }

// Tarifas de delivery por zona (departamento). Es el "costo de delivery" que el cliente ve en
// su panel cuando el pedido está Disponible para entrega. Una dirección puede tener además un
// costo propio (direcciones_cliente.costo_delivery) que tiene prioridad. Sin tarifa → el
// cliente ve "A cotizar por WhatsApp".
export function TarifasDeliverySection() {
  const [filas, setFilas] = useState<Fila[]>([])
  const [guardando, setGuardando] = useState(false)

  const cargar = async () => {
    if (!supabase) { setFilas([{ zona: 'Managua', costo: '8' }]); return }
    const { data, error } = await supabase.from('tarifas_delivery').select('zona, costo').order('zona')
    if (error) { toast.error('No se pudieron cargar las tarifas de delivery (¿falta aplicar la migración 202609230001?).'); return }
    setFilas((data ?? []).map((t) => ({ zona: t.zona, costo: String(t.costo) })))
  }
  useEffect(() => { void Promise.resolve().then(cargar) }, [])

  const libres = DEPARTAMENTOS_NI.filter((d) => !filas.some((f) => f.zona === d))
  const guardar = async () => {
    const validas = filas.filter((f) => f.zona)
    if (validas.some((f) => !(Number(f.costo) >= 0) || f.costo === '')) return toast.error('Revisá los montos.')
    setGuardando(true)
    try {
      if (isSupabaseConfigured && supabase) {
        const { error } = await supabase.from('tarifas_delivery').upsert(validas.map((f) => ({ zona: f.zona, costo: Number(f.costo), moneda: 'USD', activo: true, updated_at: new Date().toISOString() })), { onConflict: 'zona' })
        if (error) throw error
      }
      toast.success('Tarifas de delivery guardadas.')
      await cargar()
    } catch { toast.error('No se pudieron guardar las tarifas.') } finally { setGuardando(false) }
  }
  const quitar = async (zona: string) => {
    if (supabase) { const { error } = await supabase.from('tarifas_delivery').delete().eq('zona', zona); if (error) return toast.error('No se pudo quitar.') }
    setFilas((prev) => prev.filter((f) => f.zona !== zona))
  }

  return <section className="form-section mt-5">
    <h2 className="flex items-center gap-2 font-semibold"><Truck size={18} className="text-accent" /> Costo de delivery (panel del cliente)</h2>
    <p className="mt-2 max-w-2xl text-xs leading-5 text-muted">Cuando marcás un pedido como <b>Disponible para entrega</b>, el cliente ve este costo según el departamento de su dirección y puede solicitar el envío por WhatsApp. Si su zona no tiene tarifa, le aparece “A cotizar por WhatsApp”. Montos en dólares.</p>
    <div className="mt-4 space-y-2">
      {filas.map((f, i) => <div key={f.nueva ? `nueva-${i}` : f.zona} className="flex items-center gap-2">
        {f.nueva
          ? <select className="min-w-0 flex-1" value={f.zona} onChange={(e) => setFilas((prev) => prev.map((x) => x === f ? { ...x, zona: e.target.value } : x))}>
              <option value="">Elegí un departamento…</option>
              {(f.zona ? [f.zona, ...libres] : libres).map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          : <span className="min-w-0 flex-1 text-sm">{f.zona}</span>}
        <span className="text-xs text-muted">US$</span>
        <input type="number" min="0" step="0.5" className="w-24" value={f.costo} onChange={(e) => setFilas((prev) => prev.map((x) => x === f ? { ...x, costo: e.target.value } : x))} />
        <button type="button" className="table-action" aria-label={`Quitar ${f.zona}`} onClick={() => f.nueva ? setFilas((prev) => prev.filter((x) => x !== f)) : void quitar(f.zona)}><Trash2 size={15} /></button>
      </div>)}
    </div>
    <div className="mt-4 flex flex-wrap gap-2">
      {libres.length > 0 && <button type="button" className="subtle-button" onClick={() => setFilas((prev) => [...prev, { zona: '', costo: '', nueva: true }])}><Plus size={15} /> Agregar zona</button>}
      <button type="button" className="primary-button" disabled={guardando} onClick={() => void guardar()}><Save size={15} /> {guardando ? 'Guardando…' : 'Guardar tarifas'}</button>
    </div>
  </section>
}
