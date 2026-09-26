---
type: adr
title: ADR-0038 - A configuration source warns and reports input problems through the ordinary channels
description: The configuration source's context gains the output channel, the style, and the graph a middleware or an action already reads, and a resolver that throws an `InputError` reports it with code 2 like an action does. This supersedes the ADR-0032 clause that made every throw from a source a plugin fault.
status: proposed
created: 2026-09-26
modified: 2026-09-26
---

# ADR-0038 - A configuration source warns and reports input problems through the ordinary channels

## Context

[ADR-0032](0032-environment-and-configuration-map-into-options-through-one-core-input-source-stage.md) gave a configuration source a narrow context: the host, the plugin's own option values, and the requests. Every throw from the resolver is a fault of the plugin, an internal error with code 1. A missing or malformed file is not a core fault, and the configuration plugin decides how to treat one.

The first real configuration plugin needs three things that context lacks. It warns once when a file it discovered cannot be used, and the only way to do that today is a raw write to `host.stderr`, which skips the view registry of [ADR-0021](0021-every-rendered-byte-passes-through-one-registry-of-replaceable-views.md) and every override of `lanes.warn`. It fails the run when the operator names a file that is missing or malformed, or when a file holds a value of the wrong type, and those are mistakes in the invocation, so they belong under code 2 and the `Invalid input:` prefix, not under `Internal error:`. It derives a user file path from the application name, which no request carries.

Each need already has an ordinary answer elsewhere. A middleware and an action write through `out`. An action escapes raw data with `style.escape` before it warns. An action that finds a rule over its inputs broken throws an `InputError`, which reports with code 2 under [ADR-0036](0036-each-value-passes-the-same-validator.md). A middleware reads the graph.

## Decision

- **The context.** `SourceContext` gains `out`, the channel object a middleware receives, `style`, the contextual style an action receives, and `graph`, the `CommandGraph` `inspect()` would return for the run, which is the graph core already builds to produce the requests.
- **Warnings.** A warning goes through `out.warn`, so it renders through `lanes.warn` and any override of it. It writes when the source runs, which is before any takeover, so `--help` with a broken file prints the warning on stderr and then the page.
- **Input problems.** A resolver that throws or rejects with an `InputError` reports that error as a usage failure with code 2. Core holds it like any validation fault and raises it at the dispatch boundary, so a takeover such as `--help` reports nothing. It stops the stage, fills nothing, and takes the place of every problem already collected, and core runs no validation after it, as a plugin fault does. The source owns the error's message and problems.
- **Every other throw.** Anything else the resolver throws or rejects with remains a plugin fault with code 1 under ADR-0032.

## Considered options

- **A source-only lane: the answer record carries `warnings` and `problems` beside the answers, and core prints and raises them.** Rejected. It gives core control over when a warning prints, but it is a second way to warn and a second way to report an input problem, used by one kind of plugin. The ordinary path already covers both.
- **Hold warnings like faults, so a takeover prints none.** Rejected. The file is broken whether or not the run takes over, and a warning on stderr leaves stdout clean for the takeover's output.
- **Pass the application name alone, `application: { name }`.** Rejected in favor of the graph, which core has already built and which a middleware already reads, so a source reads the same facts through the same type.
- **Have the author pass the application name to the plugin factory.** Rejected. It states one fact twice, and a rename of the application leaves the second copy behind.

## Consequences

`SourceContext` gains three read-only members, so it is an ordinary change for a source author. A resolver that already throws an `InputError` changes from code 1 to code 2, which no published plugin does. The ADR-0032 sentence that a source that throws is a fault of that plugin now reads as every throw other than an `InputError`. The [configuration plugin](0039-the-configuration-plugin-reads-layered-json-files-and-fails-only-on-the-file-the-operator-names.md) is the first reader of all four.

## Status

Proposed. It moves to accepted with the implementation that passes `out`, `style`, and `graph` to the resolver and reports a thrown `InputError` with code 2, proven by the configuration plugin's acceptance.

## Changelog

- 2026-09-26: Proposed with the configuration plugin contract under [ADR-0039](0039-the-configuration-plugin-reads-layered-json-files-and-fails-only-on-the-file-the-operator-names.md).
