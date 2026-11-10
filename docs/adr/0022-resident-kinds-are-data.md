# ADR-0022: A resident kind from outside Apiary is data, never code

- **Status:** Accepted
- **Context:** Adding a resident kind meant a release: kinds were TypeScript in
  `src/main/residents/kinds.ts`. Users want their own residents (a scribe, a standup writer) that
  differ from the built-ins only in prompt, appearance, tool groups and schedule.
- **Decision:** A user's kind is a folder, `userData/resident-kinds/<id>/`, holding `kind.json` and
  an optional `PROMPT.md`. `validateResidentKindManifest` (`src/shared/residentKindManifest.ts`) is
  the only way in, as `validatePet` is for pets: it is total, reads only allowlisted own
  properties, caps every string (name 40, blurb 200, prompt 20,000), strips control characters,
  chooses the appearance from the closed glyph, palette and animation sets, keeps only known
  capabilities (never `gitlab.approve`, which needs a kind's own code), `text` option fields,
  `prompt` quick actions, a cycle at 5, 10, 15, 30 or 60 minutes and a `toolPolicy`, and refuses
  an id a built-in kind uses. It cannot set commands, `bins`, `env`, `prepare` or `digests`.
  `manifestKind` (`src/main/residents/kinds/manifestKind.ts`) turns it into a `ResidentKind` whose
  `setup` is `() => null`, `bins` is `{}`, permission mode defaults to `manual`, and system prompt
  is a fixed Apiary preamble followed by the author's text. `createResidents` reads the folder once
  at start, registers the valid kinds and logs the rest by folder and reason. No file watching.
- **Alternatives rejected:** Kinds as loadable JavaScript modules: anything dropped in the folder
  would run in main with the user's full rights, outside every check the built-ins pass, and a
  kind's `prepare` or `env` could reach the machine before the user saw a thing.
- **Consequences:** A data kind can do only what the resident's `claude` can already do under chat
  mode's permissions, asking first by default. A change to a kind folder applies at the next start.
- **Check:** the validator's and `manifestKind`'s tests, `tests/unit/residents/manifestKind.test.ts`.
