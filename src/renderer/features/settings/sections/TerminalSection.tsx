import type { JSX } from 'react'
import type { AppSettingsPayload } from '@shared/api'
import { previewPrompt } from '@shared/promptPreview'
import { CheckboxSetting } from '../fields/CheckboxSetting'
import { NumberSetting } from '../fields/NumberSetting'

/**
 * The path the preview is shown against: a real worktree layout, not the user's own directory.
 * A fixed example is what makes the setting comparable — the point being demonstrated is that one
 * folder shortens such a path and two barely do, and that only shows if the example is long.
 */
const EXAMPLE_PATH = '~/projects/paratoo-fdcp.worktrees/pipeline-issues'

export function TerminalSection(
  { draft, patch }: { draft: AppSettingsPayload; patch: (fields: Partial<AppSettingsPayload>) => void },
): JSX.Element {
  return (
    <>
      <CheckboxSetting
        testId="setting-terminal-minimal-prompt"
        checked={draft.terminalMinimalPrompt}
        onChange={(checked) => { patch({ terminalMinimalPrompt: checked }) }}
        label={<>Minimal prompt: just <code>$</code></>}
        help={(
          <>
            The shell&rsquo;s prompt shows nothing but <code>$</code> — no user, host or
            path — so the whole line is yours to type in. The session&rsquo;s header
            already says where the terminal is, and <code>pwd</code> still does. Works in
            bash (including macOS&rsquo;s own) and zsh, after your own startup files, so
            everything else they set up is untouched.
          </>
        )}
      />

      <CheckboxSetting
        testId="setting-terminal-shorten-path"
        checked={draft.terminalShortenPath}
        onChange={(checked) => { patch({ terminalShortenPath: checked }) }}
        disabled={draft.terminalMinimalPrompt}
        dataDisabled={draft.terminalMinimalPrompt}
        label="Shorten the path in the prompt"
        help={(
          <>
            A worktree path takes most of a narrow terminal&rsquo;s first line before you
            have typed anything, and the part that identifies it is the end. Apiary asks
            the shell to keep only the last few folders, leaving the rest of your prompt
            exactly as you have it. One folder is usually the right answer: a worktree
            path is identified by its last component, and keeping two of
            <code> thing.worktrees/pipeline-issues</code> keeps nearly the whole path.
          </>
        )}
      />

      {draft.terminalShortenPath && !draft.terminalMinimalPrompt && (
        <div className="settings-row settings-row-indent">
          <NumberSetting
            testId="setting-terminal-path-segments"
            label="Keep the last"
            unit="folders"
            min={1}
            max={8}
            value={draft.terminalPathSegments}
            onChange={(n) => { patch({ terminalPathSegments: n }) }}
          />
          <div className="settings-help settings-preview" data-testid="terminal-path-preview">
            <code>{previewPrompt(EXAMPLE_PATH, {
              enabled: draft.terminalShortenPath,
              segments: draft.terminalPathSegments,
            })}
            </code>
          </div>
        </div>
      )}

      <div className="settings-row settings-row-indent">
        <span className="settings-help" data-testid="terminal-shorten-note">
          Both apply to terminals opened from now on — a shell already running keeps the
          environment it started with. With the minimal prompt on, the path is gone
          anyway, so shortening it does nothing. Shortening uses bash&rsquo;s own <code>PROMPT_DIRTRIM</code>,
          so a zsh prompt is unaffected: zsh has no equivalent, and the alternative is
          overwriting a prompt you configured yourself. It needs bash 4 or newer, so
          macOS&rsquo;s own <code>/bin/bash</code> (still 3.2) ignores it.
        </span>
      </div>
    </>
  )
}
