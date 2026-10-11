import { type JSX, useEffect, useState } from 'react'
import type { AppSettingsPayload } from '@shared/api'
import { spellingLanguages } from '../../../state/spelling'
import { CheckboxSetting } from '../fields/CheckboxSetting'
import { RemoteAccessSetting } from './RemoteAccessSetting'

export function GeneralSection(
  { draft, patch }: { draft: AppSettingsPayload; patch: (fields: Partial<AppSettingsPayload>) => void },
): JSX.Element {
  const [languages, setLanguages] = useState<string[]>([])
  useEffect(() => {
    void spellingLanguages().then(setLanguages)
  }, [])
  // A saved language this machine no longer has stays listed, so the select shows what is saved.
  const saved = draft.proofingLanguage
  const proofingOptions = saved === 'system' || languages.includes(saved) ? languages : [...languages, saved]
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
    <label className="settings-row settings-row-stacked">
      <strong>Proofing language</strong>
      <select
        className="search"
        data-testid="proofing-language-select"
        value={saved}
        onChange={(e) => { patch({ proofingLanguage: e.target.value }) }}
      >
        <option value="system">Follow the system language</option>
        {proofingOptions.map((code) => <option key={code} value={code}>{code}</option>)}
      </select>
      <span className="settings-help">
        Spelling suggestions and underlines use this dictionary. The change takes effect when you save.
        On macOS this setting has no effect; spelling uses the languages in System Settings.
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
    <RemoteAccessSetting draft={draft} patch={patch} />
    </>
  )
}
