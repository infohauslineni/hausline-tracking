import { ArrowRight, Check, CheckCircle2, Info, MapPin, Package, PackageCheck, Pencil, Plus, Truck, XCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Cargando, CuentaShell, Hoja } from '../../components/cuenta/CuentaShell'
import { MapaTiles } from '../../components/cuenta/MapaTiles'
import { EstadoPedidoTag, FotoProducto } from '../../components/cuenta/piezas'
import { etapaBase } from '../../constants/orders'
import { buscarPedidoPublico } from '../../services/publicTracking.service'
import {
  costoDelivery, disponibleParaEntrega, esDemo, etapaCliente, formatoFecha, formatoMonto, lineasDireccion, listarDirecciones, listarTarifas,
  mensajeSolicitudEnvio, obtenerEntrega, solicitarEntrega, vincularPedido, type Direccion, type DireccionSnapshot, type EntregaPedido, type Tarifa,
} from '../../services/cuentaCliente.service'
import type { PublicOrder } from '../../types/publicTracking'
import { whatsappUrl } from '../../utils/whatsapp'

const WHATSAPP_HAUSLINE = import.meta.env.VITE_WHATSAPP_NUMBER || '50578995116'

export function CuentaPedidoDetallePage() {
  const { codigo = '' } = useParams()
  const location = useLocation()
  const [order, setOrder] = useState<PublicOrder | null | undefined>(undefined)
  const [direcciones, setDirecciones] = useState<Direccion[]>([])
  const [tarifas, setTarifas] = useState<Tarifa[]>([])
  const [entrega, setEntrega] = useState<EntregaPedido | null>(null)
  const [elegidaId, setElegidaId] = useState<string | null>(() => new URLSearchParams(location.search).get('direccion'))
  const [cambiar, setCambiar] = useState(false)
  const [flujo, setFlujo] = useState<{ fase: 'enviando' | 'listo'; mensaje: string } | null>(null)

  const cargar = useCallback(async () => {
    const code = codigo.toUpperCase()
    // Tener el código ya da acceso al seguimiento público: al abrirlo desde la cuenta lo
    // dejamos enlazado (idempotente) para que la solicitud de envío quede a su nombre.
    if (!esDemo) await vincularPedido(code).catch(() => false)
    const [o, dirs, tar, ent] = await Promise.all([
      buscarPedidoPublico(code).catch(() => null),
      listarDirecciones().catch(() => [] as Direccion[]),
      listarTarifas().catch(() => [] as Tarifa[]),
      obtenerEntrega(code).catch(() => null),
    ])
    setOrder(o); setDirecciones(dirs); setTarifas(tar); setEntrega(ent)
  }, [codigo])
  useEffect(() => { void Promise.resolve().then(cargar) }, [cargar])

  const elegida = useMemo(() => direcciones.find((d) => d.id === elegidaId) ?? direcciones.find((d) => d.id === entrega?.direccion?.id) ?? direcciones.find((d) => d.predeterminada) ?? direcciones[0] ?? null, [direcciones, elegidaId, entrega])
  const costo = costoDelivery(elegida, tarifas)

  const solicitar = async () => {
    if (!order || !elegida) return
    setFlujo({ fase: 'enviando', mensaje: '' })
    try {
      const inicio = Date.now()
      const nueva = await solicitarEntrega(order.codigo, elegida, tarifas)
      const resto = 700 - (Date.now() - inicio)
      if (resto > 0) await new Promise((r) => setTimeout(r, resto))
      setEntrega(nueva)
      setFlujo({ fase: 'listo', mensaje: mensajeSolicitudEnvio(order.codigo, elegida, nueva.costo ?? costo) })
    } catch (error) {
      setFlujo(null)
      toast.error(error instanceof Error ? error.message : 'No se pudo solicitar el envío.')
    }
  }

  if (order === undefined) return <CuentaShell titulo="Detalle del pedido" volver="/cuenta/pedidos"><Cargando /></CuentaShell>
  if (order === null) return <CuentaShell titulo="Detalle del pedido" volver="/cuenta/pedidos">
    <div className="hsp-card mt-4 p-8 text-center">
      <Package size={26} className="hsp-faint mx-auto" />
      <p className="mt-3 text-[14px] font-semibold">No encontramos el pedido {codigo.toUpperCase()}</p>
      <Link to="/cuenta/pedidos" className="hsp-btn hsp-btn--line mt-5 inline-flex h-10 min-h-0 text-[13px]">Volver a mis pedidos</Link>
    </div>
  </CuentaShell>

  const base = etapaBase(order.estado_codigo)
  const disponible = disponibleParaEntrega(order.estado_codigo)
  const volverAqui = `/cuenta/pedidos/${order.codigo}`

  return <CuentaShell titulo="Detalle del pedido" volver="/cuenta/pedidos">
    <ProductoCard order={order} />

    {disponible && <>
      {/* ¡Disponible! — sin seguimiento internacional: el pedido YA está en Nicaragua. */}
      <section className="hsc-ready hsp-rise mt-3" style={{ animationDelay: '40ms' }}>
        <div className="flex items-start gap-3.5">
          <span className="hsc-ready__icon"><Truck size={22} strokeWidth={1.6} /></span>
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold">¡Tu pedido ya está disponible!</h2>
            <p className="hsp-muted mt-1 text-[13px] leading-5">Tu pedido ya se encuentra en Nicaragua. Solicitá el envío a tu dirección registrada.</p>
          </div>
        </div>

        {entrega?.solicitada_at && <div className="hsc-note mt-3.5">
          <CheckCircle2 size={16} className="shrink-0" style={{ color: '#16a34a' }} />
          <span>Solicitaste el envío el {formatoFecha(entrega.solicitada_at)}{entrega.direccion ? ` a “${entrega.direccion.nombre}”` : ''}. Te confirmamos la entrega por WhatsApp.</span>
        </div>}

        <p className="hsp-eyebrow mb-2 mt-4">Dirección de entrega</p>
        {elegida
          ? <DireccionEntrega dir={elegida} />
          : <div className="rounded-2xl border border-dashed p-5 text-center" style={{ borderColor: 'var(--hair-strong)' }}>
              <MapPin size={20} className="hsp-faint mx-auto" />
              <p className="mt-2 text-[13px] font-semibold">Todavía no tenés una dirección guardada</p>
              <p className="hsp-muted mt-1 text-[12px]">Agregala para ver el costo de delivery y solicitar el envío.</p>
              <Link to={`/cuenta/direcciones/nueva?volver=${encodeURIComponent(volverAqui)}`} className="hsp-btn mt-4 inline-flex h-11 min-h-0 text-[13px]"><Plus size={15} /> Agregar dirección</Link>
            </div>}

        {elegida && <>
          <div className="hsc-kv mt-3">
            <span className="inline-flex items-center gap-1.5">Costo de delivery <span title="Tarifa configurada por HAUSLINE para esta dirección o su zona."><Info size={13} className="hsp-faint" /></span></span>
            <strong>{costo != null ? formatoMonto(costo) : 'A cotizar por WhatsApp'}</strong>
          </div>
          {Number(order.saldo ?? 0) > 0.01 && <div className="hsc-kv">
            <span>Saldo pendiente del pedido</span>
            <strong>{formatoMonto(order.saldo, order.moneda ?? 'USD')}</strong>
          </div>}

          <button type="button" onClick={() => void solicitar()} className="hsp-btn mt-4 w-full">
            <WhatsIcon /> {entrega?.solicitada_at ? 'Volver a solicitar envío' : 'Solicitar envío a esta dirección'}
          </button>
          <div className="mt-4 text-center">
            <p className="text-[13px] font-semibold">¿Necesitás cambiar tu dirección?</p>
            <p className="hsp-muted mt-0.5 text-[12px]">Podés actualizarla antes de solicitar el envío.</p>
            <button type="button" onClick={() => setCambiar(true)} className="hsp-btn hsp-btn--line mt-3 h-11 min-h-0 w-full text-[13px]"><MapPin size={15} /> Cambiar dirección</button>
          </div>
        </>}
      </section>
    </>}

    {base === 'empaquetado' && <EstadoCard icono={<PackageCheck size={22} strokeWidth={1.6} />} titulo="Empaquetado, listo para envío" texto={entrega?.direccion ? `Sale hacia “${entrega.direccion.nombre}”: ${lineasDireccion(entrega.direccion).slice(0, 2).join(', ')}.` : 'Tu pedido ya está empacado y sale pronto hacia tu dirección.'} verde />}
    {base === 'entregado' && <EstadoCard icono={<Check size={22} strokeWidth={2} />} titulo="Pedido entregado" texto={order.fecha_entrega ? `Entregado el ${formatoFecha(order.fecha_entrega)}. ¡Gracias por comprar en HAUSLINE!` : '¡Gracias por comprar en HAUSLINE!'} verde />}
    {base === 'cancelado' && <EstadoCard icono={<XCircle size={22} strokeWidth={1.6} />} titulo="Pedido cancelado" texto="Si tenés dudas sobre este pedido, escribinos por WhatsApp." />}
    {!disponible && (etapaCliente(order.estado_codigo) === 'proceso' || etapaCliente(order.estado_codigo) === 'enviado') && base !== 'empaquetado' && <EnCamino order={order} />}

    <Hoja abierta={cambiar} onCerrar={() => setCambiar(false)} titulo="Elegí la dirección de entrega">
      <div className="space-y-2">
        {direcciones.map((d) => {
          const c = costoDelivery(d, tarifas)
          const activa = d.id === elegida?.id
          return <div key={d.id} className={`hsc-option${activa ? ' is-on' : ''}`}>
            <button type="button" className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={() => { setElegidaId(d.id); setCambiar(false) }}>
              <span className="hsc-radio mt-0.5" aria-hidden />
              <span className="min-w-0">
                <strong className="block text-[14px]">{d.nombre}{d.predeterminada && <span className="hsc-pill ml-2">Predeterminada</span>}</strong>
                <span className="hsp-muted block truncate text-[12px]">{d.direccion}, {d.ciudad}</span>
                <span className="hsp-ink-soft block text-[12px]">Delivery: {c != null ? formatoMonto(c) : 'a cotizar'}</span>
              </span>
            </button>
            <Link to={`/cuenta/direcciones/${d.id}?volver=${encodeURIComponent(`${volverAqui}?direccion=${d.id}`)}`} className="hsc-iconbtn shrink-0" aria-label={`Editar ${d.nombre}`}><Pencil size={15} /></Link>
          </div>
        })}
      </div>
      <Link to={`/cuenta/direcciones/nueva?volver=${encodeURIComponent(volverAqui)}`} className="hsp-btn hsp-btn--line mt-3 h-11 min-h-0 w-full text-[13px]"><Plus size={15} /> Agregar nueva dirección</Link>
    </Hoja>

    <Hoja abierta={flujo !== null} onCerrar={() => setFlujo(null)}>
      {flujo?.fase === 'enviando'
        ? <div className="py-8 text-center">
            <span className="hsc-spinner" />
            <p className="mt-4 text-[16px] font-semibold">Solicitando envío</p>
            <p className="hsp-muted mt-1 text-[13px]">Estamos registrando tu solicitud…</p>
          </div>
        : flujo && <WhatsAppListo mensaje={flujo.mensaje} onCerrar={() => setFlujo(null)} />}
    </Hoja>
  </CuentaShell>
}

