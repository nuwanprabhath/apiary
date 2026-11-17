/**
 * The one way a unit, integration or component test measures time (`timing-via-fastest-run`).
 *
 * A budget checked against a single run fails whenever the machine is busy: another suite, an agent,
 * a GC pause or a sleeping laptop stretch that one run. The fastest of several runs is what the code
 * costs; a real slowdown (an O(n²) walk) slows every run, so it still fails.
 */
export function fastestMs(work: () => unknown, runs = 5): number {
  let fastest = Number.POSITIVE_INFINITY
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now()
    work()
    fastest = Math.min(fastest, performance.now() - started)
  }
  return fastest
}
