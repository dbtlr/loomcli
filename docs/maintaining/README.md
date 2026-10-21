---
description: The router into the references for maintainers of the Loom repository. The release workflow, the PR guards, the changelog compiler, the marked-string wire contract, and the glyph catalog.
---

# Maintaining Loom

These pages document how this repository builds, checks, and releases Loom. An application author does not need them.

- [Release workflow](release-workflow.md): open it when a release PR merges and the workflow publishes the packages, or a release run needs recovery.
- [PR guards](pr-guards.md): open it when a PR's fragment, version, or release-cut check fails.
- [Changelog compiler](changelog-compiler.md): open it when you prepare the synchronized release cut or its dry run.
- [Marked-string wire contract](style-wire.md): open it when you change how core frames style spans, glyphs, padding, or no-wrap text inside a marked string.
- [Glyph reference](glyphs.md): open it when you need a glyph's main or compatibility form. `scripts/check-glyph-catalog.py` generates the page.
