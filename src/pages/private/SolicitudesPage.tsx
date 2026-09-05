import { AlertCircle, ArrowRight, Check, Clock3, Inbox, Mail, MapPin, MessageCircle, PackagePlus, Trash2, Upload, X, Zap } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Modal } from '../../components/ui/Modal'
import { CuentaSelect, type DestinoPago } from '../../components/finanzas/CuentaSelect'
import { DEMO_SOLICITUDES } from '../../data/demoSolicitudes'
import { isSupabaseConfigured } from '../../lib/supabase'
import { archivarComprobanteDrive } from '../../services/archivos.service'
import { confirmarSolicitud, descartarSolicitud, eliminarSolicitud, listarSolicitudes, suscribirSolicitudes, type Solicitud } from '../../services/solicitudes.service'
import { useAuth } from '../../contexts/AuthContext'
import { whatsappUrl } from '../../utils/whatsapp'
import { resolverImagenCatalogo } from '../../utils/catalogoImagen'

// Cuánto falta para que la solicitud se venza (color según urgencia). ≤3 h = crítico.
function tiempoRestante(venceAt: string): { texto: string; tono: 'ok' | 'warn' | 'crit'; vencida: boolean; horas: number } {
  const ms = new Date(venceAt).getTime() - Date.now()
  if (ms <= 0) return { texto: 'Vencida', tono: 'crit', vencida: true, horas: -1 }
  const horas = Math.floor(ms / 3_600_000)
  if (horas >= 1) return { texto: `${horas} h`, tono: horas <= 3 ? 'crit' : horas <= 8 ? 'warn' : 'ok', vencida: false, horas }
  const min = Math.max(1, Math.floor(ms / 60_000))
  return { texto: `${min} min`, tono: 'crit', vencida: false, horas: 0 }
}
const usd = (n: number) => `USD ${Number(n).toFixed(2)}`
const nio = (n: number | null) => (n != null ? `≈ C$${Number(n).toLocaleString('es-NI', { maximumFractionDigits: 0 })}` : '')
// Monto en dólares y su equivalente en córdobas (redondeado a la decena, como el resto
// de la app) para los recordatorios de WhatsApp: "USD 80.00 (≈ C$2,960)".
const usdNio = (monto: number, tipoCambio: number | null) => {
  const tc = tipoCambio && tipoCambio > 0 ? tipoCambio : 37
  const cordobas = Math.round((Number(monto) * tc) / 10) * 10
  return `USD ${Number(monto).toFixed(2)} (≈ C$${cordobas.toLocaleString('es-NI')})`
}
const fechaCorta = (iso: string) => new Intl.DateTimeFormat('es-NI', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))

