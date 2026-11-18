---
type: adr
title: ADR-0177 - One logging installation writes to several destinations
description: One logging hook writes identical JSONL records to an ordered list of independently filtered file and console destinations, retaining the single-destination shorthand.
status: proposed
created: 2026-11-18
modified: 2026-11-18
---

# ADR-0177 - One logging installation writes to several destinations

## Context

[ADR-0070](0070-the-logging-plugin-writes-one-json-record-per-event-to-a-size-rotated-file-or-stderr.md) chooses one file or the console per installation. The plugin identity installs once, so an application cannot keep debug records in a file while sending only warnings to a supervisor on stderr. [ADR-0174](0174-v-shows-the-log-through-message-templates-and-out-keeps-what-the-operator-is-told.md) makes core show readable log lines at `-v` independently of recording destinations.

## Decision

- **An ordered list.** `logging({ destinations: [...] })` takes a readonly list of `LoggingDestinationSettings`. Each entry is a discriminated union of file settings, with optional `to: 'file'`, and console settings, with `to: 'console'`. A list allows any number of files and console entries without naming keys after destination kinds, so another kind can join the union. An empty list records nothing.
- **The shorthand stays.** `LoggingSettings` accepts either one `LoggingDestinationSettings` or the object holding the list. Existing calls retain their defaults and behavior. `logging()` still writes one default file at `info`. Keeping this shorthand avoids a migration for applications that need only one destination. There are no shared level or file settings.
- **Independent levels.** Each entry sets its own level, `info` by default. Its level filters only its own writes. A `fatal` event is never filtered by level. There is no predicate setting: levels meet the routing need without adding an author callback and its failure behavior.
- **One record, list order.** The hook serializes an eligible event once and writes those bytes synchronously to eligible entries in declaration order. The message template stays as written. A console entry writes only to stderr, and nothing when stderr is null. Core's readable screen remains separate.
- **Each file owns its behavior.** Each file entry has its own path, `maxBytes`, `keep`, `onError`, and announcement state. Defaults and rotation follow ADR-0070. A failed write calls that entry's callback and later entries continue if it returns. A callback that throws takes the ordinary hook failure path and stops this hook's writes for that event.
- **One hook.** One installation owns one `onLog` hook for the whole list. It logs `Logging to {path}.` once per file entry per outermost run after the first successful append, and `Rotated {path}.` after each rotation. Through the destination's `log`, these events reach other hooks and core's verbose screen, never any destination in this installation. A reused path is not deduplicated: each listed entry writes and announces independently.

## Considered options

- **Named keys for each kind.** Rejected. Lists give files independent settings and an explicit write order, and leave another destination kind room without a parallel configuration lane.
- **A required list for every application.** Rejected. Existing settings can remain a shorthand with the same defaults and no loss of capability.
- **Predicates beside levels.** Deferred. Independent thresholds cover this use without another callback contract.

## Consequences

This narrows ADR-0070's choice of one file or console per installation and ADR-0165's announcement rule from once per outermost run to once per file entry per outermost run. ADR-0070 and ADR-0165 carry dated entries. Its record bytes, rotation, directory resolution, failure behavior, and console stderr rules stay in force for each entry. `LoggingDestinationSettings` is a new public input type. There is no breaking migration.

The [logging reference](../plugins/logging.md) documents both forms and independent filtering.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-18: Proposed with the settings, independent filtering, and ordered writes.
- 2026-11-18: [ADR-0178](0178-operators-control-log-files-and-levels-and-failures-name-the-runs-log.md), proposed, lets an operator replace file thresholds and redirect the first file without changing console destinations. It binds when that record is accepted.
- 2026-11-18: [ADR-0179](0179-the-logging-plugin-emits-opentelemetry-records-through-the-authors-logger.md), proposed, adds an OpenTelemetry kind to the destination union and narrows the identical-bytes clause to file and console logging destinations. It binds when that record is accepted.
