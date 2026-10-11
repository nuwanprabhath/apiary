import type { Guard } from '../ipc/guards'

/**
 * A host to connect to over SSH, as typed in the connect dialog: an `~/.ssh/config` alias, a
 * name, or `user@name`. It reaches `ssh` as an argument, so it must never look like an option (a
 * leading `-`, as in `-oProxyCommand=…`) or carry a space, quote or shell character: only the
 * characters a host name, a user name, an IPv6 address or a port need.
 */
const REMOTE_HOST_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._%+@:[\]-]{0,252}$/

export const isRemoteHost: Guard<string> = (v): v is string =>
  typeof v === 'string' && REMOTE_HOST_PATTERN.test(v)

/** What a remote window hears about its connection to the work machine. */
export interface RemoteStatus {
  state: 'connected' | 'disconnected' | 'reconnecting'
  /** The work machine's name, as its Apiary reported it. */
  host: string
  /** Why it disconnected, in words a person can act on. */
  message?: string
  /** Which retry this is (1, 2, …), while `reconnecting`. */
  attempt?: number
}

/** A home machine connected to this machine's Apiary (the work machine's own view). */
export interface RemoteClientInfo {
  id: string
  /** The home machine's name, as it said in `hello`. Informational: never trusted for anything. */
  client: string
  /** When it connected (ms since the epoch). */
  connectedAt: number
  /** How many of this machine's windows it has open. */
  windows: number
}

/** A time of day as a person reads it ("10:12"), for "since …" in the lists of who is connected. */
export const clockTime = (at: number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** Why a work machine refused a connection. */
export type RefusalReason = 'version' | 'pairing-required' | 'pairing-wrong' | 'rate-limited'

/** The pairing code: 8 characters from an alphabet without 0/O or 1/I, shown as `XXXX-XXXX`. */
export const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const PAIRING_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{4}-?[A-HJ-NP-Z2-9]{4}$/i

/** A pairing code as a person types it: dash and case do not matter. */
export const isPairingCode: Guard<string> = (v): v is string =>
  typeof v === 'string' && PAIRING_CODE_PATTERN.test(v.trim())

/** The canonical form (upper case, no dash) a code is compared and stored in. */
export function normalizePairingCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase()
}

/** `ABCD2345` as `ABCD-2345`. */
export function formatPairingCode(code: string): string {
  const plain = normalizePairingCode(code)
  return `${plain.slice(0, 4)}-${plain.slice(4)}`
}

/** What a `remoteConnect` error starts with when the work machine asks for its pairing code. */
const PAIRING_REQUIRED_PREFIX = 'Pairing code needed.'
/** ...and when the code sent was not the one it shows. */
const PAIRING_WRONG_PREFIX = 'Pairing code wrong.'
/** Ends the error when this machine cannot keep the code (no `safeStorage`), so the dialog can say so. */
const UNSAVED_NOTE = ' It cannot be remembered on this computer.'

export type PairingRefusal = 'pairing-required' | 'pairing-wrong' | 'rate-limited'

/** The error text for a pairing refusal; `pairingError` recognises the first two. */
export function pairingErrorMessage(reason: PairingRefusal, host: string, canSave = true): string {
  const note = canSave ? '' : UNSAVED_NOTE
  switch (reason) {
    case 'pairing-required': return `${PAIRING_REQUIRED_PREFIX} ${host} asks for the pairing code shown in its Settings → General.${note}`
    case 'pairing-wrong': return `${PAIRING_WRONG_PREFIX} That is not the pairing code ${host} shows in its Settings → General.${note}`
    case 'rate-limited': return `Too many wrong pairing codes for ${host}. Wait a minute and try again.`
  }
}

/** Whether a `remoteConnect` rejection means "ask for the pairing code", and which kind. */
export function pairingError(message: string): 'pairing-required' | 'pairing-wrong' | null {
  if (message.startsWith(PAIRING_REQUIRED_PREFIX)) return 'pairing-required'
  if (message.startsWith(PAIRING_WRONG_PREFIX)) return 'pairing-wrong'
  return null
}

/** Whether the error says the code will not be remembered, so the user has to enter it each time. */
export const pairingNotSaved = (message: string): boolean => pairingError(message) !== null && message.endsWith(UNSAVED_NOTE)

/** Where a candidate host came from; the list keeps this order. */
export type RemoteHostSource = 'recent' | 'ssh-config' | 'tailscale'

/** What a probe found: `unknown` means not probed yet; `refused` means ssh got there and was refused the login. */
export type RemoteHostState = 'ready' | 'off' | 'stopped' | 'refused' | 'unreachable' | 'unknown'

/** A host the connect dialog and File → Open Remote Session offer, with the last probe's answer. */
export interface RemoteHost {
  name: string
  source: RemoteHostSource
  status: RemoteHostState
  /** Why `unreachable` or `refused`, as a sentence. */
  detail?: string
  /** When the status was found (ms since the epoch). */
  checkedAt?: number
}
