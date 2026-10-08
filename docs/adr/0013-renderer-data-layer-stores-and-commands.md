# ADR-0013: The renderer reads through `createIpcStore` stores and acts through commands with one error policy

- **Status:** Accepted
- **Context:** Seven hooks each repeated "fetch once, subscribe to a push, guard against a stale
  answer". Two let an old initial fetch overwrite a newer pushed value (`usePets`, `useUpdate`).
  `useChat` ran twice per pane, so a streaming chat's pushes reached every closure in the window.
  There were 163 direct `window.apiary` calls in 43 components, and a failed call was dropped by
  `void` or an empty `.catch`.
- **Decision:** Data main owns and pushes is read through a store from
  `src/renderer/state/createIpcStore.ts`: one subscription and one in-flight fetch however many
  components read it, and a push that lands during a fetch wins. What a component asks main to do is
  a command in `state/`, and each command follows exactly one policy from `state/policy.ts`:
  background (logged), surfaced (a toast), or returned (the caller awaits it).
- **Alternatives tried:** A hook per domain (the seven above). A store for every stream: `ptyBus`
  (an unbounded stream by id, nothing to hold) and `mrStatusStore` (a request per session per
  interval) were left off the factory because it would only complicate it.
- **Consequences:** A component never touches `window.apiary`. A new store is
  `npm run new -- store <name> --fetch <call>`; a new command picks its policy by what the user sees
  when it fails. Hot paths (`writePty`, `resizePty`) call the bridge directly on purpose.
- **Enforced by:** the ESLint rules `bridge-via-state` (allowed only under `src/renderer/state/`),
  `no-void-bridge-call`, `no-silent-catch` and `no-polling-in-features`;
  `tests/unit/createIpcStore.test.ts`, `tests/unit/errorPolicy.test.ts`,
  `tests/component/ipcStores.test.tsx`.

See "Reading data main pushes" in [`src/renderer/state/CLAUDE.md`](../../src/renderer/state/CLAUDE.md).
