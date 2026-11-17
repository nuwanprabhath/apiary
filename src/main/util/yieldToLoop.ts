export const yieldToLoop = (): Promise<void> => new Promise((resolve) => { setImmediate(resolve) })
