---
type: adr
title: ADR-0028 - Plugins run code at lifecycle hooks, and middleware reads the request
description: A plugin definition carries lifecycle hooks named on<Event> that core calls at named points, beginning with onCommandAttach at graph build. Local parsing and validation run ahead of the middleware chain with the fault held until the dispatch boundary, so a middleware reads the request and selects a result's view by name. The formatter is the proof.
status: accepted
created: 2026-09-15
modified: 2026-09-16
---

# ADR-0028 - Plugins run code at lifecycle hooks, and middleware reads the request

## Context

The formatter needs three things no plugin could do under ADR-0017 and ADR-0013 as written. It must put `--format` on the Commands that declare a result and on no other, because which formats exist is a fact of each Command and most Commands have none, so a global option would be a guess on every page. It must add `json` and `jsonl` to every result's views without the author naming them. And it must read the value of `--format`, a local option, before the action emits, which a chain that ran ahead of local parsing could not see.

A plugin is a place to write code. The earlier contract described a plugin as declarations alone and its value as performing no work at install, which described the plugins that existed and not the seam's purpose. This record replaces that framing: a plugin's code runs where core calls it, and core names the points.

**Lifecycle hooks.** A plugin definition carries functions named `on` followed by the event, with the event's subject where it carries meaning: `onCommandAttach` names its subject, and a later `onLog` would not. Hooks run in installation order and compose in sequence, each receiving what the previous plugin's hook returned; this is the one composition that is not first-in-wins under ADR-0013. Middleware keeps its name and is not a hook, because it wraps an invocation instead of running in sequence at a point. `onCommandAttach` runs at graph build once per Command, the root included, after the author's declarations are complete and after core has resolved each result record, and before the remaining build rules, which run over what the hooks returned. It receives the declaration unlocked through `AttachedCommand`, the authoring calls a hook may use with their types erased beside the facts `inspect()` publishes, and returns the declaration to build. A hook's calls are exempt from the closures `action()` applies, because those keep the action's types true to the author's declaration and nothing a hook adds reaches the types: a hook-declared option is present in the value at run time, absent from the action's typed `options`, and read by a middleware untyped.

**The chain reads the request.** Core parses the routed Command's local tokens and validates the invocation before the first middleware runs, and holds the fault it finds, a validator's own developer error included. The context carries `request`, the parsed values, or `null` under a held fault, and the fault is raised at the dispatch boundary, the point the chain reaches when its last middleware continues, so a wrapper installed ahead of help still reaches help's takeover. A takeover therefore keeps the behavior the earlier placement bought, that no fault of the invocation is reported when a middleware ends it, and every middleware sees the same request. A run cancelled before the boundary resolves its cancellation code and never raises the held fault. The cost is that a schema runs on an invocation a middleware then takes over; this record requires nothing new of a validator, so one with a side effect performs it there.

**Selection is a variable on the context.** Core renders a result through its declaration's default view unless a middleware assigns another name to `view` before the dispatch boundary, where the last assignment wins. Core validates the assignment at the boundary and treats a miss as the assigning plugin's internal error, because a plugin that selects a name has it validated first, which is what the formatter's option does through its schema. Core spells no view name and no diagnostic for an unknown format.

**The formatter.** Its hook appends `json` and `jsonl` to a record that lacks them and declares `--format` as an ordinary local option with no default, whose description lists the names and whose validator accepts the names and the unadvertised alias `ndjson` for `jsonl`, except where the author named `ndjson` as a view of their own. `json()` and `jsonl()` are whole views under either unit; under `rows` core collects the sequence. Its middleware is always on and copies a supplied value into `view`, so an omitted `--format` leaves an earlier plugin's selection alone. The option is local in every respect, so help lists the formats through the description, `inspect()` publishes the option with no plugin named as its source, and `--format` on a Command with no result is the ordinary unknown-option error. A collision between the hook's option and one the application, an imported Command, or another plugin already declares is a build error to the developer that names the plugin and the Command; the plugin offers no rename, because a second spelling for one thing is what an agent would have to guess between.

## Considered options

- **A declarative contribution slot for machine views, with core adding names to every result.** Rejected. It made core own the name set, the option, the alias, and a selection call with its own diagnostics, and every later plugin that needed to reshape a Command would have needed another slot.
- **`--format` as a plugin option in the globals table.** Rejected. Different Commands have different formats and most have none. It is never a global.
- **The hook typed over `Command` itself.** Rejected after review. `Command`'s state machine locks a completed declaration, its result-dependent `views()` is hidden at a neutral result type, the root is an `Application`, and a Command with registered globals is not assignable to the bare type. An erased surface built for the hook states what a hook can do and read.
- **One factory per result unit, `json()` beside `jsonRows()`.** Rejected by the owner after review as confusing. The declaration knows its unit, so `json()` and `jsonl()` serve both as whole views; streaming machine output under `rows` is a later refinement if a consumer needs it.
- **A `format({ option })` parameter renaming the option for an application that cannot rename an imported Command's `format`.** Rejected by the owner after review: the remedy for a collision is an error message to the developer.
- **A declared default on `--format`.** Rejected after review. A default fills on every run, so the middleware would clobber a selection an earlier plugin made.
- **An explicit `parse()` on the context with parsing kept lazy.** Rejected. A middleware that forgets the call reads nothing.
- **Two chains, one ahead of parsing and one around the action.** Rejected. Two concepts and two activation rules for one participation.
- **The whole lifecycle at once: typed context contributions from middleware into the action and a post-action hook.** Deferred. Each waits for a plugin that needs it. ADR-0017 rejected before, after, and error hooks as a replacement for the chain; a post-action hook beside the chain is a different question and is left open.

## Consequences

The Plugins contract's sentence that a plugin holds declarations alone and performs no work at install is replaced by: creating and installing the value runs none of its code, and a hook runs at build. An installed plugin with a hook pays one call per Command on every invocation, since the graph builds on every run. ADR-0017's placement of the chain ahead of local parsing is superseded by the dated entry it carries; ADR-0004's group check moves with the chain, ADR-0013's composition rule gains the sequential exception for hooks, and ADR-0025's closure gains the hook exemption, each by a dated entry. A hook-declared local option cannot activate a middleware, so a middleware that reads one declares `'always'`. The exported types are `AttachedCommand`, `CommandAttachHook`, `ResultView`, and `Request`; the private build handle the command module spells `AttachedCommand` today is renamed with the increment.

The ordering of validation ahead of the chain is settled here. Open: whether a takeover should be able to skip validation and its side effects, how a plugin participates in validation, and how facts about the request beyond the parsed values are carried to actions and middleware.

## Status

Accepted. The formatter increment proves it: both example applications install `format()` after `help()` and `version()`, `textstat --format json` prints its table as one document with the timing line still on stderr, `jsonkit paths --format jsonl` prints one line per entry once core has collected the sequence, and the acceptance in [Formatter](../core.md#formatter) runs under Node and Bun.
