---
name: prune-tests
description: Measure Apiary's test suite, find tests that cost time without catching anything the rest of the suite would not (no unique coverage, duplicates across layers, e2e cases that need no real app, one-off bug tests whose code is gone), merge, move, speed up or delete them, and report before and after numbers. Use for "tests are slow", "prune the tests", "reduce test time", "duplicate tests", or every few releases.
---

# Prune tests

The suite only grows: every fix adds a test and nothing takes one away. This skill is the taking
away. It is run every few releases, and it ends with numbers: wall time, tests, files and lines per
layer, and coverage, before and after, measured on the same machine.

A test is worth its cost when it would fail for a bug nothing else would catch. The work is finding
the tests that would not, then merging, moving, speeding up or deleting them, and **proving each
removal loses nothing**. Coverage finds candidates; it does not decide. A line that ran is not a
line anything checked.

## 0. Measure first

```sh
node .claude/skills/prune-tests/measure.mjs before        # all layers, one at a time, ~25 min
```

It writes `.agent-reports/test-stats/before/`: `summary.json`, each layer's per-file and per-test
seconds, and `slowest.md`. Nothing else may run on the machine meanwhile (no agents, no second
suite), or the times are noise. Read `slowest.md`: the time is never spread evenly, and the top 25
files of each layer usually hold most of it.

## 1. Find the time before the tests

In the first run (1.59, see `docs/testing.md`) most of the time won came from how the suite runs,
not from any one test. Check these first; each is cheap to find and changes no assertion:

