/** POSIX single-quote escaping, so a path or option value with a space or a quote in it survives
 *  reaching a shell. The one definition: `resumeCommand.ts` and `update/capability.ts` import it. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
