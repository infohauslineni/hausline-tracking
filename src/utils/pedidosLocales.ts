// "Mis pedidos" SIN cuenta: recordamos en este dispositivo los códigos que el cliente ya
// consultó, para que pueda volver a todos sus pedidos desde un solo lugar sin registrarse.
// (Las cuentas con historial entre dispositivos son una segunda fase; esto funciona ya.)
const KEY = 'hausline.pedidos.recientes'
const MAX = 30

export type PedidoLocal = { codigo: string; visto: string }

function leer(): PedidoLocal[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data.filter((item) => item && typeof item.codigo === 'string') : []
  } catch { return [] }
}

export function pedidosGuardados(): PedidoLocal[] {
  // Más recientes primero.
  return leer().sort((a, b) => (b.visto ?? '').localeCompare(a.visto ?? ''))
}

export function recordarPedido(codigo: string) {
  const code = codigo.trim().toUpperCase()
  if (!/^HS\d{6}$/.test(code)) return
  try {
    const actual = leer().filter((item) => item.codigo !== code)
    const siguiente = [{ codigo: code, visto: new Date().toISOString() }, ...actual].slice(0, MAX)
    localStorage.setItem(KEY, JSON.stringify(siguiente))
  } catch { /* modo privado / storage bloqueado: seguimos sin historial */ }
}

export function olvidarPedido(codigo: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(leer().filter((item) => item.codigo !== codigo.trim().toUpperCase())))
  } catch { /* noop */ }
}
