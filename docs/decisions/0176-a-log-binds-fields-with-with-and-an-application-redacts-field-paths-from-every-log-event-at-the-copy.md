---
type: adr
title: ADR-0176 - A log binds fields with with, and an Application redacts field paths from every log event at the copy
description: Every Log gains with(fields), which copies the fields once and returns a Log whose every event carries them, nesting, with a call's own field winning a shared name and a bound field filling a template placeholder. An Application declares log.redact once, a list of dotted field paths that step through arrays, and core writes "[Redacted]" for each when it copies an event's fields, bound fields included, so no onLog hook, log line, logging destination, or export reads the value. Loom redacts nothing by default, and a path that is not dotted nonempty keys is a declaration error from the constructor.
status: proposed
created: 2026-11-18
modified: 2026-11-18
---

# ADR-0176 - A log binds fields with with, and an Application redacts field paths from every log event at the copy

## Context

[ADR-0069](0069-core-hands-log-events-to-onlog-hooks-and-writes-no-log-record.md) gave every context a `log` whose call copies its fields into frozen JSON, and [ADR-0174](0174-v-shows-the-log-through-message-templates-and-out-keeps-what-the-operator-is-told.md) shows each event at `-v` from that same copy. Two needs remained, which the LM-362 survey of the logging floor found in both output seats.

An author who handles many requests in one run passes the same `requestId` to every call by hand. pino and winston bind such fields with a child logger, and consola binds a tag with `withTag`.

An author who logs a request or a configuration object can carry a secret into every reader of the log: each `onLog` hook, first-party or third-party, the `-v` line, each logging destination, and any export. Redacting inside one reader leaves the others to leak. The owner ruled (LM-374, Q6) that redaction is declared once on the Application and that core applies it when it copies the fields, and set standing principle P5: a redacted path reaches no reader, it reads `"[Redacted]"`, and Loom never guesses what to redact.

## Decision

### Bound fields

- **The method.** `Log` gains `with(fields)`, which returns a `Log` whose every event carries `fields`. Every `log` has it, since core builds each one through one function: the action's, a middleware's, a source's, a provider's, an `onFailure` and an `onEnvironment` hook's, a log destination's, and the self-update plugin's contexts, which carry an action's.
- **Copied once.** `with` copies its fields at the call, by ADR-0069's copy rule with redaction applied, as pino serializes a child's bindings once. A later change to the object changes nothing, and a property whose read throws throws from `with`.
- **Merging.** An event's fields are the bound copy with the call's own copy beside it. A field the call's copy holds replaces a bound one of the same name, and a nested `with` replaces a field of the Log it is called on. A field the copy omits leaves the bound one in place.
- **What stays.** The returned Log keeps its receiver's plugin and, for a destination's `log`, the rule that its events never reach the hook whose destination it is. The receiver is unchanged.
- **Templates.** A bound field is a field: it fills a placeholder of its name and trails at `-v` when the message does not place it, under ADR-0174.

### Redaction

- **Declared once.** `new Application(name, { log: { redact } })` takes a list of field paths. The setting sits under `log`, as the shutdown budget sits under `shutdown`, so a later log setting joins it.
- **At the copy.** Core applies the list while it copies a call's fields and a `with` call's fields, so the frozen copy holds `"[Redacted]"` in place of each redacted value. Every reader reads that one copy, so no `onLog` hook, log line, logging destination, or export sees the value, whichever placeholder or trailing field shows it.
- **A path.** Dotted object keys, each nonempty, with no escaping and no array index, as the configuration plugin's `strict` paths read under [ADR-0155](0155-the-configuration-plugins-strict-setting-fails-the-run-for-a-value-at-or-under-a-path-it-lists.md). The first key names a field, and each later key a key inside the value before it. A path names keys from the top of the fields alone: `password` redacts the `password` field and no `password` key below another field.
- **Arrays.** A path steps through an array, its next key applying to every item, nested arrays included, so `accounts.secret` redacts `secret` in every account. A redacted key whose value is an array reads `"[Redacted]"` whole.
- **Coverage.** A redacted key's whole value reads `"[Redacted]"`, and a path under one adds nothing. A path whose key the copy does not hold adds nothing, and a value the copy omits stays omitted. An Error's copy is an object, so `error.stack` redacts the stack alone. Redacting the copy's `message` also redacts its `stack`, which can repeat that message.
- **Outside the fields.** The message keeps the template as written, under ADR-0174, and a failure event's form, a defect's detail, and the event's other facts are core's and no path reaches them.
- **No defaults.** Loom redacts no name of its own. An Application that lists no path keeps every value.
- **A bad path.** A path that is not dotted nonempty keys is a declaration error from the Application constructor, the earliest point that knows it under [ADR-0034](0034-a-declaration-fault-throws-at-the-earliest-point-that-knows-it.md), `@loomcli/core/invalid-redact-path`, worded in core's output messages module under [ADR-0164](0164-looms-operator-messages-live-in-message-modules-and-a-voice-test-per-package-reads-them.md).

## Considered options

- **Redaction in the logging plugin.** Rejected. It would cover one reader, and a third-party hook, the `-v` line, and every other destination would still read the value, against P5.
- **Default names such as `password` or `token`.** Rejected. Loom cannot know what an application's fields mean, and a guess hides a value an author meant to keep while missing one it did not name.
- **Paths that match a key at any depth.** Rejected. A path names one place, as a configuration `strict` path does, so an author reads exactly what it covers; a key that repeats at several depths is listed at each.
- **Array indexes or a `*` wildcard, as pino reads them.** Rejected. Stepping through every item covers what an author naming a list's key means, and keeps the one path syntax Loom already has.
- **Reading bound fields again at each call, as winston merges its metadata.** Rejected. Copying once matches ADR-0069's rule that a later change to the caller's object changes nothing, and a binding is read once however many events follow.
- **A `child()` or `withTag()` name.** Rejected for `with`, the shortest name that reads as binding fields, as Go's `slog.Logger.With` reads.

## Consequences

`Log` gains `with`, an addition to an output type, and `ApplicationOptions` gains the optional `log`. A value an author built by hand as a `Log`, such as a test double, needs `with` to compile; `@loomcli/testing`'s builders give theirs one that passes the bound fields to the levels a test states. Core registers `@loomcli/core/invalid-redact-path`. A run that lists no path walks no redaction tree. It narrows ADR-0110's rule that a new function whose answer the unit reads asks to be stated: the builders' unstated `log.with` returns a working Log. It narrows ADR-0146's rule that a stated member replaces the default whole: `logDestination` takes `log` member by member. ADR-0069, ADR-0110, ADR-0146, and ADR-0174 carry dated entries.

The glossary gains Bound fields and Redaction, and its Log entry names `with`.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-18: Proposed with the contract and the implementation (LM-374). The builder settled what the task left open: the setting `log: { redact }`, dotted paths that step through arrays and match from the top of the fields alone, `with` copying its fields once and nesting with the inner binding winning, and bound fields filling template placeholders.
