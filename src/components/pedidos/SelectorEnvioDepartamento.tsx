import { Bus, Check, Truck, X } from 'lucide-react'
import { BUS_NIO, CARGOTRANS_MOTORIZADO_NIO, RUTAS_CARGOTRANS, costoEnvioDepartamento, rutaCargotrans, type EleccionEnvio } from '../../constants/cargotrans'

const opcion = (on: boolean) => `flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 text-sm font-semibold transition ${on ? 'border-accent bg-accent/15 text-white ring-2 ring-accent' : 'border-line bg-transparent text-muted'}`

// Cargotrans (ruta + C$100 del motorizado) / Bus (C$160) / Sin envío. Cambia el método o la ruta
// cuando el cliente pide otra cosa; el monto en dólares se calcula con el tipo de cambio.
export function SelectorEnvioDepartamento({ ciudad, departamento, tipoCambio, valor, onChange }: { ciudad?: string | null; departamento?: string | null; tipoCambio: number; valor: EleccionEnvio; onChange: (v: EleccionEnvio) => void }) {
  const lugar = (ciudad || departamento || '').trim()
  const auto = rutaCargotrans(ciudad, departamento)
  const costo = costoEnvioDepartamento(valor.metodo, valor.ruta, lugar, tipoCambio)
  return <div className="space-y-2">
    <div className="grid grid-cols-3 gap-2">
      <button type="button" className={opcion(valor.metodo === 'cargotrans')} aria-pressed={valor.metodo === 'cargotrans'} onClick={() => onChange({ metodo: 'cargotrans', ruta: valor.ruta ?? auto })}><Truck size={15} /> Cargotrans</button>
      <button type="button" className={opcion(valor.metodo === 'bus')} aria-pressed={valor.metodo === 'bus'} onClick={() => onChange({ ...valor, metodo: 'bus' })}><Bus size={15} /> Bus</button>
      <button type="button" className={opcion(valor.metodo === 'ninguno')} aria-pressed={valor.metodo === 'ninguno'} onClick={() => onChange({ ...valor, metodo: 'ninguno' })}><X size={15} /> Sin envío</button>
    </div>
    {valor.metodo === 'cargotrans' && <div className="grid grid-cols-3 gap-2">
      {RUTAS_CARGOTRANS.map((r) => <button type="button" key={r.ruta} className={`rounded-xl border px-2 py-2 text-left text-xs transition ${valor.ruta === r.ruta ? 'border-accent bg-accent/10 ring-1 ring-accent' : 'border-line'}`} onClick={() => onChange({ metodo: 'cargotrans', ruta: r.ruta })}>
        <span className="flex items-center gap-1 font-semibold">{valor.ruta === r.ruta && <Check size={12} />}{r.label.replace('Ruta ', '')}</span>
        <span className="block text-muted">US${r.usd.toFixed(2)}{auto === r.ruta ? ' · su zona' : ''}</span>
      </button>)}
    </div>}
    {valor.metodo === 'cargotrans' && !auto && <p className="text-[11px] text-amber-300">{lugar ? `No encontré “${lugar}” en las rutas de Cargotrans` : 'El cliente no tiene municipio'}: elegí la ruta (Puerto Cabezas y Bluefields: escribí el monto a mano).</p>}
    <p className="text-[11px] text-muted">
      {costo ? <>Se suma <b className="text-white">US$ {costo.usd.toFixed(2)}</b> · {valor.metodo === 'bus' ? `C$${BUS_NIO} del bus` : `ruta + C$${CARGOTRANS_MOTORIZADO_NIO} del motorizado`} (tipo de cambio {tipoCambio > 0 ? tipoCambio : 37}).</> : valor.metodo === 'ninguno' ? 'No se agrega envío.' : 'Elegí la ruta para calcular el envío.'}
    </p>
  </div>
}
