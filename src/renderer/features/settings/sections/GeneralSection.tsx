import { type JSX, useEffect, useState } from 'react'
import { spellingLanguages } from '../../../state/spelling'
import type { SettingsDraft } from '../../../state/settingsStore'
import { CheckboxSetting } from '../fields/CheckboxSetting'
import { RemoteAccessSetting } from './RemoteAccessSetting'

/** Read as it draws, so a component test can stand in for Linux. */
const isLinux = (): boolean => navigator.userAgent.includes('Linux')

export function GeneralSection(
  { draft, patch, machineHost }: { draft: SettingsDraft; patch: (fields: Partial<SettingsDraft>) => void; machineHost: string | null },
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
    {machineHost === null && (
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
    )}
    {machineHost === null && (
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
    )}
    {machineHost === null && isLinux() && <XWaylandSetting checked={draft.linuxXWayland} onChange={(checked) => { patch({ linuxXWayland: checked }) }} />}
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
      testId="setting-new-sessions-in-chat"
      checked={draft.newSessionsInChat}
      disabled={!draft.transcriptChat}
      onChange={(checked) => { patch({ newSessionsInChat: checked }) }}
      label="Open new sessions in the chat"
      help={(
        <>
          A session started with + opens on its Chat tab instead of its terminal. Your first
          message starts it, and the replies show in the chat. Needs &quot;Run sessions as a
          chat&quot;.
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
    {machineHost === null
      ? <RemoteAccessSetting draft={draft} patch={patch} />
      : <RemoteAccessReadOnly host={machineHost} on={draft.remoteAccess} />}
    </>
  )
}

/**
 * Remote access on the work machine's view: its state only. Turning it off from here would cut the
 * connection this window runs on, so the switch is not offered.
 */
function RemoteAccessReadOnly({ host, on }: { host: string; on: boolean }): JSX.Element {
  return (
    <div className="settings-row settings-row-stacked" data-testid="remote-access-readonly">
      <strong>Remote access</strong>
      <span className="settings-help">
        {on ? `On: ${host} serves its sessions to other machines over SSH.` : 'Off.'}
        {' '}This window runs over it, so it cannot be turned off from here.
      </span>
    </div>
  )
}

/** Linux on a Wayland desktop: run through XWayland, so windows come back on their own monitors. */
function XWaylandSetting({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }): JSX.Element {
  return (
    <CheckboxSetting
      testId="setting-linux-xwayland"
      checked={checked}
      onChange={onChange}
      label="Bring windows back on their own monitors (XWayland)"
      help={(
        <>
          On a Wayland desktop, apps cannot choose where their windows go, so Apiary&apos;s windows all
          came back on one screen. With this on, Apiary runs through XWayland, and each window
          comes back where it was, at its size, maximised if it was. Text can look slightly soft
          on a screen with fractional scaling; turn it off to run as a Wayland app. Applies the next
          time Apiary starts.
        </>
      )}
    />
  )
}
