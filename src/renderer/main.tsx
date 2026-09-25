import { createRoot } from 'react-dom/client'
import { App } from './App'
import { NotificationProvider } from './state/notifications'
import { NotificationCenter } from './components/NotificationCenter'
import { ErrorBoundary } from './components/ErrorBoundary'
import './fonts'
import './styles.css'
import { applyTheme } from './theme/applyTheme'

/**
 * The provider is outermost so that the outer error boundary — the one that catches a crash in
 * App itself, the sidebar included — still has somewhere to report to, and so the notification
 * stack keeps rendering even when everything below it has been replaced by the crash pane.
 */
/**
 * Marks whatever is scrolling for a moment, so its (otherwise hidden) scrollbar shows while it
 * moves — see the scrollbar rules in styles.css. Capture phase, because scroll does not bubble.
 */
const scrollTimers = new WeakMap<Element, number>()
document.addEventListener('scroll', (e) => {
  const el = e.target instanceof Element ? e.target : document.scrollingElement
  if (el === null) return
  el.setAttribute('data-scrolling', '')
  window.clearTimeout(scrollTimers.get(el))
  scrollTimers.set(el, window.setTimeout(() => { el.removeAttribute('data-scrolling') }, 900))
}, { capture: true, passive: true })

// Before the first render, so a themed window's first paint is already in its theme.
applyTheme(window.apiary.initialTheme.active)

createRoot(document.getElementById('root')!).render(
  <NotificationProvider>
    <ErrorBoundary label="Apiary">
      <App />
    </ErrorBoundary>
    <NotificationCenter />
  </NotificationProvider>,
)
