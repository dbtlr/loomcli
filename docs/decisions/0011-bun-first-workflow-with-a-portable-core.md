---
type: adr
title: ADR-0011 - Bun-first developer workflow with a portable published core
description: Bun is the project's development runtime. The published core is portable ESM that uses no Bun-only API, and the supported runtimes are stated only from executable evidence, never from CI pins.
status: accepted
created: 2026-09-07
modified: 2026-10-21
---

# ADR-0011 - Bun-first developer workflow with a portable published core

## Context

Two scopes are easy to conflate: the runtime the project develops on, and the runtimes the published package supports.

**Bun-first** names the project workflow. Bun is the preferred development, test, build, and execution runtime for this repository.

**Portable core** names the public runtime contract. The published `@loom/core` is pure ESM that runs on Node-compatible runtimes without any required Bun API. A Bun-specific capability lives behind an adapter or an optional package, never in core.

The supported runtimes are Node and Bun on macOS, Linux, and Windows. A compatibility baseline is stated only from executable evidence at the claimed versions, which ADR-0014 defines. The versions pinned in CI prove the setup runs; they are not a support statement.

## Considered options

- **Coupling core to Bun.** Rejected. It would make every consumer a Bun consumer.
- **Treating a bundle as removing the Bun dependency.** Rejected. Bundling hides an API dependency; it does not remove it.
- **Reading the CI matrix as the support statement.** Rejected. A pin says what CI runs today, not what the package promises. Raising or lowering a pin must not silently change the promise.

## Consequences

Explicit minimum Node and Bun versions and the TypeScript baseline remain open until the evidence exists. Adding a Bun-only API to core is a violation, not a convenience.

## Changelog

- 2026-09-08: The core package is named `@loomcli/core` before its first publication. References to `@loom/core` above name the same library. The architectural decision is unchanged.
- 2026-09-08: Windows left the CI matrix. By this record's own rule that support is stated only from executable evidence, the supported platforms are macOS and Linux, and Windows is unverified. The decision is unchanged; the platform sentence in Context is historical.
- 2026-09-29: [ADR-0050](0050-a-packet-built-into-the-application-says-whether-it-is-in-development.md), proposed, moves the example applications from `tsc` to `Bun.build`, so the examples use the build Loom applications use, and adds `@loomcli/loom/build`, whose `packet()` is a `Bun.build` plugin. Core stays portable: it reads the packet as data and uses no Bun-only API, and each bundle still runs under Node and Bun. The published packages keep `tsc`, because they ship declarations. It binds when accepted.
- 2026-09-30: [ADR-0050](0050-a-packet-built-into-the-application-says-whether-it-is-in-development.md) is accepted, so the entry above binds.
- 2026-10-07: [ADR-0065](0065-release-facts-on-the-host-say-how-the-running-application-was-built.md) and [ADR-0066](0066-the-toolchain-acts-on-one-package-directory.md), proposed, move the example applications from `Bun.build` with `packet()` to `loom build --target node`, which bakes the release facts. `loom build` and `loom check` do their work under Bun, which keeps the developer workflow Bun-first, and the published core stays portable: it reads the facts behind a `typeof` guard. They bind when accepted.
- 2026-10-20: [ADR-0100](0100-acceptance-plans-live-beside-the-tests.md), proposed, applies this record's rule that support is stated only from executable evidence to the code itself: code that no CI entry runs comes out until one runs it. No CI job runs Windows, so every branch Loom takes on `win32` comes out in 0.15.0, the `bun-windows-*` compile targets of `loom build` included, and Windows takes the paths Linux and macOS take. It binds when that record is accepted.
- 2026-10-21: [ADR-0103](0103-process-acceptance-comes-from-looms-own-pipeline-and-the-packed-consumer.md), accepted, supersedes ADR-0014, so it now defines the executable evidence the Context names: Loom's own pipeline and the packed consumer under Node and Bun on Linux and macOS, with the rest of the suite in-process under both runtimes. The decision is unchanged.
