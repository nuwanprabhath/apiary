/** Lets I/O and timers run between slices of a long loop. */
export const yieldToLoop = (): Promise<void> => new Promise((resolve) => { setImmediate(resolve) })