- **Parallelism.** Compare each layer's wall time with the sum of its file times (`summary.json`:
  `seconds` against `fileSeconds`). Equal means it runs one file at a time; a guard set when the
  suite was small (integration's `fileParallelism: false`, worth 13 s once) may cost minutes now.
  Try the parallel setting, run it three times, and fix a test that fails under load by waiting on
  its condition longer, never by going back to serial.
- **The slowest file's setup.** Time the hooks against the tests (`performance.now()` around
  `beforeEach` work, written to a file: Vitest swallows a passing test's console). A per-test world
  that takes 0.3 s is paid once per test; build it once, copy it, or split the file across workers.
- **A long pole.** One file longer than the layer's wall time divided by its workers sets the floor:
  split it (the contract runs' `part`).
- **Fixed waits hit in full.** A test that takes almost exactly a timeout (20 s, 30 s) is waiting
  one out: usually a fixture that does not do what the real thing does (the e2e stand-in `claude`
  never took the alternate screen, so every prompt waited for `sendPrompt`'s 20 s cap).
- **Work no assertion needs.** Screenshots, traces, coverage or logs written by every run when only
  a person reviewing them needs them (UI scenarios' screenshots were a third of their time).
- **The same spec run twice over one code path.** A second run of a shared spec (the remote
  contract) earns its time only where its path differs; leave out what it repeats, decided from the
  source so it stays true (`HOME_ONLY_AREAS` in `tests/integration/support/remoteBridge.ts`).

Never run two component (browser) runs at once: they share Vite's dependency cache, and both fail
with "Failed to fetch dynamically imported module".

## 2. Find candidates

Run what fits the layer that costs the most. Work from the most expensive layer down: one e2e test
is worth ten component tests and a hundred unit tests in time.

| Signal | How | Finds |
| --- | --- | --- |
| No unique coverage | `node .claude/skills/prune-tests/overlap.mjs files` (each Vitest file alone with coverage; ~20 min), then `overlap.mjs within <file>` for a slow or flagged file | files and tests every statement, function and branch of which another file also runs; the file that contains most of each |
| e2e that needs no real app | read each slow spec against "only what needs the real app" (`tests/CLAUDE.md`): processes, ptys, several windows, a relaunch, real git, the watcher, native menus | e2e cases that only drive the renderer, and so belong in a component test (seconds instead of tens of seconds), or already have one |
| Same behaviour in two layers | for each e2e or integration case, search the cheaper layers for the same test ids and the same assertion (`grep -rn '<testid>' tests/component`) | the costlier copy; keep one wiring test per spec, drop the rest |
| One-off bug tests | `git log --format='%h %s' -- <test file>` and the test's own comment; then: does the code it guarded still exist (`git log -S`), and does a type, a lint rule or an architecture test now make the bug impossible? | regression tests whose code was deleted or rewritten, or whose bug a guard now prevents |
| Weak tests | a test whose assertions would hold if the code under it returned nothing (`expect(x).toBeDefined()`, only "does not throw", a snapshot of a mock) | tests that cost time and catch nothing; strengthen or delete |
| Slow for no reason | `slowest.md`: fixed waits, real timers where a fake clock would do, a fresh app launch per case where one launch could serve a `describe`, `until(...)` polls that wait out a timeout to prove absence | time to cut without losing a single assertion |
| Near duplicates | `overlap.mjs` "most contained by" ≥ 95% in both directions, or `it.each`-shaped copies | tests to merge into one table-driven test |

## 3. Decide, case by case

For each candidate, pick one, in this order of preference:

1. **Speed it up**: same assertions, less time. Share one app launch across a `describe`, use a
   fake clock, replace a timeout-to-prove-absence with `stays(check, ms)` at the shortest honest
   window, drop a needless `build`. Nothing is lost, so nothing needs proving but the times.
2. **Move it down a layer**: an e2e case that drives only the renderer becomes a component test; an
   integration case that needs no real subprocess becomes a unit test. The assertion stays.
3. **Merge**: tests that arrange the same world and check facets of one behaviour become one test,
   or one `it.each` table. Every assertion of each survives in the merged one.
4. **Delete**: only when the proof below holds.

**Never delete, whatever coverage says:**

- The `apiary/*` rule cases (`tests/unit/architecture/sanctionedRules.test.ts`) and every other
  architecture test: they read source, not run it, so they show no coverage and guard everything.
- Contract clauses (`tests/contract/`): they keep the fake honest; their value is that both sides run
  them.
- The one wiring test each e2e spec keeps (`tests/CLAUDE.md`), and every `@smoke` test.
- Security tests (paste stripping, path confinement, sender checks, consent, credentials): the
  cost of the bug is not the size of the test.
- A test whose assertion is the only one on a value the person sees (text, a count, an order), even
  if another test runs the same lines without checking it.
- A UI scenario: it is a screenshot as well as a test.

**Proof for a deletion or a merge** (record it in the commit message):

1. The coverage of the whole layer does not drop: `npm run test:coverage` and
   `npm run test:component:coverage` before and after, item for item for the files the test
   touched (`overlap.mjs` gives the item set).
2. Mutation check: break the code the deleted test was about (invert the condition it guarded,
   return early, drop the call) and show that a remaining test fails. If none fails, the test was
   the only thing checking that: keep it (or move its assertion into the test that ran the lines).
   Undo the mutation.
3. For a one-off bug test, name what makes the bug impossible now: the deleted code (`git log -S`),
   or the type, rule or architecture test that prevents it.

## 4. Keep it from growing back

- `tests/e2e/budget.json` holds the e2e test count (`tests/unit/architecture/e2eBudget.test.ts`
  counts them). A change that adds an e2e test removes or moves one, or raises the budget in the
  same commit with the reason in the message. The maintainer decides raises; prefer a component
  test.
- The cheapest layer that can prove it (`tests/CLAUDE.md`) applies to every new test; a review that
  sees an e2e case driving only the renderer sends it down.

## 5. Measure again and report

```sh
node .claude/skills/prune-tests/measure.mjs after
node .claude/skills/prune-tests/compare.mjs before after   # writes after/compare.md
```

Same machine, nothing else running, and every layer must pass in both runs. Report the table, then
each change with its kind (sped up, moved, merged, deleted), the seconds it saved, and for each
deletion its proof. Commit one change kind per commit, following the version and changelog rules
(root `CLAUDE.md`); test-only commits carry `No-Red-Test-Reason:`.
