import { useEffect, useMemo, useRef, useState } from 'react'
import { listarCuentas } from '../../services/cuentas.service'
import type { CuentaBancaria } from '../../types/domain'
import { MONEDA_SIMBOLO } from '../../utils/money'

export type DestinoPago = { cuentaId: string | null; montoCuenta: number }

// Selector de cuenta para los formularios de dinero. Con modo "suma" (por defecto) es
// "¿a qué cuenta entró?" (cobros/abonos) y suma a la tarjeta; con modo "resta" es "¿de qué
// cuenta salió?" (pagos a proveedor/gastos) y resta de la tarjeta. Al elegir una cuenta,
// propone el monto convertido a la moneda de la cuenta (córdobas redondeados a la decena) y
// deja corregirlo.
//
// `requerido`: cuando es true, cada movimiento DEBE caer en una cuenta (así la caja y las
// tarjetas nunca se desfasan). Se quita la opción "No asignar" y se autoselecciona la primera
// cuenta para que siempre haya un destino válido.
export function CuentaSelect({ montoUsd, tipoCambio, value, onChange, modo = 'suma', label, requerido = false, proposito }: { montoUsd: number; tipoCambio: number; value: DestinoPago; onChange: (destino: DestinoPago) => void; modo?: 'suma' | 'resta'; label?: string; requerido?: boolean; proposito?: 'comprar' | 'recibir' }) {
  const [todas, setTodas] = useState<CuentaBancaria[]>([])
  const editado = useRef(false)
  useEffect(() => { void listarCuentas(setTodas).then(setTodas).catch(() => undefined) }, [])
  const resta = modo === 'resta'
  const titulo = label ?? (resta ? '¿De qué cuenta salió?' : '¿A qué cuenta entró?')

  // Filtra por propósito: en compras muestra las cuentas "para comprar" (+ las de "ambos"),
  // en cobros las "para recibir". Si el filtro deja la lista vacía (aún no dedicaste cuentas),
  // mostramos todas para no bloquear el formulario.
  const cuentas = useMemo(() => {
    const filtradas = proposito ? todas.filter((c) => (c.proposito ?? 'ambos') === proposito || (c.proposito ?? 'ambos') === 'ambos') : todas
    return filtradas.length ? filtradas : todas
  }, [todas, proposito])

  const cuenta = cuentas.find((c) => c.id === value.cuentaId) ?? null
  const sugerido = (c: CuentaBancaria) => {
    const usd = Math.max(0, Number(montoUsd || 0))
    if (c.moneda === 'USD') return Math.round(usd * 100) / 100
    const tc = tipoCambio > 0 ? tipoCambio : 37
    return Math.ceil((usd * tc) / 10) * 10
  }

  // Mientras el monto no se haya tocado a mano, mantiene el sugerido al día con el monto del pago.
  useEffect(() => {
    if (cuenta && !editado.current) onChange({ cuentaId: cuenta.id, montoCuenta: sugerido(cuenta) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [montoUsd, tipoCambio, value.cuentaId])

  // Obligatorio: si aún no hay cuenta elegida, autoselecciona la primera en cuanto cargan.
  useEffect(() => {
    if (requerido && !value.cuentaId && cuentas.length) { editado.current = false; onChange({ cuentaId: cuentas[0].id, montoCuenta: sugerido(cuentas[0]) }) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requerido, cuentas])

  if (!cuentas.length) return null

  // Un toque por cuenta (chips). El monto en la moneda de la cuenta solo se pide cuando hace falta
  // convertir (cuenta en córdobas); en dólares es el mismo monto y no se muestra.
  const elegir = (c: CuentaBancaria | null) => { editado.current = false; onChange({ cuentaId: c?.id ?? null, montoCuenta: c ? sugerido(c) : 0 }) }
  const chip = (activo: boolean) => `inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition ${activo ? 'border-accent bg-accent/15 text-white' : 'border-line text-muted hover:border-white/25 hover:text-white'}`
  return <div className="form-field col-span-full">
    <span>{titulo}</span>
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={titulo}>
      {cuentas.map((c) => <button type="button" role="radio" aria-checked={value.cuentaId === c.id} key={c.id} className={chip(value.cuentaId === c.id)} onClick={() => elegir(c)}><span>{c.emoji}</span>{c.nombre}<span className="text-[10px] text-muted">{MONEDA_SIMBOLO[c.moneda]}</span></button>)}
      {!requerido && <button type="button" role="radio" aria-checked={!value.cuentaId} className={chip(!value.cuentaId)} onClick={() => elegir(null)}>{resta ? 'No descontar' : 'Ninguna'}</button>}
    </div>
    {cuenta && cuenta.moneda !== 'USD' && (
      <label className="mt-1.5 flex items-center gap-2 text-xs text-muted">
        <span className="shrink-0">{resta ? 'Salieron' : 'Entraron'} {MONEDA_SIMBOLO[cuenta.moneda]}</span>
        <input type="number" step=".01" className="w-32" value={value.montoCuenta} onChange={(e) => { editado.current = true; onChange({ cuentaId: cuenta.id, montoCuenta: Number(e.target.value) }) }} />
      </label>
    )}
  </div>
}
