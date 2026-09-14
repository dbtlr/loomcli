---
type: adr
title: ADR-0023 - A Command declares its result as named views, stdout belongs to the result, and machine presentations are views a formatter plugin declares
description: A Command declares one value or a sequence of rows with a stated type and a record of named views, its action emits once through out.results, and stdout belongs to the result. Views are whole or row by row, json and jsonl are views a formatter plugin declares, and no schema or cardinality is part of the declaration.
status: proposed
created: 2026-09-11
modified: 2026-09-14
---

# ADR-0023 - A Command declares its result as named views, stdout belongs to the result, and machine presentations are views a formatter plugin declares

## Context

An action today binds data to presentation at the call site. It calls `out.render(value, view)` under ADR-0008, or it builds text itself and calls `out.print`. Either way the action decides how the value appears, and nothing else can. A machine consumer cannot ask the same Command for another presentation, and no projection can state what a Command produces, because the shape exists only inside a closure.

The results lane is a ladder an author climbs one step at a time, and each step costs only what it adds. On the first step nothing is declared: an action renders through a configured pack view, a table or a records list, inside `out.render`, and the view infers its row type from the data. On the second step a Command declares its result. On the third a formatter plugin lets a run select another presentation by name. On the fourth rows render as they arrive.

A Command declares its result with one of two authoring calls before `action()`. `result<Value>()` declares one value, and `rows<Row>()` declares a sequence of rows. The type is stated by the author, and it is what `out.results` is typed from inside the handler, which is why the call closes with the action like an argument does. Each carries a `views` record keyed by presentation name, first key the default, and the stated type flows into every entry by contextual typing, so a pack view's column list is checked against the row type without a type argument of its own. A third call, `views()`, stays open in every state on a declaration that carries a result and merges replacements by key, so an importing application reshapes presentation without touching the action.

A view is one of two structural shapes. A whole view renders one value in one call, as ADR-0008 defines it. A row view renders a sequence one row at a time through `row`, with optional `head` and `tail`, and every function stays pure and synchronous. Under `rows<Row>()` either shape is legal under any key: core feeds a row view as the source yields and buffers for a whole view. The action emits any iterable or async iterable and holds no opinion about buffering. There is no cardinality on a view and no stream declaration on a Command, because the only fact that mattered, whether a presentation can render before the source ends, is a property of the view, and the view already knows it.

`json` and `jsonl` are views. The formatter plugin declares them as configured factories with a map that reshapes the wire form the way a column list reshapes a table, one factory per unit because a row map and a whole-value map differ at run time and a type argument is erased. They render as ordinary views with the plugin uninstalled. Installing the plugin adds `--format` selection over the record's keys and makes both available on every declared result with the identity map. Core knows no presentation name, not even `text`, and there is no encoding outside the view model, so an agent asking for a presentation by name reaches a view whichever package declared it.

A declared result owns stdout. On a Command that declares one, `print` and `render` keep their signatures and write to stderr, decided at graph build from the declaration and never at run time from the selected view. The redirect belongs to the action's output channel; a middleware's keeps the default destinations, so a help page still reaches stdout. No method is removed, because an author denied a lane works around the framework rather than through it.

A declared result is a promise the Command makes. An action that returns normally without calling `out.results` fails with `ResultError`, exit 1, naming the Command. A failure raised before the call is that failure, because a failure is the outcome. A second call is a `ResultError` that turns a would-be 0 into 1, the rule a second `next()` follows in the middleware chain. A cancelled run raises no missing-result fault. A sequence that stops early, whether its source throws, a row view fails, a write fails, the action fails, or the run is cancelled, leaves written rows in place under a row view and an empty stdout under a whole view, and core writes one line through the exported declared view `incompleteResult` before the fault's own report, so an empty stdout and a failed stdout never read the same.

No schema is part of the declaration. The manifest projection is the only reader of a result's shape, and it attaches that shape through its own extension descriptor when it arrives; a declaration in core with no reader is weight, not a benefit. `inspect()` publishes the result's kind, its view names in order, and its default, and a pack view's plain-data configuration is published under that plugin's descriptor.

## Considered options

