import { Globe, Link2, Unlink } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'

type Cuenta = { correo: string; verificada: boolean; nombre: string | null } | null

// "Cuenta web" del cliente (Mi cuenta en hauslineshopni.es). Los pedidos de este cliente se
// ven en su cuenta si: está asociado aquí, compró con sesión abierta, o tiene el MISMO correo
// verificado. Desde aquí el personal asocia/desasocia a mano (RPC asociar_cliente_cuenta).
export function CuentaWebCard({ clienteId, correoCliente }: { clienteId: string; correoCliente?: string | null }) {
  const [cuenta, setCuenta] = useState<Cuenta | undefined>(undefined)
  const [correo, setCorreo] = useState('')
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    if (!supabase) { setCuenta(null); return }
    const { data, error } = await supabase.rpc('cuenta_de_cliente', { p_cliente_id: clienteId })
    setCuenta(error ? null : (data as Cuenta))
  }, [clienteId])
  useEffect(() => { void Promise.resolve().then(cargar) }, [cargar])

  const asociar = async (event: FormEvent | null, valor: string) => {
    event?.preventDefault()
    if (!supabase) return
    setGuardando(true)
    try {
      const { error } = await supabase.rpc('asociar_cliente_cuenta', { p_cliente_id: clienteId, p_correo: valor })
      if (error) throw error
      toast.success(valor ? 'Cliente asociado a la cuenta web.' : 'Cuenta web desasociada.')
      setCorreo('')
      await cargar()
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : 'No se pudo actualizar la cuenta web.')
    } finally { setGuardando(false) }
  }

  if (cuenta === undefined) return null
  return <section className="form-section mt-5">
    <h2 className="flex items-center gap-2 font-semibold"><Globe size={18} className="text-accent" /> Cuenta web (Mi cuenta)</h2>
    {cuenta
      ? <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <strong>{cuenta.correo}</strong>
            <p className="mt-0.5 text-xs text-muted">{cuenta.verificada ? 'Correo verificado · ve sus pedidos en hauslineshopni.es/cuenta' : 'Correo SIN verificar todavía'}</p>
          </div>
          <button type="button" className="subtle-button px-4" disabled={guardando} onClick={() => { if (window.confirm('¿Desasociar esta cuenta web del cliente?')) void asociar(null, '') }}><Unlink size={15} /> Desasociar</button>
        </div>
      : <>
          <p className="mt-2 text-xs leading-5 text-muted">Sin cuenta asociada. {correoCliente ? <>Si el cliente crea su cuenta con <b>{correoCliente}</b> y lo verifica, sus pedidos le aparecen solos.</> : 'Si crea una cuenta, podés asociarla aquí con su correo.'}</p>
          <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => void asociar(e, correo.trim())}>
            <input type="email" className="min-w-0 flex-1" placeholder="Correo de la cuenta web del cliente" value={correo} onChange={(e) => setCorreo(e.target.value)} />
            <button className="primary-button px-4" disabled={guardando || !correo.trim()}><Link2 size={15} /> Asociar</button>
          </form>
        </>}
  </section>
}
