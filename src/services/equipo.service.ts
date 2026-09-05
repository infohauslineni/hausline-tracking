import { supabase } from '../lib/supabase'
import type { RolUsuario } from '../contexts/AuthContext'

export type MiembroEquipo = {
  id: string
  nombre: string
  correo: string
  rol: RolUsuario
  activo: boolean
  created_at: string
}

function requireSupabase() {
  if (!supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

// Lista los usuarios del panel. Solo el admin ve a todos (política perfiles_leer); un
// operador solo se vería a sí mismo, pero esta pantalla es solo-admin.
export async function listarEquipo(): Promise<MiembroEquipo[]> {
  const { data, error } = await requireSupabase()
    .from('perfiles')
    .select('id, nombre, correo, rol, activo, created_at')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as MiembroEquipo[]
}

// Crea un empleado (rol operador) vía el endpoint /api/crear-usuario, que valida que quien
// llama sea admin. Requiere la contraseña temporal que el empleado cambiará luego.
export async function crearOperador(input: { correo: string; password: string; nombre: string }) {
  const client = requireSupabase()
  const { data: sessionData } = await client.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) throw new Error('Sesión no disponible.')
  const res = await fetch('/api/crear-usuario', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.ok) throw new Error(json.error || 'No se pudo crear el usuario.')
  return json as { ok: true; id: string | null }
}

// Activa/desactiva a un usuario. Desactivar corta su acceso al instante: usuario_activo()
// pasa a false y el RLS le niega todo en la siguiente consulta.
export async function activarUsuario(id: string, activo: boolean) {
  const { error } = await requireSupabase().from('perfiles').update({ activo }).eq('id', id)
  if (error) throw error
}

// Cambia el rol de un usuario (admin ↔ operador). Usar con cuidado: dar 'admin' abre todas
// las finanzas.
export async function cambiarRol(id: string, rol: RolUsuario) {
  const { error } = await requireSupabase().from('perfiles').update({ rol }).eq('id', id)
  if (error) throw error
}