export function SolicitudesPage() {
  const [items, setItems] = useState<Solicitud[]>(isSupabaseConfigured ? [] : DEMO_SOLICITUDES)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState<Solicitud | null>(null)

  const cargar = useCallback(async (silencioso = false) => {
    if (!isSupabaseConfigured) return
    try { setItems(await listarSolicitudes()) } catch { if (!silencioso) toast.error('No se pudieron cargar los encargos.') } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured) return
    void cargar()
    const unsub = suscribirSolicitudes(() => void cargar(true))
    return () => unsub()
  }, [cargar])

  const pendientes = useMemo(() => items.filter((s) => s.estado === 'pendiente').sort((a, b) => new Date(a.vence_at).getTime() - new Date(b.vence_at).getTime()), [items])
  const vencidas = useMemo(() => items.filter((s) => s.estado === 'vencida'), [items])
  const porVencer = useMemo(() => pendientes.filter((s) => tiempoRestante(s.vence_at).tono === 'crit').length, [pendientes])

  // Confirma con el MONTO REAL pagado (lo elige el admin en el modal). Si el admin subió
  // un comprobante, se archiva en la carpeta de Drive del pedido (best-effort: si falla,
  // el pedido igual queda creado).
  const confirmar = async (s: Solicitud, abono: number, comprobante: File | null, destino: DestinoPago) => {
    setBusy(s.id)
    try {
      if (isSupabaseConfigured) {
        const codigo = await confirmarSolicitud(s.id, abono, destino.cuentaId, destino.montoCuenta)
        if (comprobante) {
          try { await archivarComprobanteDrive(codigo, comprobante) }
          catch { toast.error('El pedido se creó, pero no se pudo archivar el comprobante en Drive.') }
        }
        // Avisar al cliente por WhatsApp con su código y el enlace de seguimiento.
        const link = `${window.location.origin}/tracking/${codigo}`
        const msg = `¡Hola ${s.cliente_nombre}! Confirmamos tu pago ✅. Tu pedido ya está en proceso.\n\nCódigo de pedido: ${codigo}\nSeguí tu pedido aquí: ${link}\n\n¡Gracias por comprar en HAUSLINE!`
        window.open(whatsappUrl(s.cliente_whatsapp, msg), '_blank', 'noopener,noreferrer')
        toast.success(`Pedido ${codigo} creado${comprobante ? ' y comprobante archivado' : ''}. Abrimos WhatsApp para avisarle al cliente.`)
      } else { toast.success('Encargo confirmado (vista previa).') }
      setItems((all) => all.map((x) => x.id === s.id ? { ...x, estado: 'confirmada' } : x))
      setConfirmando(null)
    } catch { toast.error('No se pudo confirmar el encargo.') } finally { setBusy(null) }
  }
  const descartar = async (s: Solicitud) => {
    if (!window.confirm(`¿Descartar el encargo de ${s.cliente_nombre}? Se quitará de la bandeja.`)) return
    setBusy(s.id)
    try {
      if (isSupabaseConfigured) await descartarSolicitud(s.id)
      setItems((all) => all.filter((x) => x.id !== s.id))
      toast.success('Encargo descartado.')
    } catch { toast.error('No se pudo descartar el encargo.') } finally { setBusy(null) }
  }
  const eliminar = async (s: Solicitud) => {
    setBusy(s.id)
    try {
      if (isSupabaseConfigured) await eliminarSolicitud(s.id)
      setItems((all) => all.filter((x) => x.id !== s.id))
      toast.success('Encargo eliminado.')
    } catch { toast.error('No se pudo eliminar.') } finally { setBusy(null) }
  }

  return <div>
    {!isSupabaseConfigured && <div className="preview-banner"><strong>Vista previa local:</strong> mostrando encargos de demostración.</div>}
    <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="eyebrow">Encargos</p><h1 className="page-title">Encargos por confirmar</h1><p className="page-subtitle">Pedidos hechos desde la web. Verificá la transferencia y confirmá para crear el pedido real.</p></div>
    </div>

    <div className="mt-6 flex flex-wrap gap-3">
      <Count value={pendientes.length} label="Por confirmar" tone="accent" />
      <Count value={porVencer} label="Por vencer (≤3 h)" tone="amber" />
      {vencidas.length > 0 && <Count value={vencidas.length} label="Vencidas (sin pagar)" tone="muted" />}
    </div>

    {loading ? <div className="mt-5 h-64 animate-pulse rounded-2xl border border-line bg-panel" /> : pendientes.length === 0 ? <EmptyState /> : <div className="mt-6 space-y-3">
      {pendientes.map((s) => <SolicitudCard key={s.id} s={s} busy={busy === s.id} onConfirm={() => setConfirmando(s)} onDiscard={() => void descartar(s)} />)}
    </div>}

    {confirmando && <ConfirmarModal s={confirmando} busy={busy === confirmando.id} onClose={() => setConfirmando(null)} onConfirm={(abono, comprobante, destino) => void confirmar(confirmando, abono, comprobante, destino)} />}

    {vencidas.length > 0 && <div className="mt-8">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-muted"><Trash2 size={15} /> Vencidas · nunca pagaron (no gastaron código)</h2>
      <div className="mt-3 space-y-2">{vencidas.map((s) => <div key={s.id} className="flex items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3 opacity-70"><span className="font-mono text-xs font-semibold">{s.codigo}</span><span className="text-xs text-muted">{s.cliente_nombre} · {s.producto}</span><button className="table-action table-action-danger ml-auto" onClick={() => void eliminar(s)} aria-label="Eliminar"><Trash2 size={16} /></button></div>)}</div>
    </div>}
  </div>
}

