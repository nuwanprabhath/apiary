/**
 * Marks whatever is scrolling for a moment, so its (otherwise hidden) scrollbar shows while it
 * moves — see the scrollbar rules in styles.css. Capture phase, because scroll does not bubble.
 *
 * A module of its own, imported for its side effect, so the component tests' harness installs the
 * same behaviour main.tsx does.
 */
const scrollTimers = new WeakMap<Element, number>()
document.addEventListener('scroll', (e) => {
  const el = e.target instanceof Element ? e.target : document.scrollingElement
  if (el === null) return
  el.setAttribute('data-scrolling', '')
  window.clearTimeout(scrollTimers.get(el))
  scrollTimers.set(el, window.setTimeout(() => { el.removeAttribute('data-scrolling') }, 900))
}, { capture: true, passive: true })
