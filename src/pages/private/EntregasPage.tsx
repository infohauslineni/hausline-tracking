import { AlertTriangle, Banknote, Bike, Bus, CheckCircle2, Copy, ExternalLink, MapPin, MessageCircle, Package, PackageCheck, Phone, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Modal } from '../../components/ui/Modal'
import { mensajeWhatsAppEstado } from '../../constants/orders'
import { useAuth } from '../../contexts/AuthContext'
import { isSupabaseConfigured } from '../../lib/supabase'
import { obtenerTipoCambio } from '../../services/comercial.service'
import { haceCuanto, listarEntregas, marcarAvisoDisponible, type Entrega } from '../../services/entregas.service'
import { actualizarEstadoPedido, esLineaEnvio } from '../../services/pedidos.service'
import { resolverImagenCatalogo } from '../../utils/catalogoImagen'
import { urlSeguimientoCliente } from '../../utils/seguimientoUrl'
import { whatsappUrl } from '../../utils/whatsapp'
import { Status } from './PedidosPage'

// ENTREGAS: todo lo que ya se puede entregar, en una sola lista: a dónde va, cuánto se cobra y
// si ya se le avisó al cliente. Para coordinar el delivery sin abrir pedido por pedido.

type Filtro = 'todas' | 'sin_avisar' | 'managua' | 'departamentos'

const us = (n: number) => `US$ ${n.toFixed(2)}`
const productosDe = (e: Entrega) => (e.pedido.pedido_items ?? []).filter((it) => !esLineaEnvio(it))
const diasDisponible = (e: Entrega) => e.disponibleDesde ? Math.max(0, Math.floor((Date.now() - new Date(e.disponibleDesde).getTime()) / 86_400_000)) : null
const sinAvisar = (e: Entrega) => e.pedido.estado === 'disponible_entrega' && !e.pedido.aviso_disponible_at
// Lo que cobra HAUSLINE para cerrar el pedido (el envío que no está en el pedido se cobra aparte, al entregar).
const debePedido = (e: Entrega) => e.cobrar.saldo + e.cobrar.bodega

