import { CircleDollarSign, Globe, KeyRound, LogOut, Mail, Phone, UserRound } from 'lucide-react'
import { type FormEvent, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { CuentaShell, FilaMenu, Hoja, useCuenta } from '../../components/cuenta/CuentaShell'
import { actualizarCuenta, cambiarClave, cambiarCorreo, esDemo, salirCliente, subirAvatar, urlAvatar, type CuentaCliente } from '../../services/cuentaCliente.service'

type Campo = 'nombre' | 'correo' | 'telefono' | 'clave' | 'idioma' | 'moneda' | null

export function CuentaDatosPage() {
  const { cuenta, recargar } = useCuenta()
  const navigate = useNavigate()
  const [campo, setCampo] = useState<Campo>(null)
  const [subiendo, setSubiendo] = useState(false)
  const inputFoto = useRef<HTMLInputElement>(null)
  const avatar = urlAvatar(cuenta?.avatar_path)

  const elegirFoto = async (file: File | undefined) => {
    if (!file) return
    setSubiendo(true)
    try { await subirAvatar(file); await recargar(); toast.success('Foto actualizada.') }
    catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo subir la foto.') }
    finally { setSubiendo(false); if (inputFoto.current) inputFoto.current.value = '' }
  }
  const salir = async () => { await salirCliente(); navigate('/cuenta/ingresar', { replace: true }) }

  return <CuentaShell titulo="Datos personales" volver="/cuenta">
    <section className="hsp-rise mt-3 flex items-center gap-5">
      <span className="hsc-avatar">{avatar ? <img src={avatar} alt="" /> : <UserRound size={44} strokeWidth={1.2} />}</span>
      <div className="min-w-0">
        <strong className="block truncate text-[20px] font-semibold">{cuenta?.nombre || 'Tu nombre'}</strong>
        <span className="hsp-muted block truncate text-[13px]">{cuenta?.correo}</span>
        <button type="button" disabled={subiendo} onClick={() => inputFoto.current?.click()} className="hsp-btn hsp-btn--line mt-2.5 h-9 min-h-0 rounded-lg px-5 text-[12px]">{subiendo ? 'Subiendo…' : 'Editar foto'}</button>
        <input ref={inputFoto} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void elegirFoto(e.target.files?.[0])} />
      </div>
    </section>

    <h2 className="mb-2.5 mt-7 text-[15px] font-semibold">Información personal</h2>
    <div className="hsp-card hsp-divide overflow-hidden">
      <FilaMenu icono={<UserRound size={19} strokeWidth={1.6} />} etiqueta="Nombre completo" valor={cuenta?.nombre || 'Agregar'} onClick={() => setCampo('nombre')} />
      <FilaMenu icono={<Mail size={19} strokeWidth={1.6} />} etiqueta="Correo electrónico" valor={cuenta?.correo} onClick={() => setCampo('correo')} />
      <FilaMenu icono={<Phone size={19} strokeWidth={1.6} />} etiqueta="Teléfono" valor={cuenta?.telefono || 'Agregar'} onClick={() => setCampo('telefono')} />
    </div>

    <h2 className="mb-2.5 mt-6 text-[15px] font-semibold">Preferencias</h2>
    <div className="hsp-card hsp-divide overflow-hidden">
      <FilaMenu icono={<Globe size={19} strokeWidth={1.6} />} etiqueta="Idioma" valor={cuenta?.idioma === 'en' ? 'English' : 'Español'} onClick={() => setCampo('idioma')} />
      <FilaMenu icono={<CircleDollarSign size={19} strokeWidth={1.6} />} etiqueta="Moneda" valor={cuenta?.moneda === 'NIO' ? 'NIO - Córdoba nicaragüense' : 'USD - Dólar estadounidense'} onClick={() => setCampo('moneda')} />
    </div>

    <h2 className="mb-2.5 mt-6 text-[15px] font-semibold">Seguridad</h2>
    <div className="hsp-card hsp-divide overflow-hidden">
      <FilaMenu icono={<KeyRound size={19} strokeWidth={1.6} />} etiqueta="Cambiar contraseña" onClick={() => setCampo('clave')} />
      <FilaMenu icono={<LogOut size={19} strokeWidth={1.6} />} etiqueta="Cerrar sesión" onClick={() => void salir()} peligro />
    </div>

    {cuenta && <Editor campo={campo} cuenta={cuenta} onCerrar={() => setCampo(null)} onGuardado={async () => { setCampo(null); await recargar() }} />}
  </CuentaShell>
}

