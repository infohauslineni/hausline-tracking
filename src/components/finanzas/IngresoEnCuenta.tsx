import { useEffect, useState } from 'react'
import { listarCuentas } from '../../services/cuentas.service'
import type { CuentaBancaria, Moneda } from '../../types/domain'
import { MONEDA_SIMBOLO, aUsd } from '../../utils/money'

// Un cobro/abono donde LA CUENTA MANDA LA MONEDA: primero elegís a qué cuenta entró el
// dinero y después escribís el monto EN LA MONEDA DE ESA CUENTA (córdobas si es cuenta C$,
// dólares si es cuenta US$). El equivalente en dólares —que es la moneda del pedido— se
// calcula solo con el tipo de cambio. Así, si el cliente transfiere C$ a tu cuenta córdobas,
// elegís esa cuenta y escribís los córdobas exactos que recibiste, sin hacer cuentas a mano.
//
// `montoCuenta` es el número que tecleás (moneda de la cuenta) y suma/queda en la tarjeta;
// `montoUsd` es el equivalente en dólares que usa el pedido para el saldo.
export type Ingreso = { cuentaId: string | null; montoCuenta: number; montoUsd: number; moneda: Moneda }

export const INGRESO_VACIO: Ingreso = { cuentaId: null, montoCuenta: 0, montoUsd: 0, moneda: 'USD' }

// USD → moneda de la cuenta (córdobas redondeados a la decena hacia arriba, igual que en el
// resto de la app). Sirve para no perder el valor al cambiar de una cuenta a otra.
function aMonedaCuenta(montoUsd: number, moneda: Moneda, tipoCambio: number): number {
  if (moneda === 'USD') return Math.round(montoUsd * 100) / 100
  const tc = tipoCambio > 0 ? tipoCambio : 37
  return Math.ceil((montoUsd * tc) / 10) * 10
}

export function IngresoEnCuenta({ tipoCambio, value, onChange, label = 'Abono inicial', proposito = 'recibir' }: {
  tipoCambio: number
  value: Ingreso
  onChange: (v: Ingreso) => void
  label?: string
  proposito?: 'comprar' | 'recibir'
}) {
  const [todas, setTodas] = useState<CuentaBancaria[]>([])
  useEffect(() => { void listarCuentas(setTodas).then(setTodas).catch(() => undefined) }, [])

  // Filtra por propósito (recibir/comprar); si el filtro deja la lista vacía, muestra todas.
  const filtradas = todas.filter((c) => (c.proposito ?? 'ambos') === proposito || (c.proposito ?? 'ambos') === 'ambos')
  const cuentas = filtradas.length ? filtradas : todas
  const cuenta = cuentas.find((c) => c.id === value.cuentaId) ?? null

  // Al cambiar de cuenta conservamos el VALOR (en dólares) y reconvertimos a la moneda de la
  // nueva cuenta, para que cambiar de C$ a US$ no altere lo que realmente entró.
  const cambiarCuenta = (cuentaId: string) => {
    const c = cuentas.find((x) => x.id === cuentaId) ?? null
    const moneda = c?.moneda ?? 'USD'
    onChange({ cuentaId, moneda, montoUsd: value.montoUsd, montoCuenta: aMonedaCuenta(value.montoUsd, moneda, tipoCambio) })
  }

  // Al teclear el monto (en la moneda de la cuenta) recalculamos el equivalente en dólares.
  const cambiarMonto = (montoCuenta: number) => {
    const moneda = cuenta?.moneda ?? 'USD'
    onChange({ cuentaId: value.cuentaId, moneda, montoCuenta, montoUsd: aUsd(montoCuenta, moneda, tipoCambio) })
  }

  if (!cuentas.length) return null

  const simbolo = MONEDA_SIMBOLO[cuenta?.moneda ?? 'USD']
  return <div className="form-field col-span-full">
    <span>{label} <span className="text-muted">(elegí la cuenta y escribí el monto en su moneda)</span></span>
    <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
      <select value={value.cuentaId ?? ''} onChange={(e) => cambiarCuenta(e.target.value)}>
        <option value="">Elegí a qué cuenta entró…</option>
        {cuentas.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.nombre} ({MONEDA_SIMBOLO[c.moneda]})</option>)}
      </select>
      <label className="flex items-center gap-2 text-sm">
        <span className="shrink-0 text-muted">{simbolo}</span>
        <input type="number" min="0" step=".01" className="w-32" value={value.montoCuenta || ''} disabled={!cuenta} onChange={(e) => cambiarMonto(Number(e.target.value))} />
      </label>
    </div>
    {cuenta && cuenta.moneda === 'NIO' && value.montoCuenta > 0 && (
      <small className="text-muted">≈ US$ {value.montoUsd.toFixed(2)} al tipo de cambio C$ {(tipoCambio > 0 ? tipoCambio : 37).toFixed(2)} · es lo que se descuenta del saldo del pedido.</small>
    )}
  </div>
}
