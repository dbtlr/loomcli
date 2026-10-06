---
type: adr
title: ADR-0061 - A view declares its media type, and a result publishes it by view name
description: Every view shape takes an optional mediaType string, and ResultNode publishes mediaTypes keyed by view name, null where a view declares none. Core stores the string at the call that stores the view and never checks it. The formatter's json() and jsonl() declare application/json and application/jsonl, and the manifest reads the fact in place of the json and jsonl naming promise. This closes the deferral ADR-0023 recorded.
status: proposed
created: 2026-10-05
modified: 2026-10-06
---

# ADR-0061 - A view declares its media type, and a result publishes it by view name

## Context

A machine reader of a Command's output must know how to parse it. Today the graph says nothing about that: `ResultNode` publishes view names alone, so the manifest states the `json` and `jsonl` encodings on the strength of the names, a promise core never enforced. An author who maps `json()` under the key `wire` loses the promise, and one who puts a table under `json` breaks it. [ADR-0023](0023-a-command-declares-its-result-and-core-resolves-its-presentation.md) recorded on 2026-09-24 that publishing each view's encoding as a graph fact waits for the MCP milestone, the first projection that would read it. The MCP plugin of [ADR-0063](0063-the-mcp-plugin-serves-opted-in-commands-as-tools.md) is that projection: it sends a JSON view's output as structured content.

## Decision

- **A view declares its media type.** `View` and `RowView` take an optional `mediaType` string, on a bare view and a declared view alike. An omitted `mediaType` declares none.
- **A result publishes it by view name.** `ResultNode` gains `mediaTypes`, one entry per view name in record order: the declared string, or `null`.
- **Core stores and never checks.** The call that stores a view, `result()`, `rows()`, `views()`, a hook's `views()`, or `view()`, reads `mediaType` once and keeps the string. Core holds no grammar or registry of media types and never compares a view's text with its type. A value that is not a string is the declaration error `@loomcli/core/media-type`.
- **Selection stays by name.** Core reads no media type at run time; a run selects a view by name.
- **The pack declares its own.** `json()` declares `application/json` and `jsonl()` `application/jsonl`, under every `map` and every key. The table and records views declare none.
- **The manifest reads the fact.** The manifest copies `mediaTypes` with each result and states its two encodings for the views that declare them, never for a view name.

## Considered options

- **Keep the naming promise.** Rejected. Core cannot enforce it, a mapped view under another key loses it, and a reader must know the formatter's names.
- **A closed set of encodings.** Rejected. A view may write CSV, YAML, or a format no list anticipates, and core reads the fact nowhere, so a closed set would only refuse true claims.
- **Validating the string against the media type grammar.** Rejected. Core would own a grammar it never reads, and a well-formed type can still be false. The author owns the claim.
- **Selecting a view by media type at run time.** Rejected. Selection by name is the one way a run chooses a view, and a second way would let `--format` and a media type disagree.

## Consequences

A projection reads how to parse a view from the graph, with no plugin installed. The manifest document gains `mediaTypes` on each result, an ordinary change under its stability rule, and its `encodings` statements now apply by media type. An author's view that declares a media type its text does not match breaks its own promise, which core does not detect. [ADR-0023](0023-a-command-declares-its-result-and-core-resolves-its-presentation.md) carries a dated entry that closes its deferral.

## Status

Proposed 2026-10-05 with the contract in [Media types](../core.md#media-types). It moves to accepted inside the release PR of the release that ships the implementation: `mediaTypes` published on every result, the formatter's two views declaring their types, the manifest reading the fact, and the acceptance in that section, under Node and Bun.

## Changelog

- 2026-10-05: Proposed with the contract.
- 2026-10-06: [ADR-0064](0064-a-failure-class-declares-a-failure-code-and-a-plugin-encodes-the-failure-form-by-media-type.md), proposed, gives the media type one run-time reader. A failed `run()` reads its selected view's media type, through the failure view context, to find a failure encoder, comparing exact strings. Selection stays by name, and core still holds no grammar or registry of media types and never checks the string. It binds with this record and ADR-0064.
