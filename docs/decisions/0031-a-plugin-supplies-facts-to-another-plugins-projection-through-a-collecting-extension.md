---
type: adr
title: ADR-0031 - A plugin supplies facts to another plugin's projection through a collecting extension
description: A projection with an open set of suppliers declares a collecting extension, whose values accumulate in order instead of replacing each other, and a supplier adds values from its onCommandAttach hook by importing the declaring plugin's declarations module. Help supplies its details and examples to the manifest this way, and the manifest carries no code for any supplier.
status: proposed
created: 2026-09-24
modified: 2026-09-24
---

# ADR-0031 - A plugin supplies facts to another plugin's projection through a collecting extension

## Context

The manifest needs prose and example invocations for a Command, and more than one party holds them. Help holds `details` and `examples` for its page. The author may hold instructions an agent needs that make no sense on a help page. A third-party plugin may hold facts of its own that belong in the manifest. The set of suppliers is open, and the manifest is the one known consumer.

Shaping planned a pull: the manifest imports help's descriptor module and reads help's values with `readExtension`. A pull puts knowledge of every supplier inside the consumer. The manifest would need new code for each plugin that wants to appear in it, a replacement help plugin would lose its examples from the manifest, and a third-party plugin could never reach the manifest at all. The pull also conflicted with ADR-0020, which forbids a subpath of the plugin pack from importing a sibling.

The rule that settles who declares the seam is that the party with the open set names the seam, and the known party declares it. The manifest's suppliers are the open set, so the manifest declares the seam and each supplier names it. A supplier decides for itself where its facts are projected: help decides that its examples belong in the manifest, and the manifest needs no code for help to do so.

An extension already carries typed plain data on a graph node under a descriptor's identity. What it lacks is room for more than one supplier: across layers, a later value replaces the complete earlier value under ADR-0025. A collecting extension keeps every value instead.

## Decision

- An extension declared with `collect: true` is a collecting extension. Its values accumulate on a Command in a fixed order: the constructor's `extensions`, then each `extend()` layer in authoring order, then each value a lifecycle hook adds, in installation order. A value never replaces an earlier one, and values never merge. One layer still holds at most one value per extension. The node's record holds the frozen array of the validated outputs, and `readExtension` through a collecting descriptor returns that array, or `[]` when the node holds none.
- A lifecycle hook reads the extension values a Command carries. The value `onCommandAttach` receives publishes the record as it stands at that hook, and `readExtension` accepts it. Build validates the author's layers before the first hook runs, and a value a hook adds is validated when the hook adds it.
- A plugin supplies values to another plugin's collecting extension from its `onCommandAttach` hook, through `extend()`, by importing the declaring plugin's declarations module. The declaring plugin need not be installed. Its values are then inert on the graph, as every extension value of an uninstalled plugin is.
- A collected value names no supplier. Which plugin or which layer supplied it is provenance, which ADR-0010 keeps out of every projection.
- The manifest declares `manifestCommand`, a collecting extension on Commands with `details` and `examples`. Help's hook supplies its own `details` and `examples` through it. An author's own value is where an agent-only instruction goes.
- The principle ADR-0030 states, that nothing depends on the manifest, keeps its meaning: no projection, plugin, or core path reads a fact from the manifest, and every fact a supplier gives the manifest also stays on the graph for every other projection. Supplying values to the manifest's extension is the supplier's choice of where to project its own facts, not a dependency on the manifest to learn something.

This record supersedes one clause of ADR-0025: across layers, a value of a collecting extension joins the earlier values instead of replacing the complete earlier value. The replacement rule stands for every ordinary extension, and the rest of ADR-0025 stands.

It also supersedes one sentence of ADR-0020, that a subpath imports nothing from a sibling. A subpath may import a sibling's declarations module at `<subpath>/extension`, and never a sibling's entry, middleware, or views module. The purpose of that sentence holds: an application that installs one plugin bundles one plugin, plus the declarations of the collecting extensions it supplies.

It reverses the rejection of contribution queues recorded among ADR-0019's considered options, which ADR-0025 superseded, for a reason that record did not weigh: reading another plugin's facts through its descriptor module serves a consumer that knows its suppliers, and the manifest's suppliers are an open set.

## Considered options

- **The manifest pulls help's facts through help's descriptor module.** Rejected. The consumer needs code for each supplier, a replacement help plugin drops out of the manifest, and a third-party plugin cannot reach it.
- **A separate contribution queue in core, apart from extensions.** Rejected. It would be a second mechanism for putting typed plain data on a graph node, with its own declaration call, its own attach call, and its own read. The collecting form reuses the identity, the target brand, schema validation, plain-data freezing, `inspect()`, inertness, and the by-reference descriptor check.
- **A seam named by identity string, with a type-only import for the value's type.** Rejected. The call would carry an explicit type argument over an untyped lookup, which is an assertion in all but name. Core also could not validate a value unless the declaring plugin were installed, because only it holds the schema, so a bad value would pass silently until the day the consumer is installed.
- **Request-time contributions, with a drain posture and an escalation error.** Rejected. Every contribution point in core is synchronous at build, nothing reads request-time data from another plugin, and a build failure is the only failure timing an author needs.
- **Promoting `details` and `examples` to core facts.** Rejected for now. It would be a breaking migration of help's published descriptor, and it would not serve a third-party plugin's facts or an author's agent-only instruction.
- **A build-time combine function on the declaration, so a consumer rejects conflicting values at build.** Rejected. The manifest's fields are all collections, so no values conflict, and a consumer that needs a single value can declare an ordinary extension.

## Consequences

`Extension` gains a third type parameter, `Collect`, which defaults to `false`, and every descriptor publishes `collect`. `readExtension` gains an overload for a collecting descriptor, and it accepts the value a hook receives for a Command-target descriptor. The value `onCommandAttach` receives gains `extensions`. An invalid extension value an author declared is now reported before any hook runs, where before this record it was reported after every hook ran. The help plugin gains an `onCommandAttach` hook, which costs one call per Command on every build, and its entry module imports the manifest's declarations module. The plugin pack gains the subpath `@loomcli/plugins/manifest/extension` ahead of the manifest plugin's entry.

## Status

Proposed. It moves to accepted with the implementation that collects values, publishes `extensions` to hooks, ships the manifest's declarations module, and makes help supply its values, proven through `inspect()` with no manifest plugin installed, under Node and Bun.
