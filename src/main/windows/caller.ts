/**
 * Who called, as far as a handler that may run for a remote window can tell. A real window's
 * `WebContents` satisfies it; so does a `VirtualContents` (`remote/virtualContents.ts`), which has
 * no `BrowserWindow` behind it. A handler whose channel is `remote`-scoped (`remote/scopes.ts`)
 * receives only this (`ipc/registrar.ts`), so one that reaches for a real window does not compile.
 */
export interface Caller {
  readonly id: number
  send(channel: string, ...args: unknown[]): void
  isDestroyed(): boolean
  once(event: 'destroyed', listener: () => void): unknown
  on(event: 'did-navigate', listener: () => void): unknown
}

export interface RemoteEvent { sender: Caller }
