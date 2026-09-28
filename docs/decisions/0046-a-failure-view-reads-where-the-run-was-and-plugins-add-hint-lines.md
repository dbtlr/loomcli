---
type: adr
title: ADR-0046 - A failure view reads where the run was, and plugins add hint lines
description: Every failure view's context gains the application name and the Command path routing walked, filled where run() catches the failure. Plugins add hint lines to a failure through an optional onFailure lifecycle hook that reads the graph and the Command at that path, and the view receives the hints. A broken hook follows the broken-view rule. Core keeps an issue's own fields and rewrites only its path.
status: accepted
created: 2026-09-27
modified: 2026-09-28
---

# ADR-0046 - A failure view reads where the run was, and plugins add hint lines

## Context

A failure carries the facts its sentence interpolates under [ADR-0007](0007-failures-are-public-classes-with-class-keyed-renderers.md): `UnknownOptionError` carries `spelling`, and `UnknownCommandError` carries `token` and `candidates`. Two kinds of fact are missing from what a failure view reads.

The first is where the run was: the application name and the Command routing had reached. A failure view's context is `{ style, width }`, and no failure records the Command it was raised under. jsonkit's branded views therefore spell `jsonkit` as a literal, and no view can say that `--bogus` was unknown on `jsonkit get`.

The second is advice that belongs to a plugin rather than to core, such as an accepted spelling close to a mistyped option, or a pointer to the `--explain` option the private `@loom/explain` plugin declares. Today a plugin speaks about a failure only by overriding its view under [ADR-0021](0021-every-rendered-byte-passes-through-one-registry-of-replaceable-views.md), and resolution is first-in-wins. Of two plugins that each want to add a line to one failure, one replaces the other, and the one that speaks also takes over the sentence core wrote.

Core also reduces each issue a validator returns to `{ message, path }` when it reads the issue, and again when it prefixes a value's position on a multiple option or a variadic argument. A field a validator attaches for a machine reader, such as an issue code a validator catalog could publish, is gone before any view sees it.

[ADR-0028](0028-plugins-run-code-at-lifecycle-hooks-and-middleware-reads-the-request.md) names lifecycle hooks `on<Event>` and leaves open a hook beside the middleware chain. [ADR-0017](0017-plugins-participate-through-one-middleware-chain-with-declared-activation.md) rejected before, after, and on-error hooks as a replacement for the chain. A hook that adds lines to a failure core is already rendering replaces nothing the chain does. It receives the failure typed `Readonly<LoomError>`, as a failure view does. Core does not freeze the failure, so a JavaScript hook that assigns to it steps outside the contract. A hook cannot catch or suppress the failure, and a working hook cannot change the exit code, which core reads before any hook runs; a broken one forces 1, as a broken view does.

## Decision

A failure carries what went wrong, and the run carries where it happened. Plugins add hint lines to a failure message, and they never replace each other's views.

- **Where the run was.** A failure view's context gains `application`, the application name, and `path`, the canonical Command names routing walked. `path` is `[]` before routing, the partial path walked before an unknown Command, and the routed path otherwise. `run()` fills both once, where it catches the failure. Every failure view receives them: core's classes, an author's subclasses, internal errors, result errors, and a declaration fault raised at graph build, whose `path` is `[]`. The failure classes gain no field for this.
- **Hint lines.** A plugin definition gains an optional lifecycle hook, `onFailure(failure, context)`, named under ADR-0028's `on<Event>` rule. It is synchronous and returns a string, a readonly array of strings, or `undefined`. Each string is one hint, a marked string like any view output.
- **What a hook reads.** Its context holds `application` and `path` with the meaning above; `style`, the contextual style for stderr, so a hint escapes text the operator typed; and `graph` and `command`. `graph` is the frozen graph and `command` is the `CommandNode` at `path`: the routed Command, the root before routing, and the last Command the partial path reached for an unknown Command. Both have the meaning [ADR-0041](0041-every-action-reads-the-frozen-graph-and-its-routed-command.md) gives them on an action, and both are built lazily as there. A hint plugin reads candidates from `graph.globals`, `command.options`, and `command.children`, and it leaves out aliases, hidden members, and deprecated members itself by their node facts, the rule [ADR-0043](0043-shell-completion-follows-cobras-protocol-and-never-evaluates-typed-text.md) applies to completion. `UnknownOptionError` gains no field of accepted spellings.
- **When it runs.** Core calls every installed plugin's `onFailure` for each failure `run()` renders after graph build, before it calls that failure's view, so the view receives the hints. No hook runs for a declaration fault raised at graph build or for a failure raised before it, because no valid graph exists; this matches ADR-0007's rule that a plugin's overrides are not consulted for a build fault. No hook runs for a cancellation the run reports silently, or for a takeover such as `--help`, because neither renders a failure.
- **Order.** Hints keep plugin installation order, and each hook's strings keep the order it returned them in. Core does not deduplicate. Each hook receives the failure and its context alone, and never the hints an earlier hook returned, so hints accumulate instead of passing from one hook to the next.
- **A broken hook.** A hook that throws, returns a value that is not a string or an array of strings, or returns a promise contributes no hints. The failure still renders with every other plugin's hints, one internal-error line names the plugin, and the run exits 1. This is ADR-0007's broken-view rule applied to hooks. Cancellation outranks it, as it outranks a broken view.
- **The failure view's context.** `FailureViewContext` extends `ViewContext` with `application`, `path`, and `hints`, which is `[]` when no hook contributed. `override(FailureClass, view)` types its replacement as a `FailureView` of the class's instances, whose function receives `FailureViewContext`. A replacement written against `ViewContext` stays valid, because it reads less. Core's default text prints the core sentence, then each hint on its own line. An override receives the hints and decides whether to print them. Lane views, the help page, the version line, and result views keep `ViewContext`. A failure view's context never carries a member named `command`.
- **Issue fields survive.** Where core reads an issue and where it rebuilds one to prefix a value's position, it keeps the issue's own fields and rewrites only `path`. Core still reads nothing but `message` and `path`.
- **Plugins alone.** `onFailure` is on the plugin definition alone, as `onCommandAttach` is. An application that wants its own hint writes an override or installs a small local plugin.

