---
type: adr
title: ADR-0083 - A synchronized release may select a version above the fragment minimum
description: The synchronized release cut accepts an explicit stable 0.x target at or above the fragment-derived minimum. Omission preserves automatic calculation, and fragment kinds continue to describe consumer effects.
status: accepted
created: 2026-10-15
modified: 2026-10-16
---

# ADR-0083 - A synchronized release may select a version above the fragment minimum

## Context

[ADR-0012](0012-synchronized-versions-from-manifests-and-owned-fragments.md) derives one synchronized version from the current manifests and pending fragments. Below `1.0.0`, compatible features advance the patch. A milestone containing only compatible changes can still warrant a minor release. Reclassifying a compatible feature as breaking to obtain that version would misstate its consumer effect and require a fictitious migration.

## Decision

- **An optional target.** `loom release cut --target 0.13.0` selects the synchronized target. The same option works with `--dry-run`. Omission preserves automatic calculation. The name `--target` leaves the global `--version` control unchanged.
- **A minimum, not a classification.** The target must exceed the current version and meet or exceed the fragment-derived next version. Larger bumps are allowed. Fragments retain their actual kinds and migration requirements.
- **The same version forms.** A target is a stable `0.x` version accepted by the synchronized manifests. Leading zeroes, a `v` prefix, prereleases, build metadata, and `1.0.0` remain unsupported.
- **The same safeguards.** Nonempty fragments remain required except with `--initial` from `0.0.0`. Initial releases have a minimum of `0.1.0`. Notes, clean-checkout, tag, lockfile, manifest synchronization, and release-file checks remain in force. Invalid targets fail before release files change.
- **One selected version throughout.** The dry run and writer use the selected target. Release PR admission treats the title version as that target, applies the same minimum rule, and reproduces the generated files from the base. Publication planning reads the committed manifests. Recording uses that planned version and verifies registry provenance and artifact integrity.
- **A bounded scope.** This replaces ADR-0012's exact fragment-derived version requirement and rejection of version overrides for synchronized cuts alone. [ADR-0067](0067-a-packages-changelog-cuts-its-version-from-three-fragment-kinds.md) retains automatic calculation and rejects overrides for the public per-package `loom changelog write`. Target selection applies to every synchronized cut, including a replacement cut. A cut never rewrites, republishes, or retags the version it supersedes. Recovery procedures and publication authorization remain unchanged.

## Consequences

The PR title and synchronized manifests record the chosen target, so the cut needs no additional metadata file. A title alone cannot admit a release: the guard still reproduces its changelog, manifests, and lockfile.

The pinned published tool in [ADR-0075](0075-the-release-workflow-runs-a-pinned-published-loom-cli.md) runs only `release plan` and `release record`. Those commands read the selected version instead of recalculating a bump. The PR guard builds the checkout's tool, so this change can ship without first publishing itself or changing the release-tool pin.

## Status

Accepted in 0.13.0.
