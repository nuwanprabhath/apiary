import type { ESLint, Linter } from 'eslint'

declare const plugin: ESLint.Plugin
export const apiaryRules: Record<string, Linter.RuleSeverity>
export default plugin
