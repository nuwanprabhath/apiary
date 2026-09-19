import { useEffect, useState } from 'react'

/** Settles on `value` only after it has stopped changing for `delayMs` — the search box's own
 *  state updates every keystroke; this is what decides when a query is worth acting on. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}
