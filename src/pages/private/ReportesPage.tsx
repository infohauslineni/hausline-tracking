import { CalendarDays, CircleDollarSign, Download, PackageCheck, PiggyBank, ReceiptText, WalletCards } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Modal } from '../../components/ui/Modal'
import { guardarConfiguracionFinanzas, obtenerConfiguracionFinanzas, obtenerGananciaRealizada, obtenerSaldoCuenta, periodoComercial, retirarGanancia } from '../../services/finanzas.service'
import type { ConfiguracionFinanzas, GananciaRealizada } from '../../types/domain'

const zero: GananciaRealizada = { desde: '', hasta: '', pedidos_entregados: 0, cobrado: 0, costos: 0, ganancia_realizada: 0, ganancia_asignada: 0, ganancia_disponible: 0 }
const todayIso = () => new Date().toISOString().slice(0, 10)
const promptKey = () => `hausline-retiro-consultado-${todayIso()}`

export function ReportesPage() {
  const [config, setConfig] = useState<ConfiguracionFinanzas>({ dia_inicio_mes: 1, dia_retiro: 28, porcentaje_reserva_negocio: 30 })
  const [data, setData] = useState(zero)
  const [saldoCuenta, setSaldoCuenta] = useState(0)
  const [loading, setLoading] = useState(true)
  const [withdrawPrompt, setWithdrawPrompt] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const currentConfig = await obtenerConfiguracionFinanzas()
      const period = periodoComercial(new Date(), currentConfig.dia_inicio_mes)
      const [result, saldo] = await Promise.all([obtenerGananciaRealizada(period.desde, period.hasta), obtenerSaldoCuenta()])
      setConfig(currentConfig)
      setData(result)
      setSaldoCuenta(saldo)
      const reserve = Math.max(0, result.ganancia_disponible * currentConfig.porcentaje_reserva_negocio / 100)
      // Solo se puede retirar lo que de verdad hay en la cuenta, aunque la ganancia contable sea mayor.
      const available = Math.max(0, Math.min(result.ganancia_disponible - reserve, saldo))
      if (new Date().getDate() === currentConfig.dia_retiro && available > 0 && localStorage.getItem(promptKey()) !== 'done') setWithdrawPrompt(true)
    } catch { toast.error('No se pudo calcular la ganancia. Ejecuta la migración financiera en Supabase.') } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  const reserve = Math.max(0, data.ganancia_disponible * config.porcentaje_reserva_negocio / 100)
  const gananciaNeta = Math.max(0, data.ganancia_disponible - reserve)
  // El retiro real está topado por el saldo de cuenta: no puedes sacar dinero que aún no está en caja.
  const withdrawable = Math.max(0, Math.min(gananciaNeta, saldoCuenta))
  const limitadoPorCaja = gananciaNeta > saldoCuenta + 0.005
  const isWithdrawalDay = new Date().getDate() === config.dia_retiro
  const withdrawalDate = useMemo(() => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const candidate = new Date(now.getFullYear(), now.getMonth(), config.dia_retiro)
    if (candidate < today) candidate.setMonth(candidate.getMonth() + 1)
    return new Intl.DateTimeFormat('es-NI', { day: 'numeric', month: 'long', year: 'numeric' }).format(candidate)
  }, [config.dia_retiro])

  const withdraw = async (confirmed = false) => {
    if (!withdrawable) return toast.error('Todavía no hay ganancia disponible para retirar.')
    if (!confirmed && !confirm(`¿Registrar retiro de USD ${withdrawable.toFixed(2)}? Este monto se descontará del saldo de Mi cuenta.`)) return
    try {
      await retirarGanancia(withdrawable, todayIso())
      localStorage.setItem(promptKey(), 'done')
      setWithdrawPrompt(false)
      toast.success('Retiro registrado y descontado del saldo de Mi cuenta.')
      await load()
    } catch { toast.error('No se pudo registrar el retiro.') }
  }

  const postpone = () => { localStorage.setItem(promptKey(), 'done'); setWithdrawPrompt(false) }
  const saveConfig = async () => { try { await guardarConfiguracionFinanzas(config); toast.success('Calendario financiero guardado.'); await load() } catch { toast.error('No se pudo guardar la configuración.') } }

  return <div>
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="eyebrow">Cierre comercial</p><h1 className="page-title">Ganancia mensual real</h1><p className="page-subtitle">Solo cuenta pedidos entregados y dinero efectivamente recibido.</p></div><button className="primary-button px-5" disabled={loading || withdrawable <= 0} onClick={() => void withdraw()}><Download size={17} /> Retirar ganancia disponible</button></div>
    <section className="mt-6 rounded-2xl border border-accent/25 bg-accent/[.055] p-5 sm:p-6"><div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-accent"><CalendarDays size={16} /> Periodo comercial</p><h2 className="mt-2 text-xl font-semibold">{formatDate(data.desde)} — {formatDate(data.hasta)}</h2><p className="mt-2 text-sm text-muted">{isWithdrawalDay ? <b className="text-accent">Hoy es tu día de retiro.</b> : <>Próximo retiro recomendado: <b className="text-white">{withdrawalDate}</b></>}</p></div><div className="rounded-2xl border border-accent/20 bg-black/20 p-5 text-right"><span className="text-xs text-muted">Puedes retirar ahora (limitado por tu caja)</span><strong className="mt-1 block text-3xl text-accent">USD {withdrawable.toFixed(2)}</strong><span className="mt-1 block text-[11px] text-muted">Saldo real en cuenta: USD {saldoCuenta.toFixed(2)}</span></div></div>{limitadoPorCaja && <p className="mt-4 rounded-xl border border-amber-300/25 bg-amber-300/[.06] p-3 text-[12px] leading-5 text-amber-200/90">Tu ganancia después de la reserva es <b>USD {gananciaNeta.toFixed(2)}</b>, pero en la cuenta solo hay <b>USD {saldoCuenta.toFixed(2)}</b>. Puedes retirar hasta ese saldo real; el resto de la ganancia queda pendiente porque todavía no está cobrado o ya se reinvirtió (por ejemplo, pedidos aún no entregados o dinero puesto en stock).</p>}</section>
    <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3"><Card icon={PackageCheck} label="Pedidos entregados" value={String(data.pedidos_entregados)} /><Card icon={WalletCards} label="Dinero recibido" value={`USD ${data.cobrado.toFixed(2)}`} /><Card icon={ReceiptText} label="Costos reales" value={`USD ${data.costos.toFixed(2)}`} red /><Card icon={CircleDollarSign} label="Ganancia realizada" value={`USD ${data.ganancia_realizada.toFixed(2)}`} accent /><Card icon={PiggyBank} label={`Reserva negocio (${config.porcentaje_reserva_negocio}%)`} value={`USD ${reserve.toFixed(2)}`} /><Card icon={Download} label="Ya asignada o retirada" value={`USD ${data.ganancia_asignada.toFixed(2)}`} /></div>
    <section className="form-section mt-6"><h2 className="font-semibold">Qué pasa al comenzar otro mes</h2><p className="mt-2 text-sm leading-6 text-muted">No se borra ni se restablece nada. Los pedidos pendientes, saldos por cobrar, inventario, deudas y saldo de Mi cuenta siguen iguales. Solo cambia el periodo que usa este informe para medir la ganancia del nuevo mes.</p></section>
    <section className="form-section mt-6"><h2 className="font-semibold">Calendario y reserva</h2><div className="mt-5 grid gap-3 sm:grid-cols-3"><label className="form-field"><span>Tu mes de ventas inicia el día</span><input type="number" min="1" max="28" value={config.dia_inicio_mes} onChange={(event) => setConfig({ ...config, dia_inicio_mes: Math.max(1, Math.min(28, Number(event.target.value) || 1)) })} /></label><label className="form-field"><span>Día mensual de retiro</span><input type="number" min="1" max="28" value={config.dia_retiro} onChange={(event) => setConfig({ ...config, dia_retiro: Math.max(1, Math.min(28, Number(event.target.value) || 1)) })} /></label><label className="form-field"><span>Reserva para envíos y negocio (%)</span><input type="number" min="0" max="100" value={config.porcentaje_reserva_negocio} onChange={(event) => setConfig({ ...config, porcentaje_reserva_negocio: Math.max(0, Math.min(100, Number(event.target.value) || 0)) })} /></label></div><button className="primary-button mt-5 px-5" onClick={() => void saveConfig()}>Guardar calendario</button></section>
    <Modal open={withdrawPrompt} onClose={postpone} title="Hoy puedes retirar tu ganancia" description="La aplicación te consulta antes de mover el dinero."><div className="rounded-2xl border border-accent/25 bg-accent/[.06] p-5"><span className="text-xs text-muted">Ganancia disponible después de reservar dinero para el negocio</span><strong className="mt-2 block text-3xl text-accent">USD {withdrawable.toFixed(2)}</strong><p className="mt-3 text-sm leading-6 text-muted">Si confirmas, se registrará como retiro de ganancia y se descontará automáticamente del saldo de Mi cuenta.</p></div><div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button className="subtle-button justify-center" onClick={postpone}>Dejar para después</button><button className="primary-button justify-center px-5" onClick={() => void withdraw(true)}><Download size={17} /> Sí, retirar ganancia</button></div></Modal>
  </div>
}

function formatDate(value: string) { if (!value) return '—'; return new Intl.DateTimeFormat('es-NI', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`)) }
function Card({ icon: Icon, label, value, accent, red }: { icon: typeof CalendarDays; label: string; value: string; accent?: boolean; red?: boolean }) { return <article className="panel-card"><Icon size={20} className={accent ? 'text-accent' : red ? 'text-red-300' : 'text-muted'} /><span className="mt-4 block text-xs text-muted">{label}</span><strong className={`mt-1 block text-2xl ${accent ? 'text-accent' : red ? 'text-red-300' : ''}`}>{value}</strong></article> }
