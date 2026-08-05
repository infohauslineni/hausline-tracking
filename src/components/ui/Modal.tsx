import { X } from 'lucide-react'
import type { ReactNode } from 'react'

export function Modal({ title, description, open, onClose, children }: { title: string; description?: string; open: boolean; onClose: () => void; children: ReactNode }) {
  if (!open) return null
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-label={title}>
    <button className="absolute inset-0" aria-label="Cerrar" onClick={onClose} />
    <section className="relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-line bg-[#101311] p-5 shadow-2xl sm:rounded-2xl sm:p-6">
      <header className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">{title}</h2>{description && <p className="mt-1 text-xs text-muted">{description}</p>}</div><button className="icon-button shrink-0" onClick={onClose} aria-label="Cerrar modal"><X size={18} /></button></header>
      <div className="mt-6">{children}</div>
    </section>
  </div>
}
