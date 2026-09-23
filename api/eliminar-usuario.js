import { createClient } from '@supabase/supabase-js'

// Elimina la cuenta de un empleado. Borrar un usuario de auth requiere la llave de servicio
// (el navegador no puede), así que lo hace este endpoint. Solo un ADMIN puede llamarlo, y
// nadie puede borrarse a sí mismo. Al borrar el usuario de auth, su fila en `perfiles` se va
// sola por el `on delete cascade`.
export const config = { maxDuration: 30 }

// También lo usa "Mi cuenta" de la tienda para que un CLIENTE elimine SU propia cuenta
// (body.propia = true): se borra su usuario (correo + contraseña), su perfil de cliente
// (teléfono, foto, idioma/moneda), sus direcciones y favoritos (on delete cascade) y su foto
// del storage. Sus PEDIDOS se conservan: clientes.user_id pasa a null y el pedido sigue en
// el panel. Va en este mismo endpoint porque el plan Hobby permite máximo 12 funciones.
const ORIGEN_TIENDA = 'https://hauslineshopni.es'

async function eliminarCuentaPropia(admin, solicitante, token, response) {
  // Nunca por esta vía una cuenta del personal.
  const { data: perfil } = await admin.from('perfiles').select('activo').eq('id', solicitante.id).maybeSingle()
  if (perfil?.activo) return response.status(403).json({ ok: false, error: 'Las cuentas del equipo no se eliminan desde aquí.' })
  // Exige un inicio de sesión RECIENTE (la tienda vuelve a pedir la contraseña justo antes).
  let iat = 0
  try { iat = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).iat || 0 } catch { iat = 0 }
  if (!iat || Date.now() / 1000 - iat > 600) return response.status(401).json({ ok: false, error: 'Confirmá tu contraseña para eliminar la cuenta.' })
  try {
    const { data: archivos } = await admin.storage.from('avatares').list(solicitante.id)
    if (archivos?.length) await admin.storage.from('avatares').remove(archivos.map((f) => `${solicitante.id}/${f.name}`))
  } catch (e) { console.error('eliminar-cuenta: fotos', e?.message) }
  const { error } = await admin.auth.admin.deleteUser(solicitante.id)
  if (error) return response.status(400).json({ ok: false, error: 'No se pudo eliminar la cuenta.' })
  return response.status(200).json({ ok: true })
}

export default async function handler(request, response) {
  // CORS solo para la tienda (Mi cuenta llama desde hauslineshopni.es).
  if ((request.headers?.origin ?? '') === ORIGEN_TIENDA) {
    response.setHeader('Access-Control-Allow-Origin', ORIGEN_TIENDA)
    response.setHeader('Vary', 'Origin')
    response.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  }
  if (request.method === 'OPTIONS') return response.status(204).end()
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

  const body = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : (request.body ?? {})
  if (body.propia === true) return eliminarCuentaPropia(admin, solicitante, token, response)

  // 2) Autorización: solo un admin activo puede eliminar usuarios.
  const { data: perfil } = await admin.from('perfiles').select('rol, activo').eq('id', solicitante.id).maybeSingle()
  if (!perfil || !perfil.activo || perfil.rol !== 'admin') {
    return response.status(403).json({ ok: false, error: 'Solo un administrador puede eliminar usuarios.' })
  }

  // 3) A quién borrar.
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