This record narrows ADR-0028's composition clause, that each hook receives what the previous plugin's hook returned, and ADR-0013's restatement of it, for `onFailure`: hooks still run in installation order, and their hints accumulate. It answers, for failures, the question ADR-0028 left open of a hook beside the chain.

## Considered options

- **Repair facts as fields on every failure.** Each failure would carry the application name and, for an unknown option, the accepted spellings. Rejected. The application name would thread through the parser and every routine that raises, and every new hint would need a new field on some class, so core would own each plugin's advice.
- **Class-keyed hint entries beside overrides.** A `hint(FailureClass, fn)` entry listed under `views`. Rejected in favor of a lifecycle hook. Hints accumulate while overrides resolve first-in-wins, so one list would hold entries under two composition rules, and a plugin that advises on several classes would list one entry per class where one hook narrows with `instanceof`.
- **Complete-replacement overrides as the only composition.** Rejected. Of two plugins that each advise on one failure, only one could speak, and it would also own the sentence core wrote.
- **Optional `graph` and `command` on the failure view's context.** Rejected. A declaration fault raised at build has no graph, so every failure view would branch on its absence. The hook, which never runs for a build fault, reads both without that branch, and the view reads what the hook produced.

## Consequences

The failure view's context and the hook context are types core produces and consumers read, and `onFailure` is optional. An existing failure override compiles unchanged and a plugin without the hook is unaffected, so the implementation's change fragment is ordinary, not breaking.

A plugin with `onFailure` costs nothing on a successful run and one call for each failure a run renders. A hook that reads `graph` or `command` builds the run's graph once, as an action that reads them does.

A validator may attach its own fields to an issue, and they reach an `InputError` view. Core names no such field, so a later record can give the validator catalog an issue code without a core change.

`candidates` on the routing errors is unchanged. A plugin that wants a different candidate list, such as the spellings nearest a typo, derives it from the graph.

[Failure views](../core.md#failure-views) and [Failure hints](../core.md#failure-hints) state the contract. ADR-0005, ADR-0007, ADR-0013, ADR-0021, and ADR-0028 carry dated entries that bind when this record is accepted, and ADR-0017 carries a dated pointer recording that its rejection of on-error hooks as a replacement for the chain stands.

## Status

Accepted 2026-09-27 with the implementation. Every failure view receives `application`, `path`, and `hints`, `run()` calls `onFailure` under the rules above, core keeps an issue's own fields, and the private `@loom/explain` plugin's hint and the acceptance in [Failure hints](../core.md#failure-hints) pass under Node and Bun.

## Changelog

- 2026-09-27: Proposed with the failure hint contract.
- 2026-09-27: Accepted with the implementation.
- 2026-09-28: [ADR-0047](0047-an-operator-message-says-what-went-wrong-and-what-to-do-instead.md), proposed, makes hint lines the only place a pointer that depends on installed plugins appears, and removes a deprecated Command from `candidates` on the routing errors, the rule ADR-0043 applies to completion, so the Consequences clause that `candidates` is unchanged no longer holds for deprecated children. [ADR-0048](0048-a-validator-package-declares-one-issue-code-per-sentence.md), proposed, gives the validator catalog the issue code this record's Consequences anticipate, with no core change. Both bind when accepted.
- 2026-09-28: The suggestions contract in [Suggestions](../core.md#suggestions) offers a near match inside the sentence through an ordinary view override of `UnknownCommandError` and `UnknownOptionError` under ADR-0021, not through a hint, so the two compose: the plugin's view prints the hints under its sentence. The Consequences clause that a plugin derives the nearest spellings from the graph holds: it derives them in its `onFailure` hook, which returns no hint, and its view reads what the hook recorded for the failure, the split this record's Considered options chose. Help's pointer to the page is a hint from `help()`'s own `onFailure`.
