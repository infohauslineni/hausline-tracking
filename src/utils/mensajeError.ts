// Texto de un error para mostrarlo: los de Supabase no son "Error" (son objetos con message,
// details y hint), por eso antes salía solo "No se pudo registrar el pago." sin la causa.
export function mensajeError(e: unknown): string {
  if (e instanceof Error && e.message) return e.message
  if (e && typeof e === 'object') {
    const o = e as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown; error_description?: unknown }
    const partes = [o.message ?? o.error_description, o.details, o.hint].filter((x) => typeof x === 'string' && x.trim()) as string[]
    if (partes.length) return partes.join(' · ') + (o.code ? ` (${String(o.code)})` : '')
  }
  return typeof e === 'string' && e ? e : 'error desconocido'
}