// Modal para confirmar el pago indicando el MONTO REAL que pagó el cliente.
function ConfirmarModal({ s, busy, onClose, onConfirm }: { s: Solicitud; busy: boolean; onClose: () => void; onConfirm: (abono: number, comprobante: File | null, destino: DestinoPago) => void }) {
  const total = Number(s.total)
  const mitad = Math.round(total * 50) / 100
  const [monto, setMonto] = useState<string>((Number(s.abono) || total).toFixed(2))
  const [comprobante, setComprobante] = useState<File | null>(null)
  const [destino, setDestino] = useState<DestinoPago>({ cuentaId: null, montoCuenta: 0 })
  const abono = Math.min(total, Math.max(0, Number(monto) || 0))
  const saldo = Math.max(0, total - abono)
  return <Modal open title="Confirmar pago" description={`${s.codigo} · ${s.cliente_nombre} · ${s.producto}`} onClose={onClose}>
    <div className="flex items-center justify-between rounded-xl border border-line bg-white/[0.02] p-4 text-sm"><span className="text-muted">Total del pedido</span><strong className="font-mono">{usd(total)}</strong></div>
    <p className="mt-5 text-xs font-semibold text-muted">¿Cuánto pagó el cliente ahora?</p>
    <div className="mt-2 grid grid-cols-2 gap-2">
      <button type="button" onClick={() => setMonto(total.toFixed(2))} className={`rounded-xl border p-3 text-left transition ${Math.abs(abono - total) < 0.01 ? 'border-accent bg-accent/[0.07]' : 'border-line hover:border-line'}`}><strong className="block text-sm">Pagó todo</strong><span className="text-xs text-muted">{usd(total)}</span></button>
      <button type="button" onClick={() => setMonto(mitad.toFixed(2))} className={`rounded-xl border p-3 text-left transition ${Math.abs(abono - mitad) < 0.01 ? 'border-accent bg-accent/[0.07]' : 'border-line'}`}><strong className="block text-sm">Abono 50%</strong><span className="text-xs text-muted">{usd(mitad)}</span></button>
    </div>
    <label className="mt-4 block"><span className="text-xs font-semibold text-muted">O escribí el monto exacto (USD)</span>
      <input type="number" min="0" step="0.01" value={monto} onChange={(e) => setMonto(e.target.value)} className="simple-input mt-1.5" />
    </label>
    <div className="mt-4 flex items-center justify-between rounded-xl border border-line bg-white/[0.02] p-3 text-sm"><span className="text-muted">Quedará como saldo pendiente</span><strong className={`font-mono ${saldo > 0.01 ? 'text-amber-300' : 'text-[#62eaa0]'}`}>{usd(saldo)}</strong></div>

    {abono > 0 && <div className="mt-4"><CuentaSelect montoUsd={abono} tipoCambio={Number(s.tipo_cambio) || 37} value={destino} onChange={setDestino} modo="suma" proposito="recibir" requerido label="¿A qué cuenta entró el abono?" /></div>}

    <p className="mt-5 text-xs font-semibold text-muted">Comprobante de pago {abono > 0 ? <span className="font-normal text-accent">(obligatorio)</span> : <span className="font-normal">(opcional)</span>}</p>
    {comprobante
      ? <div className="mt-1.5 flex items-center gap-3 rounded-xl border border-accent/40 bg-accent/[0.06] p-2.5 text-sm">
          <img src={URL.createObjectURL(comprobante)} alt="Comprobante" className="size-11 shrink-0 rounded-lg object-cover" />
          <div className="min-w-0 flex-1"><p className="flex items-center gap-1 text-xs font-medium text-accent"><Check size={14} /> Comprobante listo</p><p className="truncate text-[11px] text-muted">{comprobante.name}</p></div>
          <button type="button" className="table-action" onClick={() => setComprobante(null)} aria-label="Quitar comprobante"><X size={16} /></button>
        </div>
      : <label className={`mt-1.5 flex cursor-pointer items-center gap-2.5 rounded-xl border border-dashed px-3 py-3 text-sm transition ${abono > 0 ? 'border-accent/50 bg-accent/[0.04] hover:border-accent hover:bg-accent/[0.08]' : 'border-line bg-white/[0.02] hover:border-accent/40'}`}>
          <Upload size={17} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 text-xs text-muted">Subir imagen del comprobante — se guarda en la carpeta de Drive del pedido</span>
          <input type="file" accept="image/*" className="hidden" onChange={(e) => setComprobante(e.target.files?.[0] ?? null)} />
        </label>}

    <div className="mt-6 flex justify-end gap-2">
      <button className="subtle-button" onClick={onClose}>Cancelar</button>
      <button className="primary-button px-5" disabled={busy || (abono > 0 && !comprobante)} onClick={() => { if (abono > 0 && !comprobante) return toast.error('Subí la foto del comprobante para confirmar el encargo.'); onConfirm(abono, comprobante, destino) }}>{busy ? 'Creando…' : <><Check size={16} /> Confirmar y crear pedido</>}</button>
    </div>
  </Modal>
}

function Count({ value, label, tone }: { value: number; label: string; tone: 'accent' | 'amber' | 'muted' }) {
  const color = tone === 'accent' ? 'text-accent' : tone === 'amber' ? 'text-amber-300' : 'text-muted'
  return <div className="rounded-xl border border-line bg-panel px-4 py-3"><strong className={`font-display block text-2xl font-bold tracking-tight ${color}`}>{value}</strong><span className="text-[11px] text-muted">{label}</span></div>
}

