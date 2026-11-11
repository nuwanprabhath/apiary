/**
 * What the MR desk's claude may never run, and what it uses instead. The disallowed tools and the
 * prompt's "blocked" lines are both made from this one table, so a block always explains itself.
 */
export const MR_DESK_BLOCKED: readonly { tool: string; command: string; instead: string }[] = [
  { tool: 'Bash(glab mr approve:*)', command: 'glab mr approve', instead: 'the `approve_mr` tool (it asks the user)' },
  {
    tool: 'Bash(glab mr note:*)', command: 'glab mr note',
    instead: '`mra draft add` for a draft only the user sees, or the `request_user_action` tool for a reply',
  },
  { tool: 'Bash(glab mr merge:*)', command: 'glab mr merge', instead: 'nothing: never merge' },
  { tool: 'Bash(glab mr close:*)', command: 'glab mr close', instead: 'nothing: never close an MR' },
  { tool: 'Bash(glab api:*)', command: 'glab api', instead: '`mra api <path>` (GET only)' },
  { tool: 'Bash(git push:*)', command: 'git push', instead: 'nothing: never push' },
]

export const MR_DESK_DISALLOWED: readonly string[] = MR_DESK_BLOCKED.map((b) => b.tool)

/** The prompt's lines naming each blocked command and its replacement. */
export function blockedLines(): string[] {
  return [
    'These are blocked for you (a blocked command fails with "permission denied"); use what follows the arrow instead:',
    ...MR_DESK_BLOCKED.map((b) => `- \`${b.command}\` → ${b.instead}`),
  ]
}

/** Every distinct `mra <sub>` named in backticks in `text`, in order of first mention. */
export function mraSubcommandsIn(text: string): string[] {
  return [...new Set([...text.matchAll(/`mra ([a-z][a-z-]*)/g)].map((m) => m[1] ?? ''))]
}

/** The subcommands argparse lists in `mra --help` (`{poll,stats,…}`), or none when it lists none. */
export function subcommandsFromHelp(help: string): string[] {
  const list = /\{([a-z][a-z,-]*)\}/.exec(help)?.[1]
  return list === undefined ? [] : list.split(',')
}
