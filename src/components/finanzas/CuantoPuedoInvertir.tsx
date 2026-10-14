import { AlertTriangle, ChevronDown, Landmark, TrendingUp } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { isSupabaseConfigured } from '../../lib/supabase'
import { obtenerResumenInversion, type ResumenInversion } from '../../services/compromisos.service'

// ¿Cuánto puedo invertir? Dinero libre real (sobre el mínimo de cada cuenta) menos lo que ya está
// comprometido (proveedor, envíos, compras por pagar, devoluciones, gastos fijos).
const usd = (n: number) => `US$ ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const moneda = (n: number, m: string) => `${m === 'NIO' ? 'C$' : 'US$'} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function CuantoPuedoInvertir({ recarga = 0, compacto = false }: { recarga?: number; compacto?: boolean }) {
  const [r, setR] = useState<ResumenInversion | null>(null)
  const [abierto, setAbierto] = useState<string | null>(null)
  useEffect(() => {
    if (!isSupabaseConfigured) return
    let vivo = true
    void obtenerResumenInversion().then((x) => { if (vivo) setR(x) }).catch(() => undefined)
    return () => { vivo = false }
  }, [recarga])
  if (!r) return isSupabaseConfigured ? <div className="mt-4 h-28 animate-pulse rounded-2xl border border-line bg-panel" /> : null
  if (r.libreReal == null) return null
  const puede = r.puedeInvertir ?? 0
  const debajo = r.cuentas.filter((c) => c.debajo)
  const sinMinimos = r.cuentas.every((c) => c.minimo <= 0)

  return <section className={`mt-4 rounded-2xl border p-5 ${puede > 0 ? 'border-line bg-panel' : 'border-amber-400/35 bg-amber-400/[.05]'}`}>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold"><TrendingUp size={16} className="text-accent" /> ¿Cuánto puedo invertir?</h2>
        <p className="mt-1 text-xs text-muted">Dinero que de verdad tenés libre, menos lo que ya debés o va a salir pronto.</p>
      </div>
      <div className="shrink-0 sm:text-right">
        {puede > 0
          ? <><span className="text-xs text-muted">Podés invertir hasta</span><strong className="block text-3xl tabular-nums text-white">{usd(puede)}</strong></>
          : <><span className="text-xs text-amber-200">No conviene invertir ahora</span><strong className="block text-2xl tabular-nums text-amber-200">Te faltan {usd(-puede)}</strong><span className="text-[11px] text-muted">para cubrir lo que ya está comprometido</span></>}
      </div>
    </div>

    {!compacto && <div className="mt-4 space-y-1.5 text-sm">
      <div className="flex justify-between gap-3"><span className="flex items-center gap-1.5 text-muted"><Landmark size={14} /> Libre en tus cuentas{sinMinimos ? '' : ' (sobre el mínimo)'}</span><b className="tabular-nums">{usd(r.libreReal)}</b></div>
      {r.compromisos.map((c) => <div key={c.clave}>
        <button type="button" className="flex w-full items-baseline justify-between gap-3 text-left" onClick={() => setAbierto(abierto === c.clave ? null : c.clave)}>
          <span className="flex items-center gap-1 text-muted"><ChevronDown size={13} className={`transition ${abierto === c.clave ? 'rotate-180' : ''}`} />{c.titulo} ({c.lineas.length}){c.aprox ? ' · aprox.' : ''}</span>
          <b className="tabular-nums text-red-300">− {usd(c.monto)}</b>
        </button>
        {abierto === c.clave && <div className="mb-2 ml-5 mt-1 space-y-0.5 rounded-lg border border-line bg-white/[.02] p-2 text-xs">
          <p className="mb-1 text-[11px] text-muted">{c.ayuda}</p>
          {c.lineas.map((l, i) => <div key={i} className="flex justify-between gap-3">{l.pedidoId ? <Link to={`/pedidos/${l.pedidoId}`} className="truncate text-white/85 hover:text-accent">{l.etiqueta}</Link> : <span className="truncate text-white/85">{l.etiqueta}</span>}<span className="shrink-0 tabular-nums text-muted">{usd(l.monto)}</span></div>)}
        </div>}
      </div>)}
      <div className="flex justify-between gap-3 border-t border-line pt-2"><span className="font-semibold">Libre para invertir</span><b className={`tabular-nums ${puede > 0 ? 'text-white' : 'text-amber-200'}`}>{usd(puede)}</b></div>
      {r.porCobrar > 0.005 && <p className="pt-1 text-xs text-muted">Además, te deben <b className="text-white">{usd(r.porCobrar)}</b> en saldos de clientes. No se cuenta hasta que lo paguen.</p>}
    </div>}

    {debajo.length > 0 && <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/[.06] p-2.5 text-xs text-amber-100"><AlertTriangle size={14} className="mt-0.5 shrink-0" /><span>{debajo.map((c) => `${c.cuenta.nombre} está debajo de su mínimo (tiene ${moneda(c.saldo, c.cuenta.moneda)} de ${moneda(c.minimo, c.cuenta.moneda)})`).join(' · ')}.</span></p>}
    {sinMinimos && <p className="mt-3 text-xs text-muted">Tip: en Mi cuenta, editá cada tarjeta y poné el <b className="text-white">mínimo</b> que siempre querés dejar (ej. BAC US$ 200 y C$ 2,500). Ese dinero no se cuenta como libre.</p>}
    {r.sinCosto.length > 0 && <p className="mt-2 text-xs text-amber-200">Sin costo registrado (no entran en la cuenta): {r.sinCosto.join(', ')}. Agregá el costo del producto para que el cálculo sea exacto.</p>}
  </section>
}
