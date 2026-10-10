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
