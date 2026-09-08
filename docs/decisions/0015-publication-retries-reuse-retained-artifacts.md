---
type: adr
title: ADR-0015 - Publication retries reuse one retained artifact set
description: Publication identity includes immutable tarballs and their source evidence. Retries verify retained bytes and stop when artifacts are missing instead of rebuilding packages.
status: accepted
created: 2026-09-08
modified: 2026-09-08
---

# ADR-0015 - Publication retries reuse one retained artifact set

## Context

A failed publication can leave some package versions reserved while other steps remain incomplete. Rebuilding after a machinery repair can produce different bytes for that same version. A Git tag identifies source but does not prove package integrity or release completion.

One release artifact set binds the tarballs, their integrity digests, participating package list, version, source SHA, original release base, and consumed fragments. Preparation validates the committed cut with the existing compiler and PR guard. Consumer evidence runs against the same packed bytes.

A retry verifies and reuses that set. It never rebuilds release packages, substitutes a repair commit, or trusts package-version presence without matching integrity. Existing annotated tags are reusable only at the recorded source SHA. An absent, expired, or inconsistent set stops automatic recovery for maintainer reconciliation. Changed package contents require a new version.

GitHub Actions artifacts retain preparation and incomplete-release sets. The completed GitHub Release receives the identical set for durable history. The recorded manifest digest and source SHA are independent verification inputs, alongside the Actions artifact and run IDs.

## Considered options

- **Rebuild from the release source on retry.** Rejected. Source equality does not guarantee byte equality across builds.
- **Rebuild from repaired main.** Rejected. A tooling repair cannot silently replace package contents under a reserved version.
- **A separate durable object store.** Deferred. GitHub storage fits the existing delivery system. Finite Actions retention remains explicit, with reconciliation required after loss.
- **Treat a tag as completion.** Rejected. Packages, promotions, and GitHub Release publication can each fail independently.

## Consequences

[Preparation and verification](../publication-artifacts.md) enforce artifact identity and reuse. They do not establish external publication completion. The subsequent publication implementation must compare registry integrity, finish all promotions, and verify the matching tag and published GitHub Release. It must retain the identical set with that release before declaring completion.

This decision extends the publication boundary left open by [ADR-0012](0012-synchronized-versions-from-manifests-and-owned-fragments.md). It does not authorize publication or replacement cuts.
