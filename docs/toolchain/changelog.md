---
description: "The package changelog: change fragments and the changelog loom compiles from them."
---

# The package changelog

```text
loom changelog check
loom changelog write [--target VERSION] [--date YYYY-MM-DD] [--narrative FILE] [--dry-run]
loom changelog notes <version>
```

```sh
mkdir -p .changes
printf -- '- Add the `--tag` option to `notes list`.\n' > .changes/feature.list-by-tag.md
loom changelog check
git add .changes && git commit -m 'Add list-by-tag fragment'
loom changelog write --dry-run        # prints the section and 1.5.0, writes nothing
loom changelog write --date 2026-10-07
loom changelog notes 1.5.0            # prints the 1.5.0 section's body for the release page

loom changelog write --target 2.0.0-rc.1   # sets the version, keeps the fragments pending
loom changelog notes 2.0.0-rc.1            # prints the pending fragments
loom changelog write                       # finalizes 2.0.0 and consumes them
```

A package's changelog cuts its version from its pending fragments. `.changes/` and `CHANGELOG.md` live in the package directory unless the [configuration file](build.md#the-configuration-file)'s `paths.changes` and `paths.changelog` name other places, the version is the package's `package.json` `version`, and git tags never enter. Every mention of `.changes/` and `CHANGELOG.md` on this page means the configured folder and file. [ADR-0067](../decisions/0067-a-packages-changelog-cuts-its-version-from-three-fragment-kinds.md) and [ADR-0132](../decisions/0132-a-packages-changelog-cut-may-choose-its-version-cut-a-prerelease-and-set-a-shared-version.md) record the decisions.

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

  This is the version `write` cuts without `--target`. A current version with a prerelease part finalizes instead, as below. A current version in any other form fails the cut.
- **A chosen version.** `--target` cuts the version it names, such as `0.11.0` or `0.11.0-rc.1`: `MAJOR.MINOR.PATCH`, optionally followed by `-` and a SemVer prerelease part. A leading `v`, leading zeroes, and build metadata are refused. The target must rank above the current version under SemVer precedence, and its release part, the version without its prerelease part, must meet or exceed the *fragment minimum*: the version the table gives from the last release and the highest kind present. The last release is the current version when it is stable, and while the version is a prerelease it is the highest version among the changelog's release sections, or `0.0.0` when the changelog holds none. A release section's version is the first word of its level-two heading when that word is `v` and a `MAJOR.MINOR.PATCH` version, as in `## v1.4.0 - 2026-10-07`; any other level-two heading names no release. A fragment keeps its kind whatever version the cut takes, so a breaking fragment still carries its migration section. A malformed target, or one that fails either rule, fails the cut before any file changes and names the minimum.

  | Current version | Highest kind present | Target `0.11.0` | Target `0.9.5` |
  | --------------- | -------------------- | --------------- | -------------- |
  | `0.9.4`         | Fix                  | Cuts `0.11.0`   | Cuts `0.9.5`   |
  | `0.9.4`         | Breaking             | Cuts `0.11.0`   | Fails: at least `0.10.0` |
  | `0.11.0`        | Any                  | Fails: not above `0.11.0` | Fails |
- **A prerelease cut.** A target with a prerelease part sets the version and writes no section, and every fragment stays pending until a stable cut consumes it. It neither creates nor writes `CHANGELOG.md`; the checks below that the file has a title, no `Unreleased` section, and no section for the version apply at the stable cut. A prerelease cut from a stable version other than `0.0.0` fails, before any file changes, unless `CHANGELOG.md` holds that version's release section, because once the version is a prerelease that section is how the cut finds its last release; cut a stable release first, or add the section. `--date` and `--narrative` are still validated, and they shape no section. A later prerelease must rank above the one before it, so `0.11.0-rc.1` can be followed by `0.11.0-rc.2` but not by `0.11.0-beta.1`.
- **Finalizing.** From a prerelease, `write` without `--target` cuts the release part, `0.11.0-rc.2` to `0.11.0`, writing its section and consuming the fragments as any stable cut does. When a fragment that landed after the prerelease raises the fragment minimum past the release part, the cut fails, names the minimum, and asks for `--target`.
- **`check`.** It validates every fragment in `.changes/` and exits 1 for any invalid one, naming it. It accepts an empty set and a missing `.changes/`, and it needs no git history, so it runs in CI.
- **`write`.** It validates the fragments, takes the next version from `--target` or the table, and for a stable version renders one section: `## v<version> - <date>`, the narrative when given, then `### Breaking Changes`, `### Features`, and `### Fixes`, each omitted when empty. Each breaking fragment keeps its migration section beside its entries. Within a group, fragments sort by the first-parent commit that added each one and then by file name, so `write` needs full git history, and a shallow clone or a fragment no commit added fails it. It prepends the section above the earlier release sections of `CHANGELOG.md`, keeping its frontmatter, title, and history, and creates the file with a `# Changelog` title when it is missing. An existing `CHANGELOG.md` without a level-one title, with an `Unreleased` section, or that already holds a section for the next version fails the cut and changes no file. It sets `version` in `package.json` and in each file `sharedVersion` lists, changing nothing else in them, and deletes the consumed fragments. It writes every file through a temporary copy and replaces them together, so a failure before the replacement changes nothing.
- **Options.** `--date` is the release date, by default the current UTC date, and an invalid calendar date fails. `--narrative` copies the prose of a Markdown file above the entries, and the file cannot be empty or hold a level-one or level-two heading. `--dry-run` prints the section and the next version and writes nothing; for a prerelease it prints the version and how many fragments stay pending. A stable cut prints the section and then `Next version: <version>`, and a prerelease cut prints `Next version: <version>` and then `<count> fragments stay pending for <release part>.`
- **An empty set.** `write` with no fragments fails, `0.0.0` and a prerelease cut included, because a cut with nothing to release changes nothing a consumer can read.
- **A shared version.** The configuration file's `sharedVersion` lists `package.json` files that carry this package's version, so one cut sets every binary a repository ships from one tag. Before it changes anything, `write`, `--dry-run` included, fails when the value is not a list of nonempty strings, rather than dropping it as the configuration file drops other rejected values, and reads each listed file and fails, naming `sharedVersion` and the file, when one is missing, does not parse, has no `version` string, or holds a version other than this package's. The cut sets `version` in each listed file in the same replacement as `package.json`, so a failure changes none of them.

  ```jsonc
  // packages/collector/loom.config.json: one root changelog, three binaries
  {
    "paths": { "changes": "../../.changes", "changelog": "../../CHANGELOG.md" },
    "sharedVersion": ["../hub/package.json", "../dashboard/package.json"]
  }
  ```

- **`notes`.** It prints one version's notes for a release page and changes nothing. For a stable version it prints the body of that version's changelog section, everything under its heading up to the next release section, and a version with no section fails with exit 1, because the version has not been cut. For a prerelease version it prints the pending fragments grouped as `write` renders a section, with no heading or narrative, so it needs full git history as `write` does. A prerelease version other than the package's current version fails with exit 1, as a stable version without a section does, and so does no pending fragment; `write --target <version> --dry-run` previews a candidate before its cut. The version takes `--target`'s form, so `v1.5.0` is an argument error.
- **Left to other tools.** `write` refreshes no lockfile, which is the package manager's job, so the author runs it after the cut; a lockfile that records workspace members' versions needs it after a cut that sets them. It reports no material changes, reads no workspace list, publishes nothing, and checks no tags, PR titles, or pull requests for fragments.
