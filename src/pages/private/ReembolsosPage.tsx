import { Check, Copy, MessageCircle, RotateCcw, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { CuentaSelect, type DestinoPago } from '../../components/finanzas/CuentaSelect'
import { Modal } from '../../components/ui/Modal'
import { estadoLabel } from '../../constants/orders'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { obtenerTipoCambio } from '../../services/comercial.service'
import { ETAPA_REEMBOLSO_LABEL, aprobarReembolso, cancelarSinReembolso, listarReembolsos, porAtender, rechazarReembolso, type SolicitudReembolso } from '../../services/reembolsos.service'
import type { EstadoPedido } from '../../types/domain'
import { whatsappUrl } from '../../utils/whatsapp'

type Filtro = 'atender' | 'todas'
const fecha = (iso: string) => new Intl.DateTimeFormat('es-NI', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
const usd = (n: number | null | undefined) => `US$ ${Number(n || 0).toFixed(2)}`

const ESTADO_UI: Record<SolicitudReembolso['estado'], { label: string; clase: string }> = {
  pendiente: { label: 'Por revisar', clase: 'bg-amber-400/12 text-amber-300' },
  aprobada: { label: 'Aprobada · reembolsada', clase: 'bg-emerald-400/12 text-emerald-300' },
  rechazada: { label: 'Rechazada · esperando al cliente', clase: 'bg-red-400/12 text-red-300' },
  retirada: { label: 'El cliente siguió con su pedido', clase: 'bg-white/10 text-muted' },
  cancelada_sin_reembolso: { label: 'El cliente cancela sin reembolso', clase: 'bg-red-400/12 text-red-300' },
}

// Bandeja de solicitudes de cancelación que los clientes dejan desde Mi cuenta (tienda).
// Nada se cancela solo: acá se revisa si el motivo es verídico y se aprueba o rechaza.
export function ReembolsosPage() {
  const [items, setItems] = useState<SolicitudReembolso[]>([])
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [filtro, setFiltro] = useState<Filtro>('atender')
  const [aprobando, setAprobando] = useState<SolicitudReembolso | null>(null)
  const [rechazando, setRechazando] = useState<SolicitudReembolso | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const cargar = useCallback(async (silencioso = false) => {
    if (!isSupabaseConfigured) { setLoading(false); return }
    try { setItems(await listarReembolsos()) }
    catch { if (!silencioso) toast.error('No se pudieron cargar las solicitudes. ¿Aplicaste la migración 202609250002?') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void cargar() }, [cargar])
  // En vivo: si un cliente deja o cambia una solicitud, se refresca sola.
  useEffect(() => {
    const c = supabase
    if (!isSupabaseConfigured || !c) return
    const ch = c.channel('reembolsos-pagina').on('postgres_changes', { event: '*', schema: 'public', table: 'solicitudes_reembolso' }, () => { void cargar(true) }).subscribe()
    return () => { void c.removeChannel(ch) }
  }, [cargar])

  const atender = useMemo(() => items.filter(porAtender), [items])
  const visibles = filtro === 'atender' ? atender : items

  const cancelarSin = async (s: SolicitudReembolso) => {
    if (!confirm(`¿Cancelar el pedido ${s.codigo} sin reembolso? El cliente ya lo eligió.`)) return
    setBusy(s.id)
    try { await cancelarSinReembolso(s); toast.success(`Pedido ${s.codigo} cancelado sin reembolso.`); await cargar(true) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo cancelar.') } finally { setBusy(null) }
  }
  const copiar = (texto: string) => { void navigator.clipboard?.writeText(texto).then(() => toast.success('Copiado.')).catch(() => undefined) }

  return (
    <div>
      {!isSupabaseConfigured && <div className="preview-banner"><strong>Vista previa local:</strong> las solicitudes requieren conexión a Supabase.</div>}
      <p className="eyebrow">Finanzas</p>
      <h1 className="page-title">Solicitudes de reembolso</h1>
      <p className="page-subtitle">Cuando un cliente cancela desde Mi cuenta, llega aquí como solicitud. Revisá si el motivo es real (fotos de control de calidad, tracking, fechas) antes de reembolsar. Si lo rechazás, el cliente elige entre seguir con su pedido o cancelarlo sin reembolso.</p>

      <div className="mt-6 flex flex-wrap gap-2">
        {([['atender', `Por atender${atender.length ? ` (${atender.length})` : ''}`], ['todas', 'Todas']] as [Filtro, string][]).map(([v, t]) => (
          <button key={v} className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${filtro === v ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line text-muted hover:text-white'}`} onClick={() => setFiltro(v)}>{t}</button>
        ))}
      </div>

      {loading ? <div className="mt-5 h-64 animate-pulse rounded-2xl border border-line bg-panel" />
        : visibles.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-line bg-panel px-6 py-16 text-center">
            <RotateCcw size={30} className="mx-auto text-muted" />
            <p className="mt-3 text-sm text-muted">{filtro === 'atender' ? 'No hay solicitudes por atender.' : 'Todavía no hay solicitudes.'}</p>
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {visibles.map((s) => {
              const ui = ESTADO_UI[s.estado]
              const pedidoEstado = s.pedidos?.estado
              return (
                <article key={s.id} className="rounded-2xl border border-line bg-panel p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/pedidos/${s.pedido_id}`} className="text-base font-bold hover:text-accent">{s.codigo}</Link>
                    <span className="text-sm text-muted">{s.nombre_cliente || 'Cliente'}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${ui.clase}`}>{ui.label}</span>
                    <span className="ml-auto text-[11px] text-muted">{fecha(s.created_at)}</span>
                  </div>
                  <div className="mt-3 grid gap-3 lg:grid-cols-[1.4fr_1fr]">
                    <div className="rounded-xl border border-line bg-white/[0.02] p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Motivo</p>
                      <p className="mt-0.5 text-sm font-semibold">{s.motivo_label}</p>
                      <p className="mt-2 whitespace-pre-wrap text-sm text-white/85">{s.detalle}</p>
                      <p className="mt-3 text-[11px] text-muted">Etapa al pedirla: <b className="text-white/80">{ETAPA_REEMBOLSO_LABEL[s.etapa] ?? s.etapa}</b> ({estadoLabel(s.estado_pedido as EstadoPedido)}){pedidoEstado && pedidoEstado !== s.estado_pedido ? <> · ahora: <b className="text-white/80">{estadoLabel(pedidoEstado as EstadoPedido)}</b></> : null}</p>
                      {s.respuesta && <p className="mt-2 text-[12px] text-muted">Respuesta al cliente: “{s.respuesta}”</p>}
                      {s.estado === 'rechazada' && s.plazo_decision_at && <p className="mt-2 text-[12px] text-amber-200/90">El cliente tiene hasta el {fecha(s.plazo_decision_at)} para elegir. Si no elige, queda como que siguió con su pedido.</p>}
                      {s.estado === 'retirada' && s.plazo_decision_at && s.decision_cliente_at && s.decision_cliente_at >= s.plazo_decision_at && <p className="mt-2 text-[12px] text-muted">Venció el plazo de 48 h sin respuesta: el pedido siguió su curso.</p>}
                    </div>
                    <div className="rounded-xl border border-line bg-white/[0.02] p-3 text-sm">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Datos para el reembolso</p>
                      <p className="mt-1">Pagado: <b>{usd(s.monto_pagado)}</b>{s.monto_reembolso != null && s.estado === 'aprobada' ? <> · reembolsado: <b className="text-emerald-300">{usd(s.monto_reembolso)}</b></> : null}</p>
                      <p className="mt-1">{s.banco} · <span className="font-mono">{s.numero_cuenta}</span> <button className="ml-1 inline-flex align-middle text-muted hover:text-white" onClick={() => copiar(s.numero_cuenta)} aria-label="Copiar número de cuenta"><Copy size={13} /></button></p>
                      <p className="mt-1">Titular: <b>{s.titular}</b></p>
                      {s.whatsapp_cliente && <a className="mt-2 inline-flex items-center gap-1.5 text-xs text-accent hover:underline" href={whatsappUrl(s.whatsapp_cliente, `Hola${s.nombre_cliente ? `, ${s.nombre_cliente}` : ''}. Recibimos tu solicitud de cancelación del pedido ${s.codigo} y la estamos revisando.`)} target="_blank" rel="noreferrer"><MessageCircle size={14} /> Escribir al cliente</a>}
                    </div>
                  </div>
                  {s.estado === 'pendiente' && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button className="primary-button min-h-9 px-3 text-xs" disabled={busy === s.id} onClick={() => setAprobando(s)}><Check size={15} /> Es verídico · aprobar y reembolsar</button>
                      <button className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white/[0.02] px-3 py-2 text-xs font-semibold text-muted transition hover:border-red-400/40 hover:text-red-300" disabled={busy === s.id} onClick={() => setRechazando(s)}><X size={15} /> No es verídico · rechazar</button>
                    </div>
                  )}
                  {s.estado === 'cancelada_sin_reembolso' && pedidoEstado !== 'cancelado' && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted">El cliente eligió cancelar sin reembolso{s.decision_cliente_at ? ` (${fecha(s.decision_cliente_at)})` : ''}.</span>
                      <button className="primary-button min-h-9 px-3 text-xs" disabled={busy === s.id} onClick={() => void cancelarSin(s)}>Cancelar pedido sin reembolso</button>
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        )}

      {aprobando && <AprobarModal s={aprobando} onClose={() => setAprobando(null)} onDone={() => { setAprobando(null); void cargar(true) }} />}
      {rechazando && <RechazarModal s={rechazando} onClose={() => setRechazando(null)} onDone={() => { setRechazando(null); void cargar(true) }} />}
    </div>
  )
}

function AprobarModal({ s, onClose, onDone }: { s: SolicitudReembolso; onClose: () => void; onDone: () => void }) {
  const [monto, setMonto] = useState(Number(Number(s.monto_pagado || 0).toFixed(2)))
  const [destino, setDestino] = useState<DestinoPago>({ cuentaId: null, montoCuenta: 0 })
  const [tipoCambio, setTipoCambio] = useState(37)
  const [respuesta, setRespuesta] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { void obtenerTipoCambio().then(setTipoCambio).catch(() => undefined) }, [])
  const msg = `Hola${s.nombre_cliente ? `, ${s.nombre_cliente}` : ''}. Revisamos tu solicitud y la *aprobamos*: tu pedido ${s.codigo} quedó cancelado.${monto > 0 ? ` Te reembolsamos *US$ ${monto.toFixed(2)}* a tu cuenta ${s.banco} ${s.numero_cuenta} a nombre de ${s.titular}. El reembolso se procesa en 1 a 3 días hábiles.` : ''}${respuesta.trim() ? `\n\n${respuesta.trim()}` : ''}\n\nGracias por tu comprensión.`

  const confirmar = async () => {
    setSaving(true)
    try { const correo = await aprobarReembolso(s, { monto, destino, respuesta }); toast.success(`Aprobada: pedido ${s.codigo} cancelado${monto > 0 ? ` y reembolso de US$ ${monto.toFixed(2)} registrado` : ''}.${correo ? ' Le avisamos al cliente por correo.' : ' (El correo no salió; avisale por WhatsApp.)'}`); onDone() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo aprobar.') } finally { setSaving(false) }
  }
  return <Modal open onClose={onClose} title={`Aprobar reembolso · ${s.codigo}`} description="Se cancela el pedido, el reembolso sale de la caja y de la cuenta que elijas, y al cliente le llega el correo de reembolso aprobado.">
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-white/[0.02] p-3 text-sm">Transferir a <b>{s.banco}</b> · <span className="font-mono">{s.numero_cuenta}</span> · <b>{s.titular}</b></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="form-field"><span>Monto a reembolsar (US$)</span><input type="number" min="0" step=".01" value={monto} onChange={(e) => setMonto(Number(e.target.value))} /></label>
        {monto > 0 && <CuentaSelect requerido montoUsd={monto} tipoCambio={tipoCambio} value={destino} onChange={setDestino} modo="resta" label="¿De qué cuenta sale el reembolso?" />}
      </div>
      <label className="form-field"><span>Mensaje para el cliente (opcional)</span><textarea rows={2} value={respuesta} onChange={(e) => setRespuesta(e.target.value)} placeholder="Ej. Confirmamos por las fotos que la talla no coincide." /></label>
      {s.whatsapp_cliente && <a className="inline-flex items-center gap-2 text-xs text-accent hover:underline" href={whatsappUrl(s.whatsapp_cliente, msg)} target="_blank" rel="noreferrer"><MessageCircle size={14} /> Avisar al cliente por WhatsApp</a>}
      <div className="flex justify-end gap-2"><button className="subtle-button" onClick={onClose}>Volver</button><button className="primary-button px-5" disabled={saving} onClick={() => void confirmar()}>{saving ? 'Guardando…' : 'Aprobar y cancelar pedido'}</button></div>
    </div>
  </Modal>
}

function RechazarModal({ s, onClose, onDone }: { s: SolicitudReembolso; onClose: () => void; onDone: () => void }) {
  const [respuesta, setRespuesta] = useState('')
  const [saving, setSaving] = useState(false)
  const msg = `Hola${s.nombre_cliente ? `, ${s.nombre_cliente}` : ''}. Revisamos tu solicitud de cancelación del pedido ${s.codigo} y no pudimos aprobar el reembolso.${respuesta.trim() ? ` ${respuesta.trim()}` : ''}\n\nPodés elegir desde Mi cuenta: *seguir con tu pedido* o *cancelarlo sin reembolso*: https://hauslineshopni.es/cuenta/pedido/?id=${s.codigo}`
  const confirmar = async () => {
    setSaving(true)
    try {
      const correo = await rechazarReembolso(s, respuesta)
      toast.success(correo ? 'Rechazada. Le enviamos un correo al cliente para que elija qué hacer.' : 'Rechazada. El cliente lo verá en Mi cuenta (el correo no salió; avisale por WhatsApp).')
      onDone()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo rechazar.') } finally { setSaving(false) }
  }
  return <Modal open onClose={onClose} title={`Rechazar solicitud · ${s.codigo}`} description="El pedido NO se cancela. El cliente verá tu explicación y elegirá entre seguir con su pedido o cancelarlo sin reembolso.">
    <div className="space-y-4">
      <label className="form-field"><span>¿Por qué no se aprueba? (lo ve el cliente)</span><textarea rows={3} value={respuesta} onChange={(e) => setRespuesta(e.target.value)} placeholder="Ej. En las fotos de control de calidad el producto coincide con lo que pediste (talla 42, color negro)." /></label>
      {s.whatsapp_cliente && <a className="inline-flex items-center gap-2 text-xs text-accent hover:underline" href={whatsappUrl(s.whatsapp_cliente, msg)} target="_blank" rel="noreferrer"><MessageCircle size={14} /> Avisar al cliente por WhatsApp</a>}
      <div className="flex justify-end gap-2"><button className="subtle-button" onClick={onClose}>Volver</button><button className="primary-button px-5" disabled={saving} onClick={() => void confirmar()}>{saving ? 'Guardando…' : 'Rechazar solicitud'}</button></div>
    </div>
  </Modal>
}
