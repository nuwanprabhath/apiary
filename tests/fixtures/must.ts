/** Proves a value an indexed access may leave out is present; a test that expected it fails here, naming what it expected. */
export function must<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) throw new Error(`expected ${what} to be present`)
  return value
}

/** `items[index]`, proved present. */
export function at<T>(items: readonly T[], index: number): T {
  return must(items[index], `item ${index} of ${items.length}`)
}

type Tuple<T, N extends number, R extends T[] = []> = R['length'] extends N ? R : Tuple<T, N, [...R, T]>

function hasLength<T, N extends number>(items: readonly T[], n: N): items is readonly T[] & Tuple<T, N> {
  return items.length >= n
}

/** The list, proven to hold at least `n` items; for `const [a, b] = take(list, 2)`. */
export function take<T, N extends number>(items: readonly T[], n: N): Tuple<T, N> {
  if (!hasLength(items, n)) throw new Error(`expected at least ${n} items, got ${items.length}`)
  return items
}
