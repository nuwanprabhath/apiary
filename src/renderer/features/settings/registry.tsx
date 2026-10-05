import type { JSX } from 'react'
import type { AppSettingsPayload, PluginInfoPayload, UpdateStatusPayload } from '@shared/api'
import { SessionsSection } from './sections/SessionsSection'
import { SearchSection } from './sections/SearchSection'
import { SidebarSection } from './sections/SidebarSection'
import { ThemesSectionEntry } from './sections/ThemesSectionEntry'
import { TerminalSection } from './sections/TerminalSection'
import { PluginsSection } from './sections/PluginsSection'
import { PetsSection } from './sections/PetsSection'
import { UpdatesSection } from './sections/UpdatesSection'
import { GeneralSection } from './sections/GeneralSection'
import { DiagnosticsSection } from './sections/DiagnosticsSection'

/**
 * Everything any section could need. A section takes only the slice it uses — see each one's own
 * props — and `registry.ts` wires the full bag down to it, rather than every section's signature
 * having to agree on one shape (UI-20's registry, replacing the 600-line ternary chain that used
 * to be SettingsDialog.tsx).
 */
export interface SectionProps {
  draft: AppSettingsPayload
  patch: (fields: Partial<AppSettingsPayload>) => void
  update: UpdateStatusPayload | null
  plugins: PluginInfoPayload[]
  indexed: number | null
  notesIndexed: number
  rebuilding: boolean
  onRebuild: () => void
}

export interface Section {
  id: string
  label: string
  /** Shown under the section heading, saying what this group of settings is for. */
  blurb: string
  Component: (props: SectionProps) => JSX.Element
}

export const SECTIONS: Section[] = [
  {
    id: 'sessions',
    label: 'Sessions',
    blurb: 'How sessions get into Apiary, and how often it looks for new ones.',
    Component: ({ draft, patch }) => <SessionsSection draft={draft} patch={patch} />,
  },
  {
    id: 'search',
    label: 'Search',
    blurb: 'What the search box looks at when you type in it.',
    Component: ({ draft, patch, indexed, notesIndexed, rebuilding, onRebuild }) => (
      <SearchSection
        draft={draft} patch={patch} indexed={indexed} notesIndexed={notesIndexed}
        rebuilding={rebuilding} onRebuild={onRebuild}
      />
    ),
  },
  {
    id: 'sidebar',
    label: 'Sidebar',
    blurb: 'How the session list behaves while you work.',
    Component: ({ draft, patch }) => <SidebarSection draft={draft} patch={patch} />,
  },
  {
    id: 'themes',
    label: 'Themes',
    blurb: 'How Apiary looks. A theme changes colours, type, shape and effects — never what is where.',
    Component: () => <ThemesSectionEntry />,
  },
  {
    id: 'terminal',
    label: 'Terminal',
    blurb: 'The shells Apiary starts for a session.',
    Component: ({ draft, patch }) => <TerminalSection draft={draft} patch={patch} />,
  },
  {
    id: 'pets',
    label: 'Pets',
    blurb: 'Little characters that keep you company along the edge of the window.',
    Component: () => <PetsSection />,
  },
  {
    id: 'plugins',
    label: 'Plugins',
    blurb: 'Extras that add a button to the bar under a session.',
    Component: ({ draft, patch, plugins }) => <PluginsSection draft={draft} patch={patch} plugins={plugins} />,
  },
  {
    id: 'updates',
    label: 'Updates',
    blurb: 'How Apiary keeps itself up to date.',
    Component: ({ draft, patch, update }) => <UpdatesSection draft={draft} patch={patch} update={update} />,
  },
  {
    id: 'general',
    label: 'General',
    blurb: 'Where Apiary finds the tools it runs.',
    Component: ({ draft, patch }) => <GeneralSection draft={draft} patch={patch} />,
  },
  {
    id: 'diagnostics',
    label: 'Diagnostics',
    blurb: 'A log you can switch on when something goes wrong, and send on.',
    Component: ({ draft, patch }) => <DiagnosticsSection draft={draft} patch={patch} />,
  },
]

/** The blurb for the section on screen, by id rather than by position in the array. */
export const blurbOf = (id: string): string => SECTIONS.find((s) => s.id === id)?.blurb ?? ''
