---
type: adr
title: ADR-0060 - onGraphBuilt judges the built graph and never contributes
description: A plugin definition gains a third lifecycle hook, onGraphBuilt, which core calls once per graph build with the frozen graph, after every onCommandAttach hook. It may reject the graph by throwing a DeclarationError, and it cannot attach, rewrite, or store anything. Any other throw or a returned value is the broken-graph-hook build fault.
status: proposed
created: 2026-10-05
modified: 2026-10-05
---

# ADR-0060 - onGraphBuilt judges the built graph and never contributes

## Context

Some rules span the whole graph and belong to a plugin rather than to core. The MCP plugin serves each opted-in Command as a tool named from its path, and two Commands such as `scratch create` and `scratch_create` give one tool name. No `onCommandAttach` hook can see that, because it receives one Command at a time and an earlier Command's facts may still change under a later hook. The fault must still surface where every declaration fault surfaces: at build, from `run()` and `inspect()`, as a Developer Diagnostic in a development build, and not first when an agent calls a tool.

[ADR-0028](0028-plugins-run-code-at-lifecycle-hooks-and-middleware-reads-the-request.md) named lifecycle hooks `on<Event>` and left more hooks to the plugins that need them. An earlier design carried a build-complete hook that wrote derived data into plugin storage, which brings a storage contract and a contribution order that no reader needs.

## Decision

- **The hook.** A plugin definition may carry `onGraphBuilt(graph)`, typed `GraphBuiltHook`, named under ADR-0028's rule. It is synchronous and returns `undefined`.
- **When.** Once per graph build, after every `onCommandAttach` hook and the build rules over what they returned, and after the graph is frozen: on every `run()`, every `inspect()`, and every `app.invoke()` build. An action's `invoke()` reuses its run's graph and runs no hook again. Hooks run in installation order, and each receives the same graph.
- **What it receives.** The frozen `CommandGraph` `inspect()` returns, extension values included. It is not told which call built the graph.
- **It judges and never contributes.** The hook may reject the graph by throwing a `DeclarationError`, which reports as itself, a build fault with exit 1, by build. It cannot attach a Command, rewrite a fact, or store derived data. A plugin that needs data derived from the graph derives it where it reads it.
- **A broken hook.** A hook that throws anything else, or returns a value, a promise included, is the build fault `@loomcli/core/broken-graph-hook`, which names the plugin. `plugin()` rejects an `onGraphBuilt` that is not a function.

## Considered options

- **A build-complete hook that stores derived data.** Rejected. It needs plugin-owned graph storage and an order among contributions, and no reader needs either: the MCP plugin builds its tool table in its own action.
- **Checking the collision in the plugin's action.** Rejected. The fault would surface only on `app mcp`, as a runtime failure an operator sees, while every other run of the broken application succeeds.
- **Letting `onCommandAttach` see the whole graph.** Rejected. A Command's facts are not final until every hook has run on it, so a check there reads a graph that is still changing.
- **Telling the hook which call built the graph.** Rejected. A rule about the declarations holds in every build, and a hook that branched on the caller would let `inspect()` and `run()` disagree.

## Consequences

A plugin with the hook makes every build produce the frozen graph, so each validated input's schema converter runs once per run, as it does on any run that has a middleware chain. A hook's fault is a build fault, so no `onFailure` hook runs for it. The hook is optional, so an existing plugin is unaffected. [ADR-0028](0028-plugins-run-code-at-lifecycle-hooks-and-middleware-reads-the-request.md) carries a dated entry.

## Status

Proposed 2026-10-05 with the contract in [Judging the built graph](../core.md#judging-the-built-graph). It moves to accepted inside the release PR of the release that ships the implementation: the hook called once per build after every `onCommandAttach`, a thrown `DeclarationError` reported as itself, the broken-hook rows rejected, and the acceptance in that section, under Node and Bun.

## Changelog

- 2026-10-05: Proposed with the contract.