function Editor({ campo, cuenta, onCerrar, onGuardado }: { campo: Campo; cuenta: CuentaCliente; onCerrar: () => void; onGuardado: () => Promise<void> }) {
  const titulos: Record<Exclude<Campo, null>, string> = { nombre: 'Nombre completo', correo: 'Correo electrónico', telefono: 'Teléfono', clave: 'Cambiar contraseña', idioma: 'Idioma', moneda: 'Moneda' }
  return <Hoja abierta={campo !== null} onCerrar={onCerrar} titulo={campo ? titulos[campo] : undefined}>
    {campo && <FormCampo key={campo} campo={campo} cuenta={cuenta} onGuardado={onGuardado} />}
  </Hoja>
}

function FormCampo({ campo, cuenta, onGuardado }: { campo: Exclude<Campo, null>; cuenta: CuentaCliente; onGuardado: () => Promise<void> }) {
  const inicial = campo === 'nombre' ? cuenta.nombre : campo === 'correo' ? cuenta.correo : campo === 'telefono' ? cuenta.telefono ?? '' : ''
  const [valor, setValor] = useState(inicial)
  const [guardando, setGuardando] = useState(false)

  const guardar = async (event?: FormEvent, directo?: Partial<CuentaCliente>) => {
    event?.preventDefault()
    setGuardando(true)
    try {
      if (directo) await actualizarCuenta(directo)
      else if (campo === 'nombre') { if (valor.trim().length < 2) throw new Error('Escribí tu nombre completo.'); await actualizarCuenta({ nombre: valor.trim() }) }
      else if (campo === 'telefono') { if (!/^[0-9+ ()-]{7,25}$/.test(valor.trim())) throw new Error('Revisá el número (ej. +505 8888 8888).'); await actualizarCuenta({ telefono: valor.trim() }) }
      else if (campo === 'correo') {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor.trim())) throw new Error('Correo inválido.')
        if (valor.trim().toLowerCase() === cuenta.correo.toLowerCase()) return void (await onGuardado())
        if (esDemo) await actualizarCuenta({})
        else await cambiarCorreo(valor)
        toast.success('Te enviamos un enlace al correo nuevo para confirmar el cambio.')
      } else if (campo === 'clave') {
        if (valor.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.')
        if (!esDemo) await cambiarClave(valor)
        toast.success('Contraseña actualizada.')
      }
      if (campo !== 'correo' && campo !== 'clave') toast.success('Guardado.')
      await onGuardado()
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo guardar.') }
    finally { setGuardando(false) }
  }

  if (campo === 'idioma' || campo === 'moneda') {
    const opciones = campo === 'idioma'
      ? [{ v: 'es', t: 'Español', d: null }, { v: 'en', t: 'English', d: 'Próximamente: por ahora el sitio está en español.' }]
      : [{ v: 'USD', t: 'USD - Dólar estadounidense', d: null }, { v: 'NIO', t: 'NIO - Córdoba nicaragüense', d: 'Los precios se muestran en dólares; en córdobas se calculan al tipo de cambio del día al pagar.' }]
    const actual = campo === 'idioma' ? cuenta.idioma : cuenta.moneda
    return <div className="space-y-2">
      {opciones.map((o) => <button key={o.v} type="button" disabled={guardando} onClick={() => void guardar(undefined, { [campo]: o.v } as Partial<CuentaCliente>)} className={`hsc-option w-full text-left${actual === o.v ? ' is-on' : ''}`}>
        <span className="hsc-radio mt-0.5" aria-hidden />
        <span><strong className="block text-[14px]">{o.t}</strong>{o.d && <span className="hsp-muted block text-[12px] leading-5">{o.d}</span>}</span>
      </button>)}
    </div>
  }

  return <form onSubmit={(e) => void guardar(e)}>
    <label className="hsc-field">
      <span>{campo === 'clave' ? 'Nueva contraseña' : campo === 'correo' ? 'Correo nuevo' : campo === 'telefono' ? 'Número de WhatsApp' : 'Nombre y apellido'}</span>
      <input autoFocus value={valor} onChange={(e) => setValor(e.target.value)} type={campo === 'clave' ? 'password' : campo === 'correo' ? 'email' : campo === 'telefono' ? 'tel' : 'text'} autoComplete={campo === 'clave' ? 'new-password' : campo === 'correo' ? 'email' : campo === 'telefono' ? 'tel' : 'name'} placeholder={campo === 'telefono' ? '+505 8888 8888' : undefined} />
    </label>
    {campo === 'correo' && <p className="hsp-muted mt-2 text-[12px] leading-5">Por seguridad, el cambio se aplica cuando abrás el enlace que te enviamos al correo nuevo.</p>}
    <button disabled={guardando} className="hsp-btn mt-4 w-full">{guardando ? 'Guardando…' : 'Guardar'}</button>
  </form>
}
