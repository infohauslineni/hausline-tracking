// Registro de correos enviados (tabla email_eventos, migración 202609240001) con candado
// anti-duplicados: antes de mandar un correo "reservamos" su clave única (p. ej.
// "estado:HS123456:despachado"); si ya existía, ese correo ya salió y no se repite. Si el envío
// falla, se guarda el error y se libera la clave para que un reintento sí pueda mandarlo.
//
// Usa la llave de servicio (solo en el servidor). Si falta configuración o la tabla aún no
// existe, NO bloquea el correo: devuelve { id: null, duplicado: false } y se envía igual.

function cfg() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  return url && key ? { url, headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' } } : null
}

export async function reservarEmail({ clave, tipo, estado = null, codigo = null, destinatario = null, userId = null }) {
  const c = cfg()
  if (!c) return { id: null, duplicado: false }
  try {
    const qs = clave ? '?on_conflict=clave' : ''
    const res = await fetch(`${c.url}/rest/v1/email_eventos${qs}`, {
      method: 'POST',
      headers: { ...c.headers, prefer: `return=representation${clave ? ',resolution=ignore-duplicates' : ''}` },
      body: JSON.stringify({ clave: clave ?? null, tipo, estado, codigo, destinatario, user_id: userId }),
    })
    if (!res.ok) { console.error('email_eventos: no se pudo registrar', res.status, await res.text().catch(() => '')); return { id: null, duplicado: false } }
    const filas = await res.json().catch(() => [])
    // Con ignore-duplicates, una clave repetida no inserta nada → ya se había enviado.
    if (clave && Array.isArray(filas) && filas.length === 0) return { id: null, duplicado: true }
    return { id: filas?.[0]?.id ?? null, duplicado: false }
  } catch (error) {
    console.error('email_eventos: error', error?.message)
    return { id: null, duplicado: false }
  }
}

export async function cerrarEmail(id, error = null) {
  const c = cfg()
  if (!c || !id) return
  try {
    await fetch(`${c.url}/rest/v1/email_eventos?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { ...c.headers, prefer: 'return=minimal' },
      body: JSON.stringify(error
        ? { error: String(error).slice(0, 500), clave: null } // libera el candado para reintentar
        : { enviado_at: new Date().toISOString(), error: null }),
    })
  } catch (e) {
    console.error('email_eventos: no se pudo cerrar', e?.message)
  }
}
