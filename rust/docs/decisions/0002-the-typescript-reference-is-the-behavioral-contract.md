---
type: adr
title: ADR-0002 - The TypeScript reference is the behavioral contract, and a difference is a recorded deviation
description: Operator-visible and machine-visible behavior follows the TypeScript reference byte for byte, except at a limit of the programming language, which the repository's ADR-0217 puts outside the promise. The authoring API is Rust-native. Each intentional difference is listed in the deviations register, and a conformance corpus captured from the reference examples proves the rest.
status: accepted
created: 2026-11-12
modified: 2026-11-24
---

# ADR-0002 - The TypeScript reference is the behavioral contract, and a difference is a recorded deviation

## Context

A sister framework has two surfaces. The operator surface is what a person or an agent meets when running an application: the grammar, messages, help pages, tables, exit codes, manifest JSON, MCP tool schemas and results, completion output, and file formats on disk. The author surface is the API a developer declares an application with.

The repository's [ADR-0217](../../../docs/decisions/0217-parity-between-looms-implementations-is-the-operators-experience.md) binds every implementation of Loom, this one included, and ranks above this record. It defines parity as the operator's experience, makes TypeScript the reference implementation until the implementations share a set of cases, and puts a limit of the programming language outside parity.

The operator surface follows the reference byte for byte. Its documents under `../docs` are this port's specification, and its tests under `../typescript` are the oracle. An agent that has learned one Loom application has learned them all, in either language, which is the purpose of an agent-first framework.

The promise stops at a limit of the programming language, as ADR-0217 states it: the largest integer a language holds exactly, a string type that cannot hold a lone surrogate, or the order JavaScript gives to integer-like keys. The bytes the reference prints at such a limit bind the TypeScript implementation alone. A difference there is neither a defect nor a deviation, and the port does not change to reproduce it. A limit that a library the port chose sets, such as the nesting depth a parser accepts, is not a limit of the language, and the promise covers it.

The author surface is Rust-native. It keeps the reference's vocabulary (Application, Command, argument, option, plugin, extension, view, provider, middleware) and its fluent declaration shape, and it uses Rust's own mechanisms where TypeScript's do not exist: traits for failure classes and validators, a derive for typed inputs, `#[non_exhaustive]` for output types.

A difference from the reference contract on the operator surface that is not at a limit of the language is a **deviation**. `docs/deviations.md` lists each one with its reason. Deviations are expected where following the reference would surprise an author who writes Rust, or where the platform differs, such as JavaScript-specific developer-diagnostic content, and nowhere else.

A **conformance corpus** under `conformance/` holds invocations of the reference examples (jsonkit and textstat) with the stdout, stderr, and exit code the TypeScript build produced. The Rust examples are ports of the same declarations and reproduce the corpus. The capture script reads the reference checkout's location from the environment, so the committed corpus runs without the reference built.

## Considered options

- **Treat the reference as inspiration and design the operator surface afresh.** Rejected. Two frameworks that share a name and differ in messages and JSON shapes give an agent two things to learn.
- **Differential tests that run the TypeScript build during `cargo test`.** Rejected. The Rust test suite would need Node and a built reference checkout. A captured corpus gives the same evidence hermetically.
- **Equal bytes at every input, the limits of each language included.** Rejected by ADR-0217. A limit of the language belongs to the language and the application, and it is not part of the operator's experience.

## Consequences

A reference behavior change is ported by re-capturing the corpus and following the failures. The reference revision the corpus was captured from is recorded in the corpus.

## Status

Accepted on 2026-11-12. The code that enforces this record has landed: the conformance corpus under `conformance/` holds 687 cases captured from the reference examples, the `conformance-harness` package runs them against the Rust `jsonkit` and `textstat`, and every difference is a row of `docs/deviations.md`.

## Changelog

- 2026-11-12: Accepted.
- 2026-11-24: Revised as the port moved into the repository beside the TypeScript workspace. The promise of the reference's bytes stops at a limit of the programming language, as the repository's ADR-0217 states, and the reference is `../typescript` and `../docs` in place of a separate checkout.
