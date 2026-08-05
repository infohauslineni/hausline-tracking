import { aUsd, MONEDA_SIMBOLO, type Moneda } from '../../utils/money'

type Props = {
  label?: string
  moneda: Moneda
  montoOriginal: number | string
  tipoCambio: number
  onMoneda: (moneda: Moneda) => void
  onMonto: (value: number) => void
  autoFocus?: boolean
}

/** Campo de monto con selector de moneda (córdobas / dólares) y equivalente en USD. */
export function MoneyField({ label = 'Monto', moneda, montoOriginal, tipoCambio, onMoneda, onMonto, autoFocus }: Props) {
  const numeric = Number(montoOriginal) || 0
  const usd = aUsd(numeric, moneda, tipoCambio)
  return (
    <div className="form-field col-span-full">
      <span>{label}</span>
      <div className="flex gap-2">
        <div className="flex shrink-0 overflow-hidden rounded-lg border border-line">
          {(['NIO', 'USD'] as const).map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => onMoneda(code)}
              className={`px-3 text-xs font-semibold transition ${moneda === code ? 'bg-accent text-app' : 'bg-white/[.02] text-muted hover:text-white'}`}
            >
              {MONEDA_SIMBOLO[code]}
            </button>
          ))}
        </div>
        <input
          type="number"
          min="0"
          step=".01"
          value={montoOriginal}
          autoFocus={autoFocus}
          onChange={(event) => onMonto(Number(event.target.value))}
          className="flex-1"
          placeholder="0.00"
        />
      </div>
      <small className="!text-muted">
        {moneda === 'NIO'
          ? `Se registrará como US$ ${usd.toFixed(2)} (tipo de cambio C$ ${Number(tipoCambio).toFixed(2)} × US$).`
          : 'Se registrará en dólares.'}
      </small>
    </div>
  )
}
