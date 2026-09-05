// Caché de consultas con "stale-while-revalidate" y persistencia en sessionStorage.
//
// Objetivo: que al entrar o recargar la web todo aparezca al instante. Guardamos la
// última respuesta buena en sessionStorage (sobrevive recargas dentro de la pestaña) y,
// cuando una página vuelve a pedir esos datos, devolvemos de inmediato lo último conocido
// mientras refrescamos en segundo plano. Cuando llega la versión fresca, avisamos con
// `onFresh` para que la vista se actualice sola.

type Entry<T = unknown> = {
  value?: T
  hasValue: boolean
  expiresAt: number
  promise?: Promise<T>
}

const cache = new Map<string, Entry>()
const STORAGE_PREFIX = 'hq:'

function persistedGet<T>(key: string): { value: T } | undefined {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + key)
    if (!raw) return undefined
    return { value: JSON.parse(raw) as T }
  } catch {
    return undefined
  }
}

function persistedSet(key: string, value: unknown) {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value))
  } catch {
    // sessionStorage lleno o no disponible: seguimos solo con memoria.
  }
}

function persistedDelete(key: string) {
  try {
    sessionStorage.removeItem(STORAGE_PREFIX + key)
  } catch {
    // sin acción
  }
}

export function cachedQuery<T>(
  key: string,
  loader: () => Promise<T>,
  ttlMs = 45_000,
  onFresh?: (value: T) => void,
): Promise<T> {
  const now = Date.now()
  let entry = cache.get(key) as Entry<T> | undefined

  // Sin nada en memoria: intenta recuperar lo último persistido (recarga de página).
  if (!entry) {
    const persisted = persistedGet<T>(key)
    if (persisted) entry = { value: persisted.value, hasValue: true, expiresAt: 0 }
  }

  // Dato fresco (dentro del TTL): sírvelo sin tocar la red.
  if (entry && entry.hasValue && entry.expiresAt > now) {
    return entry.promise ? entry.promise : Promise.resolve(entry.value as T)
  }

  const staleValue = entry?.hasValue ? entry.value : undefined
  const hasStale = entry?.hasValue ?? false

  // Reusa un refresco en curso si ya lo hay; si no, arranca uno.
  let refresh = entry?.promise
  if (!refresh) {
    const prevSerialized = hasStale ? safeStringify(staleValue) : undefined
    refresh = loader()
      .then((fresh) => {
        cache.set(key, { value: fresh, hasValue: true, expiresAt: Date.now() + ttlMs })
        persistedSet(key, fresh)
        // Solo avisa si cambió respecto a lo que ya se mostró, para no re-renderizar de gusto.
        if (onFresh && (!hasStale || safeStringify(fresh) !== prevSerialized)) onFresh(fresh)
        return fresh
      })
      .catch((error) => {
        // No envenenamos la caché: permite reintentar en la próxima llamada.
        const current = cache.get(key) as Entry<T> | undefined
        if (current) current.promise = undefined
        if (!hasStale) cache.delete(key)
        throw error
      })
    cache.set(key, { value: staleValue, hasValue: hasStale, expiresAt: now + ttlMs, promise: refresh })
  }

  // Si tenemos algo que mostrar ya, devuélvelo al instante y deja que el refresco corra.
  if (hasStale) {
    refresh.catch(() => undefined)
    return Promise.resolve(staleValue as T)
  }
  return refresh
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

export function invalidateCache(...keys: string[]) {
  keys.forEach((key) => {
    cache.delete(key)
    persistedDelete(key)
  })
}

// Borra todas las claves que empiezan con alguno de los prefijos dados. Útil para claves
// parametrizadas (por periodo o rango de fechas), p. ej. "resumen:..." o "caja:...".
export function invalidateCachePrefix(...prefixes: string[]) {
  for (const key of Array.from(cache.keys())) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) invalidateCache(key)
  }
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const storageKey = sessionStorage.key(i)
      if (!storageKey || !storageKey.startsWith(STORAGE_PREFIX)) continue
      const bareKey = storageKey.slice(STORAGE_PREFIX.length)
      if (prefixes.some((prefix) => bareKey.startsWith(prefix))) sessionStorage.removeItem(storageKey)
    }
  } catch {
    // sessionStorage no disponible: la memoria ya quedó limpia.
  }
}

// Invalida todo lo relacionado con dinero: se llama tras registrar/editar/borrar pagos,
// gastos, movimientos, inversiones o aperturas de caja, para que saldos y resúmenes nunca
// queden desactualizados.
export function invalidateComercial() {
  invalidateCache('pedidos', 'inversiones', 'movimientos', 'pagos', 'gastos', 'cuentas', 'recibido-mes')
  invalidateCachePrefix('resumen:', 'caja:')
}
