import type { JSX } from 'react'
import type { AppSettingsPayload } from '@shared/api'
import { CheckboxSetting } from '../fields/CheckboxSetting'

export function GeneralSection(
  { draft, patch }: { draft: AppSettingsPayload; patch: (fields: Partial<AppSettingsPayload>) => void },
): JSX.Element {
  return (
    <>
    <label className="settings-row settings-row-stacked">
      <strong>Path to the claude binary</strong>
      <input
        className="search"
        data-testid="claude-bin-input"
        placeholder="Leave empty to use PATH"
        value={draft.claudeBin ?? ''}
        onChange={(e) => { patch({ claudeBin: e.target.value }) }}
      />
      <span className="settings-help">
        Set this only if resuming fails with &quot;claude: command not found&quot;. Run
        <code> which claude </code> in your shell to find it.
      </span>
    </label>
    <CheckboxSetting
      testId="setting-system-title-bar"
      checked={draft.systemTitleBar}
      onChange={(checked) => { patch({ systemTitleBar: checked }) }}
      label="Use the system title bar"
      help={(
        <>
          Apiary draws its own title bar and menus in the theme&apos;s colours. Turn this on to use
          the operating system&apos;s instead — for a window manager that does not get on with a
          custom title bar. Applies to windows opened after the change; restart Apiary to apply it
          to this one.
        </>
      )}
    />
    <CheckboxSetting
      testId="setting-transcript-chat"
      checked={draft.transcriptChat}
      onChange={(checked) => { patch({ transcriptChat: checked }) }}
      label="Run sessions as a chat, like the VS Code extension"
      help={(
        <>
          Messages sent from a session&apos;s Chat tab run it as a chat: replies stream in as
          they are written, tools ask for permission right there, and you stay on the Chat tab.
          A session runs either as a chat or in its terminal, not both — opening its terminal
          stops the chat, and the conversation carries on where it was.
        </>
      )}
    />
    <CheckboxSetting
      testId="setting-hide-tool-call-io"
      checked={draft.hideToolCallIo}
      onChange={(checked) => { patch({ hideToolCallIo: checked }) }}
      label="Hide tool calls in the chat"
      help={(
        <>
          Leaves out the boxes showing what Claude ran and what came back (commands, file reads,
          edits), so the Chat tab is what you said and what Claude said. This is where each Chat tab
          starts: its &quot;Hide tool calls&quot; switch changes the view for as long as you are
          looking at it without changing this.
        </>
      )}
    />
    </>
  )
}
