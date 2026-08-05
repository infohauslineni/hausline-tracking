import { HauslineLogo } from './HauslineLogo'

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <HauslineLogo size={40} className="shrink-0 rounded-xl shadow-accent" />
      {!compact && (
        <span>
          <strong className="block text-sm font-extrabold tracking-[0.18em] text-white">HAUSLINE</strong>
          <span className="block text-[10px] font-semibold tracking-[0.3em] text-muted">TRACKING</span>
        </span>
      )}
    </div>
  )
}
