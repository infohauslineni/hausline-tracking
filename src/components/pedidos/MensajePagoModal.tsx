import { Copy, Download, MessageCircle } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Modal } from '../ui/Modal'
import { cuentasTexto } from '../../constants/pagos'
import { descargarOCompartirCotizacion, type CotizacionData } from '../../services/cotizacionImagen.service'
import { whatsappUrl } from '../../utils/whatsapp'

// "ESPERAMOS SU PAGO": lo que se le manda al cliente ANTES de crear el pedido (desde un borrador o
// desde Nuevo pedido). Resumen de productos, envío y total, y cuánto debe depositar (50 % o el
// total) en dólares, córdobas o ambos, con las cuentas. También baja la cotización como imagen.

export type LineaMensaje = { nombre: string; talla?: string | null; cantidad: number; precio: number; imagen?: string | null }
type Moneda = 'ambas' | 'usd' | 'nio'

const r2 = (n: number) => Math.round(n * 100) / 100
const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`

export function MensajePagoModal({ open, onClose, cliente, lineas, envio, descuento = 0, tipoCambio, pagoInicial = '50', onPagoCambia }: {
  open: boolean; onClose: () => void
  cliente: { nombre: string; whatsapp?: string | null }
  lineas: LineaMensaje[]
  envio: { usd: number; detalle: string; lugar: string } | null
  descuento?: number
  tipoCambio: number
  pagoInicial?: '50' | 'total'
  onPagoCambia?: (p: '50' | 'total') => void
}) {
  const [pago, setPago] = useState<'50' | 'total'>(pagoInicial)
  const [moneda, setMoneda] = useState<Moneda>('ambas')
  const [exportando, setExportando] = useState(false)
  const [sufijoCot] = useState(() => Math.floor(Math.random() * 900) + 100)
  const tc = tipoCambio > 0 ? tipoCambio : 37
  const cs = (n: number) => `C$${(Math.ceil((n * tc) / 10) * 10).toLocaleString('en-US')}`
  const monto = (n: number) => (moneda === 'usd' ? usd(n) : moneda === 'nio' ? cs(n) : `${usd(n)} (${cs(n)})`)
  const productos = r2(lineas.reduce((s, l) => s + l.precio * l.cantidad, 0))
  const envioUsd = envio?.usd ?? 0
  const total = r2(Math.max(0, productos - descuento) + envioUsd)
  const deposito = pago === '50' ? r2(total * 0.5) : total
  const nombre1 = cliente.nombre.trim().split(/\s+/)[0] || ''

  const texto = [
    `Hola${nombre1 ? ` ${nombre1}` : ''} 👋 Le saluda el equipo de HAUSLINE. Este es el resumen de su pedido:`,
    '',
    ...lineas.map((l) => `🛍️ ${l.nombre}${l.talla ? ` · Talla ${l.talla}` : ''}${l.cantidad > 1 ? ` · ${l.cantidad} unidades` : ''} — ${usd(r2(l.precio * l.cantidad))}`),
    ...(descuento > 0 ? [`🏷️ Descuento — −${usd(descuento)}`] : []),
    ...(envio && envioUsd > 0 ? [`🚚 Envío a ${envio.lugar} — ${usd(envioUsd)}`] : []),
    '',
    `💵 Total${envioUsd > 0 ? ' con envío' : ''}: *${monto(total)}*`,
    '',
    pago === '50'
      ? `Para confirmar su pedido esperamos su depósito del 50 %: *${monto(deposito)}*. El resto (${monto(r2(total - deposito))}) lo paga al recibir.`
      : `Para confirmar su pedido esperamos su depósito del total: *${monto(deposito)}*.`,
    '',
    'Puede depositar a cualquiera de estas cuentas:',
    cuentasTexto(),
    '',
    'Cuando deposite, envíenos el comprobante por aquí y confirmamos su pedido de inmediato. ¡Muchas gracias! 🙌',
  ].join('\n')

  const cotizacion = (sufijo: number): CotizacionData => {
    const hoy = new Date()
    const desde = new Date(hoy.getTime() + 20 * 86400000), hasta = new Date(hoy.getTime() + 25 * 86400000)
    const mes = (d: Date) => new Intl.DateTimeFormat('es-NI', { month: 'long' }).format(d)
    const rango = desde.getMonth() === hasta.getMonth() ? `entre el ${desde.getDate()} y el ${hasta.getDate()} de ${mes(hasta)}` : `entre el ${desde.getDate()} de ${mes(desde)} y el ${hasta.getDate()} de ${mes(hasta)}`
    const z = (n: number) => String(n).padStart(2, '0')
    return {
      numero: `${String(hoy.getFullYear()).slice(2)}${z(hoy.getMonth() + 1)}${z(hoy.getDate())}-${sufijo}`,
      fecha: hoy, cliente: cliente.nombre.trim() || null,
      lineas: [
        ...lineas.map((l) => ({ nombre: l.nombre, imagen: l.imagen ?? null, tallas: l.talla ? [{ talla: l.talla, cantidad: l.cantidad }] : [], cantidad: l.cantidad, precio: l.precio, subtotal: r2(l.precio * l.cantidad) })),
        ...(descuento > 0 ? [{ nombre: 'Descuento', imagen: null, tallas: [], cantidad: 1, precio: -descuento, subtotal: -descuento, nota: 'Precio especial' }] : []),
        ...(envio && envioUsd > 0 ? [{ nombre: `Envío a ${envio.lugar}`, imagen: null, tallas: [], cantidad: 1, precio: envioUsd, subtotal: envioUsd, envio: true }] : []),
      ],
      total, totalCs: cs(total), pago, aPagar: deposito, aPagarCs: cs(deposito),
      entrega: `20 a 25 días con envío estándar (aprox. ${rango})`,
    }
  }
  const imagen = async () => {
    setExportando(true)
    try { const r = await descargarOCompartirCotizacion(cotizacion(sufijoCot)); if (r === 'descargada') toast.success('Cotización descargada. Mandala por WhatsApp.') }
    catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo crear la imagen.') } finally { setExportando(false) }
  }
  const copiar = async () => { try { await navigator.clipboard.writeText(texto); toast.success('Mensaje copiado.') } catch { toast.error('No se pudo copiar.') } }
  const opcion = (on: boolean) => `rounded-xl border px-2 py-2 text-sm font-semibold transition ${on ? 'border-accent bg-accent/15 text-white ring-2 ring-accent' : 'border-line text-muted'}`

  return <Modal open={open} onClose={onClose} title="Esperamos su pago" description="Mandale el total y cuánto debe depositar. El pedido no se crea hasta que registres el depósito.">
    <div className="space-y-4">
      <div><p className="mb-1.5 text-xs font-semibold text-muted">¿Cuánto deposita?</p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={opcion(pago === '50')} onClick={() => { setPago('50'); onPagoCambia?.('50') }}>50 % · {usd(r2(total * 0.5))}</button>
          <button type="button" className={opcion(pago === 'total')} onClick={() => { setPago('total'); onPagoCambia?.('total') }}>100 % · {usd(total)}</button>
        </div>
      </div>
      <div><p className="mb-1.5 text-xs font-semibold text-muted">Montos en</p>
        <div className="grid grid-cols-3 gap-2">
          {([['ambas', 'US$ y C$'], ['usd', 'Solo US$'], ['nio', 'Solo C$']] as [Moneda, string][]).map(([k, t]) => <button type="button" key={k} className={opcion(moneda === k)} onClick={() => setMoneda(k)}>{t}</button>)}
        </div>
      </div>
      <div className="rounded-xl border border-line bg-white/[.02] p-3 text-sm">
        <p className="flex justify-between"><span className="text-muted">Total{envioUsd > 0 ? ' con envío' : ''}</span><b>{usd(total)} · {cs(total)}</b></p>
        <p className="mt-1 flex justify-between"><span className="text-muted">Deposita ahora ({pago === '50' ? '50 %' : '100 %'})</span><b className="text-emerald-400">{usd(deposito)} · {cs(deposito)}</b></p>
      </div>
      <label className="form-field"><span>Mensaje para WhatsApp</span><textarea rows={12} readOnly value={texto} className="font-sans text-[13px] leading-5" /></label>
      <div className="grid gap-2 sm:grid-cols-3">
        <a className="primary-button justify-center" href={whatsappUrl(cliente.whatsapp ?? '', texto)} target="_blank" rel="noreferrer"><MessageCircle size={16} /> WhatsApp</a>
        <button type="button" className="subtle-button justify-center" onClick={() => void copiar()}><Copy size={15} /> Copiar</button>
        <button type="button" className="subtle-button justify-center" disabled={exportando || !lineas.length} onClick={() => void imagen()}><Download size={15} /> {exportando ? 'Creando…' : 'Cotización (imagen)'}</button>
      </div>
    </div>
  </Modal>
}
