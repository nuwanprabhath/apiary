import type { MenuItemConstructorOptions } from 'electron'
import type { RemoteHost } from '@shared/domain/remote'

/** One host's menu label, from the cache: "work-box", or with what is wrong ("work-box — login refused"). */
function remoteHostLabel(host: RemoteHost): string {
  if (host.status === 'off') return `${host.name} — remote access off`
  if (host.status === 'stopped') return `${host.name} — not running`
  if (host.status === 'refused') return `${host.name} — login refused`
  if (host.status === 'unreachable') return `${host.name} — unreachable`
  return host.name
}

/** File → Open Remote Session's items: one per listed host, then a separator and "Other Host…" (the only item when nothing is listed). */
export function remoteSessionItems(
  hosts: RemoteHost[], onOpenHost: (host: string) => void, onOtherHost: () => void,
): MenuItemConstructorOptions[] {
  return [
    ...hosts.map((h): MenuItemConstructorOptions => ({ label: remoteHostLabel(h), click: () => { onOpenHost(h.name) } })),
    ...(hosts.length > 0 ? [{ type: 'separator' } as const] : []),
    { label: 'Other Host…', click: onOtherHost },
  ]
}
