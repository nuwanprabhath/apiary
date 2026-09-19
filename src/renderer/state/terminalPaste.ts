/**
 * The one write path every paste gesture goes through.
 *
 * xterm's own `Terminal.paste()` is the only thing that should ever put clipboard text on a pty:
 * it goes through the same `onData` listener as typed input, and it applies bracketed-paste
 * markers itself, only when the running program has asked for them. Calling `ptyWrite` directly
 * from a key handler used to run *alongside* that — xterm's own native `paste` DOM event fires
 * independently of any keydown handling — so the same text landed twice, once bracketed and once
 * not. Routing every path through this one function is what makes that impossible again.
 */
export interface PasteableTerminal {
  paste: (text: string) => void
}

export function pasteText(term: PasteableTerminal, text: string): void {
  if (text === '') return
  term.paste(text)
}
