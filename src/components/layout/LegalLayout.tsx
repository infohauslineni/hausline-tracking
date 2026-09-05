import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Brand } from '../ui/Brand'

// Cascarón compartido por las páginas legales (Privacidad, Términos).
// Reusa el mismo encabezado, glow y pie que la página de rastreo para que
// se vea como parte del mismo sitio.
export function LegalLayout({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  useEffect(() => { window.scrollTo(0, 0) }, [])
  return <main className="relative min-h-screen overflow-hidden bg-app text-white">
    <div className="tracking-glow" />
    <header className="relative z-10 mx-auto flex w-full max-w-3xl items-center justify-between px-5 py-6 sm:px-8">
      <Link to="/tracking" aria-label="Inicio de rastreo"><Brand /></Link>
      <Link to="/tracking" className="subtle-button"><span className="hidden sm:inline">Rastrear pedido</span><ArrowRight size={16} /></Link>
    </header>
    <section className="relative z-10 mx-auto w-full max-w-3xl px-5 py-6 sm:px-8 sm:py-10">
      <Link to="/tracking" className="inline-flex items-center gap-2 text-xs text-muted hover:text-white"><ArrowLeft size={15} /> Volver</Link>
      <p className="eyebrow mt-6">Información legal</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">{title}</h1>
      <p className="mt-2 text-xs text-muted">Última actualización: {updated}</p>
      <div className="legal-doc mt-8 space-y-8 text-sm leading-7 text-muted">{children}</div>
    </section>
    <footer className="relative z-10 mx-auto flex w-full max-w-3xl flex-col gap-3 border-t border-line px-5 py-6 text-center text-xs text-muted sm:flex-row sm:justify-between sm:px-8">
      <span>© 2026 Hausline · King of Shoes</span>
      <span className="flex justify-center gap-4">
        <Link to="/privacidad" className="hover:text-white">Privacidad</Link>
        <Link to="/terminos" className="hover:text-white">Términos y condiciones</Link>
      </span>
    </footer>
  </main>
}

// Bloque de sección con título, para armar los documentos legales.
export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="space-y-3">
    <h2 className="text-base font-semibold text-white">{title}</h2>
    {children}
  </section>
}
