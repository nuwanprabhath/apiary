# ADR-0014: One composition root builds every long-lived object, and `AppService` stays a facade

- **Status:** Accepted
- **Context:** `AppService` kept taking orchestration (126 more lines of chat code in one release).
  Services built their own collaborators, so `ClaudeProjectsSource` was built twice and could not be
  replaced in a test. Resolver, branch and merge-request caches were module state, reset between
  tests by exported test hooks. Infrastructure imported
  settings, env and the app shell.
- **Decision:** `createContainer` and `createServices` in `src/main/app/container.ts` construct every
  long-lived main-process object; construction is pure (no window, timer or poll), and `index.ts`
  starts things in order. Caches are instances that take their `exec`. `AppService` only delegates:
  every method is one statement. Chat and plugins have their own services (`ChatService`,
  `PluginService`) that handlers take directly. Layers point down: app, ipc, services, infrastructure.
- **Alternatives tried:** Growing `AppService` and module-level state with test hooks: the cause of
  the drift above. A service constructing what it needs inside itself: the `ClaudeProjectsSource` duplicate.
- **Consequences:** A new service is built in the container, injected, and added to the
  `construct-in-container` list. Logic goes in the owning service, never on `AppService`. The one
  exception is the search worker, which opens its own `SearchIndex` on its own thread.
  `AppService.dispose` is the single allowed non-delegating method (shutdown order).
- **Enforced by:** the ESLint rule `construct-in-container`;
  `tests/unit/architecture/appServiceDelegates.test.ts`; dependency-cruiser `main-infra-stays-down`,
  `main-services-below-ipc`, `main-ipc-below-app`, `ipc-handlers-are-adapters`;
  `tests/unit/container.test.ts`.

See "Composition and the session services" in [`src/main/CLAUDE.md`](../../src/main/CLAUDE.md).
