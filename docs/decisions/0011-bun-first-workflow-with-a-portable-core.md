---
type: adr
title: ADR-0011 - Bun-first developer workflow with a portable published core
description: Bun is the project's development runtime. The published core is portable ESM that uses no Bun-only API, and the supported runtimes are stated only from executable evidence, never from CI pins.
status: accepted
created: 2026-09-07
modified: 2026-09-07
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
