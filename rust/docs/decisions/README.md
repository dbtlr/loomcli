---
description: Index of the decision records for Loom CLI for Rust, with the rule for how each status binds planning, implementation, and review.
---

# Decision records

Each record captures one hard-to-reverse decision of the Rust port, the reasoning behind it, and the alternatives it rejected. The repository's own records, under [docs/decisions](../../../docs/decisions/README.md), bind every implementation and rank above these. [ADR-0217](../../../docs/decisions/0217-parity-between-looms-implementations-is-the-operators-experience.md) states what parity between the implementations covers. The TypeScript reference's records state why the behavioral contract is what it is, and they bind this port wherever a record here does not say otherwise.

## How a status binds the work

| Status       | Binding                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `accepted`   | Load-bearing. Code and plans rely on it, and its language is locked. Changing it means writing a record that supersedes it. |
| `proposed`   | The agreed shape ahead of the code that will enforce it. A violation re-opens the decision. Details may still move.         |
| `superseded` | Kept for history. It names the record that replaced it and binds nothing.                                                   |
| `deprecated` | Kept for history. Its closing section records why.                                                                          |

## Records

| Record                                                                       | Decision                                                                                             | Status   |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------- |
| [ADR-0001](0001-core-owns-its-parser-and-does-not-build-on-clap.md)          | Core owns its parser, graph, and rendering, and does not build on Clap.                              | accepted |
| [ADR-0002](0002-the-typescript-reference-is-the-behavioral-contract.md)      | The TypeScript reference is the behavioral contract, outside a language's limits, and a difference is a recorded deviation. | accepted |
| [ADR-0003](0003-a-run-is-asynchronous-on-tokio.md)                           | A run is asynchronous on tokio, and an action is an async closure.                                   | accepted |
| [ADR-0004](0004-one-dynamic-builder-and-a-derive-that-expands-to-it.md)      | Declarations are one dynamic builder, and a derive that expands to it carries the types.             | accepted |
| [ADR-0005](0005-a-plugin-is-a-value-any-crate-exports.md)                    | A plugin is a value any crate exports, and the first-party pack is one crate with a feature each.    | accepted |
| [ADR-0006](0006-rust-tracks-the-shared-conformance-cases-it-is-behind-on-in-a-list-apart-from-deviations.md) | Rust lists the shared conformance cases it is behind on in [behind.json](../../conformance/behind.json), apart from deviations; Rust work only shrinks the list, and a TypeScript change that alters expected output grows it. | proposed |
