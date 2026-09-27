/**
 * Wraps a single-argument synchronous function so repeated calls with the same argument only run
 * it once. Built for `AppService.tree()` (MAIN-10): `buildTree` asks `cwdExists` once per
 * *session*, not once per distinct cwd, so a folder with several sessions turned into that many
 * synchronous `existsSync` calls on every `tree()` — which every window calls on every
 * `treeChanged` broadcast (after every watcher pass, every index update). A fresh memo per `tree()`
 * call is enough: cheap to build, and it never has to be invalidated because nothing holds it
 * past the call that created it.
 */
export function memoize<T>(fn: (arg: string) => T): (arg: string) => T {
  const seen = new Map<string, T>()
  return (arg: string): T => {
    const cached = seen.get(arg)
    if (cached !== undefined) return cached
    const result = fn(arg)
    seen.set(arg, result)
    return result
  }
}
