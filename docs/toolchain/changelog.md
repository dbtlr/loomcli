---
description: "The package changelog: change fragments and the changelog loom compiles from them."
---

# The package changelog

The public per-package commands use automatic version calculation. Explicit `--target` selection belongs only to this repository's hidden [synchronized release cut](../maintaining/changelog-compiler.md#version-calculation).

```text
loom changelog check
loom changelog write [--date YYYY-MM-DD] [--narrative FILE] [--dry-run]
```

```sh
mkdir -p .changes
printf -- '- Add the `--tag` option to `notes list`.\n' > .changes/feature.list-by-tag.md
loom changelog check
git add .changes && git commit -m 'Add list-by-tag fragment'
loom changelog write --dry-run        # prints the section and 1.5.0, writes nothing
loom changelog write --date 2026-10-07
```

A package's changelog cuts its version from its pending fragments. `.changes/` and `CHANGELOG.md` live in the package directory, the version is the package's `package.json` `version`, and git tags never enter.

- **Three kinds.** A fragment named `breaking.<slug>.md` is a breaking change, `feature.<slug>.md` a feature, and `<slug>.md` a fix. A bare `breaking.md` or `feature.md` is invalid. A fragment's body follows the grammar of the fragment guide `loom init` writes: Markdown bullets with no frontmatter or headings, and for a breaking fragment one `### Migration` section with the five labels. A subdirectory or a non-Markdown file in `.changes/` is invalid. A hidden entry, one whose name starts with `.`, is not a fragment and is ignored. `.changes/README.md` is the guide, not a fragment.
- **The bump.** The highest kind present decides the next version.

  | Current version | Highest kind present | Next version |
  | --------------- | -------------------- | ------------ |
  | `0.0.0`         | Any                  | `0.1.0`      |
  | `0.4.7`         | Breaking             | `0.5.0`      |
  | `0.4.7`         | Feature or fix       | `0.4.8`      |
  | `1.4.7`         | Breaking             | `2.0.0`      |
  | `1.4.7`         | Feature              | `1.5.0`      |
  | `1.4.7`         | Fix                  | `1.4.8`      |

  A current version that is not `MAJOR.MINOR.PATCH`, a prerelease included, fails the cut, because prerelease channels belong to release orchestration.
- **`check`.** It validates every fragment in `.changes/` and exits 1 for any invalid one, naming it. It accepts an empty set and a missing `.changes/`, and it needs no git history, so it runs in CI.
- **`write`.** It validates the fragments, computes the next version, and renders one section: `## v<version> - <date>`, the narrative when given, then `### Breaking Changes`, `### Features`, and `### Fixes`, each omitted when empty. Each breaking fragment keeps its migration section beside its entries. Within a group, fragments sort by the first-parent commit that added each one and then by file name, so `write` needs full git history, and a shallow clone or a fragment no commit added fails it. It prepends the section above the earlier release sections of `CHANGELOG.md`, keeping its frontmatter, title, and history, and creates the file with a `# Changelog` title when it is missing. An existing `CHANGELOG.md` without a level-one title, with an `Unreleased` section, or that already holds a section for the next version fails the cut and changes no file. It sets `version` in `package.json`, changing nothing else in the file, and deletes the consumed fragments. It writes every file through a temporary copy and replaces them together, so a failure before the replacement changes nothing.
- **Options.** `--date` is the release date, by default the current UTC date, and an invalid calendar date fails. `--narrative` copies the prose of a Markdown file above the entries, and the file cannot be empty or hold a level-one or level-two heading. `--dry-run` prints the section and the next version and writes nothing.
- **An empty set.** `write` with no fragments fails, `0.0.0` included, because a cut with nothing to release changes nothing a consumer can read.
- **Left to other tools.** `write` refreshes no lockfile, which is the package manager's job, so the author runs it after the cut. It reports no material changes, keeps no versions synchronized across packages, and checks no tags or PR titles.

## The package changelog acceptance

The package changelog is proven when process runs of the packed `loom` bin produce these results under Node and Bun, in fixture git repositories:

- **The bump table.** Each row of the table cuts its next version from fixtures holding those kinds, and a package at `1.2.0-next.1` fails the cut.
- **Ordering.** Fragments added in three commits render in landing order within each group, breaking entries first, and a fragment edited in a later commit keeps its first position.
- **`check`.** A breaking fragment without its migration labels, a bare `feature.md`, and a fragment in a subdirectory each fail `check` with exit 1 and their names.
- **`write`.** A cut prepends the section, sets `version` with the rest of `package.json` byte-identical, deletes the consumed fragments, and leaves `.changes/README.md`. A shallow clone fails and changes no file. `--dry-run` prints the section and the version and leaves every file byte-identical.
