---
type: adr
title: ADR-0187 - An author supplies an input's completion values from a named completer
description: An option or an argument names a completer with a values member of its completion extension value, the functions live in the completion plugin's settings, the answer calls one at Tab time with the typed inputs and offers what it returns under the exact-or-omitted rules, and a name the settings do not define is a build fault.
status: accepted
created: 2026-11-18
modified: 2026-11-21
---

# ADR-0187 - An author supplies an input's completion values from a named completer

## Context

[ADR-0180](0180-an-author-hints-an-inputs-completion-with-one-static-value-hint.md) lets an author hint how an input's values complete, and defers values that the application computes. A task tracker's ids, a project's branches, and a cloud account's resources are known only at Tab time, and only the author's code can list them. Cobra answers with a completion function per flag and argument, and GitHub issue 401 asks for it. [ADR-0043](0043-shell-completion-follows-cobras-protocol-and-never-evaluates-typed-text.md) forbids a script from evaluating anything typed, which the answer's own call of an author's function does not break: the function runs in the application's process, never in the shell, and receives typed text as a string.

Core stores an extension value as plain data and forbids a function in one, under [ADR-0019](0019-plugin-facts-are-descriptor-keyed-extension-values-and-core-owns-the-universal-facts.md), so the graph, which help and the manifest read, cannot hold the function.

## Decision

- **A name in the graph, the function in the settings.** `completion({ values: { <name>: Completer } })` holds the functions. An option or an argument names one with `{ values: '<name>' }`, a sixth member of the hint of [ADR-0180](0180-an-author-hints-an-inputs-completion-with-one-static-value-hint.md), on `completionInput` and `completionArgument`. The other five members gain `values?: undefined`, so the change is additive and a value with two hints stays a type error and an invalid extension value.
- **The completer.** It receives `{ word, typed, signal, host }`: the word being completed without its lead, the typed inputs [ADR-0186](0186-core-reports-the-words-an-unfinished-invocation-gave-each-input.md) reports, the run signal, and the host. An arity option's words include those its open occurrence has received, so a completer learns which word of the tuple it completes from their count modulo the arity. It returns, now or in a promise, an iterable object of texts or `{ value, description? }`. A bare text is rejected by the type, because each of its characters would be a value. Nothing it receives is validated.
- **What is offered.** Each value is offered after the lead the typed word carries, filtered by the prefix, with every exact-or-omitted rule of the answer, repeats once, and directive `4`. An empty value is left out before the lead is added, as a closed set's is, so the bare lead is never offered. A completer never asks for file names, because an input that completes files is hinted with `files`, `extensions`, or `directories`.
- **A closed set wins.** An input whose schema names a closed set offers it and never calls the completer, as it does over every hint.
- **When it runs.** Only the `__complete` Command calls a completer, for a `value` or `argument` position, or a `command` position whose argument names one. Help, the manifest, MCP, and `inspect()` never do. Core adds no timer, under principle 1: a completer ends with the run signal.
- **A failure.** A completer that throws or rejects offers nothing and the answer ends with directive `1`, and one `warn` log event carries the completer's name and the thrown value. At a `command` position, where the argument shares the word with the Command's children, a failed completer drops only its own values: a child whose name starts with the prefix is still offered, with directive `4`, because every script discards an answer that ends with `1`. Directive `1` stays where no child matches. An abort of the run signal ends the answer the same way and logs nothing, even for a completer that never returns. The script discards standard error, so nothing is written to the terminal.
- **An unknown name is a build fault.** An input that names a completer the settings do not define raises the Developer Diagnostic `@loomcli/plugins/completion/unknown-completer` through the plugin's `onGraphBuilt` hook, because the input would complete nothing and no run would say why. The settings record is read through its own entries, so no inherited name is defined.
- **No script changes.** A completer's answer uses directives `4` and `1`, which every script honors.

## Considered options

- **A function in the extension value.** Rejected: core's extension rule forbids it, and the graph is plain data that help, the manifest, and MCP read.
- **A function on the option or argument declaration.** Rejected: it is a new core member for one plugin's use, and a Command library would carry a function that a plugin that is not installed cannot call.
- **A fault only when the completer is called.** Rejected: the failure would be an empty completion that the script hides.
- **Letting a completer return a hint for the shell's file fallback.** Rejected for now: the static hints already say it, and a second way to do one job multiplies the answer's branches.
- **A timer in core or the plugin.** Rejected by principle 1: the run signal already ends a run the operator interrupts.

## Consequences

This narrows ADR-0180's hint, which gains a sixth member in both of its facts types, `CompletionValueFacts` and `CompletionInputFacts`, and its sentence that a named completer is a separate decision. It narrows [ADR-0043](0043-shell-completion-follows-cobras-protocol-and-never-evaluates-typed-text.md)'s **What is offered** clause, whose offered words gain the values a named completer returns, under the same exact-or-omitted rule; ADR-0043's no-evaluation rule is unchanged, because a completer runs in the application's process. ADR-0180 and ADR-0043 carry dated entries. The [completion reference](../plugins/completion.md#named-completers) states the settings, the context, the answer, and the fault. `completion()` takes an optional settings argument, so an existing call is unchanged.

## Status

Accepted in 0.20.0.

## Changelog

- 2026-11-18: Proposed for author-supplied completion values (LM-355). Review settled that a failed completer at a `command` position drops only its own values and that an empty value is left out before the lead.
