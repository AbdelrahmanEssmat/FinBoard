export function groupBy<T, K extends string | number>(items: T[], key: (item: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>
  for (const it of items) {
    const k = key(it)
    ;(out[k] ??= []).push(it)
  }
  return out
}

export function byId<T extends { id: string }>(items: T[] | undefined): Map<string, T> {
  const m = new Map<string, T>()
  for (const it of items ?? []) m.set(it.id, it)
  return m
}
