// Prints the baselined lint debt per rule: what `eslint-suppressions.json` (ESLint) and
// `stylelint-suppressions.json` still allow. The numbers may only go down — a new violation fails
// the lint, a fixed one must be pruned (`npm run lint:prune`). The architecture-drift skill reads
// this to report the trend between releases.
import { existsSync, readFileSync } from 'node:fs'

const totals = new Map()
for (const file of ['eslint-suppressions.json', 'stylelint-suppressions.json']) {
  if (!existsSync(file)) continue
  const data = JSON.parse(readFileSync(file, 'utf8'))
  for (const rules of Object.values(data)) {
    for (const [rule, entry] of Object.entries(rules)) {
      const count = typeof entry === 'object' && entry !== null && 'count' in entry ? entry.count : 1
      totals.set(rule, (totals.get(rule) ?? 0) + count)
    }
  }
}
const rows = [...totals].sort((a, b) => b[1] - a[1])
for (const [rule, count] of rows) console.log(`${String(count).padStart(5)}  ${rule}`)
console.log(`${String(rows.reduce((n, [, c]) => n + c, 0)).padStart(5)}  total`)
