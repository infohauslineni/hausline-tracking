type CacheEntry<T> = {
  expiresAt: number
  promise: Promise<T>
}

const cache = new Map<string, CacheEntry<unknown>>()

export function cachedQuery<T>(key: string, loader: () => Promise<T>, ttlMs = 45_000): Promise<T> {
  const current = cache.get(key) as CacheEntry<T> | undefined
  if (current && current.expiresAt > Date.now()) return current.promise

  const promise = loader().catch((error) => {
    cache.delete(key)
    throw error
  })
  cache.set(key, { expiresAt: Date.now() + ttlMs, promise })
  return promise
}

export function invalidateCache(...keys: string[]) {
  keys.forEach((key) => cache.delete(key))
}
