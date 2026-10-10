import { AlertTriangle, Copy, Mail, MapPin, MessageCircle, Phone, Truck, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Modal } from '../ui/Modal'
import { supabase } from '../../lib/supabase'
import { costoEnvioPedido, direccionesDeCliente, type DireccionCliente } from '../../services/direccionesCliente.service'
import { esManaguaLugar, lugaresEntrega } from '../../services/entregas.service'
import type { Cliente, Pedido } from '../../types/domain'
import { whatsappUrl } from '../../utils/whatsapp'

// Datos de ENTREGA del cliente (para no tener que pedírselos por WhatsApp al avisar que su
// pedido está disponible). Junta, en orden de prioridad:
//   1. La dirección a la que el cliente pidió el envío desde la tienda (entrega_direccion).
//   2. Sus direcciones guardadas en Mi cuenta (la predeterminada primero).
//   3. Lo que quedó en su ficha de cliente (departamento / ciudad / dirección del registro).
// Si no hay ninguna, lo avisa y ofrece pedirle la dirección por WhatsApp.


function useDatosCliente(pedido: Pedido) {
  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [direcciones, setDirecciones] = useState<DireccionCliente[]>([])
  const [cargando, setCargando] = useState(true)
  useEffect(() => {
    let vivo = true
    if (!supabase || !pedido.cliente_id) { void Promise.resolve().then(() => { if (vivo) setCargando(false) }); return () => { vivo = false } }
    const db = supabase
    void Promise.resolve().then(() => { if (vivo) setCargando(true) }).then(() => Promise.all([
      db.from('clientes').select('*').eq('id', pedido.cliente_id).maybeSingle().then((r) => r.data as Cliente | null),
      direccionesDeCliente(pedido.cliente_id).then((r) => r.direcciones).catch(() => []),
    ])).then(([c, d]) => { if (vivo) { setCliente(c); setDirecciones(d) } }).finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [pedido.cliente_id])
  return { cliente, direcciones, cargando }
}


export function DatosEntregaCliente({ pedido, mostrarSaldo = true }: { pedido: Pedido; mostrarSaldo?: boolean }) {
  const { cliente, direcciones, cargando } = useDatosCliente(pedido)
  const nombre = cliente?.nombre ?? pedido.clientes?.nombre ?? 'Cliente'
  const telefono = cliente?.whatsapp ?? pedido.clientes?.whatsapp ?? ''
  // Si no se pudo leer la ficha completa, se usa lo que trae el pedido (departamento / ciudad).
  const lista = lugaresEntrega(pedido, cliente ?? (pedido.clientes as unknown as Cliente | null) ?? null, direcciones)
  const principal = lista[0] ?? null
  const saldo = Math.max(0, Number(pedido.saldo || 0))
  // Mismo costo que usa el WhatsApp de disponible (si la línea de envío ya está en el pedido, el saldo ya la incluye).
  const envio = costoEnvioPedido({ ...pedido, clientes: { costo_envio: cliente?.costo_envio ?? pedido.clientes?.costo_envio ?? null } }, direcciones, [], 0)
  const origenEnvio = envio ? { pedido: 'Envío agregado al pedido', tienda: 'Envío confirmado por el cliente', direccion: 'Envío fijado para su dirección', cliente: 'Envío predeterminado del cliente', zona: 'Tarifa de su zona' }[envio.fuente] : ''
  const totalConEnvio = envio ? (envio.incluido ? saldo : saldo + envio.costo) : saldo

  const copiar = async (texto: string, ok: string) => { try { await navigator.clipboard.writeText(texto); toast.success(ok) } catch { toast.error('No se pudo copiar.') } }
  // Bloque listo para mandarle al delivery / pegar en la guía del bus.
  const textoEntrega = [
    `Pedido ${pedido.codigo}`,
    `Cliente: ${nombre}`,
    telefono && `Teléfono: ${telefono}`,
    ...(principal ? principal.lineas.slice(principal.deFicha ? 0 : 1).map((l, i) => i === 0 ? `Dirección: ${l}` : l) : []),
    principal?.mapa && `Ubicación: ${principal.mapa}`,
    mostrarSaldo && saldo > 0.01 && `Cobrar: US$ ${saldo.toFixed(2)}`,
  ].filter(Boolean).join('\n')
  const pedirDireccion = `Hola ${nombre.split(' ')[0]}, su pedido ${pedido.codigo} ya está disponible para entrega. ¿Nos confirma la dirección completa (con referencia) y el departamento para coordinar el envío? Gracias. — El equipo de HAUSLINE`

  if (cargando) return <div className="h-32 animate-pulse rounded-xl border border-line bg-white/[.02]" />

  return <div className="space-y-3 text-sm">
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="flex items-center gap-2.5 rounded-xl border border-line bg-white/[.02] p-3"><UserRound size={18} className="shrink-0 text-accent" /><div className="min-w-0"><p className="text-[11px] text-muted">Nombre</p><strong className="block truncate">{nombre}</strong></div></div>
      <div className="flex items-center gap-2.5 rounded-xl border border-line bg-white/[.02] p-3"><Phone size={18} className="shrink-0 text-accent" /><div className="min-w-0 flex-1"><p className="text-[11px] text-muted">WhatsApp / teléfono</p><strong className="block truncate font-mono">{telefono || '—'}</strong></div>
        {telefono && <><button className="table-action" onClick={() => void copiar(telefono, 'Número copiado.')} title="Copiar número" aria-label="Copiar número"><Copy size={15} /></button><a className="table-action" href={whatsappUrl(telefono, '')} target="_blank" rel="noreferrer" title="Abrir chat" aria-label="Abrir chat"><MessageCircle size={15} /></a></>}</div>
      {cliente?.correo && <div className="flex items-center gap-2.5 rounded-xl border border-line bg-white/[.02] p-3 sm:col-span-2"><Mail size={18} className="shrink-0 text-accent" /><div className="min-w-0"><p className="text-[11px] text-muted">Correo</p><span className="block truncate">{cliente.correo}</span></div></div>}
    </div>

    {lista.length ? lista.map((l, i) => <div key={i} className={`rounded-xl border p-3 ${i === 0 ? 'border-accent/35 bg-accent/[.05]' : 'border-line bg-white/[.02]'}`}>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted"><MapPin size={13} className={i === 0 ? 'text-accent' : ''} /> {l.titulo}</p>
      <div className="mt-1.5 space-y-0.5">{l.lineas.map((x, j) => <p key={j} className={j === 0 ? 'font-semibold text-white' : 'text-white/80'}>{x}</p>)}</div>
      {l.mapa && <a className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:underline" href={l.mapa} target="_blank" rel="noopener noreferrer"><MapPin size={13} /> Ver en Google Maps</a>}
    </div>)
      : <div className="rounded-xl border border-amber-400/30 bg-amber-400/[.07] p-3 text-xs text-amber-200">
        <p className="flex items-center gap-2 font-semibold"><AlertTriangle size={15} /> No tenemos la dirección de este cliente.</p>
        <p className="mt-1 text-amber-200/80">No pidió envío desde la tienda, no guardó direcciones en Mi cuenta y su ficha no tiene dirección.</p>
        {telefono && <a className="subtle-button mt-2.5 inline-flex px-3 py-1.5 text-xs" href={whatsappUrl(telefono, pedirDireccion)} target="_blank" rel="noreferrer"><MessageCircle size={14} /> Pedirle la dirección por WhatsApp</a>}
      </div>}

    {principal && <p className="flex items-center gap-2 rounded-xl border border-line bg-white/[.02] px-3 py-2 text-xs text-muted"><Truck size={15} className="shrink-0 text-accent" />{esManaguaLugar(principal) ? <span>Es de <b className="text-white">Managua</b>: entrega por <b className="text-white">delivery</b>.</span> : <span>Es de <b className="text-white">{principal.departamento || principal.ciudad || 'fuera de Managua'}</b>: envío por <b className="text-white">bus / Cargotrans</b>.</span>}</p>}
    {envio && <p className="rounded-xl border border-line bg-white/[.02] px-3 py-2 text-xs text-muted">{origenEnvio}: <b className="font-mono text-white">US$ {envio.costo.toFixed(2)}</b>{mostrarSaldo && totalConEnvio > 0.01 ? <> · total con envío <b className="font-mono text-white">US$ {totalConEnvio.toFixed(2)}</b></> : null}</p>}
    {mostrarSaldo && saldo > 0.01 && <p className="rounded-xl border border-line bg-white/[.02] px-3 py-2 text-xs text-muted">Saldo a cobrar al entregar: <b className="font-mono text-white">US$ {saldo.toFixed(2)}</b></p>}

    <button className="primary-button w-full" onClick={() => void copiar(textoEntrega, 'Datos de entrega copiados. Pegalos al delivery o en la guía.')}><Copy size={16} /> Copiar datos de entrega</button>
  </div>
}

export function DatosEntregaModal({ open, pedido, mostrarSaldo, onClose }: { open: boolean; pedido: Pedido | null; mostrarSaldo?: boolean; onClose: () => void }) {
  return <Modal open={open && !!pedido} onClose={onClose} title="Datos de entrega del cliente" description="Todo lo que necesitás para coordinar la entrega, sin pedírselo por WhatsApp.">
    {pedido && <DatosEntregaCliente pedido={pedido} mostrarSaldo={mostrarSaldo} />}
  </Modal>
}
