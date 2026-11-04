import { useState } from 'react'
import { toast } from 'sonner'
import { Modal } from '../ui/Modal'
import { ENVIO_DEFECTO, guardarDatosPrecio, type DatosPrecio } from '../../services/preciosSugeridos.service'
import { TIPOS_PRODUCTO, type TipoProducto } from '../../utils/repartoCompra'

// Ajustes del precio sugerido y el mayorista: márgenes y envío estimado por tipo de producto.
// El envío vacío usa el promedio real de tus pedidos (o uno fijo si hay pocos datos).
const usd = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`

export function PreciosSugeridosModal({ datos, onClose, onGuardado }: { datos: DatosPrecio; onClose: () => void; onGuardado: (d: DatosPrecio) => void }) {
  const [tienda, setTienda] = useState(String(datos.margenTienda))
  const [mayorista, setMayorista] = useState(String(datos.margenMayorista))
  const [envio, setEnvio] = useState<Record<TipoProducto, string>>(() => Object.fromEntries((Object.keys(TIPOS_PRODUCTO) as TipoProducto[]).map((t) => [t, datos.fijo[t] ? String(datos.fijo[t]) : ''])) as Record<TipoProducto, string>)
  const [guardando, setGuardando] = useState(false)
  const mt = Number(tienda) || 0, mm = Number(mayorista) || 0

  const guardar = async () => {
    if (mt <= 0 || mt >= 90 || mm <= 0 || mm >= 90) return toast.error('Los márgenes van de 1 a 89 %.')
    setGuardando(true)
    try {
      const d = await guardarDatosPrecio({ margenTienda: mt, margenMayorista: mm, envioFijo: Object.fromEntries(Object.entries(envio).map(([k, v]) => [k, Number(String(v).replace(',', '.')) || 0])) })
      toast.success('Precios sugeridos actualizados.'); onGuardado(d)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo guardar.') } finally { setGuardando(false) }
  }

  return <Modal open onClose={onClose} title="Precios sugeridos" description="Precio = (costo del proveedor + envío estimado) ÷ (1 − margen). Solo se ve en el panel; no cambia los precios de la tienda.">
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-2 gap-3">
        <label className="form-field"><span>Ganancia precio tienda (%)</span><input inputMode="numeric" value={tienda} onChange={(e) => setTienda(e.target.value)} /></label>
        <label className="form-field"><span>Ganancia mayorista (%)</span><input inputMode="numeric" value={mayorista} onChange={(e) => setMayorista(e.target.value)} /></label>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-semibold text-muted">Envío a Nicaragua estimado por unidad (US$)</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(Object.keys(TIPOS_PRODUCTO) as TipoProducto[]).map((t) => {
            const real = datos.real[t]
            const auto = real.muestras >= 3 ? real.promedio : ENVIO_DEFECTO[t]
            return <label key={t} className="form-field"><span>{TIPOS_PRODUCTO[t].label}</span><input inputMode="decimal" placeholder={`${usd(auto)} auto`} value={envio[t]} onChange={(e) => setEnvio((x) => ({ ...x, [t]: e.target.value }))} />
              <span className="text-[11px] font-normal text-muted">{real.muestras >= 3 ? `Promedio de ${real.muestras} pedidos` : 'Pocos datos: fijo'}</span></label>
          })}
        </div>
        <p className="mt-1.5 text-[11px] text-muted">Vacío = automático (promedio real del envío internacional de tus pedidos).</p>
      </div>
      <div className="rounded-lg bg-white/[0.03] px-3 py-2 text-xs text-muted">Ej.: camisa de $24.50 + envío {usd(datos.envio.ropa)} → tienda <b className="text-white">{usd(Math.ceil((24.5 + datos.envio.ropa) / (1 - mt / 100)))}</b> · mayorista <b className="text-white">{usd(Math.ceil((24.5 + datos.envio.ropa) / (1 - mm / 100)))}</b></div>
      <div className="flex justify-end gap-2"><button type="button" className="subtle-button" onClick={onClose}>Cancelar</button><button type="button" className="primary-button px-5" disabled={guardando} onClick={() => void guardar()}>{guardando ? 'Guardando…' : 'Guardar'}</button></div>
    </div>
  </Modal>
}
