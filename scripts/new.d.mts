// Types for new.mjs, so tests/unit/newGenerator.test.ts stays strict.
export type Kind = 'ipc' | 'store' | 'feature' | 'service'
export function validateName(name: unknown): string
export function parseArgs(argv: string[]): { kind: Kind; name: string; flags: Record<string, string> }
export function generate(opts: { kind: Kind; name: string; flags?: Record<string, string>; root: string }): {
  created: string[]
  edited: string[]
  next: string
}
