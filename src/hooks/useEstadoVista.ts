import { useCallback, useState } from 'react'

// Como useState, pero RECUERDA el valor mientras dure la pestaña: filtros, búsquedas y pestañas de
// las listas. Así, al entrar a un pedido (o cliente) y volver, la lista queda como estaba en vez
// de arrancar de cero. `clave` identifica la vista (p. ej. "pedidos.busqueda").
const memoria = new Map<string, unknown>()
const PREFIJO = 'vista:'

function leer<T>(clave: string, inicial: T | (() => T)): T {
  if (memoria.has(clave)) return memoria.get(clave) as T
  try {
    const raw = sessionStorage.getItem(PREFIJO + clave)
    if (raw != null) return JSON.parse(raw) as T
  } catch { /* sin sessionStorage o dato viejo: se usa el inicial */ }
  return typeof inicial === 'function' ? (inicial as () => T)() : inicial
}

export function useEstadoVista<T>(clave: string, inicial: T | (() => T)) {
  const [valor, setValor] = useState<T>(() => leer(clave, inicial))
  const cambiar = useCallback((siguiente: T | ((previo: T) => T)) => {
    setValor((previo) => {
      const v = typeof siguiente === 'function' ? (siguiente as (p: T) => T)(previo) : siguiente
      memoria.set(clave, v)
      try { sessionStorage.setItem(PREFIJO + clave, JSON.stringify(v)) } catch { /* solo memoria */ }
      return v
    })
  }, [clave])
  return [valor, cambiar] as const
}

// Deja preparado el valor de una vista ANTES de entrar a ella (p. ej. el buscador global abre
// Compras libres ya filtrada por el código buscado).
export function fijarEstadoVista<T>(clave: string, valor: T) {
  memoria.set(clave, valor)
  try { sessionStorage.setItem(PREFIJO + clave, JSON.stringify(valor)) } catch { /* solo memoria */ }
}

// Borra lo recordado de una vista (p. ej. la búsqueda al salir de ese apartado).
export function olvidarVista(clave: string) {
  memoria.delete(clave)
  try { sessionStorage.removeItem(PREFIJO + clave) } catch { /* sin sessionStorage */ }
}

// Búsquedas de cada lista: se borran apenas se sale de la lista (a otro apartado o al entrar a un
// pedido / producto). Al volver, la lista arranca sin búsqueda.
const BUSQUEDAS: Record<string, string[]> = {
  '/pedidos': ['pedidos.busqueda'], '/clientes': ['clientes.busqueda'], '/logistica': ['logistica.busqueda'],
  '/stock': ['stock.busqueda'], '/ventas': ['ventas.busqueda'], '/tienda': ['tienda.q'],
}
export function limpiarBusquedasFueraDe(pathname: string) {
  const ruta = pathname.replace(/\/+$/, '') || '/'
  for (const [lista, claves] of Object.entries(BUSQUEDAS)) if (ruta !== lista) claves.forEach(olvidarVista)
}
