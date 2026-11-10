#!/usr/bin/env node
// `node scripts/ui-diff.mjs [--base <rev>]`: compares the UI review screenshots of this tree with
// those of a base revision (default: the parent commit). It makes a git worktree of the base, runs
// `npm ci` and `npm run ui:review` in both trees (same machine, browser and fonts), compares
// ui-review/shots, writes ui-review/diff/index.html and removes the worktree. Report only: it exits 0
// whatever it finds. No image is committed.
//
// `pixelmatch` and `pngjs` are loaded only when a comparison runs, so the pure part below is testable
// without them.
import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** A pixel ratio under this is rendering noise, not a change. */
export const NOISE = 0.001

const pngs = (/** @type {string} */ dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.png')).sort() : [])

/**
 * Lists the PNGs added, removed and changed between two folders.
 * @param {string} beforeDir
 * @param {string} afterDir
 * @param {{ readPng: (path: string) => { width: number, height: number }, countDiff: (a: any, b: any) => number }} io
 * @returns {{ added: string[], removed: string[], changed: { file: string, ratio: number }[] }}
 */
export function compareShots(beforeDir, afterDir, io) {
  const before = pngs(beforeDir)
  const after = pngs(afterDir)
  const added = after.filter((f) => !before.includes(f))
  const removed = before.filter((f) => !after.includes(f))
  /** @type {{ file: string, ratio: number }[]} */
  const changed = []
  for (const file of after.filter((f) => before.includes(f))) {
    const a = io.readPng(join(beforeDir, file))
    const b = io.readPng(join(afterDir, file))
    const ratio = a.width !== b.width || a.height !== b.height ? 1 : io.countDiff(a, b) / (a.width * a.height)
    if (ratio >= NOISE) changed.push({ file, ratio })
  }
  return { added, removed, changed }
}

/** @param {{ added: string[], removed: string[], changed: { file: string, ratio: number }[] }} r */
export function summaryMarkdown(r) {
  if (!r.added.length && !r.removed.length && !r.changed.length) return '## UI diff\n\nNo visual change against the base.\n'
  const lines = ['## UI diff', '', 'Look at each state below; an empty list is expected for a change with no visual intent.', '']
  for (const c of r.changed) lines.push(`- changed ${(c.ratio * 100).toFixed(2)}%: \`${c.file}\``)
  for (const f of r.added) lines.push(`- added: \`${f}\``)
  for (const f of r.removed) lines.push(`- removed: \`${f}\``)
  return lines.join('\n') + '\n'
}

const esc = (/** @type {string} */ s) => s.replace(/[&<>"]/g, (c) => `&#${String(c.charCodeAt(0))};`)

async function realIo() {
  const { PNG } = (await import('pngjs')).default
  const pixelmatch = (await import('pixelmatch')).default
  const { readFileSync } = await import('node:fs')
  return {
    PNG,
    pixelmatch,
    readPng: (/** @type {string} */ p) => PNG.sync.read(readFileSync(p)),
    countDiff: (/** @type {any} */ a, /** @type {any} */ b) => pixelmatch(a.data, b.data, undefined, a.width, a.height, { threshold: 0.1 }),
  }
}

function writePage(/** @type {string} */ out, /** @type {ReturnType<typeof compareShots>} */ r, /** @type {Awaited<ReturnType<typeof realIo>>} */ io) {
  mkdirSync(join(out, 'before'), { recursive: true })
  mkdirSync(join(out, 'after'), { recursive: true })
  mkdirSync(join(out, 'delta'), { recursive: true })
  const cell = (/** @type {string} */ dir, /** @type {string} */ f) => `<td><img src="${dir}/${esc(f)}" loading="lazy" alt="${esc(dir)}"></td>`
  const rows = []
  for (const { file, ratio } of r.changed) {
    copyFileSync(join('ui-review', 'base-shots', file), join(out, 'before', file))
    copyFileSync(join('ui-review', 'shots', file), join(out, 'after', file))
    const a = io.readPng(join(out, 'before', file))
    const b = io.readPng(join(out, 'after', file))
    const d = new io.PNG({ width: a.width, height: a.height })
    io.pixelmatch(a.data, b.data, d.data, a.width, a.height, { threshold: 0.1 })
    writeFileSync(join(out, 'delta', file), io.PNG.sync.write(d))
    rows.push(`<tr><th colspan="3">${esc(file)} · ${(ratio * 100).toFixed(2)}%</th></tr><tr>${cell('before', file)}${cell('after', file)}${cell('delta', file)}</tr>`)
  }
  const list = (/** @type {string} */ t, /** @type {string[]} */ fs) => (fs.length ? `<p>${t}: ${fs.map(esc).join(', ')}</p>` : '')
  writeFileSync(join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>UI diff</title>
<style>body{font:14px sans-serif;margin:16px}img{max-width:32vw;border:1px solid #888}th{text-align:left;padding-top:16px}</style>
<h1>UI diff</h1>${list('added', r.added)}${list('removed', r.removed)}<table><tr><td>before</td><td>after</td><td>difference</td></tr>${rows.join('')}</table>`)
}

async function main() {
  const args = process.argv.slice(2)
  const base = args[args.indexOf('--base') + 1] ?? 'HEAD~1'
  const git = (/** @type {string[]} */ a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
  const tree = resolve('.ui-diff-base')
  const run = (/** @type {string} */ cwd, /** @type {string[]} */ a) => {
    const s = spawnSync('npm', a, { cwd, stdio: 'inherit' })
    if (s.status !== 0) console.warn(`ui-diff: npm ${a.join(' ')} exited ${String(s.status)} in ${cwd}`)
  }
  rmSync(tree, { recursive: true, force: true })
  git(['worktree', 'add', '--detach', tree, base])
  try {
    run(tree, ['ci'])
    run(tree, ['run', 'ui:review'])
    run('.', ['run', 'ui:review'])
    rmSync(join('ui-review', 'base-shots'), { recursive: true, force: true })
    mkdirSync(join('ui-review', 'base-shots'), { recursive: true })
    for (const f of pngs(join(tree, 'ui-review', 'shots'))) copyFileSync(join(tree, 'ui-review', 'shots', f), join('ui-review', 'base-shots', f))
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', tree], { stdio: 'inherit' })
  }
  const io = await realIo()
  const result = compareShots(join('ui-review', 'base-shots'), join('ui-review', 'shots'), io)
  const out = join('ui-review', 'diff')
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  writePage(out, result, io)
  const md = summaryMarkdown(result)
  console.log(md)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md)
  console.log(`ui-diff: open ${join(out, 'index.html')}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main()
