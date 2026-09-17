---
type: adr
title: ADR-0008 - Rendered output is a separate neutral call with a pure synchronous renderer
description: out.render(value, renderer) is the one presentation call. A Renderer turns one value into the exact bytes core writes and holds no output handle. The five semantic methods stay string-only with fixed destinations.
status: accepted
created: 2026-09-07
modified: 2026-09-17
---

# ADR-0008 - Rendered output is a separate neutral call with a pure synchronous renderer

## Context

Structured output needs a presentation step, and an application must own its presentation without owning the destination.

`out.render(data, renderer)` writes the renderer's text to stdout. A `Renderer<Data>` is a value with one `render` property that receives the data alone, returns a string, and is synchronous and pure. Core appends nothing and strips nothing, so the trailing newline belongs to the renderer. A rendered value has no semantic identity: no purpose parameter and no destination parameter. The five semantic methods keep their string-only signatures and their fixed default destinations. Call order within a destination holds across both forms.

A renderer failure rejects only its own call, later output still writes, and core reports one `InternalError` after the action with exit 1. An action failure stays primary over it.

## Considered options

- **Overloads on the semantic methods that accept a value and a renderer.** Rejected. It blurs "a message with a purpose" and "a value with a presentation", and it makes the data type harder to infer.
- **A purpose or destination parameter on `render`.** Rejected. A rendered value is neutral; the application decides what it is by choosing the renderer.
- **Text-first or factory-shaped renderer contracts from the long-term specification.** Rejected. One object with one `render` property is the smallest shape that infers its data type from the value.
- **A renderer that receives the output handle.** Rejected. A renderer that can write is a renderer that can write twice or to the wrong stream.

## Consequences

Formatters, tables, and terminal styling live in the application or in future plugins, not in core. The type parameter is inferred from the value, so a renderer for another type is a compile error.

## Changelog

- 2026-09-12: Proposed [ADR-0022](0022-renderers-return-marked-strings-that-core-resolves-and-a-theme-is-a-palette.md) records the replacement of the value-only renderer input, exact-byte output, and styling-outside-core clauses. Once accepted, core supplies an immutable renderer context and resolves marked text and embedded ANSI policy before writing. Renderer purity, neutral output, newline ownership, ordering, and failure behavior remain. This record binds as written until that transition.

- 2026-09-13: Accepted [ADR-0027](0027-core-resolves-marked-output-and-one-theme-contribution.md) supersedes the renderer-context, exact-byte, and styling-ownership clauses of ADR-0008 and the no-exclusive-theme-slot clause of ADR-0020. All other clauses remain in force.

- 2026-09-14: The view registry contract in [Views](../core.md#views) renames `Renderer<Data>` to `View<Data>` and lets the second argument of `out.render` be a declared view, named by reference, whose function an application replaces through `views`. The neutral call, purity, ordering, and failure behavior are unchanged, a bare view at the call site keeps working, and newline ownership is stated per write site: `out.render` still appends nothing. This entry binds when [ADR-0021](0021-every-rendered-byte-passes-through-one-registry-of-replaceable-views.md) is accepted with the registry implementation.

- 2026-09-14: The results-lane contract in [Results](../core.md#results) adds a second structural view shape beside `View<Data>`: a `RowView<Row>` with `row(row, index, context)` and optional `head(context)` and `tail(context)`, every function pure and synchronous, told apart from a view by the function present. `out.render` accepts an iterable with a row view and writes the sequence as it yields, awaiting each write before requesting the next row. The neutral call and purity are unchanged, and `out.render` still appends nothing. Two clauses narrow: a row view's functions run as the iterable yields rather than inside the call, and the rule that a failed view writes nothing for its call holds for a whole view alone, since a row view's pieces before a fault stand and core reports the stop through `incompleteResult`. Call order within a destination holds at the granularity of calls, a sequence holding its place until its `tail`. On a Command that declares a result, the action's `out.render` writes to stderr with stderr's view context, decided at graph build; a middleware's keeps stdout. This entry binds when [ADR-0023](0023-a-command-declares-its-result-and-core-resolves-its-presentation.md) is accepted with the results implementation.
- 2026-09-17: The table and records contract in [Table](../core.md#table) and [Records](../core.md#records) changes the row view's closing function: `tail(count, context)` receives the number of rows `row` was called with and then the view context, so a closing summary reads a count no view has to accumulate, and `head(context)` and `row(row, index, context)` are unchanged. The `tail(context)` spelling in the 2026-09-14 entry above is superseded. The neutral call, purity, ordering, and newline ownership are unchanged. This entry binds when the table and records implementation lands under [ADR-0023](0023-a-command-declares-its-result-and-core-resolves-its-presentation.md).
