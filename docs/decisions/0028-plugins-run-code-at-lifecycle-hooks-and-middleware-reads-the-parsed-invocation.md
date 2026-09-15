---
type: adr
title: ADR-0028 - Plugins run code at lifecycle hooks, and middleware reads the parsed invocation
description: A plugin definition carries lifecycle hooks named on<Event> that core calls at named points, beginning with onCommandAttach at graph build. Local parsing and validation run ahead of the middleware chain with the fault held until next(), so a middleware reads the parsed invocation and selects a result's view by name. The format plugin is the proof.
status: proposed
created: 2026-09-15
modified: 2026-09-15
---

# ADR-0028 - Plugins run code at lifecycle hooks, and middleware reads the parsed invocation

## Context

The format plugin needs three things no plugin could do under ADR-0017 and ADR-0013 as written. It must put `--format` on the Commands that declare a result and on no other, because which formats exist is a fact of each Command and most Commands have none, so a global option would be a guess on every page. It must add `json` and `jsonl` to every result's views without the author naming them. And it must read the value of `--format`, a local option, before the action emits, which a chain that ran ahead of local parsing could not see.

A plugin is a place to write code. The earlier contract described a plugin as declarations alone and its value as performing no work at install, which described the plugins that existed and not the seam's purpose. This record replaces that framing: a plugin's code runs where core calls it, and core names the points.

**Lifecycle hooks.** A plugin definition carries functions named `on` followed by the event, with the event's subject where it carries meaning and omitted where it does not: `onCommandAttach` names its subject, and a later `onLog` would not. Every hook runs in installation order. Middleware keeps its name and is not a hook, because it wraps an invocation instead of running in sequence at a point, and the difference is what an author needs to know when choosing between them. The first hook, `onCommandAttach`, runs at graph build once per Command, the root included, after the author's declarations are complete and before the build rules. It receives the unlocked declaration and uses the ordinary authoring calls, so a plugin adds an option or reshapes a result's views with the calls an author uses, and returns the declaration to build. Nothing a hook adds reaches the types: the action was compiled against the author's declaration, so a hook-declared option is present in the value at run time and absent from the action's typed `options`, and a middleware reads it untyped.

**The chain reads the parsed invocation.** Core parses the routed Command's local tokens and validates the invocation before the first middleware runs, and holds the fault it finds rather than raising it. The context carries `input`, the parsed values, or `null` under a held fault, and `next()` raises the fault where the chain used to parse. A takeover therefore keeps every behavior the earlier placement bought, help on an invalid invocation included, and every middleware sees the same request. The cost is that a schema runs on an invocation a middleware then takes over, which a pure validator does not notice.

**Selection is a variable on the context.** Core renders a result through its declaration's default view unless a middleware assigns another name to `view` on the context before the action dispatches. Core validates the assignment against the record at `next()` and treats a miss as the plugin's internal error, because a plugin that selects a name has it validated first, which is what the format plugin's option does through its schema. Core spells no view name and no diagnostic for an unknown format: the option's validator lists the names, and an unknown name is an ordinary input error.

**The format plugin.** Its hook appends `json` and `jsonl` to a record that lacks them and declares `--format` as an ordinary local option whose description lists the names, whose default is the declaration's default, and whose validator accepts the names and the unadvertised alias `ndjson` for `jsonl`. Its middleware is always on and copies the validated value into `view`. The option is local in every respect, so help lists the formats through the description and `inspect()` publishes the option with no plugin named as its source, and `--format` on a Command with no result is the ordinary unknown-option error.

## Considered options

- **A declarative contribution slot for machine views, with core adding names to every result.** Rejected. It made core own the name set, the option, the alias, and a selection call with its own diagnostics, and every later plugin that needed to reshape a Command would have needed another slot. One hook that hands the plugin the declaration covers all of them.
- **`--format` as a plugin option in the globals table.** Rejected. Different Commands have different formats and most have none, so a global spelling is wrong on most pages and its accepted values cannot be listed. It is never a global.
- **An explicit `parse()` on the context with parsing kept lazy.** Rejected. A middleware that forgets the call reads nothing, and the state machine around it buys only that a takeover skips parsing a handful of tokens.
- **Two chains, one ahead of parsing and one around the action.** Rejected. Two concepts and two activation rules for one participation.
- **The whole lifecycle at once: typed context contributions from middleware into the action and a post-action hook.** Deferred. Each waits for a plugin that needs it, and this record names them as the direction so the next hook follows the pattern.

## Consequences

The Plugins contract's sentence that a plugin holds declarations alone and performs no work at install is replaced by: creating and installing the value runs none of its code, and a hook runs at build. ADR-0017's placement of the chain ahead of local parsing is superseded by the dated entry it carries; its one chain, declared activation, deferred loading, and unwinding order stand. A hook-declared local option cannot activate a middleware, since activation is judged from the pre-scan, so a middleware that reads one declares `'always'`.

A validator now runs on an invocation a middleware takes over. How the validation lifecycle is ordered against plugins, and how facts about the request are carried to actions and middleware, are open questions this record does not settle.

## Status

Proposed. It moves to accepted when the format increment lands with both example applications installing `format()` and the acceptance in [Format](../core.md#format) proven under Node and Bun.
