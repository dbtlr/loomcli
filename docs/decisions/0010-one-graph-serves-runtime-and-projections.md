---
type: adr
title: ADR-0010 - One immutable graph serves runtime execution and every projection
description: Graph build applies every declaration rule before any token is read, and inspect() returns the same graph as frozen plain data. Help, manifests, and other projections read that snapshot rather than a parallel model, and they describe the accepted product rather than its provenance.
status: accepted
created: 2026-09-07
modified: 2026-09-07
---

# ADR-0010 - One immutable graph serves runtime execution and every projection

## Context

Loom serves operators, agents, and automation from one definition. If help, a manifest, and the router each read their own model, their contracts drift.

Graph build turns the declarations into one frozen `CommandGraph` and applies every declaration rule at every depth before any invocation token is read. `run()` and `inspect()` build from the same declarations in the same order. `inspect()` is synchronous, reads no host facts, caches nothing, and returns frozen read-only data with declared defaults snapshotted and schema objects kept private. It applies every rule `run()` applies except passing a default through its schema, because that call can be asynchronous. A rejected declaration throws the public `DeclarationError`, which `run()` reports with exit 1.

The globals appear once on the graph and never inside a `CommandNode`. A Command appears once, under its canonical name, with its hidden aliases in a separate field. A projection combines what it needs for display and adds nothing the graph does not hold.

A projection describes the accepted built product: how to construct inputs, and what outputs and failures to expect. That scope matters most for the manifest, the projection an agent reads to use an unfamiliar application without validation-driven retries. A projection excludes authoring provenance, diagnostics, ignored declarations, and plugin implementation history, because those change without changing the contract and would turn internal detail into a public surface.

## Considered options

- **A `{ ok, graph | failure }` result from `inspect()`.** Rejected. A declaration error is a developer error, and throwing a public class is the ordinary JavaScript path for one.
- **A standalone `inspect(app)` function.** Rejected. Inspection is a capability of the Application, available in every authoring state alongside `run()` and `name`.
- **Caching the built graph across calls.** Rejected. Each call builds anew, so a consumer never reads a graph that a later declaration change invalidated.
- **A manifest that mirrors the declarations, provenance included.** Rejected. Consumers would see churn that means nothing to them, and the manifest would stop being a contract they can rely on.

## Consequences

Help, manifests, completions, and agent tool listings are projections of `inspect()` output, not of the declarations. A fact a consumer needs to call the application correctly is added to the graph, and from there reaches every projection; a fact that explains how the application was built is not. Nothing is read from a Command by a back door.
