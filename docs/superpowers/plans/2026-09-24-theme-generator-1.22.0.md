# Claude Theme Generator (1.22.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Describe a theme in words; the user's `claude` designs it; preview it live, refine it, keep or save it — with nothing Claude returns able to break the app.

**Architecture:** Main runs `claude -p` headless with every tool and customisation off, in an empty temp dir, asking for JSON matching a schema generated from the spec allowlists. The reply is extracted and passed through `validateTheme` (1.21.0) before it leaves main. The renderer previews it with `applyTheme` in the Settings window, keeps a 10-step history, and on Keep/Save stores it through the existing `ThemeStore` IPC.

**Spec:** `docs/superpowers/specs/2026-09-24-look-and-themes-design.md` (Part 3). Builds on the 1.21.0 plan's modules, same branch `feature/look-and-themes`.

## Global Constraints

- Released together with 1.21.0 as a single **1.22.0** (1.21.0 is never published on its own): one changelog section.
- Command: `<claudeBin|claude> -p --output-format json --model <model> --tools "" --safe-mode --strict-mcp-config --no-session-persistence --json-schema <schema> <prompt>` — verified against Claude Code 2.1.281. `--no-session-persistence` keeps generations out of the sidebar.
- cwd: a fresh `mkdtemp` directory, removed afterwards. env: `childEnv(process.env)`. Timeout 150 s (real generations measured 45–55 s). stdout cap 64 KB (killed beyond). One generation at a time; cancel kills it.
- Models offered: `sonnet` (default), `haiku`, `opus` — aliases, allowlisted in main.
- Log (`theme` scope): started/finished/failed with model, ms, outcome, bytes, report counts. **Never** the request text or the reply.
- No AI attribution in commits. Don't push the branch. Ask before merge/tag/release.

---

### Task 1: Prompt, schema, reply extraction

**Files:** Create `src/shared/theme/prompt.ts`; Test `tests/unit/themePrompt.test.ts`.

**Produces:** `THEME_JSON_SCHEMA: object` (built from PALETTE_TOKENS, TERMINAL_COLORS, fonts, effects, limits); `buildThemePrompt(req: { request: string; current: ThemeSpec | null }): string` (includes allowed fonts/effects with one-line descriptions, the three built-ins as examples, the rules — colours as `#rrggbb`/`#rrggbbaa`, readable text, `bg`/`bg-terminal` opaque, chrome may be translucent ≥ 0.6 — the current spec for a refinement, and the request, clipped to 2000 chars); `extractThemeJson(stdout: string): unknown | null` (reads `structured_output`, else parses `result` as bare JSON, a fenced block, or the first `{…}` object in prose).

- [ ] Tests: schema lists exactly the allowlists; prompt contains the request and (for refine) the current spec, and clips a 10 KB request; extraction from `structured_output`, from bare/fenced/prose `result`, returns null for garbage, `is_error: true`, empty stdout, and non-JSON stdout.
- [ ] Implement; PASS; commit `feat(theme): the prompt and schema a theme is asked for with`.

### Task 2: The generator

**Files:** Create `src/main/theme/themeGenerator.ts`; Test `tests/integration/themeGenerator.test.ts`.

**Produces:** `class ThemeGenerator { constructor(opts: { claudeBin: () => string | null; timeoutMs?: number }); generate(req: { request: string; current: ThemeSpec | null; model: ThemeModel }): Promise<{ spec: ThemeSpec; report: ThemeReport }>; cancel(): void; busy: boolean }`; errors carry a user-facing message (`Claude took too long`, `Claude could not be run: …`, `Claude's reply had no theme in it`, `Cancelled`, `Already generating`).

- [ ] Tests with a stand-in `claude` shell script (writes its argv and cwd to a file, prints a canned JSON reply): success → validated spec; argv contains `--tools ""`-equivalent (an empty argument after `--tools`), `--safe-mode`, `--strict-mcp-config`, `--no-session-persistence`, `--json-schema`; cwd is an empty temp dir that no longer exists afterwards; timeout (script sleeps) → rejects with the timeout message; non-zero exit → rejects; oversized output → rejects; cancel → rejects `Cancelled`; hostile reply (`url()` colour, unknown effect) → only the safe parts; second call while busy → `Already generating`.
- [ ] Implement with `spawn` (no shell), collect stdout up to the cap; PASS; commit `feat(theme): run claude headless, with nothing it can touch`.

### Task 3: IPC and model option

**Files:** Modify `src/shared/api.ts` (`ThemeOptions.model`, `themeGenerate`, `themeGenerateCancel`, `ThemeGenerateResult`), `src/preload/index.ts`, `src/main/theme/themeIpc.ts`, `src/main/theme/themeStore.ts` (model option, allowlisted, default `sonnet`), `src/main/index.ts` (construct generator with the settings' claudeBin); `themeSave` gains optional `prompt`.

**Produces:** `themeGenerate(request: string, current: ThemeSpec | null): Promise<{ spec: ThemeSpec; note: string | null }>`; `themeGenerateCancel(): void`.

- [ ] Integration test for store model option (unknown model → default). Implement; typecheck; commit `feat(theme): generate over IPC`.

### Task 4: Describe, preview, refine, keep

**Files:** Modify `src/renderer/components/ThemesSection.tsx`, `src/renderer/components/SettingsDialog.tsx` (revert a live preview when the dialog closes), `styles.css`; Test `tests/e2e/themeGenerator.spec.ts` (stand-in claude via Settings → General claude path).

UI: "Describe a theme" textarea + Generate (Cancel while running, spinner); preview bar when a preview is showing: refine input + Refine, ◀ ▶ history (10), note line, Keep (saves under Claude's name and applies), Save as…, Discard. Model select in Options. Test ids: `theme-describe`, `theme-generate`, `theme-generate-cancel`, `theme-preview-bar`, `theme-refine`, `theme-refine-submit`, `theme-history-back`, `theme-history-forward`, `theme-preview-note`, `theme-keep`, `theme-discard`, `theme-model`.

- [ ] E2E: generate → app previews (accent changes) and preview bar shows; refine → stand-in receives the current spec in its prompt and returns a second theme; back/forward steps; Keep → saved card appears, active, survives relaunch; Discard restores the previous look; closing Settings mid-preview restores; hostile stand-in reply → note says what was ignored and the unsafe parts are absent; a failing stand-in → error shown, look unchanged; Cancel.
- [ ] Implement; PASS; screenshots; commit `feat(theme): describe a theme and Claude designs it`.

### Task 5: Live check and release prep

- [ ] `tests/e2e/live/themeGenerator.spec.ts` (opt-in `APIARY_LIVE_CLAUDE=1`): real claude, "like the Matrix movie" and "a cool cyberpunk theme"; each validates with `droppedColors === 0 && unknown === 0`; screenshots saved for review.
- [ ] Version 1.22.0; merge the 1.21.0 changelog section into one 1.22.0 section; CLAUDE.md Themes section gains the generator rules; full `npm test`, `npm run test:e2e`, live specs; commit `chore: 1.22.0`; ask before merge/tag/release.
