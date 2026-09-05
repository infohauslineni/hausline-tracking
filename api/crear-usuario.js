import { createClient } from '@supabase/supabase-js'

// Crea la cuenta de un EMPLEADO (rol operador) desde el panel. El navegador no puede crear
// usuarios de auth de forma segura (requiere la llave de servicio), así que lo hace este
// endpoint. Solo un ADMIN puede llamarlo: se valida su JWT y su rol antes de crear nada.
//
// El trigger crear_perfil_nuevo_usuario ya inserta el perfil con rol 'operador' por defecto;
// aquí además fijamos el nombre. La seguridad de qué ve el operador está en el RLS (migración
// 202609040001_roles_operador.sql), no en este endpoint.
export const config = { maxDuration: 30 }

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ ok: false, error: 'Method not allowed' })
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return response.status(500).json({ ok: false, error: 'Missing server configuration' })
  }
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // 1) Autenticación: el JWT del que llama.
  const authorization = request.headers?.authorization ?? request.headers?.get?.('authorization') ?? ''
  const token = String(authorization).replace(/^Bearer\s+/i, '').trim()
  if (!token) return response.status(401).json({ ok: false })
  const { data: userData } = await admin.auth.getUser(token).catch(() => ({ data: { user: null } }))
  const solicitante = userData?.user
  if (!solicitante) return response.status(401).json({ ok: false })

  // 2) Autorización: solo un admin activo puede crear empleados.
  const { data: perfil } = await admin.from('perfiles').select('rol, activo').eq('id', solicitante.id).maybeSingle()
  if (!perfil || !perfil.activo || perfil.rol !== 'admin') {
    return response.status(403).json({ ok: false, error: 'Solo un administrador puede crear usuarios.' })
  }

  // 3) Datos del nuevo empleado.
  const body = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : (request.body ?? {})
  const correo = String(body.correo ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')
  const nombre = String(body.nombre ?? '').trim()
  if (!correo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return response.status(400).json({ ok: false, error: 'Correo inválido.' })
  if (password.length < 8) return response.status(400).json({ ok: false, error: 'La contraseña debe tener al menos 8 caracteres.' })

  try {
    const { data: creado, error } = await admin.auth.admin.createUser({
      email: correo,
      password,
      email_confirm: true,
      user_metadata: { nombre },
    })
    if (error) {
      const msg = /registered|exists/i.test(error.message || '') ? 'Ya existe una cuenta con ese correo.' : error.message
      return response.status(400).json({ ok: false, error: msg })
    }
    // Asegura nombre y rol operador en el perfil (el trigger ya lo creó como operador).
    if (creado?.user?.id) {
      await admin.from('perfiles').update({ nombre, rol: 'operador', activo: true }).eq('id', creado.user.id)
    }
    return response.status(200).json({ ok: true, id: creado?.user?.id ?? null })
  } catch (error) {
    console.error('crear-usuario: falló', error?.message)
    return response.status(502).json({ ok: false, error: 'No se pudo crear el usuario.' })
  }
}
