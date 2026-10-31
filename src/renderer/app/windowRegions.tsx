import type { JSX } from 'react'
import type { UpdateStatusPayload } from '@shared/api'
import { StatusBar } from '../features/statusBar/StatusBar'
import { PetLayer, petsOut } from '../features/pets/PetLayer'
import { TextMenuHost } from '../features/spelling'
import { RemoteRoot } from '../features/remote'
import { ResidentsRoot } from '../features/residents'
import { TitleBar } from '../features/titleBar/TitleBar'
import { UpdateBanner } from '../features/update/UpdateBanner'
import { usePets } from '../state/petsStore'
import { useActiveTabs } from '../state/activeTabsStore'
import { remoteHost, type windowChrome } from '../state/windowParams'
import { useGpuCompositing, useMotionAttribute } from '../state/motion'
import { ThemeEffects } from '../theme/ThemeEffects'
import { useAppliedTheme, useThemeState } from '../theme/useTheme'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { crashNotice } from '../ui/errors'
import { useNotifications } from '../ui/notifications'

/*
 * Every region beside the layout fails alone. The decorative layers vanish with a
 * notification; the bars show a one-line fallback with a retry.
 */

/** The theme's back effects layer, which also owns what it needs: the theme and the GPU probe. */
export function ThemeEffectsLayer(): JSX.Element {
  const { notify } = useNotifications()
  const theme = useThemeState()
  /** What is on screen — a preview included — for the effects layer. */
  const applied = useAppliedTheme()
  const gpuCompositing = useGpuCompositing()
  const motion = useMotionAttribute()
  return (
    <ErrorBoundary
      label="The theme effects"
      fallback={null}
      resetKey={applied}
      onError={(thrown, componentStack) => { notify(crashNotice('The theme effects', thrown, componentStack)) }}
    >
      <ThemeEffects
        effects={applied?.effects ?? []}
        animated={theme.options.animated && motion === 'full'}
        intensity={theme.options.intensity}
        glass={applied?.material.kind === 'glass' ? applied.material : null}
        lowPower={!gpuCompositing}
      />
    </ErrorBoundary>
  )
}

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
      {/* The whole width under the sidebar and the panes alike. */}
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
      <ResidentsRoot onOpenSettings={onOpenSettings} />
    </>
  )
}
