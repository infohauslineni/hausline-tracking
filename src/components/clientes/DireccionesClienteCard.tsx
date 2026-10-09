import { Copy, MapPin, Pencil, Truck } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { costoDelivery, direccionesDeCliente, direccionesDeCuenta, fijarCostoDireccion, lineasDireccion, tarifasDelivery, urlMapa, type CostoDelivery, type DireccionCliente, type TarifaDelivery } from '../../services/direccionesCliente.service'

const TIPO: Record<DireccionCliente['tipo'], string> = { residencial: 'Casa', trabajo: 'Trabajo', otro: 'Otro' }
const precio = (c: CostoDelivery) => `${c.moneda === 'NIO' ? 'C$' : 'US$'} ${c.costo.toFixed(2)}`

// Direcciones que el cliente guardó en Mi cuenta (tienda), con su ubicación y el costo de
// delivery que ve él. Desde aquí se fija un costo propio por dirección y, en el pedido, se
// usa para agregar el envío (onUsar abre el modal "Agregar envío" ya lleno).
// Se usa con clienteId (ficha / pedido) o con userId (una cuenta web que todavía no compró).
export function DireccionesClienteCard({ clienteId, userId, compacto = false, tipoCambio = 37, onUsar, onCambio }: {
  clienteId?: string
  userId?: string
  compacto?: boolean
  tipoCambio?: number
  onUsar?: (costoUsd: number | null, detalle: string) => void
  /** Se llama después de cambiar el costo de una dirección (para recalcular el aviso). */
  onCambio?: () => void
}) {
  const [datos, setDatos] = useState<{ tieneCuenta: boolean; direcciones: DireccionCliente[] } | null>(null)
  const [tarifas, setTarifas] = useState<TarifaDelivery[]>([])
  const [todas, setTodas] = useState(false)
  const [editando, setEditando] = useState<string | null>(null)
  const [valor, setValor] = useState('')

  const cargar = useCallback(async () => {
    try {
      const buscar = userId
        ? direccionesDeCuenta(userId).then((direcciones) => ({ tieneCuenta: true, direcciones }))
        : clienteId ? direccionesDeCliente(clienteId) : Promise.resolve({ tieneCuenta: false, direcciones: [] })
      const [d, t] = await Promise.all([buscar, tarifasDelivery()])
      setDatos(d); setTarifas(t)
    } catch { setDatos({ tieneCuenta: false, direcciones: [] }) }
  }, [clienteId, userId])
  useEffect(() => { void Promise.resolve().then(cargar) }, [cargar])

  if (!datos) return null
  // En el pedido (compacto) no ocupa lugar si el cliente no guardó direcciones.
  if (compacto && !datos.direcciones.length) return null

  const guardarCosto = async (d: DireccionCliente) => {
    const limpio = valor.trim()
    const costo = limpio === '' ? null : Number(limpio)
    if (costo != null && (!Number.isFinite(costo) || costo < 0)) { toast.error('Escribí un monto válido (o dejalo vacío para usar la tarifa de la zona).'); return }
    try {
      await fijarCostoDireccion(d.id, costo)
      toast.success(costo == null ? 'Listo: usa la tarifa de su zona.' : `Costo fijado: US$ ${costo.toFixed(2)}. El cliente lo ve en Mi cuenta.`)
      setEditando(null); await cargar(); onCambio?.()
    } catch { toast.error('No se pudo guardar el costo.') }
  }
  const copiar = (d: DireccionCliente) => {
    const mapa = urlMapa(d)
    const texto = [d.nombre, ...lineasDireccion(d), mapa ? `Ubicación: ${mapa}` : null].filter(Boolean).join('\n')
    void navigator.clipboard?.writeText(texto).then(() => toast.success('Dirección copiada.')).catch(() => undefined)
  }
  const usar = (d: DireccionCliente, c: CostoDelivery | null) => {
    if (!onUsar) return
    const usd = c ? (c.moneda === 'NIO' ? Math.round((c.costo / (tipoCambio || 37)) * 100) / 100 : c.costo) : null
    const zona = [...new Set([d.ciudad, d.departamento].filter(Boolean).map((x) => String(x).trim()))].join(', ')
    onUsar(usd, `Delivery a ${d.nombre} · ${zona}`)
  }

  const lista = compacto && !todas ? datos.direcciones.slice(0, 1) : datos.direcciones
  return <section className={compacto ? 'form-section' : 'form-section mt-5'}>
    <h2 className="flex items-center gap-2 font-semibold"><MapPin size={18} className="text-accent" /> {compacto ? 'Dirección de su cuenta web' : 'Direcciones guardadas (Mi cuenta)'}</h2>
    {!datos.tieneCuenta
      ? <p className="mt-2 text-xs leading-5 text-muted">El cliente no tiene cuenta web asociada. Cuando cree su cuenta y guarde su dirección, aparece aquí con su ubicación.</p>
      : !datos.direcciones.length
        ? <p className="mt-2 text-xs leading-5 text-muted">Tiene cuenta web pero todavía no guardó direcciones.</p>
        : <div className="mt-3 space-y-3">
            {lista.map((d) => {
              const c = costoDelivery(d, tarifas)
              const mapa = urlMapa(d)
              return <div key={d.id} className="rounded-xl border border-line bg-white/[0.02] p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{d.nombre}</strong>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">{TIPO[d.tipo] ?? d.tipo}</span>
                  {d.predeterminada && <span className="rounded-full bg-accent/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">Predeterminada</span>}
                </div>
                {lineasDireccion(d).map((l) => <p key={l} className="mt-0.5 text-[13px] text-muted">{l}</p>)}
                <p className="mt-2 text-[13px]">Delivery: <strong>{c ? precio(c) : 'A cotizar'}</strong> <span className="text-[11px] text-muted">{c?.fuente === 'direccion' ? '(fijado para esta dirección)' : c?.fuente === 'zona' ? `(tarifa ${c.zona})` : '(sin tarifa para su zona)'}</span></p>
                {editando === d.id
                  ? <form className="mt-2 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void guardarCosto(d) }}>
                      <input type="number" min="0" step=".01" className="w-32" placeholder="US$ (vacío = zona)" value={valor} onChange={(e) => setValor(e.target.value)} autoFocus />
                      <button className="primary-button min-h-9 px-3 text-xs">Guardar</button>
                      <button type="button" className="subtle-button min-h-9 px-3 text-xs" onClick={() => setEditando(null)}>Cancelar</button>
                    </form>
                  : <div className="mt-2 flex flex-wrap gap-2">
                      {mapa && <a className="subtle-button min-h-9 px-3 text-xs" href={mapa} target="_blank" rel="noopener noreferrer"><MapPin size={14} /> Ver en Google Maps</a>}
                      <button type="button" className="subtle-button min-h-9 px-3 text-xs" onClick={() => copiar(d)}><Copy size={14} /> Copiar dirección</button>
                      <button type="button" className="subtle-button min-h-9 px-3 text-xs" onClick={() => { setEditando(d.id); setValor(d.costo_delivery != null ? String(d.costo_delivery) : '') }}><Pencil size={14} /> {d.costo_delivery != null ? 'Cambiar costo' : 'Fijar costo'}</button>
                      {onUsar && <button type="button" className="primary-button min-h-9 px-3 text-xs" onClick={() => usar(d, c)}><Truck size={14} /> Agregar este envío al pedido</button>}
                    </div>}
                {!mapa && <p className="mt-2 text-[11px] text-muted">Sin pin en el mapa: el cliente no marcó su ubicación.</p>}
              </div>
            })}
            {compacto && datos.direcciones.length > 1 && <button type="button" className="text-xs font-semibold text-accent" onClick={() => setTodas((v) => !v)}>{todas ? 'Ver solo la predeterminada' : `Ver sus ${datos.direcciones.length} direcciones`}</button>}
          </div>}
  </section>
}
