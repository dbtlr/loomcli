---
type: adr
title: ADR-0185 - jsonlRows streams JSON Lines beside the whole jsonl view
description: The formatter declares jsonlRows for rows results and jsonl for value results, preserving whole-view mapping while streaming each row and retaining written lines on failure.
status: proposed
created: 2026-11-18
modified: 2026-11-18
---

# ADR-0185 - jsonlRows streams JSON Lines beside the whole jsonl view

## Context

[ADR-0028](0028-plugins-run-code-at-lifecycle-hooks-and-middleware-reads-the-request.md) makes the formatter's `jsonl` a whole view under either result unit. Under `rows`, core collects the sequence before writing any line. A pipeline consuming JSON Lines needs each row as it arrives, including when the source is unbounded. Core already provides the row-view shape and owns sequence consumption, so the formatter needs a row view rather than a second streaming mechanism.

[ADR-0023](0023-a-command-declares-its-result-and-core-resolves-its-presentation.md) distinguishes whole views from row views and notes that a row map and a whole-value map differ at run time, where type arguments are erased. `View` and `RowView` are exclusive shapes: a whole view has `render`, while a row view has `row` and optional `head` and `tail`. A factory has no Command result unit to derive its shape from. One factory per shape is the typed path, keeping each return type and each map's input precise without a type assertion or a view that claims both shapes.

## Decision

- **Two JSON Lines shapes.** Export `jsonlRows<Row>(config?: EncodingConfig<Row>): RowView<Row>` beside `jsonl<Data>(config?: EncodingConfig<Data>): View<Data>` from `@loomcli/plugins/format` and `@loomcli/plugins/format/views`. Both declare `application/jsonl`. `jsonl()` remains a whole view under either result unit, and `json()` remains a whole view too.
- **Per-row mapping.** `jsonlRows()` applies its optional `map` to each row, identity by default, and writes one compact JSON line for that mapped value with the whole view's escaping and encode-failure behavior. It has no head or tail. An empty source writes nothing. `jsonl()` still maps the whole value or collected array before encoding it.
- **The hook chooses by result unit.** Where the result's views lack `jsonl`, the formatter's `onCommandAttach` hook declares `jsonlRows()` under that key for a rows Command and `jsonl()` for a value Command. It still declares `json()` under a missing `json` key. An author's existing view wins. `--format jsonl` therefore streams rows unless the author declares another view under that key.
- **Written rows stay written.** A mid-run source or encoding failure stops the sequence without retracting lines already written. The failed run exits through the ordinary failure path. When the JSONL failure encoder writes the run's failure, its one line is the only failure text on stderr, with no incomplete-result line, as [Results: a sequence that stops early](../core/results.md#a-sequence-that-stops-early) specifies. A whole `jsonl()` view still collects before rendering, so a source or encoding failure writes no sequence output.

## Considered options

- **Keep collecting for the hook's `jsonl` view.** Rejected. It delays a pipeline until the source ends and cannot serve an unbounded source.
- **Make `jsonl()` choose its shape.** Rejected. The factory receives no result unit, a type argument is erased, and returning both exclusive shapes would misstate the core view contract. Separate factories let the author choose whole-value or per-row mapping explicitly.

## Consequences

This supersedes exactly the JSONL clauses of [ADR-0028](0028-plugins-run-code-at-lifecycle-hooks-and-middleware-reads-the-request.md): its formatter clause that `jsonl()` is the hook's whole view under either unit and core collects rows for it, its considered-option rejection of separate factories insofar as it defers streaming JSONL under rows, and its acceptance clause that `jsonkit paths --format jsonl` prints only once core has collected the sequence. It also supersedes the JSONL part of [ADR-0023](0023-a-command-declares-its-result-and-core-resolves-its-presentation.md)'s 2026-09-15 entry that the formatter ships whole views under either unit and appends them at attachment. ADR-0028's lifecycle and middleware decisions stand, `json()` stays whole, and an explicitly declared `jsonl()` stays whole. ADR-0028 and ADR-0023 carry dated entries.

Under the hook's row view, a consumer may see valid rows before a nonzero exit, where the collected view previously kept stdout empty on a mid-run failure. Consumers must check the exit code. Authors who need whole-array mapping or collection can declare `jsonl()` under `jsonl` themselves.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-18: Proposed the separate JSON Lines row factory and the formatter hook's choice by result unit.
