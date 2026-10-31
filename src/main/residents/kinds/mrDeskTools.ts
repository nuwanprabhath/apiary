import type { ExecFn } from '../../exec/run'

export type MissingTool = 'python3' | 'glab'

/**
 * Whether `python3` runs and `glab` is logged in, asked once through the exec layer rather than on
 * every status. The answer is unknown (and nothing is reported missing) until the first `refresh`.
 */
export class ToolProbe {
  /** Invalidated by `refresh`, which the resident service runs at start, when the options change and on each re-check while something is missing. */
  private found: Record<MissingTool, boolean> | null = null

  constructor(private readonly exec: ExecFn) {}

  async refresh(cwd: string): Promise<void> {
    const works = (file: string, args: string[]): Promise<boolean> =>
      this.exec(file, args, cwd).then(() => true, () => false)
    const [python3, glab] = await Promise.all([works('python3', ['--version']), works('glab', ['auth', 'status'])])
    this.found = { python3, glab }
  }

  /** The first tool the last `refresh` could not use, or null. */
  missing(): MissingTool | null {
    if (this.found === null) return null
    if (!this.found.python3) return 'python3'
    return this.found.glab ? null : 'glab'
  }
}
