import { describe, it, expect, expectTypeOf } from 'vitest'
import { CHANNELS, IPC, type InvokeKey, type SendKey } from '@shared/ipc/contract'
import type { Handlers, Listeners } from '../../src/main/ipc/registrar'

/**
 * MAIN-11's own verification: the contract is the single source of truth for every channel name,
 * so a channel rename here is exactly what would break the e2e harness's direct channel stubs
 * (`tests/e2e/helpers.ts`) and `describeError`'s `'apiary:…'` string-stripping — this pins every
 * wire name so that happens as a loud, obvious diff in this file rather than a quiet behaviour
 * change nobody noticed making.
 */
describe('the IPC contract', () => {
  it('has exactly the channel strings this app has always used', () => {
    expect(CHANNELS).toEqual({
      refresh: 'apiary:refresh',
      tree: 'apiary:tree',
      searchContent: 'apiary:search-content',
      discovered: 'apiary:discovered',
      importSessions: 'apiary:import',
      transcript: 'apiary:transcript',
      checkConflict: 'apiary:check-conflict',
      resume: 'apiary:resume',
      renameSession: 'apiary:rename-session',
      renameTerminalInClaude: 'apiary:rename-terminal-in-claude',
      removeSession: 'apiary:remove-session',
      moveSession: 'apiary:move-session',
      newSessionInProject: 'apiary:new-session-in-project',
      forkSession: 'apiary:fork-session',
      newSessionStarted: 'apiary:new-session-started',
      treeChanged: 'apiary:tree-changed',
      openImportDialog: 'apiary:open-import-dialog',
      setSessionNote: 'apiary:set-session-note',
      sessionNote: 'apiary:session-note',
      searchRebuild: 'apiary:search-rebuild',
      searchStatus: 'apiary:search-status',
      saveImage: 'apiary:save-image',
      readImage: 'apiary:read-image',
      vsCodeAvailable: 'apiary:vscode-available',
      openInVsCode: 'apiary:open-in-vscode',
      openMentionedFile: 'apiary:open-mentioned-file',
      copyToClipboard: 'apiary:copy-to-clipboard',
      contextMenuRequested: 'apiary:context-menu-requested',
      editCommand: 'apiary:edit-command',
      themeInitial: 'apiary:theme-initial',
      themeState: 'apiary:theme-state',
      themeGpuCompositing: 'apiary:theme-gpu-compositing',
      themeApply: 'apiary:theme-apply',
      themeSave: 'apiary:theme-save',
      themeRename: 'apiary:theme-rename',
      themeDelete: 'apiary:theme-delete',
      themeSetOptions: 'apiary:theme-set-options',
      themeChanged: 'apiary:theme-changed',
      themeGenerate: 'apiary:theme-generate',
      themeGenerateCancel: 'apiary:theme-generate-cancel',
      petsState: 'apiary:pets-state',
      petsChanged: 'apiary:pets-changed',
      petsSetEnabled: 'apiary:pets-set-enabled',
      petGenerate: 'apiary:pet-generate',
      petGenerateCancel: 'apiary:pet-generate-cancel',
      petUpdate: 'apiary:pet-update',
      petDelete: 'apiary:pet-delete',
      petExport: 'apiary:pet-export',
      petImport: 'apiary:pet-import',
      petChat: 'apiary:pet-chat',
      petVoice: 'apiary:pet-voice',
      petClaudeActions: 'apiary:pet-claude-actions',
      petComment: 'apiary:pet-comment',
      openShell: 'apiary:open-shell',
      openShellForPty: 'apiary:open-shell-for-pty',
      ptyWrite: 'apiary:pty-write',
      ptyResize: 'apiary:pty-resize',
      ptyKill: 'apiary:pty-kill',
      ptyResume: 'apiary:pty-resume',
      ptyAttach: 'apiary:pty-attach',
      ptyDetach: 'apiary:pty-detach',
      ptyData: 'apiary:pty-data',
      ptySnapshot: 'apiary:pty-snapshot',
      ptySessions: 'apiary:pty-sessions',
      ptySessionsChanged: 'apiary:pty-sessions-changed',
      ptyRunning: 'apiary:pty-running',
      ptyExit: 'apiary:pty-exit',
      sendPrompt: 'apiary:send-prompt',
      settingsGet: 'apiary:settings-get',
      settingsSet: 'apiary:settings-set',
      openSettingsDialog: 'apiary:open-settings-dialog',
      toggleSidebar: 'apiary:toggle-sidebar',
      gitStatus: 'apiary:git-status',
      gitListRefs: 'apiary:git-list-refs',
      gitlabMrRefStatus: 'apiary:gitlab-mr-ref-status',
      gitCheckoutBranch: 'apiary:git-checkout-branch',
      gitCheckoutBranchMovingOther: 'apiary:git-checkout-branch-moving-other',
      gitPullWorktree: 'apiary:git-pull-worktree',
      newSessionInWorktree: 'apiary:new-session-in-worktree',
      gitCheckoutRemote: 'apiary:git-checkout-remote',
      gitCheckoutDetached: 'apiary:git-checkout-detached',
      gitCreateBranch: 'apiary:git-create-branch',
      gitPull: 'apiary:git-pull',
      gitUpdateBranch: 'apiary:git-update-branch',
      gitPullFolder: 'apiary:git-pull-folder',
      listWorktrees: 'apiary:list-worktrees',
      statusBarItems: 'apiary:status-bar-items',
      statusBarRefresh: 'apiary:status-bar-refresh',
      statusBarPanel: 'apiary:status-bar-panel',
      statusBarConsent: 'apiary:status-bar-consent',
      statusBarChanged: 'apiary:status-bar-changed',
      chatState: 'apiary:chat-state',
      chatStart: 'apiary:chat-start',
      chatSend: 'apiary:chat-send',
      chatInterrupt: 'apiary:chat-interrupt',
      chatSendNow: 'apiary:chat-send-now',
      chatRespond: 'apiary:chat-respond',
      chatSetPermissionMode: 'apiary:chat-set-permission-mode',
      chatSetModel: 'apiary:chat-set-model',
      chatSetEffort: 'apiary:chat-set-effort',
      chatStop: 'apiary:chat-stop',
      terminalBusy: 'apiary:terminal-busy',
      chatAttach: 'apiary:chat-attach',
      chatDetach: 'apiary:chat-detach',
      chatChanged: 'apiary:chat-changed',
      chatLifecycle: 'apiary:chat-lifecycle',
      appMenu: 'apiary:app-menu',
      appMenuInvoke: 'apiary:app-menu-invoke',
      setTitleBarColors: 'apiary:set-title-bar-colors',
      newSessionInPickedFolder: 'apiary:new-session-in-picked-folder',
      worktreeCreateOptions: 'apiary:worktree-create-options',
      worktreeCreate: 'apiary:worktree-create',
      gitPush: 'apiary:git-push',
      gitMerge: 'apiary:git-merge',
      gitFetch: 'apiary:git-fetch',
      mrStatusesInvalidated: 'apiary:mr-statuses-invalidated',
      updateStatus: 'apiary:update-status',
      updateCheck: 'apiary:update-check',
      updateDownload: 'apiary:update-download',
      updateInstall: 'apiary:update-install',
      updateOpenDownloaded: 'apiary:update-open-downloaded',
      updateSkip: 'apiary:update-skip',
      updateDismiss: 'apiary:update-dismiss',
      updateChanged: 'apiary:update-changed',
      pluginBarItems: 'apiary:plugin-bar-items',
      pluginBarRefresh: 'apiary:plugin-bar-refresh',
      pluginRunAction: 'apiary:plugin-run-action',
      pluginList: 'apiary:plugin-list',
      pluginsChanged: 'apiary:plugins-changed',
      logStatus: 'apiary:log-status',
      logReveal: 'apiary:log-reveal',
      logClear: 'apiary:log-clear',
      logWrite: 'apiary:log-write',
      tabDropped: 'apiary:tab-dropped',
      tabDetach: 'apiary:tab-detach',
      tabAdoptHere: 'apiary:tab-adopt-here',
      tabAdopt: 'apiary:tab-adopt',
      tabClaimed: 'apiary:tab-claimed',
      reportLayout: 'apiary:report-layout',
      requestLayoutFlush: 'apiary:request-layout-flush',
      reportTabs: 'apiary:report-tabs',
      activeTabs: 'apiary:active-tabs',
      activeTabsChanged: 'apiary:active-tabs-changed',
      focusTab: 'apiary:focus-tab',
      selectTab: 'apiary:select-tab',
      spellingGetLanguages: 'apiary:spelling-get-languages',
      spellingSetLanguage: 'apiary:spelling-set-language',
    })
  })

  it('has a guard for every invoke and send channel', () => {
    for (const [key, spec] of Object.entries(IPC)) {
      if (spec.kind === 'sync' || spec.kind === 'event') continue
      expect(typeof spec.args, `${key} has no argument guard`).toBe('function')
    }
  })

  it('rejects an argument list that is too long, and the declared shape', () => {
    expect(IPC.gitStatus.args([{ kind: 'pty', id: 'a' }])).toBe(true)
    expect(IPC.gitStatus.args([{ kind: 'session', id: 'a' }, 'extra'])).toBe(false)
    expect(IPC.gitStatus.args(['a', true])).toBe(false)
    // A TerminalRef replaced the old (key, isPtyId) pair: a kind and an id, nothing else.
    expect(IPC.gitStatus.args([{ kind: 'other', id: 'a' }])).toBe(false)
    expect(IPC.gitStatus.args([{ kind: 'session', id: 5 }])).toBe(false)
    expect(IPC.transcript.args(['a'])).toBe(true) // beforeIndex is optional
    expect(IPC.transcript.args(['a', 5])).toBe(true)
    expect(IPC.transcript.args(['a', 'nope'])).toBe(false)
  })

  it('rejects a malformed reportTabs array instead of letting it crash a handler (MAIN-19)', () => {
    expect(IPC.reportTabs.args([[{ key: 'a', view: 'transcript', ptyId: null, label: null }]])).toBe(true)
    expect(IPC.reportTabs.args([['not-a-tab']])).toBe(false)
    expect(IPC.reportTabs.args(['not-an-array'])).toBe(false)
  })

  // eslint-disable-next-line vitest/expect-expect -- `expectTypeOf().toEqualTypeOf()` IS the assertion; it is checked by `tsc`, not at runtime
  it('main is type-linked to the same contract the renderer bridge is built from (MAIN-11)', () => {
    // Compile-time-only (checked by `npm run typecheck`): `Handlers`/`Listeners` are keyed by
    // exactly the contract's `InvokeKey`/`SendKey` — so a channel added to (or removed from) the
    // contract without a matching main-side handler is a type error at `ipc/index.ts`'s
    // `const handlers: Handlers = { ... }`, not a "No handler registered" the first time someone
    // clicks the button.
    expectTypeOf<keyof Handlers>().toEqualTypeOf<InvokeKey>()
    expectTypeOf<keyof Listeners>().toEqualTypeOf<SendKey>()
  })
})
