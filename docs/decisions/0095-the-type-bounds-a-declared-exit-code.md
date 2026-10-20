---
type: adr
title: ADR-0095 - The type bounds a declared exit code
description: A failure class still declares its exit code as a static field from 1 through 125, read from the nearest ancestor that declares one, and core still exports the sysexits names. FailureExitCode alone bounds the code. The run-time range check, the reserved-code DeclarationError, the capture-once rule, the instance-tampering outcomes, and the unconstructed-failure rule go. It supersedes ADR-0045.
status: proposed
created: 2026-10-20
modified: 2026-10-20
---

# ADR-0095 - The type bounds a declared exit code

## Context

[ADR-0045](0045-a-failure-class-declares-its-exit-code.md) moved a failure's exit code onto its class as a static field and bounded it in two ways. `LoomError` types the static as `FailureExitCode`, so TypeScript rejects a code outside 1 through 125 on the class line. At run time, `LoomError`'s constructor also checks the code and throws a `DeclarationError` under `@loomcli/core/failure-exit-code` for a reserved one.

A dated entry of 2026-09-27 added more. Core captures each class's code at the class's first construction, so a static rewritten later, or a static getter that answers differently on a second read, changes nothing. Core pins what happens when a subclass shadows the instance accessor or code assigns to it. And a value that inherits from a failure class without being constructed by one reports as its own internal error.

Each of those rules answers a value that bypasses the types or a construction built to break the code. Under [ADR-0093](0093-a-value-that-bypasses-the-types-gets-no-rule.md) and principles 7 and 8, such values get no rule. The type already turns an undeclarable code into a compile error at the line the author wrote.

## Decision

- **The type bounds the code.** `FailureExitCode` is the union of the declarable codes, 1 through 125, and `LoomError` types its static as that union, so TypeScript rejects a literal outside the range and a plain `number` on the class line (TS2417). `ExitCode`, which `run()` resolves, stays `0 | FailureExitCode | 130 | 143`.
- **No run-time range check.** `LoomError`'s constructor reads no code to judge it, and `@loomcli/core/failure-exit-code` goes. A JavaScript class that declares 130 exits 130, because a value that bypasses the types gets no rule.
- **Read, not captured.** Core reads the code from the failure's class, walking to the nearest ancestor that declares one, and captures nothing. A static the author's code rewrites, a static getter, and an instance field that shadows the accessor are the author's code, and core adds no rule for them. The instance's `exitCode` stays a read-only accessor, because TypeScript then rejects an override as a property (TS2610) and an assignment (TS2540).
- **No unconstructed-failure rule.** A value that inherits from a failure class without being constructed by one gets no rule of its own.

This record supersedes ADR-0045 whole. Every other provision of ADR-0045 is incorporated by reference, with its addenda: the static declaration on the class, read from the nearest ancestor so that one class never exits with two codes; 1 and 2 keeping core's meanings and 0 and 126 and above reserved; the fifteen flat `sysexits.h` constants with literal types and no `EX_OK`; `LoomError` declaring 1 and `UsageError` declaring 2, every other core class inheriting its code, and invalid input that core raises staying 2; `LoomError`'s constructor taking the message and the platform's optional `ErrorOptions`, under [ADR-0049](0049-a-translator-turns-a-foreign-throw-into-a-failure-class.md); the code holding from an action, a middleware, a configuration source, and a translator, with [ADR-0038](0038-a-configuration-source-warns-and-reports-input-problems-through-the-ordinary-channels.md)'s source carve-out widened to any `LoomError`; cancellation outranking every failure code; a broken failure view or destination returning 1; and the rejected options, a constructor argument, both forms together, an application setting that maps invalid input to 64, clamping, and a frozen `sysexits` object. The failure code that [ADR-0064](0064-a-failure-class-declares-a-failure-code-and-a-plugin-encodes-the-failure-form-by-media-type.md) reads the way ADR-0045 reads `exitCode` is read the same way under this record, with no capture. Its grammar check stays under ADR-0093.

## Consequences

An application that compiles today exits with the same codes. A JavaScript author who declares a reserved code, or rewrites a class's static during a run, gets the code their own code produced. The exit codes acceptance keeps its declared-code cases and loses its capture and tampering cases.

## Status

Proposed. It moves to accepted with the release that removes the run-time range check and the capture-once machinery, planned for 0.15.0.

## Changelog

- 2026-10-20: Proposed with the 0.15.0 rescope.
