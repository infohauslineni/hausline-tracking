import { ClipboardPaste, Copy, MessageCircle, PackagePlus, Share2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { CLAVE_DATOS_CLIENTE, cuantosDatos, leerDatosCliente, mensajePedirDatos } from '../../utils/datosCliente'
import { whatsappUrl } from '../../utils/whatsapp'
import { Modal } from '../ui/Modal'

// PEDIR DATOS AL CLIENTE (acceso rápido "+"): arma el mensaje con los datos que hacen falta para
// confirmar la orden y lo manda por WhatsApp. Cuando el cliente responde, se pega su respuesta
// y con un toque se abre la orden nueva con esos datos ya puestos.
export function PedirDatosModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const [whatsapp, setWhatsapp] = useState('')
  const [nombre, setNombre] = useState('')
  const [talla, setTalla] = useState(true)
  const [editado, setEditado] = useState<string | null>(null)
  const [respuesta, setRespuesta] = useState('')
  const mensaje = editado ?? mensajePedirDatos({ nombre, incluirTalla: talla })
  const leidos = useMemo(() => leerDatosCliente(respuesta), [respuesta])
  const movil = typeof navigator !== 'undefined' && /Android|iPhone|iPad/i.test(navigator.userAgent) && typeof navigator.share === 'function'

  const copiar = async () => { try { await navigator.clipboard.writeText(mensaje); toast.success('Mensaje copiado. Pegalo en el chat del cliente.') } catch { toast.error('No se pudo copiar.') } }
  const compartir = async () => { try { await navigator.share({ text: mensaje }) } catch { /* canceló */ } }
  const pegar = async () => { try { const t = await navigator.clipboard.readText(); if (t.trim()) setRespuesta(t) } catch { toast.error('Pegalo con mantener apretado → Pegar.') } }
  const crearOrden = () => {
    try { sessionStorage.setItem(CLAVE_DATOS_CLIENTE, respuesta) } catch { /* sin almacenamiento */ }
    onClose()
    navigate('/pedidos/nuevo?cliente=nuevo')
  }

  return <Modal open onClose={onClose} title="Pedir datos al cliente" description="Mandale el mensaje para confirmar su orden. Cuando te responda, pegá su respuesta abajo y creá la orden con sus datos ya puestos.">
    <div className="space-y-4 text-sm">
      <section className="space-y-2">
        <div className="grid gap-2 sm:grid-cols-2">
          <input className="simple-input" inputMode="tel" placeholder="WhatsApp del cliente (opcional)" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
          <input className="simple-input" placeholder="Nombre (opcional, para saludarlo)" value={nombre} onChange={(e) => { setNombre(e.target.value); setEditado(null) }} />
        </div>
        <label className="flex min-h-9 items-center gap-2 text-xs text-muted"><input type="checkbox" className="size-4" checked={talla} onChange={(e) => { setTalla(e.target.checked); setEditado(null) }} /> Pedir también la talla (EUR)</label>
        <textarea rows={11} className="simple-input font-sans text-[13px] leading-5" value={mensaje} onChange={(e) => setEditado(e.target.value)} aria-label="Mensaje para el cliente" />
        <div className="grid gap-2 sm:grid-cols-3">
          <a className="primary-button justify-center" href={whatsappUrl(whatsapp, mensaje)} target="_blank" rel="noreferrer"><MessageCircle size={16} /> {whatsapp.replace(/\D/g, '').length >= 8 ? 'Abrir su chat' : 'Abrir WhatsApp'}</a>
          <button type="button" className="subtle-button justify-center" onClick={() => void copiar()}><Copy size={15} /> Copiar</button>
          {movil && <button type="button" className="subtle-button justify-center" onClick={() => void compartir()}><Share2 size={15} /> Compartir</button>}
        </div>
      </section>

      <section className="space-y-2 border-t border-line pt-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">¿Ya le respondió?</p>
        <div className="relative">
          <textarea rows={5} className="simple-input text-[13px] leading-5" placeholder="Pegá aquí lo que le respondió el cliente" value={respuesta} onChange={(e) => setRespuesta(e.target.value)} />
          {!respuesta && <button type="button" className="subtle-button absolute bottom-2 right-2 min-h-8 px-2.5 text-xs" onClick={() => void pegar()}><ClipboardPaste size={14} /> Pegar</button>}
        </div>
        {respuesta.trim() && <p className="text-xs text-muted">{cuantosDatos(leidos) ? <>Encontré <b className="text-white">{cuantosDatos(leidos)}</b> datos: {[leidos.nombre, leidos.whatsapp, leidos.correo, leidos.departamento, leidos.ciudad].filter(Boolean).join(' · ')}</> : 'No encontré datos en ese texto; igual podés crear la orden y escribirlos.'}</p>}
        <button type="button" className="primary-button w-full justify-center" disabled={!respuesta.trim()} onClick={crearOrden}><PackagePlus size={16} /> Crear orden con estos datos</button>
      </section>
    </div>
  </Modal>
}
