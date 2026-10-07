---
type: adr
title: ADR-0068 - init writes scaffold files once and owns managed files
description: loom init acts on one package directory. Scaffold files and package.json keys are written once when missing, never overwritten, and never tracked, because they are the author's code. Managed files, the fragment guide and the changelog skill, carry a header with a checksum of their content; init re-renders a matching file, warns about a drifted one and leaves it unless --force, and treats a file without the header as the author's. loom check warns about drift and never fails for it.
status: proposed
created: 2026-10-07
modified: 2026-10-07
---

# ADR-0068 - init writes scaffold files once and owns managed files

## Context

A new Loom application needs an application module, an entry, the `package.json` keys that build and check it, and the fragment guide and agent skill that keep its changelog under [ADR-0067](0067-a-packages-changelog-cuts-its-version-from-three-fragment-kinds.md). These files differ in who owns them after they are written. The application module is the author's from its first edit. The fragment guide and the skill describe the toolchain, so they go stale when the toolchain changes, and an author rarely edits them.

## Decision

- **One package directory.** `loom init` in an empty directory scaffolds a new application there. In an existing package it adds only the missing pieces, under [ADR-0066](0066-the-toolchain-acts-on-one-package-directory.md). `--only <piece>` limits it.
- **Scaffold files.** `src/application.ts`, `src/main.ts`, and the `package.json` keys `bin`, `scripts` for `build` and `check`, `dependencies` for `@loomcli/core`, and `devDependencies` for `@loomcli/loom`. Init writes each once, only when it is missing, never overwrites an existing file or key, and never tracks one, because each is the author's code.
- **Managed files.** `.changes/README.md`, the fragment guide with the `feature.` kind, and an agent skill for keeping a changelog, at `.agents/skills/<name>/SKILL.md` in the package directory. Each carries a header holding a checksum of its content, a Markdown comment, and in a skill the line after its frontmatter.
- **Re-running init.** Init re-renders a managed file whose checksum matches. A drifted managed file draws a warning and is left alone unless `--force`. Removing the header releases the file from management, and init treats it as the author's from then on.
- **Drift never fails a check.** `loom check` warns about a drifted managed file and never fails for one.
- **Later pieces.** The release-cut skill, workflows, and installer scripts join init with the release orchestration design.

The contract and the acceptance are in [loom init](../toolchain.md#loom-init).

## Considered options

- **Overwriting every file on each run.** Rejected. It destroys the author's application code and any deliberate edit to a guide.
- **Writing everything once, with nothing managed.** Rejected. The guide and the skill would go stale with each toolchain release, and nothing would say so.
- **A manifest file listing the managed files and their checksums.** Rejected. It is one more file to keep beside the package, a file copied without it loses its state, and a header travels with the file it describes.
- **Managing the scaffold files too.** Rejected. An application module is edited at once, so it would be drifted from its first change and every run would warn.

## Consequences

An author keeps a managed file current by re-running init after upgrading `@loomcli/loom`. An author who wants a guide of their own deletes the header once. In a monorepo, the skill sits in the package directory, below the repository root, where an agent that discovers skills only at the root does not find it.

## Status

Proposed 2026-10-07 with the contract in [loom init](../toolchain.md#loom-init). It moves to accepted inside the release PR of the release that ships the implementation: scaffold files written once, managed files with their headers, the drift rules, and the acceptance in that section, under Node and Bun.

## Changelog

- 2026-10-07: Proposed with the toolchain contract.
