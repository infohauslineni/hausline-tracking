import { PackageCheck } from 'lucide-react'

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-black shadow-accent">
        <PackageCheck size={21} strokeWidth={2.4} />
      </span>
      {!compact && (
        <span>
          <strong className="block text-sm font-extrabold tracking-[0.18em] text-white">HAUSLINE</strong>
          <span className="block text-[10px] font-semibold tracking-[0.3em] text-muted">TRACKING</span>
        </span>
      )}
    </div>
  )
}