function SolicitudCard({ s, busy, onConfirm, onDiscard }: { s: Solicitud; busy: boolean; onConfirm: () => void; onDiscard: () => void }) {
  const { esAdmin } = useAuth()
  const t = tiempoRestante(s.vence_at)
  const urgente = t.tono === 'crit'
  const tonoTexto = t.tono === 'crit' ? 'text-red-300' : t.tono === 'warn' ? 'text-amber-300' : 'text-muted'
  const detalle = [s.marca, s.talla ? `Talla ${s.talla}` : '', s.color, `×${s.cantidad}`].filter(Boolean).join(' · ')
  const abono50 = s.pago_tipo === '50'
  const rapido = s.envio === 'rapido'
  // El mensaje de WhatsApp cambia según urgencia: por vencer vs pedir comprobante.
  const montoRecordar = usdNio(abono50 ? s.abono : s.total, s.tipo_cambio)
  const mensaje = urgente
    ? `Hola ${s.cliente_nombre} 👋, tu encargo ${s.codigo} de ${s.producto} está por vencer (te quedan pocas horas). Para no perderlo, transferí ${montoRecordar} y envianos el comprobante. ¡Gracias!`
    : `Hola ${s.cliente_nombre}, vi tu encargo ${s.codigo} de ${s.producto} (${montoRecordar}). Para confirmarlo necesito el comprobante de la transferencia. ¡Gracias!`
  return <article className={`panel-card ${urgente ? 'border-red-400/40' : ''}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-white/[0.04] text-muted">{resolverImagenCatalogo(s.imagen) ? <img src={resolverImagenCatalogo(s.imagen)} alt="" className="size-full object-cover" /> : <PackagePlus size={20} />}</span>
        <div>
          <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-sm font-bold">{s.codigo}</span><span className="rounded-full bg-[#8ec5ff]/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#8ec5ff]">Web</span>{rapido && <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-300"><Zap size={10} /> Rápido</span>}</div>
          <p className="mt-1 text-sm font-semibold">{s.cliente_nombre}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted"><span className="inline-flex items-center gap-1"><MessageCircle size={11} /> {s.cliente_whatsapp}</span>{s.cliente_correo && <span className="inline-flex items-center gap-1"><Mail size={11} /> {s.cliente_correo}</span>}{s.cliente_ciudad && <span className="inline-flex items-center gap-1"><MapPin size={11} /> {s.cliente_ciudad}</span>}</p>
          <p className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted"><Clock3 size={10} /> Recibido {fechaCorta(s.created_at)}</p>
        </div>
      </div>
      <div className="text-right"><div className={`flex items-center justify-end gap-1.5 font-mono text-sm font-bold ${tonoTexto}`}><Clock3 size={14} /> {t.texto}</div><span className="text-[10px] uppercase tracking-wide text-muted">{t.vencida ? 'sin pagar' : urgente ? '⚠ por vencer' : 'para vencer'}</span></div>
    </div>

    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-y border-line py-3">
      <div><strong className="text-sm">{s.producto}</strong><span className="mt-0.5 block text-xs text-muted">{detalle || 'Producto'}{s.producto_codigo ? ` · Cód. ${s.producto_codigo}` : ''}</span></div>
      <div className="text-right">
        <strong className="font-display block text-xl font-bold tracking-tight">{usd(s.total)}</strong>
        <span className="font-mono text-xs text-[#8ec5ff]">{nio(s.total_nio)}</span>
        {abono50 && <span className="mt-1 block text-[11px] font-semibold text-amber-300">Abona 50%: {usd(s.abono)}</span>}
      </div>
    </div>

    <div className="mt-4 flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200"><AlertCircle size={12} /> Verificá la transferencia antes de confirmar</span>
      <a href={whatsappUrl(s.cliente_whatsapp, mensaje)} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1.5 text-[11px] font-semibold hover:underline ${urgente ? 'text-red-300' : 'text-[#62eaa0]'}`}><MessageCircle size={13} /> {urgente ? 'Avisar que vence' : 'Recordar por WhatsApp'}</a>
      <div className="ml-auto flex gap-2">
        {esAdmin ? <>
          <button className="subtle-button min-h-10" disabled={busy} onClick={onDiscard}><Trash2 size={15} /> Descartar</button>
          <button className="primary-button min-h-10 px-4" disabled={busy} onClick={onConfirm}>{busy ? 'Procesando…' : <><Check size={16} /> Confirmar pago <ArrowRight size={14} /></>}</button>
        </> : <span className="text-[11px] text-muted">El administrador confirma el pago.</span>}
      </div>
    </div>
  </article>
}

function EmptyState() {
  return <div className="mt-6 grid min-h-64 place-items-center rounded-2xl border border-dashed border-line text-center">
    <div><Inbox className="mx-auto text-muted" /><h2 className="mt-3 font-semibold">Sin encargos pendientes</h2><p className="mt-1 text-sm text-muted">Cuando un cliente encargue desde la web, aparecerá aquí.</p></div>
  </div>
}
