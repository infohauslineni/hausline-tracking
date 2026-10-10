import { Check, Palette } from 'lucide-react'
import { useState } from 'react'
import { guardarTemaPanel, temaPanelGuardado, TEMAS_PANEL } from '../../utils/temaPanel'

// Configuración → Apariencia: el color de acento del panel (botones, menú activo, resaltados).
// Se aplica al instante y se recuerda en este navegador.
export function AparienciaSection() {
  const [actual, setActual] = useState(temaPanelGuardado)
  const elegir = (id: string) => { guardarTemaPanel(id); setActual(id) }
  return <section className="form-section">
    <h2 className="flex items-center gap-2 font-semibold"><Palette size={18} className="text-accent" /> Color del panel</h2>
    <p className="mt-2 text-xs leading-5 text-muted">Elegí el color de los botones y resaltados. Cambia al instante y queda guardado en este navegador.</p>
    <div className="mt-4 grid grid-cols-4 gap-2">
      {TEMAS_PANEL.map((t) => <button key={t.id} type="button" onClick={() => elegir(t.id)} aria-pressed={actual === t.id} title={t.nombre}
        className={`flex flex-col items-center gap-1.5 rounded-xl border p-2 text-[10px] transition ${actual === t.id ? 'border-white/40 bg-white/[.06] text-white' : 'border-line text-muted hover:border-white/20 hover:text-white'}`}>
        <span className="grid size-8 place-items-center rounded-full text-black" style={{ background: t.color }}>{actual === t.id && <Check size={15} strokeWidth={3} />}</span>
        <span className="leading-3">{t.nombre}</span>
      </button>)}
    </div>
  </section>
}
