import type { ExecFn } from '../../exec/run'

/**
 * The files a kind writes and reads, injected so `kinds.ts` stays free of Node modules: the
 * renderer's component fake imports the kinds for their fields. `kindHost.ts` has the real ones.
 */
export interface KindFiles {
  /** A folder only its owner may enter, made with its parents. */
  ensureDir: (dir: string) => void
  /** A script for the user's shell, mode 0700, replaced whole. */
  writeExecutable: (file: string, text: string) => void
  /** Pretty JSON for another program to read, replaced atomically. */
  writeJson: (file: string, data: unknown) => void
  readText: (file: string) => string
}

/** What a kind needs from outside itself: where its bundled program is, whether the machine has its tools, its files. */
export interface KindDeps {
  /** The vendored `mra` folder (`resources/residents/mra`, dev or packaged). */
  mraDir: () => string
  /** Runs a short command to see whether a tool exists and works (`file args`, in `cwd`). */
  exec: ExecFn
  /** The `PATH` its programs run under: Apiary's own plus where Homebrew puts `glab`. */
  searchPath: () => string
  files: KindFiles
}

const unwired = (): never => { throw new Error('Kind deps are not wired') }

/** For the renderer fake: the kinds' fields are real, nothing runs on the machine. */
export const UNWIRED_KIND_DEPS: KindDeps = {
  mraDir: () => 'resources/residents/mra',
  exec: () => Promise.reject(new Error('Kind deps are not wired')),
  searchPath: () => '',
  files: { ensureDir: unwired, writeExecutable: unwired, writeJson: unwired, readText: unwired },
}
