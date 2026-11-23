import { Bus, Truck, X } from 'lucide-react'
import { costoEleccion, costoEnvioDepartamento, rutaCargotrans, type EleccionEnvio } from '../../constants/cargotrans'

const opcion = (on: boolean) => `flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 text-sm font-semibold transition ${on ? 'border-accent bg-accent/15 text-white ring-2 ring-accent' : 'border-line bg-transparent text-muted'}`

// Cargotrans / Bus / Sin envío. El costo se calcula solo con la dirección del cliente (tabla de
// Cargotrans + C$100 del motorizado; bus C$160) y queda en una casilla para corregirlo a mano.
// conMonto=false: sin su propia casilla de monto (la ficha del pedido ya tiene la suya).
export function SelectorEnvioDepartamento({ ciudad, departamento, tipoCambio, valor, onChange, conMonto = true }: { ciudad?: string | null; departamento?: string | null; tipoCambio: number; valor: EleccionEnvio; onChange: (v: EleccionEnvio) => void; conMonto?: boolean }) {
  const lugar = (ciudad || departamento || '').trim()
  const ruta = valor.ruta ?? rutaCargotrans(ciudad, departamento)
  const estimado = costoEnvioDepartamento(valor.metodo, ruta, lugar, tipoCambio)
  const final = costoEleccion({ ...valor, ruta }, lugar, tipoCambio)
  const manual = valor.monto != null && valor.monto.trim() !== ''
  return <div className="space-y-2">
    <div className="grid grid-cols-3 gap-2">
      <button type="button" className={opcion(valor.metodo === 'cargotrans')} aria-pressed={valor.metodo === 'cargotrans'} onClick={() => onChange({ metodo: 'cargotrans', ruta, monto: null })}><Truck size={15} /> Cargotrans</button>
      <button type="button" className={opcion(valor.metodo === 'bus')} aria-pressed={valor.metodo === 'bus'} onClick={() => onChange({ metodo: 'bus', ruta, monto: null })}><Bus size={15} /> Bus</button>
      <button type="button" className={opcion(valor.metodo === 'ninguno')} aria-pressed={valor.metodo === 'ninguno'} onClick={() => onChange({ metodo: 'ninguno', ruta, monto: null })}><X size={15} /> Sin envío</button>
    </div>
    {conMonto && valor.metodo !== 'ninguno' && <div className="flex items-end gap-2">
      <label className="form-field min-w-0 flex-1"><span>Costo del envío (US$)</span><input inputMode="decimal" aria-label="Costo del envío en dólares" value={manual ? valor.monto! : estimado ? estimado.usd.toFixed(2) : ''} placeholder="Escribí el costo" onChange={(e) => onChange({ ...valor, ruta, monto: e.target.value.replace(/[^\d.,]/g, '') })} /></label>
      {manual && estimado && <button type="button" className="subtle-button shrink-0" onClick={() => onChange({ ...valor, ruta, monto: null })}>Usar {`US$ ${estimado.usd.toFixed(2)}`}</button>}
    </div>}
    {conMonto && <p className="text-[11px] text-muted">
      {valor.metodo === 'ninguno' ? 'No se agrega envío.'
        : manual ? <>Monto escrito a mano: se suma <b className="text-white">US$ {final?.usd.toFixed(2) ?? '0.00'}</b>.</>
        : estimado ? <>Calculado para {lugar || 'su dirección'}: {valor.metodo === 'bus' ? 'C$160 del bus' : 'tarifa de Cargotrans + C$100 del motorizado'}. Si sale distinto, cambiá el monto.</>
        : <>No pude calcularlo para {lugar || 'esta dirección'}: escribí el costo.</>}
    </p>}
  </div>
}
