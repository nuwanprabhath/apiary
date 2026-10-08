import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { NotificationProvider } from './ui/notifications'
import { NotificationCenter } from './ui/NotificationCenter'
import { ErrorBoundary } from './ui/ErrorBoundary'
import './fonts'
import './styles.css'
import './scrollMarks'
import { applyTheme } from './theme/applyTheme'
import { initialTheme } from './state/theme'

// Before the first render, so a themed window's first paint is already in its theme.
applyTheme(initialTheme().active)

/**
 * The provider is outermost so that the outer error boundary — the one that catches a crash in
 * App itself, the sidebar included — still has somewhere to report to, and so the notification
 * stack keeps rendering even when everything below it has been replaced by the crash pane.
 */
createRoot(document.getElementById('root')!).render(
  <NotificationProvider>
    <ErrorBoundary label="Apiary">
      <App />
    </ErrorBoundary>
    <NotificationCenter />
  </NotificationProvider>,
)
