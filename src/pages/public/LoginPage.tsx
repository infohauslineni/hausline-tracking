import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { z } from 'zod'
import { Brand } from '../../components/ui/Brand'
import { useAuth } from '../../contexts/AuthContext'

const schema = z.object({ email: z.email('Escribe un correo válido.'), password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres.') })
type FormValues = z.infer<typeof schema>

export function LoginPage() {
  const [showPassword, setShowPassword] = useState(false)
  const [sendingReset, setSendingReset] = useState(false)
  const { user, configured, signIn, resetPassword } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { register, handleSubmit, getValues, formState: { errors, isSubmitting } } = useForm<FormValues>({ resolver: zodResolver(schema) })
  if (user) return <Navigate to="/dashboard" replace />

  const onSubmit = async (values: FormValues) => {
    try {
      await signIn(values.email, values.password)
      toast.success('Sesión iniciada.')
      const target = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/dashboard'
      navigate(target, { replace: true })
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo iniciar sesión.') }
  }

  const handleReset = async () => {
    const email = getValues('email')
    if (!email) return toast.info('Escribe primero tu correo electrónico.')
    setSendingReset(true)
    try { await resetPassword(email); toast.success('Revisa tu correo para restablecer la contraseña.') }
    catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo enviar el correo.') }
    finally { setSendingReset(false) }
  }

  return <div className="relative grid min-h-screen overflow-hidden bg-app lg:grid-cols-[1.08fr_0.92fr]">
    <div className="login-glow" />
    <section className="relative hidden min-h-screen flex-col justify-between border-r border-line p-12 lg:flex xl:p-16">
      <Brand />
      <div className="max-w-xl"><p className="eyebrow">Operaciones Hausline</p><h1 className="mt-5 text-5xl font-semibold leading-[1.05] tracking-[-0.04em] xl:text-6xl">Cada pedido.<br /><span className="text-accent">Bajo control.</span></h1><p className="mt-6 max-w-md text-base leading-7 text-muted">Administra clientes, pedidos y trayectos internacionales desde un solo lugar.</p></div>
      <p className="text-xs text-muted">Acceso exclusivo para administradores autorizados.</p>
    </section>
    <section className="relative flex min-h-screen items-center justify-center px-5 py-10 sm:px-8"><div className="w-full max-w-[430px]">
      <div className="mb-10 lg:hidden"><Brand /></div><p className="eyebrow">Bienvenido de vuelta</p><h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em]">Inicia sesión</h2><p className="mt-2 text-sm text-muted">Ingresa tus credenciales de administrador.</p>
      {!configured && <div className="mt-6 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3 text-xs leading-5 text-amber-200">Conecta Supabase en el archivo <code>.env</code> para habilitar el acceso.</div>}
      <form className="mt-8 space-y-5" onSubmit={handleSubmit(onSubmit)}>
        <label className="field-label">Correo electrónico<div className="field-wrap"><Mail size={18} /><input type="email" autoComplete="email" placeholder="admin@hausline.com" {...register('email')} /></div>{errors.email && <span className="field-error">{errors.email.message}</span>}</label>
        <label className="field-label">Contraseña<div className="field-wrap"><LockKeyhole size={18} /><input type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="••••••••" {...register('password')} /><button type="button" aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>{errors.password && <span className="field-error">{errors.password.message}</span>}</label>
        <button type="button" disabled={sendingReset} onClick={handleReset} className="text-sm font-medium text-accent transition hover:text-white">¿Olvidaste tu contraseña?</button>
        <button className="primary-button w-full" type="submit" disabled={isSubmitting || !configured}>{isSubmitting ? 'Ingresando…' : 'Iniciar sesión'}<ArrowRight size={18} /></button>
      </form>
      <div className="mt-8 border-t border-line pt-6 text-center text-sm text-muted">¿Buscas tu pedido? <Link className="font-semibold text-white hover:text-accent" to="/tracking">Ir al rastreo público</Link></div>
    </div></section>
  </div>
}
