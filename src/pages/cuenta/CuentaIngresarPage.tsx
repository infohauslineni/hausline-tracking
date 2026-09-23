import { ArrowLeft, Eye, EyeOff, MailCheck } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '../../contexts/AuthContext'
import { cambiarClave, esDemo, ingresarCliente, recuperarClave, registrarCliente, TIENDA_URL } from '../../services/cuentaCliente.service'

type Modo = 'ingresar' | 'crear' | 'recuperar' | 'nueva-clave' | 'revisa-correo'

const mensajeError = (error: unknown) => {
  const msg = error instanceof Error ? error.message : ''
  if (/invalid login|invalid credentials/i.test(msg)) return 'Correo o contraseña incorrectos.'
  if (/email not confirmed/i.test(msg)) return 'Confirmá tu correo: te enviamos un enlace al registrarte.'
  if (/already registered|already exists/i.test(msg)) return 'Ya existe una cuenta con ese correo. Ingresá o recuperá tu contraseña.'
  if (/password/i.test(msg) && /characters|short|weak/i.test(msg)) return 'La contraseña es muy débil: usá al menos 8 caracteres.'
  if (/rate|too many/i.test(msg)) return 'Demasiados intentos. Esperá un momento e intentá de nuevo.'
  if (/signups not allowed|signup is disabled/i.test(msg)) return 'El registro de cuentas todavía no está habilitado.'
  return msg || 'Algo salió mal. Intentá de nuevo.'
}

