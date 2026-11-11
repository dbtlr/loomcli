---
type: adr
title: ADR-0145 - Below 1.0.0, a feature fragment advances the minor
description: Below 1.0.0, a feature fragment advances the minor, as a breaking fragment does, and only a fix fragment advances the patch. From 1.0.0 the bump is unchanged. The rule governs loom changelog write and this repository's loom release cut alike. It supersedes ADR-0067's bump clause below 1.0.0 and ADR-0012's rule that anything not breaking advances the patch.
status: proposed
created: 2026-11-11
modified: 2026-11-11
---

# ADR-0145 - Below 1.0.0, a feature fragment advances the minor

## Context

[ADR-0012](0012-synchronized-versions-from-manifests-and-owned-fragments.md) set this repository's `0.x` bump before fragments had kinds beyond breaking: a breaking fragment advances the minor, and anything else the patch. [ADR-0067](0067-a-packages-changelog-cuts-its-version-from-three-fragment-kinds.md) added the feature kind and kept that rule below `1.0.0` on purpose, so a cut of this repository computed the same version under either record. One function, `nextVersion`, computes the bump for both `loom changelog write` and the hidden `loom release cut`.

The result is that a feature cut on `0.x` ships as a patch. A `0.4.7` package that adds a command cuts `0.4.8`, the version a fix alone would cut. Most Loom applications start below `1.0.0`, so every one of them meets this rule on its first feature release, and neither the version nor the changelog section's `### Features` heading warns them. The common `0.x` reading, and the default of release tools such as release-please and changesets, is that a feature advances the minor. Two later records worked around the rule rather than changing it: [ADR-0083](0083-a-synchronized-release-may-select-a-version-above-the-fragment-minimum.md) let this repository's cut choose a minor for a feature milestone, and [ADR-0132](0132-a-packages-changelog-cut-may-choose-its-version-cut-a-prerelease-and-set-a-shared-version.md) gave `loom changelog write` the same `--target` after Heimdall's feature-only v0.8.0 would otherwise have cut v0.7.3.

## Decision

- **The bump.** The highest kind present decides the next version.

  | Current version | Breaking | Feature | Fix   |
  | --------------- | -------- | ------- | ----- |
  | `0.0.0`         | `0.1.0`  | `0.1.0` | `0.1.0` |
  | Below `1.0.0`   | Minor    | Minor   | Patch |
  | From `1.0.0`    | Major    | Minor   | Patch |

  Advancing the minor resets the patch, and advancing the major resets both.
- **Both cuts.** The table governs `loom changelog write` and this repository's `loom release cut`, which share it. It is the fragment minimum that ADR-0083 and ADR-0132 floor a chosen target at, so a feature fragment on `0.x` now needs at least the next minor.
- **Kinds stay.** A fragment's kind still describes its consumer effect alone. A breaking fragment still carries its migration section, and on `0.x` it still advances the minor, not the major, so a `0.x` package reaches `1.0.0` only through `loom changelog write --target`.

## Considered options

- **Keep the rule and rely on `--target`.** Rejected. The default is the version most cuts take, and an author who never reads the table ships features as patches without knowing it.
- **Strict SemVer at every version, with breaking advancing the major on `0.x`.** Rejected. A `0.x` package's first breaking change would cut `1.0.0`, which declares a stability its author has not chosen.
- **A configuration key that selects the `0.x` rule.** Rejected. One table serves every package, and `--target` already covers a cut that wants a larger version.

## Consequences

A feature-only cut from `0.4.7` takes `0.5.0`, and a fix-only cut takes `0.4.8`. A `--target` between the two, such as `0.4.9` with a feature pending, now fails and names `0.5.0`. An application on `0.x` changes no code; its next cut with a feature fragment takes a minor. The [package changelog](../toolchain/changelog.md), the fragment guide `loom init` writes, this repository's [fragment guide](../../.changes/README.md), and the [changelog compiler](../maintaining/changelog-compiler.md) state the table.

## Status

Proposed.

## Changelog

- 2026-11-11: Proposed with the version computation change (LM-492).
