/** Narrows a value an indexed access may leave `undefined`; throws when it is absent. */
export function must<T>(value: T | undefined | null, what = 'value'): T {
  if (value === undefined || value === null) throw new Error(`expected ${what} to be present`)
  return value
}
