---
type: adr
title: ADR-0006 - Rust tracks the shared conformance cases it is behind on in a list, apart from deviations
description: The conformance cases live in the repository's shared conformance/ directory, captured from TypeScript, and both implementations check them. A case Rust has yet to match is listed with its differing parts in rust/conformance/behind.json, which Rust work only shrinks and a TypeScript change that alters expected output grows. A listed case that matches, or whose listed parts no longer all differ, fails the run. Deviations stay in docs/deviations.md and rust/conformance/accepted.json.
status: proposed
created: 2026-11-24
modified: 2026-11-26
---

# ADR-0006 - Rust tracks the shared conformance cases it is behind on in a list, apart from deviations

## Context

[ADR-0002](0002-the-typescript-reference-is-the-behavioral-contract.md) makes the TypeScript reference the behavioral contract and names two kinds of difference: a limit of the language, outside parity, and a deviation, recorded in `docs/deviations.md`. Its conformance corpus, under `rust/conformance/`, was captured from the reference once, and the Rust examples matched every case.

The cases now sit at the repository root in `conformance/`, and the TypeScript workspace checks its own examples against them. They were captured again from the reference at its current version, after 0.20.0, and Rust, ported from an earlier revision, differs from 148 of the 687. Those differences are neither a limit of the language nor a choice. Under ADR-0217 each is a defect in what Rust ships, known and not excused, and the catch-up phase owes its fix. Recording each as a deviation would put unchosen differences in the register of chosen ones, and leaving them as failures would keep the harness red until the catch-up ends.

## Decision

- The shared cases in the repository's `conformance/` directory are the corpus ADR-0002 names. The TypeScript workspace captures them, and nothing under `rust/` reads `typescript/`.
- A case Rust has yet to match is **behind**. `rust/conformance/behind.json` lists each one with the parts that differ (`stdout`, `stderr`, `exit`, `files`). The harness counts a listed case as behind while exactly those parts differ.
- The list moves two ways. Rust work only shrinks it: a listed case that matches, or whose listed parts no longer all differ, is **stale** and fails the run until its entry shrinks. A TypeScript change that alters expected output on purpose adds, in the same change, each case and part Rust no longer matches, which `--write-behind` names.
- A deviation is still a row of `rust/docs/deviations.md`, and its case is listed in `rust/conformance/accepted.json`, not in the behind list. A difference that is neither a limit of the language, a deviation, nor listed behind is a defect the harness fails on.

## Considered options

- **Record each behind case as a deviation.** Rejected. The register states the differences the port chooses, with a reason; a backlog has no reason but time.
- **Leave the behind cases as failures.** Rejected. A harness that is always red cannot show a regression, and Rust's checks are required.
- **A list that never grows.** Rejected. Every TypeScript change to output would then wait on Rust work, because Rust's checks are required.

## Consequences

A reference behavior change is ported by refreshing the shared expectations, listing what Rust no longer matches, and then closing the entries. The parity Rust reaches at any moment is the shared cases less the behind list, and the list's size is the catch-up's measure. The reference revision the cases were captured from is recorded in `conformance/expected/META.json`. `--write-behind` writes an entry for a regression as readily as for a reference change, so a check compares the list with its base branch: on a pull request, CI fails when the list adds a case or a part for a case whose files under `conformance/expected/` the change leaves unchanged. A reference change that alters a case's expected output can still carry an unrelated Rust regression in that same case, and review holds the rule there.

## Status

Proposed on 2026-11-24 with the change that moved the cases and added the list. ADR-0002 remains accepted except for these parts, which this record supersedes when accepted: its rule that every operator-surface difference not at a limit of the language is a deviation, for a case listed behind; its corpus paragraph; its Consequences; and its Status claim that every difference is a row of `docs/deviations.md`.

## Changelog

- 2026-11-24: Proposed.
- 2026-11-26: Consequences: a CI check on pull requests holds the rule that Rust work only shrinks the list, case by case against the change's expected files.
