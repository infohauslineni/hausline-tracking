import { createClient } from '@supabase/supabase-js'

// Elimina la cuenta de un empleado. Borrar un usuario de auth requiere la llave de servicio
// (el navegador no puede), así que lo hace este endpoint. Solo un ADMIN puede llamarlo, y
// nadie puede borrarse a sí mismo. Al borrar el usuario de auth, su fila en `perfiles` se va
// sola por el `on delete cascade`.
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

  // 2) Autorización: solo un admin activo puede eliminar usuarios.
  const { data: perfil } = await admin.from('perfiles').select('rol, activo').eq('id', solicitante.id).maybeSingle()
  if (!perfil || !perfil.activo || perfil.rol !== 'admin') {
    return response.status(403).json({ ok: false, error: 'Solo un administrador puede eliminar usuarios.' })
  }

  // 3) A quién borrar.
  const body = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : (request.body ?? {})
  const id = String(body.id ?? '').trim()
  if (!id) return response.status(400).json({ ok: false, error: 'Falta el usuario a eliminar.' })
  if (id === solicitante.id) return response.status(400).json({ ok: false, error: 'No podés eliminar tu propia cuenta.' })

  try {
    const { error } = await admin.auth.admin.deleteUser(id)
    if (error) return response.status(400).json({ ok: false, error: error.message })
    // Por si el perfil no se fue en cascada (defensa extra).
    await admin.from('perfiles').delete().eq('id', id)
    return response.status(200).json({ ok: true })
  } catch (error) {
    console.error('eliminar-usuario: falló', error?.message)
    return response.status(502).json({ ok: false, error: 'No se pudo eliminar el usuario.' })
  }
}
