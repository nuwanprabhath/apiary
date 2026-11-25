import { SETTINGS, type SettingKey } from '@shared/settings/schema'

/**
 * What the settings search knows about one setting: the words a person might type, and where the
 * control is. Declared here, once, beside the registry that lists the sections; a plugin's
 * settings are added from what the plugin declares (`pluginEntries`).
 * `tests/component/settingsSearchIndex.test.tsx` fails for a control with no entry here, a
 * `SETTINGS` key no entry edits, and a label that no longer appears on its section.
 */
export interface SettingEntry {
  id: string
  section: string
  label: string
  description: string
  /** Other words for it that neither label nor description use. */
  keywords?: readonly string[]
  /** `data-testid` of the control(s); a trailing `*` matches any id with that start. The first one on screen is scrolled to. */
  testIds: readonly string[]
  /** The `SETTINGS` keys this control edits. */
  keys?: readonly SettingKey[]
  /** Shown only where the dialog edits this machine's settings and Linux is the system. */
  linuxOnly?: true
}

export const SEARCH_ENTRIES: readonly SettingEntry[] = [
  {
    id: 'auto-import-all', section: 'sessions', label: 'Automatically import all sessions',
    description: 'Every session Apiary discovers is imported without being picked by hand, on startup and whenever it rescans. The import dialog stays available.',
    keywords: ['discover', 'add'], testIds: ['setting-auto-import-all'], keys: ['autoImportAll'],
  },
  {
    id: 'auto-import-interval', section: 'sessions', label: 'Check for new sessions periodically',
    description: 'A session you start in a terminal outside the app shows up on its own, rather than only when you press Refresh. Every N minutes.',
    keywords: ['rescan', 'interval', 'minutes', 'refresh'],
    testIds: ['setting-auto-import-interval-enabled', 'setting-auto-import-interval', 'setting-interval-preset-*'],
    keys: ['autoImportIntervalMinutes'],
  },
  {
    id: 'search-chat-content', section: 'search', label: 'Search inside conversations',
    description: 'Matches what was actually said in a session: ticket and merge-request numbers, branch names, pipeline ids, any phrase you remember, not just the session title. Off falls back to titles alone.',
    keywords: ['index', 'full text', 'content'], testIds: ['setting-search-chat-content'], keys: ['searchChatContent'],
  },
  {
    id: 'search-session-notes', section: 'search', label: 'Search session notes',
    description: 'Notes you write on a session are matched by the search box too. Turning this off empties the note index; the notes are kept.',
    testIds: ['setting-search-session-notes'], keys: ['searchSessionNotes'],
  },
  {
    id: 'search-rebuild', section: 'search', label: 'Rebuild index',
    description: 'Apiary keeps the search index up to date on its own. Rebuild it if results ever look stale. Shows how many sessions and notes are indexed.',
    keywords: ['reindex', 'stale', 'refresh'], testIds: ['search-rebuild', 'search-index-status'],
  },
  {
    id: 'reveal-active', section: 'sidebar', label: 'Reveal the open session in the sidebar',
    description: 'Switching to a tab scrolls the sidebar to that session and highlights it. Turn this off to leave the sidebar where you left it.',
    keywords: ['scroll', 'follow', 'tab'], testIds: ['setting-reveal-active'], keys: ['revealActiveInSidebar'],
  },
  {
    id: 'recent', section: 'sidebar', label: 'Show a Recent section',
    description: 'Lists sessions worked in recently, below Pinned, so a session you just left is one click away. Within the last N hours.',
    keywords: ['hours', 'pinned'], testIds: ['setting-recent-enabled', 'setting-recent-hours'],
    keys: ['recentSectionEnabled', 'recentSectionHours'],
  },
  {
    id: 'hide-old', section: 'sidebar', label: 'Hide sessions not used for a while',
    description: 'Sessions you have not worked in for longer than this drop out of the sidebar. Search still finds them, and pinned or open sessions always show. Not used in N days.',
    keywords: ['old', 'stale', 'days', 'archive'], testIds: ['setting-hide-old-enabled', 'setting-hide-old-days'],
    keys: ['hideOldSessionsEnabled', 'hideOldSessionsDays'],
  },
  {
    id: 'theme-describe', section: 'themes', label: 'Describe a theme',
    description: 'In your own words, like the Matrix movie or a calm forest at dusk. Claude designs it and you see it straight away; nothing changes until you keep it. Or pick one of the themes, rename or delete your own.',
    keywords: ['generate', 'colours', 'colors', 'dark', 'light', 'appearance', 'look', 'safe theme', 'reset'],
    testIds: ['theme-describe', 'theme-generate', 'theme-card*', 'theme-delete', 'theme-name*', 'theme-refine*', 'theme-preview*', 'theme-reset', 'theme-save-as'],
  },
  {
    id: 'theme-model', section: 'themes', label: 'Designed by',
    description: 'The Claude model your own claude uses to design themes.', keywords: ['model', 'opus', 'sonnet', 'haiku'],
    testIds: ['theme-model'],
  },
  {
    id: 'theme-animated', section: 'themes', label: 'Animated effects',
    description: 'Off shows each effect as a still picture. Effects never move while Animations is reduced.',
    keywords: ['motion', 'still'], testIds: ['theme-animated'],
  },
  {
    id: 'motion', section: 'themes', label: 'Animations',
    description: 'Automatic turns continuous animations off when your system asks for less motion, or when Apiary is drawing without the graphics card. Automatic, full or reduced.',
    keywords: ['motion', 'reduced', 'full', 'automatic', 'gpu', 'accessibility'], testIds: ['setting-motion'], keys: ['motion'],
  },
  {
    id: 'theme-intensity', section: 'themes', label: 'Effect intensity',
    description: 'Tones every effect down without changing the theme.', keywords: ['slider', 'strength'],
    testIds: ['theme-intensity'],
  },
  {
    id: 'busy-animation', section: 'themes', label: 'Working animation',
    description: 'Shown beside the line that says Claude is working. Choose the animation and its colour.',
    keywords: ['spinner', 'busy', 'colour', 'color', 'spark'], testIds: ['busy-animation-*', 'busy-color-*'],
    keys: ['busyAnimation', 'busyAnimationColor'],
  },
  {
    id: 'terminal-minimal-prompt', section: 'terminal', label: 'Minimal prompt: just $',
    description: 'The shell prompt shows nothing but $, no user, host or path, so the whole line is yours to type in. Works in bash and zsh, after your own startup files.',
    keywords: ['shell', 'ps1', 'bash', 'zsh'], testIds: ['setting-terminal-minimal-prompt'], keys: ['terminalMinimalPrompt'],
  },
  {
    id: 'terminal-shorten-path', section: 'terminal', label: 'Shorten the path in the prompt',
    description: 'A worktree path takes most of a narrow terminal first line. Apiary asks the shell to keep only the last few folders. Keep the last N folders. Uses bash PROMPT_DIRTRIM.',
    keywords: ['folders', 'worktree', 'dirtrim', 'directory'],
    testIds: ['setting-terminal-shorten-path', 'setting-terminal-path-segments', 'terminal-shorten-note'],
    keys: ['terminalShortenPath', 'terminalPathSegments'],
  },
  {
    id: 'pets-enabled', section: 'pets', label: 'Show pets',
    description: 'Little characters that live on the status bar and up the sidebar rail when it is collapsed. They wander, nap, read, and cheer Claude on. Drag one to move it, click it to chat.',
    keywords: ['companion', 'character', 'mascot'], testIds: ['setting-pets-enabled'],
  },
  {
    id: 'pets-hatch', section: 'pets', label: 'Hatch a new pet',
    description: 'Describe how it looks and what it is like, or let Claude surprise you. Pick the model for the new pet.',
    keywords: ['create', 'new', 'generate', 'model'], testIds: ['pet-describe', 'pet-hatch*', 'pet-model*', 'pet-surprise*'],
  },
  {
    id: 'residents', section: 'residents', label: 'Resident agents',
    description: 'Always-on helpers that live in Apiary. Each has its own name, hours and model. Add one, set when it works, enable or remove it.',
    keywords: ['agent', 'helper', 'hours', 'model', 'name', 'enabled', 'assistant', 'badge'],
    testIds: ['resident-*'], keys: ['residents'],
  },
  {
    id: 'slack', section: 'slack', label: 'Slack',
    description: 'Talk to Regent from a Slack channel. Bot token, channel and member id for this machine, and a connection test.',
    keywords: ['token', 'channel', 'bot', 'member', 'instructions', 'connection'], testIds: ['slack-*'],
  },
  {
    id: 'privacy', section: 'privacy', label: 'Privacy',
    description: 'Strict privacy mode holds each feature that sends your data off this machine until you agree to it. What each one sends and to whom, and how many days derived data is kept.',
    keywords: ['privacy', 'gdpr', 'consent', 'strict', 'retention', 'data', 'delete', 'purge', 'export', 'anthropic', 'slack', 'gitlab'],
    testIds: ['privacy-strict', 'privacy-retention', 'privacy-allow-*', 'privacy-withdraw-*', 'privacy-purge', 'privacy-export', 'privacy-open-plugins', 'privacy-open-updates', 'privacy-consent-*'], keys: ['gdprStrictMode', 'privacyConsents', 'dataRetentionDays'],
  },
  {
    id: 'read-other-accounts', section: 'residents', label: 'Let residents read sessions from your other Claude accounts',
    description: 'Off: a resident sees only sessions of the account it runs under. On: residents can search and read sessions you ran under any account.',
    keywords: ['account', 'privacy'], testIds: ['resident-read-other-accounts'], keys: ['readOtherAccounts'],
  },
  {
    id: 'update-automatic', section: 'updates', label: 'Check for updates automatically',
    description: 'Apiary asks GitHub whether there is a newer release, and tells you if there is. Nothing is downloaded or installed without you saying so. Every N hours.',
    keywords: ['upgrade', 'release', 'version', 'hours', 'interval'],
    testIds: ['setting-update-automatic', 'setting-update-interval', 'setting-update-preset-*'],
    keys: ['updateAutomaticChecks', 'updateCheckIntervalHours'],
  },
  {
    id: 'update-check-now', section: 'updates', label: 'Check now',
    description: 'Look for a newer version of Apiary right now. Shows the current version and when it was last checked.',
    keywords: ['version', 'upgrade', 'latest'], testIds: ['update-check-now', 'update-version-row'],
  },
  {
    id: 'update-auto-download', section: 'updates', label: 'Download updates as soon as they are found',
    description: 'The update is fetched in the background, so installing it is just a restart. Nothing restarts on its own.',
    keywords: ['install', 'background'], testIds: ['setting-update-auto-download'], keys: ['updateAutoDownload'],
  },
  {
    id: 'update-prerelease', section: 'updates', label: 'Include pre-release versions',
    description: 'Offers beta builds as well as finished releases. Off unless you want to test what is coming next.',
    keywords: ['prerelease', 'beta', 'preview', 'insider'], testIds: ['setting-update-prerelease'], keys: ['updateAllowPrerelease'],
  },
  {
    id: 'claude-bin', section: 'general', label: 'Path to the claude binary',
    description: 'Set this only if resuming fails with "claude: command not found". Run which claude in your shell to find it. Leave empty to use PATH.',
    keywords: ['executable', 'cli', 'command not found', 'resume'], testIds: ['claude-bin-input'], keys: ['claudeBin'],
  },
  {
    id: 'proofing-language', section: 'general', label: 'Proofing language',
    description: 'Spelling suggestions and underlines use this dictionary. The change takes effect when you save. On macOS spelling uses the languages in System Settings.',
    keywords: ['spell', 'spelling', 'dictionary', 'language', 'spellcheck'], testIds: ['proofing-language-select'],
    keys: ['proofingLanguage'],
  },
  {
    id: 'system-title-bar', section: 'general', label: 'Use the system title bar',
    description: 'Apiary draws its own title bar and menus in the theme colours. Turn this on to use the operating system ones, for a window manager that does not get on with a custom title bar.',
    keywords: ['window', 'frame', 'menu bar', 'native'], testIds: ['setting-system-title-bar'], keys: ['systemTitleBar'],
  },
  {
    id: 'linux-xwayland', section: 'general', label: 'Bring windows back on their own monitors (XWayland)',
    description: 'On a Wayland desktop, apps cannot choose where their windows go. Through XWayland, each window comes back where it was, at its size. Applies the next time Apiary starts.',
    keywords: ['wayland', 'linux', 'monitor', 'screen', 'position'], testIds: ['setting-linux-xwayland'],
    keys: ['linuxXWayland'], linuxOnly: true,
  },
  {
    id: 'transcript-chat', section: 'general', label: 'Run sessions as a chat, like the VS Code extension',
    description: 'Messages sent from a session Chat tab run it as a chat: replies stream in as they are written, tools ask for permission right there. A session runs either as a chat or in its terminal.',
    keywords: ['conversation', 'permission', 'stream'], testIds: ['setting-transcript-chat'], keys: ['transcriptChat'],
  },
  {
    id: 'new-sessions-in-chat', section: 'general', label: 'Open new sessions in the chat',
    description: 'A session started with + opens on its Chat tab instead of its terminal. Needs Run sessions as a chat.',
    testIds: ['setting-new-sessions-in-chat'], keys: ['newSessionsInChat'],
  },
  {
    id: 'hide-tool-call-io', section: 'general', label: 'Hide tool calls in the chat',
    description: 'Leaves out the boxes showing what Claude ran and what came back (commands, file reads, edits), so the Chat tab is what you said and what Claude said.',
    keywords: ['tools', 'output', 'collapse'], testIds: ['setting-hide-tool-call-io'],
  },
  {
    id: 'remote-access', section: 'general', label: 'Allow remote access over SSH',
    description: 'Your other Mac or PC connects with File, Open Remote Session, over SSH. Apiary opens no network port. Shows connected machines and lets you disconnect them.',
    keywords: ['server', 'network', 'client', 'connect'],
    testIds: ['setting-remote-access', 'remote-access-readonly', 'remote-clients', 'remote-server-failure'], keys: ['remoteAccess'],
  },
  {
    id: 'remote-pairing', section: 'general', label: 'Also require a pairing code',
    description: 'SSH stays the sign-in. The code is an extra the other machine has to know. Make a new code.',
    keywords: ['password', 'secret', 'security'], testIds: ['setting-remote-pairing', 'remote-pairing*'], keys: ['remoteAccessPairing'],
  },
  {
    id: 'default-account', section: 'accounts', label: 'Default account',
    description: 'New sessions start in the default account. Run a session as another Claude account without signing out of this one.',
    keywords: ['login', 'sign in', 'switch'], testIds: ['account-default-select'],
  },
  {
    id: 'add-account', section: 'accounts', label: 'Add account',
    description: 'Name another Claude account and sign in to it. Each account keeps its own config folder.',
    keywords: ['new', 'login', 'sign in', 'config', 'remove'], testIds: ['account-add*', 'account-name', 'account-*'],
  },
  {
    id: 'diagnostics-enabled', section: 'diagnostics', label: 'Write a diagnostic log',
    description: 'Off by default, and off means nothing is written at all. Switch it on when something is going wrong, reproduce it, then send the folder on. Never includes your conversations.',
    keywords: ['debug', 'bug', 'privacy', 'logging'], testIds: ['setting-diagnostics-enabled', 'diagnostics-privacy'],
    keys: ['diagnosticsEnabled'],
  },
  {
    id: 'log-limits', section: 'diagnostics', label: 'Keep logs for',
    description: 'Keep logs for N days, using at most N MB.', keywords: ['retention', 'size', 'days', 'megabytes', 'disk'],
    testIds: ['setting-log-retention-days', 'setting-log-max-size'], keys: ['logRetentionDays', 'logMaxSizeMb'],
  },
  {
    id: 'log-folder', section: 'diagnostics', label: 'Where the logs are',
    description: 'The folder the diagnostic logs are written to. Open it, copy its path, or clear the logs.',
    keywords: ['open', 'copy', 'clear', 'delete', 'path'], testIds: ['log-folder-path', 'log-open-folder', 'log-copy-path', 'log-clear'],
  },
]

/** True where `testId` is one of the entry's ids (or under one of its prefixes). */
export const entryOwns = (entry: SettingEntry, testId: string): boolean =>
  entry.testIds.some((id) => (id.endsWith('*') ? testId.startsWith(id.slice(0, -1)) : id === testId))

/** An entry only for what this dialog shows: a screen-only setting is not on the work machine's view. */
export const isThisMachineOnly = (entry: SettingEntry): boolean =>
  entry.keys !== undefined && entry.keys.length > 0 && entry.keys.every((k) => SETTINGS[k].scope === 'screen')
