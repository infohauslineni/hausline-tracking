import { ArrowLeft } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'

// "Volver": regresa a la pantalla de la que venías (Pedidos, Entregas, el cliente, el Resumen…)
// en vez de mandarte siempre a la lista. Si se entró directo por un enlace (no hay a dónde
// volver dentro del panel), va a `destino`.
export function Volver({ destino, etiqueta = 'Volver' }: { destino: string; etiqueta?: string }) {
  const navigate = useNavigate()
  const volver = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1); else navigate(destino)
  }
  return <button type="button" onClick={volver} className="mb-5 inline-flex items-center gap-2 text-xs text-muted transition hover:text-white"><ArrowLeft size={16} /> {etiqueta}</button>
}

// Recuerda en qué punto de cada pantalla estabas. Al VOLVER (atrás del navegador o el botón
// "Volver") te deja en el mismo lugar de la lista; al entrar a una pantalla nueva, arriba.
const posiciones = new Map<string, number>()
export function RestaurarScroll() {
  const location = useLocation()
  const tipo = useNavigationType()
  const clave = useRef(location.key)

  useEffect(() => {
    try { window.history.scrollRestoration = 'manual' } catch { /* navegador viejo */ }
    const guardar = () => { posiciones.set(clave.current, window.scrollY) }
    window.addEventListener('scroll', guardar, { passive: true })
    return () => window.removeEventListener('scroll', guardar)
  }, [])

  // Antes de que el navegador reacomode la página nueva (que puede ser más corta y "recortar" el
  // scroll), se cambia la clave: así ese recorte no pisa la posición guardada de la lista.
  useLayoutEffect(() => { clave.current = location.key }, [location.key])

  useEffect(() => {
    const destino = tipo === 'POP' ? posiciones.get(location.key) ?? 0 : 0
    if (destino <= 0) { window.scrollTo(0, 0); return }
    // La lista puede tardar un instante en pintarse (datos en caché): se reintenta hasta que la
    // página sea lo bastante alta para llegar al punto guardado, o pase 1,5 s.
    let vivo = true
    const inicio = performance.now()
    const intentar = () => {
      if (!vivo) return
      const alcanzable = document.documentElement.scrollHeight - window.innerHeight
      if (alcanzable >= destino - 2 || performance.now() - inicio > 1500) { window.scrollTo(0, Math.min(destino, Math.max(0, alcanzable))); return }
      requestAnimationFrame(intentar)
    }
    requestAnimationFrame(intentar)
    return () => { vivo = false }
  }, [location.key, tipo])

  return null
}
