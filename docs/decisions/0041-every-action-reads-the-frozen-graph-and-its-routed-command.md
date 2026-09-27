---
type: adr
title: ADR-0041 - Every action reads the frozen graph and its routed Command
description: The action context gains graph and command, the same frozen CommandGraph and routed CommandNode a middleware reads, so a Command whose job is to project the graph, such as shell completion, does that job in its own action. No plugin-specific lane exists.
status: accepted
created: 2026-09-26
modified: 2026-09-27
---

# ADR-0041 - Every action reads the frozen graph and its routed Command

## Context

Shell completion is a projection of the graph: it offers the Command names, option spellings, and values the graph holds. [ADR-0033](0033-a-plugin-attaches-ordinary-commands-to-the-root.md) lets the completion plugin attach its `completion` Command, and it rules that a plugin Command's action receives what every action receives. Today that excludes the graph. An action receives `{ args, options, passthrough, out, host, signal, style }`, and nothing in it reaches the graph or the routed node.

Plugin code already reaches the graph through two ordinary paths. A middleware reads `graph` and the routed `command`, which is how help and the manifest print. A configuration source reads `graph` under [ADR-0038](0038-a-configuration-source-warns-and-reports-input-problems-through-the-ordinary-channels.md). A middleware cannot activate for a Command, only for its own plugin's options or always, so completion could reach the graph only through an always-on middleware that recognizes its own Command, answers, and leaves the Command's actions as stubs that never run.

## Decision

- **The action context gains two members.** `graph` is the frozen `CommandGraph` that `inspect()` returns for this run, and `command` is the routed `CommandNode` inside it. They are the same two values the run's middleware receive.
- **Every action.** An application's action and a plugin Command's action receive them alike. This is not a lane for plugins: it widens what every action receives, so ADR-0033's rule that a plugin Command's action receives what every action receives holds unchanged.
- **Read-only.** Both are frozen plain data. An action that reads them changes nothing about the run.

## Considered options

- **An always-on middleware that answers for its own Command.** Rejected. It needs no core change, but the behavior sits outside the action where a reader looks for it, the Commands' actions become stubs, the middleware module loads on every run of every application that installs the plugin, and whether `completion bash --help` reaches help depends on installation order.
- **Activation keyed to the plugin's own Commands.** Rejected. It removes the load cost, but the actions stay stubs, and it adds a second way to activate that exists for one case.
- **A graph for plugin Command actions alone.** Rejected. It is the plugin-specific lane ADR-0033 refused: the graph would record which plugin attached a Command, and an application's own Command could not project the graph.

## Consequences

The action context is a type core produces and consumers read, so an existing action compiles unchanged, and the change is not breaking. Because it touches the action handler's typing, the implementation reports the editor-latency gate against the baseline on `main`.

An application may now write its own projection, such as a `commands` listing, as an ordinary action. [ADR-0010](0010-one-graph-serves-runtime-and-projections.md) still governs what a projection may add: nothing the graph does not hold.

## Status

Accepted 2026-09-27 with the implementation. Every action, an application's or a plugin Command's, receives `graph` and `command`, and the completion plugin's actions read them in the conformance run in Bash, Zsh, and Fish under Node and Bun.

## Changelog

- 2026-09-26: Proposed with the shell completion contract.
- 2026-09-27: The two members are lazy. Reading either builds the run's graph once, so a run without middleware whose action reads neither calls no schema converter.
- 2026-09-27: Accepted with the implementation.
- 2026-09-27: A run that asks a configuration source builds the graph too, because the source reads it. A run calls no schema converter only when it has no middleware, asks no configuration source, and its action reads neither member.
