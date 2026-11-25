export function srcNeedingRedTest(src: string[], base: string, git: (args: string[]) => string): string[]

export function testsFailOnBase(opts: {
  root: string
  base: string | null
  changed: string[]
  git: (args: string[]) => string
}): string | null