export function CuentaIngresarPage() {
  const { user, loading } = useAuth()
  const [params] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const destino = (location.state as { from?: string } | null)?.from ?? '/cuenta'
  const [modo, setModo] = useState<Modo>(params.get('recuperar') ? 'nueva-clave' : params.get('crear') ? 'crear' : 'ingresar')
  const [nombre, setNombre] = useState('')
  const [correo, setCorreo] = useState('')
  const [telefono, setTelefono] = useState('')
  const [clave, setClave] = useState('')
  const [ver, setVer] = useState(false)
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    const html = document.documentElement
    const prev = html.style.background
    html.style.background = '#f6f6f4'
    return () => { html.style.background = prev }
  }, [])

  // Con sesión ya abierta (y sin estar poniendo una contraseña nueva) va directo al panel.
  if (esDemo || (!loading && user && modo !== 'nueva-clave')) return <Navigate to={destino} replace />

  const enviar = async (event: FormEvent) => {
    event.preventDefault()
    setEnviando(true)
    try {
      if (modo === 'ingresar') { await ingresarCliente(correo, clave); navigate(destino, { replace: true }) }
      else if (modo === 'crear') {
        if (nombre.trim().length < 2) throw new Error('Escribí tu nombre completo.')
        if (clave.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.')
        if (telefono && !/^[0-9+ ()-]{7,25}$/.test(telefono.trim())) throw new Error('Revisá tu número de WhatsApp.')
        const { requiereConfirmacion } = await registrarCliente({ nombre, correo, telefono, password: clave })
        if (requiereConfirmacion) setModo('revisa-correo')
        else { toast.success('¡Bienvenido a HAUSLINE!'); navigate(destino, { replace: true }) }
      } else if (modo === 'recuperar') { await recuperarClave(correo); setModo('revisa-correo') }
      else if (modo === 'nueva-clave') {
        if (clave.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.')
        await cambiarClave(clave)
        toast.success('Contraseña actualizada.')
        navigate('/cuenta', { replace: true })
      }
    } catch (error) { toast.error(mensajeError(error)) }
    finally { setEnviando(false) }
  }

  const titulo = { ingresar: 'Ingresá a tu cuenta', crear: 'Creá tu cuenta', recuperar: 'Recuperá tu contraseña', 'nueva-clave': 'Nueva contraseña', 'revisa-correo': 'Revisá tu correo' }[modo]

  return <main className="hs-portal hsc min-h-screen">
    <div className="mx-auto w-full max-w-md px-5 pb-12">
      <header className="relative flex h-16 items-center justify-center">
        <a href={TIENDA_URL} className="hsc-iconbtn absolute left-0 -ml-2" aria-label="Volver a la tienda"><ArrowLeft size={20} /></a>
        <span className="hsc-logo">HAUSLINE</span>
      </header>

      <section className="hsp-rise pt-6">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{titulo}</h1>
        <p className="hsp-muted mt-1.5 text-[13px] leading-5">
          {modo === 'crear' ? 'Seguí tus pedidos, guardá tus direcciones y tu lista de deseos en un solo lugar.'
            : modo === 'recuperar' ? 'Te enviamos un enlace para crear una contraseña nueva.'
            : modo === 'nueva-clave' ? 'Escribí la contraseña nueva para tu cuenta.'
            : modo === 'revisa-correo' ? '' : 'Tus pedidos, direcciones y favoritos te esperan.'}
        </p>
      </section>

      {modo === 'revisa-correo'
        ? <div className="hsp-card hsp-rise mt-6 p-6 text-center">
            <MailCheck size={30} strokeWidth={1.4} className="mx-auto" style={{ color: '#16a34a' }} />
            <p className="mt-3 text-[14px] font-semibold">Te enviamos un correo a {correo}</p>
            <p className="hsp-muted mx-auto mt-1.5 max-w-xs text-[12px] leading-5">Abrí el enlace del correo para continuar. Si no lo ves, revisá la carpeta de spam o promociones.</p>
            <button type="button" onClick={() => setModo('ingresar')} className="hsp-btn hsp-btn--line mt-5 h-11 min-h-0 text-[13px]">Volver a ingresar</button>
          </div>
        : <form onSubmit={(e) => void enviar(e)} className="hsp-rise mt-6" style={{ animationDelay: '40ms' }}>
            {modo === 'crear' && <label className="hsc-field mb-3 block"><span>Nombre completo</span><input value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="name" required /></label>}
            {modo !== 'nueva-clave' && <label className="hsc-field mb-3 block"><span>Correo electrónico</span><input type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} autoComplete="email" required /></label>}
            {modo === 'crear' && <label className="hsc-field mb-3 block"><span>WhatsApp <i className="hsp-faint not-italic">(opcional)</i></span><input type="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} autoComplete="tel" placeholder="+505 8888 8888" /></label>}
            {modo !== 'recuperar' && <label className="hsc-field mb-1 block"><span>{modo === 'nueva-clave' ? 'Contraseña nueva' : 'Contraseña'}</span>
              <span className="relative block">
                <input type={ver ? 'text' : 'password'} value={clave} onChange={(e) => setClave(e.target.value)} autoComplete={modo === 'ingresar' ? 'current-password' : 'new-password'} required minLength={modo === 'ingresar' ? 1 : 8} className="pr-11" />
                <button type="button" onClick={() => setVer((v) => !v)} className="hsc-iconbtn absolute right-1 top-1/2 -translate-y-1/2" aria-label={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'}>{ver ? <EyeOff size={17} /> : <Eye size={17} />}</button>
              </span>
            </label>}
            {modo === 'ingresar' && <button type="button" onClick={() => setModo('recuperar')} className="hsc-link mt-1">¿Olvidaste tu contraseña?</button>}
            {modo === 'crear' && <p className="hsp-faint mt-1 text-[11px]">Mínimo 8 caracteres. Al crear tu cuenta aceptás los <Link to="/terminos" className="underline">Términos</Link> y la <Link to="/privacidad" className="underline">Privacidad</Link>.</p>}

            <button disabled={enviando} className="hsp-btn mt-6 w-full">{enviando ? 'Un momento…' : modo === 'ingresar' ? 'Ingresar' : modo === 'crear' ? 'Crear cuenta' : modo === 'recuperar' ? 'Enviar enlace' : 'Guardar contraseña'}</button>

            <p className="hsp-muted mt-5 text-center text-[13px]">
              {modo === 'ingresar'
                ? <>¿No tenés cuenta? <button type="button" onClick={() => setModo('crear')} className="font-semibold underline underline-offset-2" style={{ color: 'var(--ink)' }}>Creala gratis</button></>
                : modo !== 'nueva-clave' && <>¿Ya tenés cuenta? <button type="button" onClick={() => setModo('ingresar')} className="font-semibold underline underline-offset-2" style={{ color: 'var(--ink)' }}>Ingresá</button></>}
            </p>
          </form>}

      <div className="mt-10 border-t pt-5 text-center" style={{ borderColor: 'var(--hair)' }}>
        <p className="hsp-muted text-[12px]">¿Solo querés ver un pedido?</p>
        <Link to="/pedido" className="hsc-link mt-1 inline-block">Seguir mi pedido con el código</Link>
      </div>
    </div>
  </main>
}
