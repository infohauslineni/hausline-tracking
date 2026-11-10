import { Ban, MailX, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { isSupabaseConfigured } from '../../lib/supabase'
import { correosNoFuncionan, type ListaCorreosNoFuncionan } from '../../services/suscriptores.service'

// Configuración → Correos que no funcionan: direcciones que rebotaron o cuyo dominio no existe.
// El sistema ya no les manda ningún correo (pedidos, campañas, recordatorios).
export function CorreosNoFuncionanSection() {
  const [datos, setDatos] = useState<ListaCorreosNoFuncionan | null>(null)
  const [revisando, setRevisando] = useState(false)
  const [verTodos, setVerTodos] = useState(false)
  const [nuevo, setNuevo] = useState('')
  useEffect(() => { if (isSupabaseConfigured) void correosNoFuncionan('listar').then(setDatos).catch(() => undefined) }, [])

  const revisar = async () => {
    setRevisando(true)
    try {
      const r = await correosNoFuncionan('revisar')
      setDatos(r)
      const n = r.resultado?.nuevos ?? 0
      const leidos = r.resultado?.revisadosImap ?? 0
      const avisos = `Leí ${leidos} ${leidos === 1 ? 'aviso' : 'avisos'} de rebote de Gmail (también Papelera y Spam).`
      toast.success(n ? `Encontré ${n} ${n === 1 ? 'correo que no funciona' : 'correos que no funcionan'}. Ya no se les envía nada. ${avisos}` : `Revisado: no hay correos nuevos que fallen. ${avisos}`, { duration: 10000 })
      if (r.resultado?.errorImap) toast.warning('No pude leer los rebotes de Gmail esta vez; sí revisé los dominios.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo revisar.') } finally { setRevisando(false) }
  }
  // "Desbloquear" = vuelve a recibir correos (antes decía "Quitar" y se confundía con borrarlo).
  const quitar = async (correo: string) => {
    if (!window.confirm(`¿Volver a ENVIARLE correos a ${correo}?\n\nHacelo solo si el cliente ya corrigió su correo. Si no, seguirá rebotando.`)) return
    try { setDatos(await correosNoFuncionan('quitar', correo)); toast.success(`${correo} vuelve a recibir correos.`) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo quitar.') }
  }
  const bloquear = async () => {
    const correo = nuevo.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(correo)) { toast.error('Escribí un correo válido.'); return }
    try { setDatos(await correosNoFuncionan('agregar', correo)); setNuevo(''); toast.success(`${correo} ya no recibe ningún correo.`) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo bloquear.') }
  }
  const lista = [...(datos?.lista ?? [])].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
  const visibles = verTodos ? lista : lista.slice(0, 8)
  const fecha = (iso?: string | null) => iso ? new Intl.DateTimeFormat('es-NI', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) : '—'

  return <section className="form-section">
    <h2 className="flex items-center gap-2 font-semibold"><MailX size={18} className="text-accent" /> Correos que no funcionan</h2>
    <p className="mt-2 text-xs leading-5 text-muted">A estas direcciones ya no se les manda ningún correo. Entran solas cuando un correo rebota o cuando el dominio no existe (por ejemplo gmail.con), y también podés bloquear uno a mano. Se revisa cada hora. <b className="text-white">Desbloquear</b> hace que vuelva a recibir correos.</p>
    <p className="mt-2 text-xs text-muted"><b className="text-white">{lista.length}</b> {lista.length === 1 ? 'correo bloqueado' : 'correos bloqueados'} · última revisión de rebotes: {fecha(datos?.revisado_at)}</p>
    {visibles.length > 0 && <div className="mt-3 space-y-1.5">
      {visibles.map((x) => <div key={x.correo} className="flex items-start justify-between gap-2 rounded-lg border border-line bg-white/[.02] px-3 py-2 text-xs">
        <span className="min-w-0"><b className="block truncate text-white">{x.correo}</b><span className="text-muted">{x.motivo} · {fecha(x.fecha)}</span></span>
        <button className="shrink-0 text-[11px] font-semibold text-muted hover:text-white hover:underline" onClick={() => void quitar(x.correo)} title="Vuelve a recibir correos: solo si el cliente ya corrigió su correo">Desbloquear</button>
      </div>)}
      {lista.length > 8 && <button className="text-[11px] font-semibold text-muted hover:text-white" onClick={() => setVerTodos((v) => !v)}>{verTodos ? 'Ver menos' : `Ver los ${lista.length}`}</button>}
    </div>}
    <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); void bloquear() }}>
      <input className="search-input min-w-0 flex-1" type="email" inputMode="email" value={nuevo} onChange={(e) => setNuevo(e.target.value)} placeholder="Bloquear un correo a mano (ej. cliente@gmial.com)" aria-label="Correo a bloquear" />
      <button type="submit" className="subtle-button shrink-0" disabled={!nuevo.trim() || !isSupabaseConfigured}><Ban size={14} /> Bloquear</button>
    </form>
    <button className="subtle-button mt-2 w-full" disabled={revisando || !isSupabaseConfigured} onClick={() => void revisar()}><RefreshCw size={14} className={revisando ? 'animate-spin' : ''} /> {revisando ? 'Revisando… (puede tardar un minuto)' : 'Revisar ahora (rebotes de 60 días + dominios)'}</button>
  </section>
}
