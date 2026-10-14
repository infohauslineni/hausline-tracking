import { MailX, RefreshCw } from 'lucide-react'
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
  useEffect(() => { if (isSupabaseConfigured) void correosNoFuncionan('listar').then(setDatos).catch(() => undefined) }, [])

  const revisar = async () => {
    setRevisando(true)
    try {
      const r = await correosNoFuncionan('revisar')
      setDatos(r)
      const n = r.resultado?.nuevos ?? 0
      toast.success(n ? `Encontré ${n} ${n === 1 ? 'correo que no funciona' : 'correos que no funcionan'}. Ya no se les envía nada.` : 'Revisado: no hay correos nuevos que fallen.', { duration: 9000 })
      if (r.resultado?.errorImap) toast.warning('No pude leer los rebotes de Gmail esta vez; sí revisé los dominios.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo revisar.') } finally { setRevisando(false) }
  }
  const quitar = async (correo: string) => {
    try { setDatos(await correosNoFuncionan('quitar', correo)); toast.success(`${correo} vuelve a recibir correos.`) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo quitar.') }
  }
  const lista = [...(datos?.lista ?? [])].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
  const visibles = verTodos ? lista : lista.slice(0, 8)
  const fecha = (iso?: string | null) => iso ? new Intl.DateTimeFormat('es-NI', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) : '—'

  return <section className="form-section">
    <h2 className="flex items-center gap-2 font-semibold"><MailX size={18} className="text-accent" /> Correos que no funcionan</h2>
    <p className="mt-2 text-xs leading-5 text-muted">A estas direcciones ya no se les manda ningún correo. Entran solas cuando un correo rebota o cuando el dominio no existe (por ejemplo gmail.con). Se revisa cada hora.</p>
    <p className="mt-2 text-xs text-muted"><b className="text-white">{lista.length}</b> {lista.length === 1 ? 'correo bloqueado' : 'correos bloqueados'} · última revisión de rebotes: {fecha(datos?.revisado_at)}</p>
    {visibles.length > 0 && <div className="mt-3 space-y-1.5">
      {visibles.map((x) => <div key={x.correo} className="flex items-start justify-between gap-2 rounded-lg border border-line bg-white/[.02] px-3 py-2 text-xs">
        <span className="min-w-0"><b className="block truncate text-white">{x.correo}</b><span className="text-muted">{x.motivo} · {fecha(x.fecha)}</span></span>
        <button className="shrink-0 text-[11px] font-semibold text-accent hover:underline" onClick={() => void quitar(x.correo)} title="Si el cliente ya corrigió su correo">Quitar</button>
      </div>)}
      {lista.length > 8 && <button className="text-[11px] font-semibold text-muted hover:text-white" onClick={() => setVerTodos((v) => !v)}>{verTodos ? 'Ver menos' : `Ver los ${lista.length}`}</button>}
    </div>}
    <button className="subtle-button mt-4 w-full" disabled={revisando || !isSupabaseConfigured} onClick={() => void revisar()}><RefreshCw size={14} className={revisando ? 'animate-spin' : ''} /> {revisando ? 'Revisando… (puede tardar un minuto)' : 'Revisar ahora (rebotes de 60 días + dominios)'}</button>
  </section>
}
