// Autorización compartida de los endpoints del panel (el guion bajo evita que Vercel lo
// publique como función). Desde que los clientes tienen cuenta ("Mi cuenta" de la tienda)
// en este mismo proyecto Supabase, un JWT válido NO basta: hay que ser personal activo.

// Devuelve el usuario si el token es de un admin/operador activo; si no, null.
export async function personalActivo(client, token, roles = ['admin', 'operador']) {
  if (!token) return null
  const { data } = await client.auth.getUser(token).catch(() => ({ data: { user: null } }))
  const user = data?.user
  if (!user) return null
  const { data: perfil } = await client.from('perfiles').select('rol, activo').eq('id', user.id).maybeSingle()
  if (!perfil || !perfil.activo || !roles.includes(perfil.rol)) return null
  return user
}
