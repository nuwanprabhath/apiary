interface Base { name: string, description: string, message: string, files: readonly string[], allow?: readonly string[] }
export type Sanctioned =
  | (Base & { kind: 'syntax', selectors: readonly string[] })
  | (Base & { kind: 'import', sources: readonly (string | RegExp)[], importNames?: readonly string[] })
  | (Base & { kind: 'global', globals: readonly string[] })
export const SANCTIONED: readonly Sanctioned[]
