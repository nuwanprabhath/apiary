import { type JSX, useEffect, useState } from 'react'
import type { UpdateStatusPayload } from '@shared/api'
import { StatusBar } from '../features/statusBar/StatusBar'
import { PetLayer, petsOut } from '../features/pets/PetLayer'
import { TextMenuHost } from '../features/spelling'
import { RemoteRoot } from '../features/remote'
import { TitleBar } from '../features/titleBar/TitleBar'
import { UpdateBanner } from '../features/update/UpdateBanner'
import { usePets } from '../state/petsStore'
import { useActiveTabs } from '../state/activeTabsStore'
import { remoteHost, type windowChrome } from '../state/windowParams'
import { readGpuCompositing } from '../state/theme'
import { ThemeEffects } from '../theme/ThemeEffects'
import { useAppliedTheme, useThemeState } from '../theme/useTheme'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { crashNotice } from '../ui/errors'
import { useNotifications } from '../ui/notifications'

/*
 * B11 (UI-24): every region beside the layout fails alone. The decorative layers vanish with a
 * notification; the bars show a one-line fallback with a retry. Without these boundaries, a throw
 * in any of them was caught only by the root boundary and replaced the whole window.
 */

/** The theme's back effects layer, which also owns what it needs: the theme and the GPU probe. */
export function ThemeEffectsLayer(): JSX.Element {
  const { notify } = useNotifications()
  /** The theme, applied by the hook itself; kept here for the effects layer. */
  const theme = useThemeState()
  /** What is on screen — a preview included — for the effects layer. */
  const applied = useAppliedTheme()
  // Assumed until main answers (a moment after start-up); only effects' frame rate depends on it.
  const [gpuCompositing, setGpuCompositing] = useState(true)
  useEffect(() => {
    // Background probe (UI-23): a failure leaves `gpuCompositing` at its assumed-true default,
    // which only affects the effects layer's frame rate — nothing the user asked for, and nothing
    // worth a toast over.
    void readGpuCompositing().then((on) => { if (on !== null) setGpuCompositing(on) })
  }, [])
  return (
    <ErrorBoundary
      label="The theme effects"
      fallback={null}
      resetKey={applied}
      onError={(thrown, componentStack) => { notify(crashNotice('The theme effects', thrown, componentStack)) }}
    >
      <ThemeEffects
        effects={applied?.effects ?? []}
        animated={theme.options.animated}
        intensity={theme.options.intensity}
        glass={applied?.material.kind === 'glass' ? applied.material : null}
        lowPower={!gpuCompositing}
      />
    </ErrorBoundary>
  )
}

/** The title bar, the remote-window banner and the update banner, above the layout. */
export function WindowHeader({ chrome, title, updateStatus, onOpenSettings }: {
  chrome: ReturnType<typeof windowChrome>
  /** What is in front, as an editor's title bar names the open file; null for just the app name. */
  title: string | null
  updateStatus: UpdateStatusPayload | null
  onOpenSettings: (section: string) => void
}): JSX.Element {
  const { notify } = useNotifications()
  return (
    <>
      <ErrorBoundary
        label="The title bar"
        compact
        onError={(thrown, componentStack) => { notify(crashNotice('The title bar', thrown, componentStack)) }}
      >
        <TitleBar chrome={chrome} title={title !== null ? `${title} — Apiary` : 'Apiary'} />
      </ErrorBoundary>
      <RemoteRoot />
      {updateStatus !== null && (
        <ErrorBoundary
          label="The update banner"
          compact
          resetKey={updateStatus}
          onError={(thrown, componentStack) => { notify(crashNotice('The update banner', thrown, componentStack)) }}
        >
          <UpdateBanner status={updateStatus} onOpenSettings={() => { onOpenSettings('updates') }} />
        </ErrorBoundary>
      )}
    </>
  )
}

/** The status bar, the pets and the spelling menu — part of the window, not cards in the pane grid. */
export function WindowFooter({ sidebarHidden, titleOf, onOpenSettings }: {
  sidebarHidden: boolean
  /** The pets' hourly lines mention what the open sessions are about — by title only. */
  titleOf: (key: string) => string | null
  onOpenSettings: (section: string) => void
}): JSX.Element {
  const { notify } = useNotifications()
  const pets = usePets()
  const activeTabs = useActiveTabs()
  return (
    <>
      {/* Part of the window: the whole width under the sidebar and the panes alike, as VS Code's
       *  status bar is. */}
      <ErrorBoundary
        label="The status bar"
        compact
        onError={(thrown, componentStack) => { notify(crashNotice('The status bar', thrown, componentStack)) }}
      >
        <StatusBar onOpenSettings={onOpenSettings} keep={petsOut(pets)} />
      </ErrorBoundary>
      {/* Pets render model output, so they are the likeliest layer to fault. A new state retries.
       *  A remote window shows another machine's sessions: the pets belong to this one. */}
      {remoteHost() === null && (
        <ErrorBoundary
          label="The pets"
          fallback={null}
          resetKey={pets}
          onError={(thrown, componentStack) => { notify(crashNotice('The pets', thrown, componentStack)) }}
        >
          <PetLayer state={pets} sidebarHidden={sidebarHidden} tabs={activeTabs} titleOf={titleOf} onOpenSettings={onOpenSettings} />
        </ErrorBoundary>
      )}
      <ErrorBoundary
        label="The spelling menu"
        fallback={null}
        onError={(thrown, componentStack) => { notify(crashNotice('The spelling menu', thrown, componentStack)) }}
      >
        <TextMenuHost />
      </ErrorBoundary>
    </>
  )
}
