---
type: adr
title: ADR-0183 - A middleware may set one result transform that reshapes a result before its view
description: A middleware assigns one result transform per run through transform on its context, last assignment before the dispatch boundary wins; core applies it to a value result once and to each row of a rows result before the selected view renders, as it arrives under a row view or when the collected rows render under a whole view, so views stay pure. The formatter's --fields, a repeatable control option of comma lists, sets one that keeps named top-level keys under the json and jsonl views the formatter appended, and fails with exit 2 under any other view, for a field the output does not hold, and for a value that is not an object. This narrows ADR-0021's and ADR-0023's rule that a view alone decides what a result renders as, and ADR-0023's rule that a run reaches a result's rendering by view name alone.
status: proposed
created: 2026-11-18
modified: 2026-11-19
---

# ADR-0183 - A middleware may set one result transform that reshapes a result before its view

## Context

Agents and scripts read a Command's JSON output, and most of them want a few fields of it, not all of them. `gh --json <fields>` gives them that, and every token an agent does not read is a cost. Loom offers no way to do it. `--format json` writes the whole value. A view sees no options, because [ViewContext](../core/views.md) carries the stream's capabilities alone, and a middleware selects a view by name only, through `view`, or states a media type at a Command without a result, through `mediaType`. So no plugin can shape what a result renders as.

[ADR-0021](0021-every-rendered-byte-passes-through-one-registry-of-replaceable-views.md) makes a view the one place that decides the bytes, and [ADR-0023](0023-a-command-declares-its-result-and-core-resolves-its-presentation.md) gives a run one lever over a result: the view name a middleware selects, with each view a pure function of the data it receives. A view that read options would break that purity, and a second view per selection, `json` with fields and `json` without, would multiply names a run selects among.

The owner ruled that core gives middleware one per-run transform, applied to the value, or to each row as it streams, before the selected view renders. The formatter sets it from its field option only when json or jsonl is selected, and views stay pure. A later ruling named the option `--fields`, a control string option taking a comma list that may repeat, with top-level keys only.

## Decision

- **The transform.** `MiddlewareContext` gains `transform`, typed with the exported `ResultTransform`, `(value: unknown) => unknown`. It reads `undefined` until a middleware assigns one and accepts a function alone.
- **One value per run.** The last assignment before the dispatch boundary wins, whichever middleware made it and whether or not it had called `next()`, and an assignment after the boundary changes nothing, as `view` and `mediaType` behave.
- **Where it applies.** Under `result<Value>`, core calls the transform once with the value the action emits and renders the selected view over its answer. Under `rows<Row>`, a row view transforms and renders each row as it arrives, so streaming holds. Under a whole view, core collects the rows first and transforms each row when the collected rows render, rather than as each is collected. A failure view, a lane, and `out.render` never pass through it. With none assigned, the view receives what the action emitted and every byte is unchanged. On a Command that declares no result it changes nothing.
- **Its failures.** A throw in the transform takes the ordinary failure path with its own class and exit code, as a view's throw does, and under rows the rows already written stay, under ADR-0023's rule for a sequence that stops early. Core checks nothing about its answer: the selected view receives it in place of the declared type, and the middleware that assigned the transform answers for that shape, as an author answers for a view's `map`.
- **The formatter's `--fields`.** The formatter's hook declares the local string option `fields` beside every `--format` it declares, `multiple: true`, `control: true`, with no short spelling, hidden on a group as the group's `--format` is. Each value is a comma list of top-level field names, split at each comma as ADR-0127 splits a variable at its delimiter, and a value that holds an empty name is the validator's issue. When the selected view is one of the `json` and `jsonl` views the formatter's hook appended, the middleware sets a transform that keeps the named keys of each object in the order named and leaves out a key an object lacks. Under any other view it fails before the action with an `InputError`, exit 2, saying `Option "--fields" applies to the json and jsonl output the formatter provides.` The correction says to remove `--fields`, or select only a formatter-appended view this Command has: `Remove --fields, or select output the formatter provides with --format json or --format jsonl.` when both were appended, or the same sentence with only `--format json` or `--format jsonl` when only that view was appended. When neither was appended, the correction is only `Remove --fields.` An author-declared JSON view is excluded, mapped or unmapped; its author shapes the data themselves. The hook records its appended view names in a command extension that the middleware reads through `readExtension`. A named field that the output does not hold, judged against the value, any element of an array value, or the first row of a stream, fails with exit 2 and lists the keys the output holds; a value, element, or row that is not an object fails with exit 2 and names what it is. On a run core holds a fault for, `--fields` sets nothing and raises nothing, so the held fault stays the one raised.

## Considered options

- **A view that reads options.** Rejected by the owner's ruling. A view is a pure function of its data under ADR-0023, and an override that replaces `json()` would have to reimplement every option the formatter reads.
- **A mapped view per selection.** Rejected. `views()` registers a view under a name before any run, so a field list typed at run time has no view to name, and one name per field list is unbounded.
- **Selection in the action.** Rejected. Every action would read the option and filter its own value, the repeated machinery Loom exists to remove, and a plugin-declared option is absent from an action's types.
- **Dotted paths, `--jq`, and `--template`.** Out of scope by the owner's ruling. Top-level keys answer the common need, and a path or query language is a contract of its own.
- **Judging fields against every row.** Not possible under streaming without holding rows back. The first row is the one the formatter has when the first line is due, so a field only a later row holds fails, and a later row that lacks a known field leaves it out.

## Consequences

This narrows ADR-0021 and ADR-0023. ADR-0021's rule that every rendered byte passes through one registry of views stands, because the transform renders no byte; its sense that the view alone decides what a result renders as narrows to the view deciding the bytes of what the transform hands it. ADR-0023's rule that a run reaches a result's rendering through the selected view name gains the one transform beside it, and its rule that a view stays pure and synchronous stands. ADR-0021 and ADR-0023 carry dated entries.

Core exports `ResultTransform`, and `MiddlewareContext` gains `transform`. `@loomcli/testing`'s `middlewareContext` keeps the last transform assigned. Every Command the formatter gives `--format` gains `--fields`, so its help page gains a row and `inspect()` a control option, and a Command or plugin that already declares an option named `fields` meets the hook-collision build error. The glossary gains Result transform. [Middleware](../core/middleware.md), [Results](../core/results.md), [Formatter plugin](../plugins/format.md), and [Testing](../libs/testing.md) carry the contract.

An unknown field or a non-object value is judged after the action has run. A Command with an effect has already acted when `--fields` fails with exit 2; an agent must not retry an effect just because field selection failed. The wrong-view refusal is thrown from the middleware before `next()`, so a help middleware installed later cannot take over that refusal.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-18: Proposed with the result transform and the formatter's `--fields`.
- 2026-11-19: Limit the wrong-view refusal's correction to the formatter-appended views the Command has; with none, say only to remove `--fields`.