export function EntregasPage() {
  const { esAdmin } = useAuth()
  const navigate = useNavigate()
  const [entregas, setEntregas] = useState<Entrega[]>([])
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [tipoCambio, setTipoCambio] = useState(37)
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const [confirmar, setConfirmar] = useState<Entrega | null>(null)
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    if (!isSupabaseConfigured) return
    try {
      const tc = await obtenerTipoCambio().catch(() => 37)
      setTipoCambio(tc > 0 ? tc : 37)
      setEntregas(await listarEntregas(tc))
    } catch { toast.error('No se pudieron cargar las entregas.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void Promise.resolve().then(cargar) }, [cargar])

  const cordobas = useCallback((usd: number) => `C$ ${(Math.ceil((usd * tipoCambio) / 10) * 10).toLocaleString('es-NI')}`, [tipoCambio])

  const visibles = useMemo(() => entregas.filter((e) =>
    filtro === 'sin_avisar' ? sinAvisar(e) : filtro === 'managua' ? e.managua : filtro === 'departamentos' ? !e.managua : true,
  ), [entregas, filtro])
  const porCobrar = useMemo(() => visibles.reduce((s, e) => s + e.cobrar.total, 0), [visibles])
  const cuenta = (f: Filtro) => entregas.filter((e) => f === 'sin_avisar' ? sinAvisar(e) : f === 'managua' ? e.managua : f === 'departamentos' ? !e.managua : true).length

  // Bloque listo para mandarle al delivery / pegar en la guía del bus.
  const textoEntrega = (e: Entrega) => {
    const l = e.lugar
    const lineas = l ? l.lineas.slice(l.deFicha ? 0 : 1) : []
    const lleva = productosDe(e).map((it) => `${it.cantidad > 1 ? `${it.cantidad}× ` : ''}${it.producto}${it.talla ? ` (Talla ${it.talla})` : ''}`).join(', ')
    const partes = [e.cobrar.saldo > 0.01 ? `saldo ${e.cobrar.saldo.toFixed(2)}` : null, e.cobrar.envio > 0.01 ? `${e.managua ? 'delivery' : 'envío'} ${e.cobrar.envio.toFixed(2)}` : null, e.cobrar.bodega > 0.01 ? `bodega ${e.cobrar.bodega.toFixed(2)}` : null].filter(Boolean)
    const cobro = !esAdmin ? null
      : e.cobrar.total > 0.01 ? `Cobrar: ${us(e.cobrar.total)} (${cordobas(e.cobrar.total)})${partes.length > 1 ? ` = ${partes.join(' + ')}` : ''}`
        : 'Cobrar: nada, ya está pagado'
    return [
      `Pedido ${e.pedido.codigo} - ${e.cliente?.nombre ?? 'Cliente'}`,
      e.cliente?.whatsapp && `Teléfono: ${e.cliente.whatsapp}`,
      ...(lineas.length ? lineas.map((x, i) => i === 0 ? `Dirección: ${x}` : x) : ['Dirección: pendiente de confirmar']),
      l?.mapa && `Ubicación: ${l.mapa}`,
      lleva && `Lleva: ${lleva}`,
      cobro,
    ].filter(Boolean).join('\n')
  }
  const copiar = async (texto: string, ok: string) => { try { await navigator.clipboard.writeText(texto); toast.success(ok) } catch { toast.error('No se pudo copiar.') } }
  const copiarRuta = () => {
    const lista = seleccion.size ? visibles.filter((e) => seleccion.has(e.pedido.id)) : visibles
    if (!lista.length) return
    const fecha = new Intl.DateTimeFormat('es-NI', { day: 'numeric', month: 'short' }).format(new Date())
    const texto = [`Entregas HAUSLINE - ${fecha} (${lista.length})`, ...lista.map((e, i) => `${i + 1}. ${textoEntrega(e)}`)].join('\n\n')
    void copiar(texto, `${lista.length} ${lista.length === 1 ? 'entrega copiada' : 'entregas copiadas'}. Pegalas al delivery.`)
  }
  const alternar = (id: string) => setSeleccion((cur) => { const s = new Set(cur); if (s.has(id)) s.delete(id); else s.add(id); return s })

  const mensajeDe = (e: Entrega) => mensajeWhatsAppEstado(e.pedido.estado, {
    nombre: e.cliente?.nombre, codigo: e.pedido.codigo, url: urlSeguimientoCliente(e.pedido.codigo), saldo: Number(e.pedido.saldo), tipoCambio,
    departamento: e.lugar?.departamento ?? e.cliente?.departamento, ciudad: e.lugar?.ciudad ?? e.cliente?.ciudad, envio: e.envio, pagaAlRecibir: e.alRecibir,
  })
  // "Ya le avisé": queda anotado al tocar el botón de WhatsApp.
  const anotarAviso = (e: Entrega) => {
    if (e.pedido.estado !== 'disponible_entrega') return
    void marcarAvisoDisponible(e.pedido.id)
      .then((cuando) => setEntregas((cur) => cur.map((x) => x.pedido.id === e.pedido.id ? { ...x, pedido: { ...x.pedido, aviso_disponible_at: cuando } } : x)))
      .catch(() => toast.error('Se abrió WhatsApp, pero no se pudo anotar el aviso (falta aplicar el SQL de "ya le avisé").'))
  }
  const entregar = async () => {
    if (!confirmar) return
    setGuardando(true)
    try {
      await actualizarEstadoPedido(confirmar.pedido.id, 'entregado')
      setEntregas((cur) => cur.filter((x) => x.pedido.id !== confirmar.pedido.id))
      const id = confirmar.pedido.id
      toast.success(`Pedido ${confirmar.pedido.codigo} entregado.`, { action: { label: 'Ver ganancia', onClick: () => navigate(`/pedidos/${id}?ganancia=1`) }, duration: 9000 })
      setConfirmar(null)
    } catch { toast.error('No se pudo marcar como entregado.') }
    finally { setGuardando(false) }
  }

  const filtros: [Filtro, string][] = [['todas', 'Todas'], ['sin_avisar', 'Sin avisar'], ['managua', 'Managua · delivery'], ['departamentos', 'Departamentos · bus']]

  return (
    <div>
      {!isSupabaseConfigured && <div className="preview-banner"><strong>Vista previa local:</strong> las entregas requieren conexión a Supabase.</div>}
      <p className="eyebrow">Logística</p>
      <h1 className="page-title">Entregas</h1>
      <p className="page-subtitle">Todo lo que ya se puede entregar: a dónde va, cuánto se cobra y si ya le avisaste al cliente. Copiá los datos y mandáselos al delivery.</p>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {filtros.map(([v, t]) => { const n = cuenta(v); return (
          <button key={v} className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${filtro === v ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line text-muted hover:text-white'}`} onClick={() => setFiltro(v)}>{t}{n ? ` (${n})` : ''}</button>
        ) })}
        <span className="flex-1" />
        <button className="subtle-button" onClick={() => { setLoading(true); void cargar() }} title="Volver a cargar"><RefreshCw size={14} /> Actualizar</button>
        <button className="primary-button min-h-0 px-4 py-2.5 text-xs" disabled={!visibles.length} onClick={copiarRuta}><Copy size={15} /> {seleccion.size ? `Copiar ${seleccion.size} seleccionadas` : 'Copiar todas para el delivery'}</button>
      </div>

      {!loading && visibles.length > 0 && <p className="mt-3 text-xs text-muted">{visibles.length} {visibles.length === 1 ? 'entrega' : 'entregas'}{esAdmin && <> · por cobrar <b className="font-mono text-white">{us(porCobrar)}</b> <span>({cordobas(porCobrar)})</span></>}</p>}

      {loading ? <div className="mt-5 h-64 animate-pulse rounded-2xl border border-line bg-panel" />
        : !visibles.length ? <div className="mt-5 grid place-items-center rounded-2xl border border-line bg-panel px-5 py-14 text-center"><PackageCheck size={30} className="text-accent" /><h2 className="mt-3 font-semibold">{filtro === 'todas' ? 'No hay entregas pendientes' : 'Nada en este filtro'}</h2><p className="mt-1 max-w-sm text-xs text-muted">Aquí aparecen los pedidos en “Disponible para entrega”, “Pagado” y “Empaquetado”.</p></div>
        : <div className="mt-4 grid gap-3 xl:grid-cols-2">{visibles.map((e) => {
          const p = e.pedido
          const items = productosDe(e)
          const foto = items.find((it) => it.imagen)?.imagen
          const dias = diasDisponible(e)
          const l = e.lugar
          const lineas = l ? l.lineas.slice(l.deFicha ? 0 : 1) : []
          const elegido = seleccion.has(p.id)
          return <article key={p.id} className={`rounded-2xl border bg-panel p-4 sm:p-5 ${elegido ? 'border-accent/50' : 'border-line'}`}>
            <div className="flex items-start gap-3">
              <input type="checkbox" className="mt-1 size-4 shrink-0 accent-accent" checked={elegido} onChange={() => alternar(p.id)} aria-label={`Seleccionar ${p.codigo}`} />
              <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-white">{foto ? <img src={resolverImagenCatalogo(foto)} alt="" className="h-full w-full object-contain" loading="lazy" /> : <Package size={20} className="text-black/40" />}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><Link to={`/pedidos/${p.id}`} className="font-mono text-sm font-bold text-white hover:text-accent">{p.codigo}</Link><Status estado={p.estado} /></div>
                <strong className="mt-1 block truncate">{e.cliente?.nombre ?? 'Cliente'}</strong>
                <p className="truncate text-xs text-muted">{items.map((it) => `${it.cantidad > 1 ? `${it.cantidad}× ` : ''}${it.producto}${it.talla ? ` · Talla ${it.talla}` : ''}`).join(' · ') || 'Sin productos'}</p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-semibold">
              {p.estado === 'disponible_entrega' && (p.aviso_disponible_at
                ? <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/[.08] px-2.5 py-1 text-emerald-200"><CheckCircle2 size={12} /> Avisado {haceCuanto(p.aviso_disponible_at)}</span>
                : <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/35 bg-amber-400/[.09] px-2.5 py-1 text-amber-200"><AlertTriangle size={12} /> Sin avisar</span>)}
              <span className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-muted">{e.managua ? <><Bike size={12} /> Managua · delivery</> : <><Bus size={12} /> {l?.departamento || l?.ciudad || 'Departamento'} · bus / Cargotrans</>}</span>
              {e.alRecibir && <span className="inline-flex items-center gap-1 rounded-full border border-accent/35 bg-accent/[.07] px-2.5 py-1 text-accent"><Banknote size={12} /> Paga al recibir</span>}
              {dias != null && p.estado === 'disponible_entrega' && <span className="inline-flex items-center rounded-full border border-line px-2.5 py-1 text-muted">{dias === 0 ? 'Disponible desde hoy' : `Disponible hace ${dias} ${dias === 1 ? 'día' : 'días'}`}</span>}
            </div>

            <div className="mt-3 rounded-xl border border-line bg-white/[.02] p-3 text-sm">
              {lineas.length ? <>
                <p className="flex items-start gap-1.5 font-semibold text-white"><MapPin size={14} className="mt-0.5 shrink-0 text-accent" /> <span>{lineas[0]}</span></p>
                {lineas.slice(1).map((x, i) => <p key={i} className="pl-5 text-xs text-white/75">{x}</p>)}
                {l?.deFicha && !e.cliente?.direccion && !e.cliente?.referencia && <p className="mt-1 pl-5 text-[11px] text-amber-200/90">Solo tenemos la ciudad: falta la dirección exacta.</p>}
                {l?.mapa && <a className="mt-1.5 inline-flex items-center gap-1 pl-5 text-xs font-semibold text-accent hover:underline" href={l.mapa} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} /> Ver en Google Maps</a>}
              </> : <p className="flex items-center gap-1.5 text-xs text-amber-200"><AlertTriangle size={14} /> No tenemos la dirección de este cliente.</p>}
              {e.cliente?.whatsapp && <p className="mt-2 flex items-center gap-1.5 border-t border-line pt-2 font-mono text-xs text-muted"><Phone size={12} /> {e.cliente.whatsapp}</p>}
            </div>

            {esAdmin && <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-xl border border-line bg-white/[.02] px-3 py-2.5">
              {e.cobrar.total > 0.01 ? <>
                <span className="text-xs text-muted">{[e.cobrar.saldo > 0.01 ? `Saldo ${us(e.cobrar.saldo)}` : 'Pedido pagado', e.cobrar.envio > 0.01 ? `${e.managua ? 'Delivery' : 'Envío'} ${us(e.cobrar.envio)}` : e.envio?.incluido ? 'envío incluido' : null, e.cobrar.bodega > 0.01 ? `Bodega ${us(e.cobrar.bodega)}` : null].filter(Boolean).join(' + ')}</span>
                <strong className="font-mono text-base text-accent">Cobrar {us(e.cobrar.total)} <span className="text-xs font-normal text-muted">({cordobas(e.cobrar.total)})</span></strong>
              </> : <><span className="text-xs text-muted">Pagado por completo{e.envio ? '' : ' · envío a cotizar'}</span><strong className="text-sm text-emerald-300">No se cobra nada</strong></>}
            </div>}

            <div className="mt-3 flex flex-wrap gap-2">
              {e.cliente?.whatsapp && <a className="subtle-button" href={whatsappUrl(e.cliente.whatsapp, mensajeDe(e))} target="_blank" rel="noreferrer" onClick={() => anotarAviso(e)}><MessageCircle size={14} className="text-[#62eaa0]" /> {p.estado === 'disponible_entrega' ? (p.aviso_disponible_at ? 'Volver a avisar' : 'Avisar') : 'WhatsApp'}</a>}
              <button className="subtle-button" onClick={() => void copiar(textoEntrega(e), 'Datos copiados. Pegalos al delivery o en la guía.')}><Copy size={14} /> Copiar datos</button>
              <span className="flex-1" />
              {esAdmin && (debePedido(e) > 0.01
                ? <Link className="primary-button min-h-0 px-4 py-2.5 text-xs" to={`/pedidos/${p.id}?cobrar=entregado`}><PackageCheck size={15} /> Entregar y cobrar</Link>
                : <button className="primary-button min-h-0 px-4 py-2.5 text-xs" onClick={() => setConfirmar(e)}><PackageCheck size={15} /> Marcar entregado</button>)}
            </div>
          </article>
        })}</div>}

      <Modal open={!!confirmar} onClose={() => setConfirmar(null)} title="¿Marcar como entregado?" description={confirmar ? `Pedido ${confirmar.pedido.codigo} de ${confirmar.cliente?.nombre ?? 'cliente'}. Ya está pagado: solo queda como entregado y al cliente le llega el correo de entrega.` : undefined}>
        <div className="flex justify-end gap-2"><button className="subtle-button" onClick={() => setConfirmar(null)}>Cancelar</button><button className="primary-button px-5" disabled={guardando} onClick={() => void entregar()}>{guardando ? 'Guardando…' : 'Sí, ya se entregó'}</button></div>
      </Modal>
    </div>
  )
}
