// Conventional Commits, as the history already writes them (feat(look): …, fix: …, chore: 1.24.0).
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Subjects here are sentences about behaviour and often longer than the default 100 columns
    // allow in the header; the body carries the detail, but a clipped subject helps nobody.
    'header-max-length': [2, 'always', 150],
    'subject-case': [0],
    'body-max-line-length': [0],
  },
}
