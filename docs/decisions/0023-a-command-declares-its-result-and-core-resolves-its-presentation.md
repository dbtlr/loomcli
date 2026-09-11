---
type: adr
title: ADR-0023 - A Command declares its result and core resolves its presentation, and formatters are plugins
description: A Command declares its result as graph facts, a schema, views in preference order, and a cardinality, and its action emits once through out.results. Core resolves which presentation the run uses and knows no format name; plugins own format names and encoders, and a declared result owns stdout.
status: proposed
created: 2026-09-11
modified: 2026-09-11
---

# ADR-0023 - A Command declares its result and core resolves its presentation, and formatters are plugins

## Context

An action today binds data to presentation at the call site. It calls `out.render(value, renderer)` under ADR-0008, or it builds text itself and calls `out.print`. Either way the action decides how the value appears, and nothing else can. A machine consumer cannot ask the same Command for another encoding, and no projection can state what shape a Command produces, because the shape exists only inside a closure.

A Command declares its result instead, as facts on the graph under ADR-0010: a Standard Schema for the shape, through the channel ADR-0005 already uses, the views the result may be presented through in preference order with the first as the default, and the cardinality, one document or one stream of items. The action emits the result once, through `out.results(value)` for a document or `await out.results(iterable)` for a stream. The call is typed from the declaration, so a document Command rejects an iterable at compile time. The returned promise resolves when the last byte is written, which makes it the ordering anchor for anything the action does after emitting.

Core resolves the run's presentation. It uses the declared default view unless a `--format` selection named another declared view or an encoding the installed formatter offers. View names and encoding names share one namespace per Command, so an operator or an agent asks for a presentation by one name whichever kind answers it, and a declared view whose name collides with an installed encoding is a build error. Core knows no format name, not even `text`. Plugins own format names and the encoders behind them, which is the split ADR-0018 uses for the signals slot and the rule ADR-0013 states for plugins in general: core declares the lane, and nothing first-party is privileged inside it.

Presentation availability is derived rather than listed. A Command's set of presentations is the views its declaration names plus every encoding the installed formatter offers. `--format` on a Command that declares no result is a usage error naming the Command, exit 2, because an agent should learn that a Command produces no result rather than parse an empty stdout.

A declared result owns stdout. On a Command that declares a result, `print` and `render` keep their signatures and write to stderr, decided at graph build from the declaration rather than at run time from the chosen presentation. On a Command with no result both keep stdout. No method is ever removed from the output channel, because an author denied a lane works around the framework rather than through it.

A declared result is a promise the Command makes. An action that returns normally without calling `out.results` on a Command that declares one is an internal error, exit 1, naming the Command. A failure raised before the call is that failure, not a missing result, because a failure is the outcome. An empty stream is a kept promise. A second call to `out.results` is an internal error that turns a would-be 0 into 1, the same rule a second `next()` follows in the middleware chain. A stream that fails partway has written items that nothing retracts, and the invocation ends with the failure's exit code and the diagnostic on stderr.

Cardinality binds the views too. A document view renders the whole value, which a table needs because its columns depend on every row. An item view renders one item as it arrives. Graph build checks a declared view's kind against the declared cardinality, so a document view on a stream is a declaration error rather than a buffered surprise at run time.

The first formatter plugin offers two encodings. `json` writes a document as one JSON document and a stream as one array. `jsonl` writes one line per item, and a document as one line. Both serve both cardinalities. `ndjson` is an unadvertised synonym of `jsonl`, accepted and never listed, under the rule the glossary already states for a name a consumer is likely to guess.

The pack's human views, a table and a records list, are configured factories. The configuration is typed against the result's item type, and its plain data is stored as a graph fact so a later projection can describe the human shape. A configuration entry that is a function, a cell formatter for instance, is kept for rendering and is not a graph fact.

## Considered options

- **One value per invocation, with no stream form.** Rejected. Line-delimited output is a real consumer need, and one call whose cardinality comes from the declaration serves a document and a stream without a second method or a second declaration field.
- **An action that reads a format plugin's option and branches on it.** Rejected. It waits on typed plugin context reaching the action, it makes every author write the JSON branch by hand and get it subtly different, and it leaves a projection with nothing to read, because the branch is code rather than a fact.
- **A per-Command list of the formatters it supports.** Rejected. An encoding is generic over plain data and a view is already declared on the result, so the available set is derivable and a hand-written list can only drift from it.

## Consequences

`out.render`'s call-site renderer is 0.2.0 public surface, and it changes with a change fragment and no shim, as does the `failures` option ADR-0021 replaces.

The declaration is what a later machine-facing projection reads. A result schema that supplies the Standard Schema JSON Schema converter projects its shape through that standard channel, with no dependency on a particular schema library; a schema without the converter projects no shape, and the projection says so.

The exact surface is deferred to the phase contracts: whether core runs the result schema on emit, where the default is to trust the type; the formatter plugin's subpath, identity, and option spelling; and how a help page lists the available presentations.

Typing `out.results` from the declaration extends the pattern the action handler already uses to carry a Command's type into its action, which is the part of this record most likely to cost editor responsiveness and has to be measured rather than assumed.

## Status

Proposed. It moves to accepted with the phase implementations of the result declaration and the formatter plugin, proved through the example applications: textstat declares and emits its table as a result and prints byte-identical output, a hidden jsonkit Command exercises the stream path, `textstat --format json` prints one JSON document on stdout with its warnings on stderr, and `--format jsonl` on the stream Command prints one line per item.
