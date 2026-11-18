---
type: adr
title: ADR-0179 - The logging plugin emits OpenTelemetry records through the author's logger
description: An OpenTelemetry destination bridges each log event to the author's structurally typed logger without an SDK dependency, preserving templates, copied fields, and failure facts.
status: proposed
created: 2026-11-18
modified: 2026-11-18
---

# ADR-0179 - The logging plugin emits OpenTelemetry records through the author's logger

## Context

[ADR-0069](0069-core-hands-log-events-to-onlog-hooks-and-writes-no-log-record.md) shapes log events for OpenTelemetry, but a JSONL destination alone does not send them to an author's telemetry pipeline. [ADR-0177](0177-one-logging-installation-writes-to-several-destinations.md) provides an ordered list of independently filtered destinations. An OpenTelemetry bridge belongs in that list. The author owns the SDK, exporters, resource, and shutdown under principles 1 and 4.

## Decision

- **The author's logger.** A destination with `to: 'otel'` takes `logger: OpenTelemetryLogger` and an optional `level`, defaulting to `info`. The structural type requires only `emit(record): void` and accepts an `@opentelemetry/api-logs` Logger. Loom takes no runtime OpenTelemetry dependency and does not register providers, flush, shut down, or export over a network itself.
- **One event, one record.** Eligible entries call `logger.emit` synchronously in declaration order. The record's `timestamp` is a Date made from the event's time, `body` is the message template as written, and `severityText` is the original lowercase level. `severityNumber` uses the base of each OpenTelemetry range: trace 1, debug 5, info 9, warn 13, error 17, fatal 21. Trace means the least severe diagnostic level, not a tracing span. Fatal is never filtered.
- **Attributes.** `service.name` and `service.version` carry application identity using the semantic convention names as record attributes; they do not configure or replace the SDK resource. The semantic conventions place `service.*` on the Resource, and an SDK whose Resource sets none reports `unknown_service:<process>` there, so an author sets the Resource's `service.name` to match. `loom.run`, `loom.path`, and `loom.plugin` carry the event's run, path array, and plugin identity or null. `loom.fields` carries the whole fields map, preserving nested arrays, maps, and nulls without collisions with record facts. `loom.failure`, when present, carries the complete failure form. A defect adds `exception.type`, `exception.message`, and, when present, `exception.stacktrace` from the event's defect detail, following exception semantic conventions. A failure without defect detail invents no exception.
- **One source.** Every value comes from the event, whose fields core has already redacted under ADR-0176. The bridge copies JSON containers into mutable containers for the SDK; it never mutates the frozen event or reads original application values.
- **Run is not trace context.** `run` stays an attribute. Although it is trace-id-shaped, a run establishes no OpenTelemetry span, flags, or parent context. The bridge leaves context unset so the author's SDK can correlate with its active context. A manufactured context would displace real tracing.
- **Author code fails ordinarily.** An `emit` that throws escapes the plugin hook, exactly as a throwing `onError` does. Core applies the ordinary hook failure path; later entries do not receive that event. There is no retry, catch, or `onError` setting for this destination.

## Consequences

This supersedes [ADR-0069](0069-core-hands-log-events-to-onlog-hooks-and-writes-no-log-record.md)'s sentence that each event field maps to a field of the OpenTelemetry log record, Resource, InstrumentationScope, and the trace id included: the application maps to `service.*` record attributes, the plugin to `loom.plugin`, and the run to `loom.run`, because the author's SDK owns the Resource, the scope, and the trace context. It extends [ADR-0177](0177-one-logging-installation-writes-to-several-destinations.md)'s destination union and narrows its identical-bytes clause to file and console logging destinations, and narrows [ADR-0070](0070-the-logging-plugin-writes-one-json-record-per-event-to-a-size-rotated-file-or-stderr.md)'s rule that a failed write goes to `onError`, which binds file destinations alone: an OpenTelemetry logging destination's `emit` that throws takes the ordinary failure path. ADR-0069, ADR-0070, and ADR-0177 carry dated entries. Their JSONL format under ADR-0070 remains unchanged. OpenTelemetry is available in the destinations list; the existing shorthand remains file or console. There is no breaking migration.

The mapping follows the [OpenTelemetry logs data model](https://opentelemetry.io/docs/specs/otel/logs/data-model/) for severity, body, and timestamp, and the [exception log conventions](https://opentelemetry.io/docs/specs/semconv/exceptions/exceptions-logs/) for defects; the `service.*` attributes use the convention names on the record rather than the Resource, as the Decision states. Keeping `loom.fields` as a map avoids flattening ambiguities and collisions; consumers select its nested keys instead of expecting fields at the attribute root.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-18: Proposed with the structural logger destination and record mapping.
