/**
 * Renders by key, once each: a finished render is kept (and shared by everyone asking while it
 * runs). A failed one (null) is tried again straight away, once, and then forgotten, so the next
 * ask renders again. A render can fail for a moment (the GPU busy, its context lost) on a machine
 * that otherwise renders fine; keeping that null left a pet flat until Apiary restarted.
 */
export function rememberRenders<T>(render: (key: string) => Promise<T | null>): (key: string) => Promise<T | null> {
  const kept = new Map<string, Promise<T | null>>()
  return (key) => {
    const known = kept.get(key)
    if (known !== undefined) return known
    const result = render(key).then((first) => first ?? render(key))
    kept.set(key, result)
    void result.then((done) => { if (done === null && kept.get(key) === result) kept.delete(key) })
    return result
  }
}
