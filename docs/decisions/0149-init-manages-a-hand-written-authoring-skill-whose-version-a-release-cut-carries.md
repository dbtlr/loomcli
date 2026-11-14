---
type: adr
title: ADR-0149 - init manages a hand-written authoring skill whose version a release cut carries
description: loom init writes the authoring skill, a skill that teaches a coding agent to author a Loom application, as managed files at .agents/skills/loom/ under the piece skill. It is Markdown written by hand in @loomcli/loom, its links into the repository render at the running version's tag, and init removes an unedited file of its own that it no longer renders. A release PR fails unless the skill's metadata.version equals the release version, so each release reviews the skill in a preparatory PR before the cut.
status: proposed
created: 2026-11-14
modified: 2026-11-14
---

# ADR-0149 - init manages a hand-written authoring skill whose version a release cut carries

## Context

A coding agent that writes a Loom application reads the code it imports and each export's doc comment, which [ADR-0147](0147-every-published-export-and-member-carries-a-doc-comment-and-every-value-an-example.md) requires of every published library. What neither shows is how the parts fit: how an application is laid out across files, when a middleware fits and when an action does, when a Command returns a result and when it throws a failure, what the `loom` bin does and when to run it, how to test an application, and how to ship one. Nothing in a new package teaches that, so an agent learns it by trial against validation.

`loom init` already writes one agent skill, the changelog skill, as a [managed file](../glossary.md#toolchain) under [ADR-0068](0068-init-writes-scaffold-files-once-and-owns-managed-files.md), so it follows the toolchain an author runs. A skill that teaches authoring describes the libraries as well as the toolchain, so each release can make it wrong, and nothing would say so. The libraries and `@loomcli/loom` share one version under [ADR-0012](0012-synchronized-versions-from-manifests-and-owned-fragments.md), so one version names both.

The release guard limits a release PR's diff to version fields, the lockfile, the changelog section, consumed-fragment deletions, and decision acceptances, as the [PR guard reference](../maintaining/pr-guards.md#release-prs) states.

## Decision

- **A hand-written skill.** The authoring skill is Markdown written by hand and committed at `packages/loom/skills/loom/` in this repository: `SKILL.md`, which maps the references and states the invariants an agent needs first, and one file per topic in `references/`. It is never generated. It teaches what the code and its doc comments do not show and links the reference pages rather than restating their rules.
- **It ships as files.** `@loomcli/loom`'s `files` gains `skills`, so the published package carries the folder beside `dist`. Init reads it at run time from its own package, the folder beside `dist` in a built `loom` and beside `src` in a source run, so the in-process tests under Node and Bun read the same files the tarball carries, and the packed-tarball check proves the folder ships.
- **Its frontmatter.** `SKILL.md` carries `name: loom`, a `description`, and `metadata.version`, the release version the skill was last reviewed against, as a string. The Agent Skills specification puts a version under `metadata`, and a top-level `version` fails its validator.
- **Where init writes it.** Init writes the skill to `.agents/skills/loom/` in the package directory, `SKILL.md` and `references/<topic>.md`, whatever the configuration file holds, beside the changelog skill. Each file is a managed file with its own header: `SKILL.md` on the first non-blank line after its frontmatter, as in the changelog skill, and a reference on its first line, as in the fragment guide.
- **One text for every package.** The skill's text is the same in every package. It names each path by its convention, such as `src/application.ts` and `.changes/`, and tells the agent that a `loom.config.json` in the package directory moves them, so it is the one managed file that does not name the configured paths.
- **One piece.** The piece `skill` covers both skills, so `--only skill` writes the changelog skill and the authoring skill.
- **Links at the running version.** A link in the source to a file of this repository outside the skill folder is written relative, so the repository's link check resolves it. Init rewrites the forms that check reads, inline links, images, and reference definitions, with the same skips, YAML frontmatter, fenced code, and inline code spans. It resolves each target against the source file's path in the repository and renders it as an absolute URL at the tag of its own version, `https://github.com/dbtlr/loomcli/blob/v<version>/<path>` for a file and `tree/` in place of `blob/` for a directory, keeping a `#fragment`, so an agent reads the documentation of the version installed. A link between the skill's own files stays relative, and an absolute URL is left as it is.
- **A stale file goes.** A Markdown file anywhere under `.agents/skills/loom/` that carries init's header, still matches its checksum, and is not one the running version renders, such as a reference a later release renamed, is removed, and init prints one line for it, and a directory the removal leaves empty is removed too. A drifted one stays, with a warning of its own that says the running version no longer ships the file, that `--force` removes it, and that deleting its header keeps it. `--force` removes it. A file without the header is the author's, and init never touches it.
- **Examples compile.** Each fenced `ts` block in the skill is a complete module that imports only from `@loomcli/core`, `@loomcli/plugins`, `@loomcli/validators`, `@loomcli/prompts`, `@loomcli/testing`, and `zod`, and `check:types` compiles every block against the packed tarballs of those packages, packing `@loomcli/testing` beside the four it packs today.
- **A release carries its reviewed version.** `loom pr check` reads `packages/loom/skills/loom/SKILL.md` at the head of a release PR and parses its frontmatter as YAML. A missing file, missing frontmatter, a missing `metadata.version`, a value that is not a string, or a version other than the one in the title each fails the check with a message that names the file. The release diff stays as it is, so the skill is reviewed and its version set in an ordinary PR before the cut. The release-cut skill learns the target version from a dry run at the cut base, reads the release's feature and breaking fragments against the skill, updates it where a fragment changes what it teaches, and sets `metadata.version` to the target even when nothing else changes. A version-only change takes `skip-changelog`, and a change to what the skill teaches takes a fragment. When that fragment raises the minimum version, the review repeats at the new target.

## Considered options

- **Setting the skill's version in the release PR.** Not chosen by the owner's ruling. It would widen the release diff past its mechanical files, and a content update to the skill would land in the cut.
- **Links to `main`, as a doc comment's `@see` writes them.** Not chosen by the owner's ruling. `main` can describe behavior the installed version lacks.
- **A piece of its own, or renaming `skill` to `changelog-skill` beside an `authoring-skill`.** Not chosen by the owner's ruling. The second breaks `--only skill`.
- **Leaving a file init no longer renders.** Not chosen by the owner's ruling. It would stay in the skill folder unlinked, with links to an older tag.

## Consequences

The release workflow tags `v<version>` once the version publishes, so for the minutes between the two, the links of a freshly installed skill name a tag that does not exist yet. A development build of `loom` carries the last release's version, because only a cut changes it, so its links name that release's tag, where a page added since is missing and every other page is one release old.

ADR-0068's managed files gain the authoring skill and the stale-file rule, and `--force` gains a second meaning, removing a drifted file the running version no longer renders. ADR-0130's fixed paths gain the authoring skill. Both carry a dated entry. The release guard gains one check, and the release-cut skill gains a step before the cut.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-14: Proposed with the contract for the authoring skill (LM-348). It extends ADR-0068's managed files and ADR-0130's fixed paths, each of which carries a dated entry.
