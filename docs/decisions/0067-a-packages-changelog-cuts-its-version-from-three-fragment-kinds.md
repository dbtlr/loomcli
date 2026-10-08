---
type: adr
title: ADR-0067 - A package's changelog cuts its version from three fragment kinds
description: Any package keeps its own .changes/ and CHANGELOG.md in its package directory and reads its version from package.json, never from tags. Fragments are breaking, feature, or fix, and the highest kind present decides the bump, major, minor, or patch from 1.0, and minor or patch below it. loom changelog check validates the fragments, and loom changelog write cuts the version, renders the section, and consumes the fragments atomically. ADR-0012 keeps governing this repository's synchronized release.
status: proposed
created: 2026-10-07
modified: 2026-10-08
---

# ADR-0067 - A package's changelog cuts its version from three fragment kinds

## Context

[ADR-0012](0012-synchronized-versions-from-manifests-and-owned-fragments.md) versions this repository's libraries together. Each consumer-visible PR owns one fragment in `.changes/`, a `breaking.` prefix requires a migration section, the version comes from the manifests and never from tags, and only a maintainer-approved release cut writes it. Its compiler serves one synchronized `0.x` set: a breaking fragment advances the minor and anything else the patch, and it also refreshes the lockfile, reports material changes, and checks tags.

A Loom application is one package, often past `1.0`, where a new feature and a fix call for different bumps. Its author needs the fragment rules without the synchronized set, the release cut approval, or the repository's release machinery.

## Decision

- **Per package.** `.changes/` and `CHANGELOG.md` live in the package directory, under [ADR-0066](0066-the-toolchain-acts-on-one-package-directory.md). The version is the package's `package.json` `version`, and git tags never enter.
- **Three kinds.** `breaking.<slug>.md` is a breaking change, `feature.<slug>.md` a feature, and `<slug>.md` a fix. A breaking fragment carries the `### Migration` section the fragment grammar requires.
- **The bump.** The highest kind present decides it. From `1.0.0`, breaking advances the major, feature the minor, and fix the patch. Below `1.0.0`, breaking advances the minor, and feature or fix the patch, which is ADR-0012's rule exactly. A package at `0.0.0` cuts `0.1.0`.
- **`loom changelog check`.** It validates every fragment and needs no git history, so CI runs it.
- **`loom changelog write`.** It validates the fragments, computes the next version, renders one section with breaking entries first and each group in the order its fragments landed by the first-parent commit that added them, prepends it to `CHANGELOG.md`, sets the `package.json` version, and deletes the consumed fragments, atomically. It needs full git history. `--date` and `--narrative` shape the section, and `--dry-run` prints the section and the version and writes nothing.
- **Left out.** The per-package command refreshes no lockfile, which is the package manager's job, and reports no material changes, synchronizes no versions, and checks no tags or PR titles.
- **This repository.** ADR-0012 keeps governing this repository's synchronized release, its release cut, and its hidden commands. This record generalizes ADR-0012's fragment and manifest rules to any one package and adds the feature kind. This repository checks its fragments with `loom changelog check`, so its fragment guide admits `feature.`, and its synchronized cut runs through the hidden `loom release cut`, rendering the same three groups. Every package here is below `1.0.0`, where a feature advances the patch as a fix does, so a cut of this repository computes the same version under either record.

The contract and the acceptance are in [The package changelog](../toolchain.md#the-package-changelog).

## Considered options

- **Versions from git tags.** Rejected, as ADR-0012 rejected it. A tag can be missing, unfetched, or wrong, and the manifest is in the diff.
- **Two kinds, breaking and ordinary.** Rejected. From `1.0.0` a feature and a fix call for different bumps, and the author would pick one by hand on every cut.
- **Kinds read from commit messages.** Rejected. A commit message is written once and cannot be corrected by a later PR, and a fragment is a file the PR that changes the result amends or deletes.
- **Refreshing the lockfile in `write`.** Rejected. Each package manager owns its lockfile, and Loom cannot know which one a package uses or whether a workspace root holds the file.
- **A version override.** Rejected, as ADR-0012 rejected it. The fragments decide the version, and a cut that needs another version needs other fragments.

## Consequences

`loom changelog write --dry-run` replaces the repository's `preview` for a package. The fragment guide gains the `feature.` kind, and [`loom init`](../toolchain.md#loom-init) writes it into each package. This repository's guide admits `feature.` too, because the public `loom changelog check` validates its fragments. Its synchronized cut keeps ADR-0012's rule, where a feature fragment advances the patch as any fragment that is not breaking does, and renders it under `### Features`. The public command owns the `changelog` path, so the repository's hidden cut moved to `loom release cut`, and `loom release cut --dry-run` replaces its `changelog preview`.

## Status

Proposed 2026-10-07 with the contract in [The package changelog](../toolchain.md#the-package-changelog). It moves to accepted inside the release PR of the release that ships the implementation: both commands as specified, the bump table, and the acceptance in that section, under Node and Bun.

## Changelog

- 2026-10-07: Proposed with the toolchain contract.
- 2026-10-08: This repository checks its fragments with the public `loom changelog check`, so its fragment guide admits `feature.`, and its synchronized cut moved to the hidden `loom release cut`, which renders the same three groups under ADR-0012's version rule.
