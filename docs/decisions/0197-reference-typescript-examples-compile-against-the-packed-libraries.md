---
type: adr
title: ADR-0197 - Reference TypeScript examples compile against the packed libraries
description: Bare ts blocks in the reference compile against the packed libraries. Use ts sketch for signature listings, illustrations that cannot stand alone, and source excerpts that depend on omitted modules.
status: proposed
created: 2026-11-19
modified: 2026-11-19
---

# ADR-0197 - Reference TypeScript examples compile against the packed libraries

## Context

The Loom authoring skill's TypeScript examples compile against the packed libraries, under [ADR-0149](0149-init-manages-a-hand-written-authoring-skill-whose-version-a-release-cut-carries.md). The reference pages also teach authors through code, so they need the same check to catch missing imports and calls that drift from the published API.

## Decision

- In `docs/core`, `docs/plugins`, `docs/libs`, and `docs/toolchain`, use a bare `ts` fence for a complete example. `pnpm check:types` compiles it against the packed libraries and reports failures at the page, block, and line.
- Import the names an example uses. To show several files in one block, put a `// src/main.ts`-style path on its first line and mark each subsequent file the same way. Relative imports resolve between those paths. A `.json` marker writes a data file for the example.
- Write a checked example as a backtick fence tagged `ts` at the margin, indented at most three spaces. A TypeScript fence the check cannot read, one in a list item or a block quote, indented further, fenced with tildes, or tagged `typescript` or `tsx`, fails the check at its line rather than being skipped.
- The path markers are for the reference pages. Each block in the authoring skill stays one complete module, as ADR-0149 states.
- Use `ts sketch` for signature listings, illustrations that cannot stand alone, and excerpts of an application's or Loom's own source that depend on modules the page does not show. The check skips these blocks.
- The [doc-comment rules in ADR-0147](0147-every-published-export-and-member-carries-a-doc-comment-and-every-value-an-example.md) stay in force. The checks of doc-comment examples continue to verify their presence and fence.

## Considered options

- **Check every TypeScript block with no opt-out.** Rejected. Signature listings cannot compile as standalone examples.
- **Check only blocks marked `ts check`.** Rejected. Examples on new pages would go unchecked unless the author remembered to opt in.
- **Check signature listings against the API reports.** Deferred. Comparing listings with the API reports requires a separate check.

## Consequences

Complete examples on new reference pages enter the check by default. Changes to the packed libraries that break a checked example fail `pnpm check:types` at the example's location. Authors can include small helper modules in the same block to keep the example self-contained. Blocks marked `ts sketch` rely on review for accuracy.

## Status

Proposed until the release that includes the check.

## Changelog

- 2026-11-19: Proposed with the check (LM-556).