function ProductoCard({ order }: { order: PublicOrder }) {
  const [principal, ...resto] = order.productos ?? []
  return <section className="hsp-card hsp-rise p-4">
    <div className="flex items-center gap-4">
      <FotoProducto src={principal?.imagen ?? order.imagen_principal} tam={88} />
      <div className="min-w-0 flex-1">
        {principal?.marca && <span className="block text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>{principal.marca}</span>}
        <span className="block truncate text-[13px]" style={{ color: 'var(--ink-soft)' }}>{principal?.producto ?? 'Tu pedido'}</span>
        <span className="hsp-muted block text-[12px]">{[principal?.talla && `Talla ${principal.talla}`, principal?.color?.toUpperCase()].filter(Boolean).join(' · ')}</span>
        <span className="hsp-muted block text-[12px]">Pedido #{order.codigo}</span>
        {order.total != null && <strong className="mt-0.5 block text-[13px]">{formatoMonto(order.total, order.moneda ?? 'USD')}</strong>}
        <div className="mt-1.5"><span className="hsc-status"><EstadoPedidoTag estado={order.estado_codigo} /></span></div>
      </div>
    </div>
    {resto.length > 0 && <ul className="mt-3 space-y-2 border-t pt-3" style={{ borderColor: 'var(--hair)' }}>
      {resto.map((p, i) => <li key={p.id ?? i} className="flex items-center gap-3">
        <FotoProducto src={p.imagen} tam={40} redondo={9} />
        <span className="min-w-0 flex-1 truncate text-[12px]"><b className="font-semibold">{p.marca}</b> {p.producto}{p.talla ? ` · Talla ${p.talla}` : ''}</span>
        <span className="hsp-faint text-[11px]">×{p.cantidad}</span>
      </li>)}
    </ul>}
  </section>
}

function DireccionEntrega({ dir }: { dir: DireccionSnapshot }) {
  const mapa = dir.lat != null && dir.lng != null ? `https://www.google.com/maps?q=${dir.lat},${dir.lng}` : null
  return <div className="hsc-address">
    <div className="flex items-start gap-2.5 p-3.5">
      <MapPin size={17} className="mt-0.5 shrink-0" style={{ color: 'var(--ink)' }} />
      <div className="min-w-0 flex-1">
        <strong className="block text-[14px]">{dir.nombre}</strong>
        {lineasDireccion(dir).map((l) => <span key={l} className="hsp-muted block text-[12px] leading-[1.45]">{l}</span>)}
      </div>
    </div>
    <div className="relative">
      <MapaTiles lat={dir.lat} lng={dir.lng} alto={112} />
      {mapa && <a href={mapa} target="_blank" rel="noopener noreferrer" className="hsc-mapbtn">Ver en mapa</a>}
    </div>
  </div>
}

function EnCamino({ order }: { order: PublicOrder }) {
  const base = etapaBase(order.estado_codigo)
  const enNicaragua = base === 'llego_nicaragua'
  const pasos = ['pedido_confirmado', 'en_preparacion', 'control_calidad', 'transito_internacional', 'llego_nicaragua', 'disponible_entrega']
  const idx = Math.max(0, pasos.indexOf(base))
  const pct = Math.round(((idx + 1) / (pasos.length + 1)) * 100)
  return <section className="hsp-card hsp-rise mt-3 p-4" style={{ animationDelay: '40ms' }}>
    <p className="hsp-eyebrow">Estado actual</p>
    <h2 className="mt-1.5 text-[16px] font-semibold">{order.estado}</h2>
    <p className="hsp-muted mt-1 text-[13px] leading-5">{enNicaragua ? 'Tu pedido ya llegó a Nicaragua. Te avisaremos apenas esté disponible para entrega para que solicités el envío.' : order.fecha_estimada ? `Llegada estimada: ${formatoFecha(order.fecha_estimada)}.` : 'Te avisamos en cada etapa.'}</p>
    <div className="hsp-progress mt-4"><span className="hsp-progress__bar is-done" style={{ width: `${pct}%` }} /></div>
    <Link to={`/pedido/${order.codigo}`} className="hsp-btn hsp-btn--line mt-4 h-11 min-h-0 w-full text-[13px]">Ver seguimiento completo <ArrowRight size={15} /></Link>
  </section>
}

function EstadoCard({ icono, titulo, texto, verde }: { icono: ReactNode; titulo: string; texto: string; verde?: boolean }) {
  return <section className="hsp-card hsp-rise mt-3 flex items-start gap-3.5 p-4" style={{ animationDelay: '40ms' }}>
    <span className="hsc-ready__icon" style={verde ? { background: '#e7f6ec', color: '#16a34a' } : undefined}>{icono}</span>
    <div><h2 className="text-[15px] font-semibold">{titulo}</h2><p className="hsp-muted mt-1 text-[13px] leading-5">{texto}</p></div>
  </section>
}

// Paso final: la solicitud quedó registrada y el cliente abre WhatsApp con el mensaje ya
// escrito (no tiene que teclear nada). Vista previa del chat para que sepa qué se enviará.
function WhatsAppListo({ mensaje, onCerrar }: { mensaje: string; onCerrar: () => void }) {
  const url = whatsappUrl(WHATSAPP_HAUSLINE, mensaje)
  return <div>
    <div className="text-center">
      <span className="hsc-wa-badge"><WhatsIcon size={30} /></span>
      <p className="mt-3 text-[17px] font-semibold">Solicitud registrada</p>
      <p className="hsp-muted mx-auto mt-1 max-w-xs text-[13px] leading-5">Serás redirigido a WhatsApp para confirmar tu entrega con HAUSLINE.</p>
    </div>
    <div className="hsc-wa mt-4">
      <div className="hsc-wa__head"><span className="hsc-wa__avatar">H</span><span><b>HAUSLINE</b><small>en línea</small></span></div>
      <div className="hsc-wa__body"><p className="hsc-wa__bubble">{mensaje}<small>✓✓</small></p></div>
    </div>
    <a href={url} target="_blank" rel="noopener noreferrer" onClick={() => window.setTimeout(onCerrar, 400)} className="hsc-wa-btn mt-4"><WhatsIcon /> Abrir WhatsApp</a>
    <button type="button" onClick={onCerrar} className="hsp-btn--ghost mt-1 w-full">Ahora no</button>
  </div>
}

function WhatsIcon({ size = 17 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.39-1.47-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35M12.05 21.5h-.01a9.4 9.4 0 0 1-4.8-1.31l-.34-.2-3.57.93.95-3.48-.22-.36a9.4 9.4 0 0 1-1.44-5.02c0-5.2 4.24-9.43 9.44-9.43a9.4 9.4 0 0 1 9.43 9.44c0 5.2-4.24 9.43-9.44 9.43m8.03-17.46A11.3 11.3 0 0 0 12.05.7C5.8.7.7 5.8.7 12.05c0 2 .52 3.95 1.52 5.66L.6 23.6l6.03-1.58a11.3 11.3 0 0 0 5.42 1.38h.01c6.25 0 11.34-5.09 11.35-11.35 0-3.03-1.18-5.88-3.33-8.02" /></svg>
}