- **A result schema in core, as the source of the type and a projectable fact.** Rejected. Core runs nothing over it, the formatter encodes plain data without it, and only the manifest reads it. The author states the type, and the manifest plugin brings the schema when it exists.
- **Encodings outside the view model, generic over plain data and derived rather than declared.** Rejected. A JSON consumer needs its shape mapped as often as a table needs its columns chosen, and one model, a view with configuration, serves both. It also removed a namespace collision rule between view names and encoding names, since there is now one namespace.
- **A cardinality on the declaration, with a document view on a stream a build error.** Rejected. Whether a presentation can render before the source ends is a property of the view. Declaring it on the Command forced the author to choose buffering for every view at once and made a buffered table an error instead of a choice.
- **Rows as the only unit, with a single value a one-row result.** Rejected. A Command that prints one JSON value would wrap it in an array, which changes the wire form an agent reads.
- **The whole declaration open after `action()`.** Rejected. A handler registered before the type exists cannot be typed against it, so `out.results` would be untyped everywhere. The type closes with the action, and `views()` stays open, the split ADR-0025 made for extension configuration.
- **A per-Command list of the presentations it supports.** Rejected. The record of views is that list.
- **A configured pack view as a declared view with an identity.** Rejected. Every factory call is a new object, two objects under one identity are a build error, and an application cannot list its own objects under the plugin's views. A pack view is a bare view, and a result's presentation is replaced by name through `views()`, never through the Application's override list. A plugin that wants an application-wide restyle renders through an inner declared view.

## Consequences

`out.render`'s call-site view remains valid and gains an iterable form with a row view. The `views` option on the Application keeps its meaning from ADR-0021; the `views` record on a result is a separate declaration keyed by presentation name.

Typing `out.results` from the declaration extends the pattern the action handler already uses. It is the part of this record most likely to cost editor responsiveness, and it is measured before the increment merges rather than assumed.

The formatter plugin's contract, the names of its two factories per encoding, the `--format` spelling, the `ndjson` alias of `jsonl`, the usage error on a Command with no result, and how help lists the available presentations, is a separate phase, as is the configuration each pack view accepts and whether the table is a row view with declared widths or a whole view. The subpaths `@loomcli/plugins/format`, `@loomcli/plugins/table`, and `@loomcli/plugins/records` are fixed here. At implementation the root README's description of textstat's `out.render` call goes stale and moves with the increment.

## Status

Proposed. It moves to accepted with the results implementation, proved through the example applications: textstat declares its table as `result<Table>` with its own whole view and prints byte-identical output, and a hidden jsonkit Command declares `rows` with an application-authored row view, writes each row as an async generator yields it, and leaves a partial list and the incomplete line behind when the source throws.

## Changelog

- 2026-09-14: The view registry contract in [Views](../core.md#views) settles that a declared view is named by reference and its identity string is not an operator-facing name. The per-Command presentation name a `--format` selection uses is a separate declaration the results-lane contract defines, not the view's identity.
- 2026-09-14: The phase contract is written in [Results](../core.md#results), and this record is corrected while still proposed. The schema leaves the declaration; the author states the type and a manifest plugin brings the shape later. Cardinality leaves the vocabulary; a row view is a second structural view shape and `out.results` under `rows<Row>()` accepts any iterable or async iterable. `json` and `jsonl` are views the formatter plugin declares, with a per-row map, so no encoding exists outside the view model and the collision rule between view names and encoding names is withdrawn. Views on a result are a record keyed by presentation name, first key the default, reshaped after `action()` through `views()`. The missing and repeated emits are `ResultError`, and a partial failure writes `@loomcli/core/results/incomplete` before the diagnostic. The acceptance target above changes from a stream Command to a hidden rows Command with a row view.
- 2026-09-14: Corrected after the contract's review panel. A configured pack view is a bare view and a result's presentation is replaced by name alone, which the Views contract and ADR-0021's dated entry now state. `ResultError` extends `InternalError`. The formatter plugin offers one factory per unit for each of `json` and `jsonl`. A cancelled run raises no missing-result fault, and every early stop of a sequence, not only a throwing source, writes the `incompleteResult` line before the fault's own report. The word formatter names the plugin alone; its views are machine presentations.
