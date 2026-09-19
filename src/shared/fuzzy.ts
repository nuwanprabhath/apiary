const WORD_BOUNDARY = /[\s/\-_.]/

/**
 * Subsequence match with a bonus for contiguous runs and word-start hits.
 * Returns null when the query is not a subsequence of the target.
 */
export function fuzzyScore(query: string, target: string): number | null {
  if (query.length === 0) return 0
  const q = query.toLowerCase()
  const t = target.toLowerCase()

  let score = 0
  let qi = 0
  let previousIndex = -2

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue
    score += 1
    if (ti === previousIndex + 1) score += 4          // contiguous run
    if (ti === 0 || WORD_BOUNDARY.test(t[ti - 1])) score += 3  // word start
    previousIndex = ti
    qi++
  }

  return qi === q.length ? score : null
}
