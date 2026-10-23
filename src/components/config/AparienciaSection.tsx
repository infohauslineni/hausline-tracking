import { Check, Moon, Palette, Sun } from 'lucide-react'
import { useState } from 'react'
import { guardarModoPanel, guardarTemaPanel, modoPanelGuardado, temaPanelGuardado, TEMAS_PANEL, type ModoPanel } from '../../utils/temaPanel'

// Configuración → Apariencia: modo (claro estilo tienda grande u oscuro) y color de acento del
// panel (enlaces, resaltados, pestañas activas). Se aplica al instante y se recuerda en este navegador.
export function AparienciaSection() {
  const [actual, setActual] = useState(temaPanelGuardado)
  const [modo, setModo] = useState<ModoPanel>(modoPanelGuardado)
  const elegir = (id: string) => { guardarTemaPanel(id); setActual(id) }
  const cambiarModo = (m: ModoPanel) => { guardarModoPanel(m); setModo(m) }
  return <section className="form-section">
    <h2 className="flex items-center gap-2 font-semibold"><Palette size={18} className="text-accent" /> Apariencia del panel</h2>
    <p className="mt-2 text-xs leading-5 text-muted">Cambia al instante y queda guardado en este navegador.</p>
    <div className="mt-4 grid grid-cols-2 gap-2">
      {([['claro', 'Claro', Sun, 'Como una tienda grande'], ['oscuro', 'Oscuro', Moon, 'El de antes']] as const).map(([m, nombre, Icono, ayuda]) => <button key={m} type="button" onClick={() => cambiarModo(m)} aria-pressed={modo === m}
        className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${modo === m ? 'border-accent bg-accent/[.07]' : 'border-line hover:border-white/25'}`}>
        <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${m === 'claro' ? 'bg-[#f1f1f1] text-[#303030]' : 'bg-[#0a0a0a] text-[#f2f2f2]'} border border-line`}><Icono size={17} /></span>
        <span><strong className="block text-sm">{nombre}</strong><span className="text-[11px] text-muted">{ayuda}</span></span>
      </button>)}
    </div>
    <p className="mt-5 text-xs font-semibold text-muted">Color de acento</p>
    <div className="mt-2 grid grid-cols-4 gap-2">
      {TEMAS_PANEL.map((t) => <button key={t.id} type="button" onClick={() => elegir(t.id)} aria-pressed={actual === t.id} title={t.nombre}
        className={`flex flex-col items-center gap-1.5 rounded-xl border p-2 text-[10px] transition ${actual === t.id ? 'border-white/40 bg-white/[.06] text-white' : 'border-line text-muted hover:border-white/20 hover:text-white'}`}>
        <span className="grid size-8 place-items-center rounded-full" style={{ background: modo === 'claro' ? t.profundo : t.color, color: modo === 'claro' ? '#fff' : '#000' }}>{actual === t.id && <Check size={15} strokeWidth={3} />}</span>
        <span className="leading-3">{t.nombre}</span>
      </button>)}
    </div>
  </section>
}
