// El seguimiento público del cliente vive en la TIENDA (hauslineshopni.es/pedido/?c=HS000123).
// Esta app (hausline-tracking) es solo el panel privado: nunca mandamos clientes aquí.
const TIENDA = (import.meta.env.VITE_TIENDA_URL ?? 'https://hauslineshopni.es').replace(/\/$/, '')

export function urlSeguimientoCliente(codigo?: string | null) {
  const code = String(codigo ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  return code ? `${TIENDA}/pedido/?c=${encodeURIComponent(code)}` : `${TIENDA}/pedido/`
}
