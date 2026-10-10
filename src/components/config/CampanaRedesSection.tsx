import { AtSign, Send } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { isSupabaseConfigured } from '../../lib/supabase'
import { campanaRedes, type EstadoCampanaRedes } from '../../services/suscriptores.service'
import { Modal } from '../ui/Modal'

// Configuración → Correo "Síganos en Instagram y TikTok": se manda a los suscriptores que
// aceptaron recibir novedades. Primero una prueba al propio correo; el envío real pide confirmar.
export function CampanaRedesSection() {
  const [estado, setEstado] = useState<EstadoCampanaRedes | null>(null)
  const [trabajando, setTrabajando] = useState<'prueba' | 'iniciar' | null>(null)
  const [confirmar, setConfirmar] = useState(false)
  useEffect(() => { if (isSupabaseConfigured) void campanaRedes('estado').then(setEstado).catch(() => undefined) }, [])

  const c = estado?.campana ?? null
  const enviando = Boolean(c?.activa && !c.completa)
  const fecha = (iso?: string) => iso ? new Intl.DateTimeFormat('es-NI', { day: 'numeric', month: 'long' }).format(new Date(iso)) : ''

  const prueba = async () => {
    setTrabajando('prueba')
    try { const r = await campanaRedes('prueba'); setEstado(r); toast.success(`Prueba enviada a ${r.prueba}. Revisá tu bandeja (y spam).`) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo enviar la prueba.') } finally { setTrabajando(null) }
  }
  const iniciar = async () => {
    setTrabajando('iniciar')
    try { const r = await campanaRedes('iniciar'); setEstado(r); setConfirmar(false); toast.success(`Listo: el correo empieza a salir a ${r.suscriptores} suscriptores (de a 25 cada 15 minutos, de 9 a. m. a 8 p. m.).`, { duration: 9000 }) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo lanzar.') } finally { setTrabajando(null) }
  }

  return <section className="form-section">
    <h2 className="flex items-center gap-2 font-semibold"><AtSign size={18} className="text-accent" /> Correo: síganos en Instagram y TikTok</h2>
    <p className="mt-2 text-xs leading-5 text-muted">Invita a seguir las dos cuentas de Instagram (<b className="text-white">@hausline.ni</b> y <b className="text-white">@archive.hauslineni</b>) y <b className="text-white">@hausline.niof</b> en TikTok. Llega solo a quienes aceptaron recibir novedades{estado ? <> (<b className="text-white">{estado.suscriptores}</b> hoy)</> : ''}, con su enlace para darse de baja.</p>
    {c && <p className="mt-2 rounded-lg border border-line bg-white/[.02] px-3 py-2 text-xs text-muted">{enviando ? <>Enviándose: <b className="text-white">{c.enviados ?? 0}</b> de {c.total ?? estado?.suscriptores ?? 0}. Sale de a 25 cada 15 minutos.</> : c.completa ? <>Última campaña: <b className="text-white">{c.enviados ?? 0}</b> correos, terminó el {fecha(c.completada)}.</> : null}</p>}
    <div className="mt-4 grid gap-2">
      <button className="subtle-button" disabled={trabajando !== null} onClick={() => void prueba()}>{trabajando === 'prueba' ? 'Enviando…' : 'Enviarme una prueba'}</button>
      <button className="primary-button" disabled={trabajando !== null || enviando || !estado?.suscriptores} onClick={() => setConfirmar(true)}><Send size={16} /> {enviando ? 'Ya se está enviando' : 'Enviar a los suscriptores'}</button>
    </div>
    <Modal open={confirmar} onClose={() => setConfirmar(false)} title="¿Enviar el correo a los suscriptores?" description={`Sale a ${estado?.suscriptores ?? 0} personas que aceptaron recibir novedades. No se puede deshacer.`}>
      <p className="text-sm leading-6 text-muted">Se manda de a 25 cada 15 minutos, solo de 9 a. m. a 8 p. m. Cada persona lo recibe una sola vez.{c?.completa ? ' Ya enviaste una campaña antes: quienes la recibieron ese mismo día no la reciben de nuevo, pero los demás sí.' : ''}</p>
      <div className="mt-5 flex justify-end gap-2"><button className="subtle-button" onClick={() => setConfirmar(false)}>Cancelar</button><button className="primary-button px-5" disabled={trabajando !== null} onClick={() => void iniciar()}>{trabajando === 'iniciar' ? 'Lanzando…' : 'Sí, enviar'}</button></div>
    </Modal>
  </section>
}
