// Recarga la página para recuperarse de un chunk viejo tras un deploy, pero como MUCHO una
// vez cada `ventanaMs`, para no entrar en un bucle de recargas si el problema persiste.
// Guarda la marca de tiempo de la última recarga en sessionStorage. Devuelve true si recargó.
export function recargarUnaVez(ventanaMs = 15_000): boolean {
  const clave = 'hausline_reload_at'
  try {
    const ultima = Number(sessionStorage.getItem(clave) || 0)
    if (Date.now() - ultima < ventanaMs) return false
    sessionStorage.setItem(clave, String(Date.now()))
    window.location.reload()
    return true
  } catch {
    // Sin sessionStorage (modo privado, etc.): recarga igual, el navegador corta el bucle.
    window.location.reload()
    return true
  }
}
