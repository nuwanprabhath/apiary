/** `value` once it is proved present; a test that expected it fails here, with what it expected. */
export function must<T>(value: T | undefined, what = 'value'): T {
  if (value === undefined) throw new Error(`expected ${what} to be present`)
  return value
}

/** `items[index]`, proved present. */
export function at<T>(items: readonly T[], index: number): T {
  return must(items[index], `item ${index} of ${items.length}`)
}
