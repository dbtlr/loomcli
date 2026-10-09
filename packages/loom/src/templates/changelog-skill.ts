/**
 * The changelog skill `loom init` manages at `.agents/skills/loom-changelog/SKILL.md`, without its
 * header. A blank line follows the frontmatter, which separates the header init puts there from
 * the title.
 */
export const changelogSkill = `---
name: loom-changelog
description: Keep this package's changelog. Add a change fragment in .changes/ for every consumer-visible change, validate it with loom changelog check, and cut a version with loom changelog write.
---

# Keep the changelog

This package cuts its version from change fragments in \`.changes/\`. The fragment guide, \`.changes/README.md\`, holds the naming rules, the body grammar, and the version table. Read it before writing a fragment.

## Record a change

1. Decide whether a consumer can see the change: a new or removed option, command, or export, changed output or errors, or a changed runtime requirement. A refactor, a test, or a chore that changes no behavior needs no fragment.
2. Pick the kind. A change that makes a consumer change their code or requirements is breaking, a compatible addition is a feature, and anything else is a fix.
3. Name the fragment \`breaking.<slug>.md\`, \`feature.<slug>.md\`, or \`<slug>.md\` with a unique slug, directly in \`.changes/\`.
4. Write one Markdown bullet per result, starting with a verb. A breaking fragment adds one \`### Migration\` section with the five labels the guide shows.
5. When a later change alters what an earlier pending fragment says, edit or delete that fragment instead of adding a contradicting one.
6. Run \`loom changelog check\` and fix each fragment it names.

## Cut a version

1. Make sure the clone has full git history, because the cut orders entries by the commit that added each fragment.
2. Run \`loom changelog write --dry-run\` and read the section and the next version it prints.
3. Run \`loom changelog write\`, with \`--date YYYY-MM-DD\` or \`--narrative FILE\` when the release needs them.
4. Run the package manager's install, because the cut refreshes no lockfile.
5. Commit \`CHANGELOG.md\`, \`package.json\`, the lockfile, and the deleted fragments together.
`;
