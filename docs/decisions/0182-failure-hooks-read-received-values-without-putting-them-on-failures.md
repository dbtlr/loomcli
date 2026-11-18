---
type: adr
title: ADR-0182 - Failure hooks read received values without putting them on failures
description: Failure hooks read rejected inputs through a context reader while failures remain free of received values.
status: proposed
created: 2026-11-18
modified: 2026-11-18
---

# ADR-0182 - Failure hooks read received values without putting them on failures

## Context

The suggestions plugin can read a rejected input's closed set from the command graph, but an `InputError` carries no received value. A near-value suggestion needs that value. Adding it to the failure would expose potentially secret input to an author's catch, failure views, and failure encoders. Core's failure text never repeats an input value.

## Decision

`FailureHookContext` gains `received(problem: InputProblem): unknown`. For an invalid problem of the failure being reported, the reader returns the value core held before validation. The source can be argv, an invocation by name, environment, or configuration. Missing and group problems, problems from another failure, and problems for which core holds no received value return `undefined`.

Core keeps the association privately, keyed by the problem object. Neither the failure nor its problems gain a field. The reader belongs to the hook context alone: a view, encoder, or catch cannot recover a secret from the failure. A plugin that reads the value owns its use and must follow the failure voice when writing a sentence. The suggestions plugin compares it with declared accepted values and prints only those accepted values.

For collected inputs the reader returns the collected raw value; issue paths identify the rejected element. A non-token value that an invocation by name cannot lower has no received token. A problem constructed by an author's code has no recorded received value.

The testing library's `failureHookContext` accepts an optional reader and defaults to returning `undefined`.

This extends the hook context of [ADR-0046](0046-a-failure-view-reads-where-the-run-was-and-plugins-add-hint-lines.md). Its separation of hook and view remains: the hook reads invocation facts and the view reads what the hook records. The no-leaks rule remains unchanged.

## Considered options

- **A received field on the failure or problem.** Rejected because every ordinary consumer of the failure could read a secret.
- **Parsing validator sentences.** Rejected because a sentence need not contain the value and its wording is not a data contract.
- **Re-reading argv in the plugin.** Rejected because it duplicates parsing and misses other input sources and invocations by name.

## Consequences

A plugin can suggest a closed-set value through the existing failure hook and view lanes without changing the failure's data or text. Core retains raw values only for the lifetime of their weakly keyed problems. The public context gains a reader, and the testing builder supplies an inert default.

The suggestions plugin locates each problem's lines by walking `failure.message` in `problems` order. It depends on core's message layout: one line per issue of an invalid problem and one line per missing or group problem. An issue sentence containing newlines spans those additional lines; the plugin leaves that sentence unchanged and advances past all of its lines.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-18: Proposed the context-only reader for rejected-value suggestions.
