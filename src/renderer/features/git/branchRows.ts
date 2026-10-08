/**
 * The rows Up/Down/Home/End move between in a branch list (`useRovingList`'s `itemSelector`): the
 * "Create branch…" style actions and every visible branch, remote and tag row — not the per-row
 * copy and pull buttons, which Tab still reaches in the ordinary order. Shared by the branch
 * switcher and the new-worktree dialog, whose lists are the same markup.
 */
export const BRANCH_ROW_SELECTOR = '.branch-switcher-action, .branch-switcher-row'
