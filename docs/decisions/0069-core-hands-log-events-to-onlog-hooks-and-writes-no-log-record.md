---
type: adr
title: ADR-0069 - Core hands log events to onLog hooks and writes no log record
description: The action, middleware, source, and onFailure contexts gain a log with five levels. Each call becomes a frozen log event, shaped to the OpenTelemetry log record, that core hands to every installed plugin's onLog hook with the outermost run's destination. Core logs each failure it reports, a defect at fatal with its stack in both builds, and writes no log record itself.
status: proposed
created: 2026-10-10
modified: 2026-10-10
---

# ADR-0069 - Core hands log events to onLog hooks and writes no log record

## Context

Applications that run as daemons need a record of what happened, read after the fact: a supervised `serve` that crashed overnight. Loom gives author code `out`, whose semantic methods render for the person at the terminal, glyphs and lanes included, and nothing that records. Two applications built on Loom each wrote their own timestamped runtime log, one of them through `out.print` to avoid the glyphs the lanes put on stderr, which is the mark of a missing capability rather than a missing option.

A distributed build also hides a defect's detail on stderr under [ADR-0047](0047-an-operator-message-says-what-went-wrong-and-what-to-do-instead.md) and keeps it out of the failure form under [ADR-0064](0064-a-failure-class-declares-a-failure-code-and-a-plugin-encodes-the-failure-form-by-media-type.md), so a crashed daemon leaves `Something went wrong.` and nothing an author can diagnose from.

[ADR-0028](0028-plugins-run-code-at-lifecycle-hooks-and-middleware-reads-the-request.md) named lifecycle hooks `on<Event>` and named `onLog` as a later one. An earlier specification delivered log events through declared channels with subscriptions and a binding order. Loom never adopted channels: plugins observe through hooks.

## Decision

- **Records, not renders.** Core gives author and plugin code `log`, separate from `out`. `out` writes for the person at the terminal; `log` records for whoever reads later. Neither routes through the other.
- **Where.** The action, middleware, configuration source, and `onFailure` contexts carry `log`, bound to the context, so an event names the plugin whose middleware, source, or hook logged it, and `null` for every action, a plugin Command's included, because nothing records which plugin attached a Command ([ADR-0033](0033-a-plugin-attaches-ordinary-commands-to-the-root.md)). `onCommandAttach` and `onGraphBuilt` get none, because they also run under `inspect()` and `check()`, where no run exists.
- **Levels.** `trace`, `debug`, `info`, `warn`, and `error`, the OpenTelemetry severity names, with no way to add one. `fatal` is a level core alone logs. `Log` has no `fatal`, because `out.fatal()` throws and ends the run, and a method of the same name that only records would invert its meaning.
- **A call.** A call takes a message and optional fields, returns nothing, and never throws to its caller, except during delivery. Core copies the fields into plain JSON data at the call, as `JSON.stringify` would, except that an `Error` keeps its name, message, stack, and cause, a `bigint` reads its decimal string, and a value that holds itself reads `"[Circular]"`, and it freezes the copy. With no installed `onLog`, core creates no event.
- **The event.** `time` (ISO 8601 UTC with milliseconds, read at the call), `level`, `message`, `fields`, `application` (the graph's name and version), `run` (32 lowercase hex characters from 16 random bytes, one per run, in the format of an OpenTelemetry trace id), `path` (the path a failure view reads), `plugin`, and on core's failure events `failure` and `defect`. Each field maps to a field of the OpenTelemetry log record without taking its name: Timestamp, SeverityText, Body, Attributes, Resource, InstrumentationScope, and the trace id.
- **Failure events.** Core logs one event for each failure it reports, after translators and `onFailure` hooks, carrying the failure form. A defect logs at `fatal` and also carries the caught value's name, message, and stack, in both builds; every other failure logs at `error`. Stderr is unchanged. A silent cancellation, a build fault, and a broken `onLog`'s report log none.
- **The hook.** `onLog(event, destination)` is an observing hook: core calls every installed plugin's hook in installation order with the same frozen event, and a hook returns `undefined` and cannot change the event; a working hook cannot change the outcome, and a broken one fails the run, below. The destination is the outermost run's `env`, `platform`, and `stderr`: the parent run's under an action's `invoke`, and a `null` stderr under `app.invoke`. A log record never enters an invocation's captured output.
- **A broken hook.** A hook that throws or returns a value is reported once through the plain fallback path under `@loomcli/core/broken-log-hook`, is not called again in the run, and makes the run return 1, or the signal's code in a cancelled run. A `log` call made while core delivers an event throws `@loomcli/core/log-in-log-hook`, which surfaces in the hook and reports that way.

## Considered options

- **Declared channels with subscriptions.** Rejected. Loom observes through `on<Event>` hooks, and a second observation system would duplicate them for one consumer.
- **Logging through `out`, or a timestamp on its lanes.** Rejected. Lanes render for a terminal reader; a record is read later, by a person or a machine, and needs fields, levels, and a stable shape.
- **A logging plugin that provides `log` itself.** Rejected. Core and other plugins need to log whether or not a writer is installed, and the failure events are core's to create.
- **Keeping defect detail out of the log, as the failure form does.** Rejected. The log is where a crashed daemon is diagnosed, and it is a record the author chose to keep, not an operator message.
- **`log.fatal` for authors.** Rejected, for the inversion against `out.fatal()` above.
- **Host fields for a clock and a run-id source.** Rejected for now. Tests assert the formats; a fixed-value seam can come with a testing package that needs it.
- **Dropping a `log` call made during delivery.** Rejected. It is an author's mistake, and a thrown fault that names it teaches the fix.

## Consequences

Every context listed gains a member, which is additive for a consumer that reads the context and for one that implements no hook. A run that installs an `onLog` creates an event per call and reads the clock and the random source; a run with none pays nothing. Defect detail now leaves the process through a plugin the author installed. [ADR-0013](0013-core-installs-no-plugins-and-composes-first-in-wins.md), [ADR-0017](0017-plugins-participate-through-one-middleware-chain-with-declared-activation.md), [ADR-0028](0028-plugins-run-code-at-lifecycle-hooks-and-middleware-reads-the-request.md), [ADR-0046](0046-a-failure-view-reads-where-the-run-was-and-plugins-add-hint-lines.md), [ADR-0047](0047-an-operator-message-says-what-went-wrong-and-what-to-do-instead.md), [ADR-0063](0063-the-mcp-plugin-serves-opted-in-commands-as-tools.md), and [ADR-0064](0064-a-failure-class-declares-a-failure-code-and-a-plugin-encodes-the-failure-form-by-media-type.md) carry dated entries.

## Status

Proposed. It moves to accepted in the release that ships core's log events and the `onLog` hook.

## Changelog

- 2026-10-10: Proposed with the contract.
