import { useEffect, useState } from 'react'

const cache = new Map<string, unknown>()
const inflight = new Map<string, Promise<unknown>>()

export function loadData<T>(name: string): Promise<T> {
  if (cache.has(name)) return Promise.resolve(cache.get(name) as T)
  let p = inflight.get(name)
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}data/${name}.json`, { cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load ${name}.json (${r.status})`)
        return r.json()
      })
      .then((j) => {
        cache.set(name, j)
        return j
      })
    inflight.set(name, p)
  }
  return p as Promise<T>
}

/** Load one generated dataset (public/data/<name>.json). Returns null while loading. */
export function useData<T>(name: string): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(() => (cache.get(name) as T) ?? null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    loadData<T>(name)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(String(e)))
    return () => {
      live = false
    }
  }, [name])
  return { data, error }
}
