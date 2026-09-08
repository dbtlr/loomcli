---
type: adr
title: ADR-0012 - Synchronized library versions derive from manifests and owned change fragments, and only a release cut changes them
description: Every publishable library shares one 0.x version read from package.json, never from tags. Each consumer-visible PR owns one change fragment, ordinary PRs cannot touch versions, and a maintainer-approved release-cut PR is the only path that writes them.
status: accepted
created: 2026-09-07
modified: 2026-09-07
---

# ADR-0012 - Synchronized library versions derive from manifests and owned change fragments, and only a release cut changes them

## Context

Publishing several first-party libraries raises three questions: what the next version is, where its changelog comes from, and who is allowed to change it.

All publishable libraries under `packages/` share one exact stable `0.x` version and release together, including libraries with no changes. The compiler derives the next version from the current `package.json` versions and the pending fragment set: a breaking fragment advances the minor, anything else advances the patch, and `0.0.0` becomes `0.1.0` on the initial cut. Git tags never determine the version. The repository rests at the last released version between cuts, and the changelog has no Unreleased section.

Each PR with a consumer-visible effect owns one flat fragment in `.changes/`, and a `breaking.` prefix requires a structured migration section. A build-affecting PR without a fragment must carry the `skip-changelog` label with a stated reason. Ordinary PRs cannot change version fields. Only the release-cut PR runs the version writer, and a maintainer approves it; an ordinary merge never publishes.

The [changelog compiler](../changelog-compiler.md), the [PR guards](../pr-guards.md), and the [fragment guide](../../.changes/README.md) implement and enforce this decision.

## Considered options

- **Tag-derived versioning.** Rejected. A tag can be missing, unfetched, or wrong, and a local check cannot see a remote tag. The manifest is in the diff and under review.
- **Independent per-package versions.** Rejected. Consumers pin one exact version across every first-party library, and cross-library compatibility has one answer.
- **An Unreleased changelog section edited by feature PRs.** Rejected. It conflicts on every merge and lets a later PR forget to correct an earlier entry. Fragments are corrected or deleted by the PR that changes the result.
- **Automatic release on merge, or from an empty fragment set.** Rejected. A release is a deliberate cut with a human approval, and an empty set outside the initial cut has nothing to release.
- **Hand-edited version fields.** Rejected. The writer produces the version, the changelog section, and the lockfile together, and the PR guard checks the cut reproduces exactly.

## Consequences

Replacement version overrides are rejected. Publication and recovery machinery, which is what publication records would serve, remains separate work and is not covered by this record.
