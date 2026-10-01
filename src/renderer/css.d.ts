// Side-effect stylesheet imports (`import './styles.css'`, `@fontsource/*/….css`) are resolved by
// Vite, not tsc. TypeScript 6 checks side-effect imports by default (noUncheckedSideEffectImports),
// so declare them here. A separate file: `env.d.ts` is a module, where this would only augment.
declare module '*.css'
