import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { dropOuterGitEnv } from '../../fixtures/outerGitEnv'

const ROOT = resolve(__dirname, '../../..')
const FIRST_LINE = "import './tests/fixtures/outerGitEnv'"

describe('no test run can write to the repository it is run from', () => {
  it('every vitest and playwright config drops the outer GIT_DIR before anything else loads', () => {
    const configs = readdirSync(ROOT).filter((f) => /^(vitest|playwright)(\.[\w-]+)?\.config\.ts$/.test(f))
    expect(configs.length).toBeGreaterThan(5)
    const missing = configs.filter((f) => readFileSync(join(ROOT, f), 'utf8').split('\n')[0] !== FIRST_LINE)
    expect(missing, `make \`${FIRST_LINE}\` the first line of these configs: a test that inherits GIT_DIR (git bisect run, a worktree hook) writes its fixture repos' config into this repo`).toEqual([])
  })

  it('drops the variables that point git at another repository, and keeps the rest', () => {
    const env: NodeJS.ProcessEnv = { GIT_DIR: '/repo/.git', GIT_INDEX_FILE: '/repo/.git/index', GIT_WORK_TREE: '/repo', GIT_CONFIG_GLOBAL: '/tmp/gitconfig', PATH: '/bin' }
    dropOuterGitEnv(env)
    expect(env).toEqual({ GIT_CONFIG_GLOBAL: '/tmp/gitconfig', PATH: '/bin' })
  })
})
