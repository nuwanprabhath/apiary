import { ignoreErrors } from '@shared/ignoreErrors'

/**
 * `text` as an http(s) URL to hand `shell.openExternal`, or null. A URL that arrives over IPC is
 * checked rather than trusted: `openExternal` gives the OS anything (`file:`, and on some
 * systems schemes that run things), so the worst this lets through is a web page.
 */
export function webUrl(text: string): string | null {
  const url = ignoreErrors(() => new URL(text), 'text that is no URL is no web page')
  return url !== undefined && (url.protocol === 'https:' || url.protocol === 'http:') ? url.toString() : null
}
