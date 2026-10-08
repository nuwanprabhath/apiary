// Prints the Node and component coverage totals as a Markdown table, for CI's job summary.
// Reads the `json-summary` reports both Vitest configs write; a missing one is skipped.
import { existsSync, readFileSync } from 'node:fs'

const KEYS = ['lines', 'statements', 'functions', 'branches']
for (const [label, file] of [['Unit + integration', 'coverage/node/coverage-summary.json'], ['Component', 'coverage/component/coverage-summary.json']]) {
  if (!existsSync(file)) continue
  const total = JSON.parse(readFileSync(file, 'utf8')).total
  console.log(`### Coverage: ${label}\n\n| Metric | % |\n| --- | --- |`)
  for (const k of KEYS) console.log(`| ${k} | ${String(total[k].pct)} |`)
  console.log('')
}
