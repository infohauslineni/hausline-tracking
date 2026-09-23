import { ArrowLeft } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { PortalShell } from '../public/PortalChrome'

// Cascarón compartido por las páginas legales (Privacidad, Términos).
// Usa el mismo shell CLARO del portal del cliente para que se vea como parte del sitio.
export function LegalLayout({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  useEffect(() => { window.scrollTo(0, 0) }, [])
  return <PortalShell>
    <section className="mx-auto w-full max-w-2xl px-5 pb-6 sm:px-8">
      <Link to="/pedido" className="hsp-muted inline-flex items-center gap-1.5 text-xs font-semibold hover:text-black"><ArrowLeft size={14} /> Volver</Link>
      <p className="hsp-eyebrow mt-6">Información legal</p>
      <h1 className="hsp-display mt-2 text-3xl font-semibold sm:text-4xl">{title}</h1>
      <p className="hsp-faint mt-2 text-xs">Última actualización: {updated}</p>
      <div className="hsp-legal mt-8 space-y-8 text-sm leading-7">{children}</div>
    </section>
  </PortalShell>
}

// Bloque de sección con título, para armar los documentos legales.
export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="space-y-3">
    <h2 className="text-base font-semibold">{title}</h2>
    {children}
  </section>
}
