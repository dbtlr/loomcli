---
type: adr
title: ADR-0116 - A provider's opener receives out, style, and the graph
description: The provider context gains out, the channel object a middleware receives, the contextual style a configuration source receives, and the frozen graph the run built, so a provider can warn the operator, write a line at -v, and read the application name. A provider still asks nothing and reads no request. This replaces ADR-0108's clause that a provider receives no out.
status: proposed
created: 2026-10-28
modified: 2026-10-28
---

# ADR-0116 - A provider's opener receives out, style, and the graph

## Context

[ADR-0108](0108-an-action-receives-provided-values-from-the-providers-its-command-opts-in-to.md) gave a provider's opener the validated global options, the values of the providers it uses, the host, `log`, the signal, and `onShutdown`, and no `out`, prompts, or request: "A provider writes nothing for the operator." Its contract left the door open: "A later member can add `out` or the prompts library without breaking an opener."

The configuration plugin's structured values are a provider, `provided.config`, under [ADR-0118](0118-the-configuration-plugin-reads-one-schema-described-file-through-a-provider-and-drops-what-the-schema-rejects.md). A run that reads `provided.config` and fills no linked option builds the value without ever calling the configuration source, so the provider is what reads the file. It then has three jobs the source context already serves and the provider context does not: warn once about a broken discovered file, write one line at `-v` for each value the schema drops, and read the application name, which the default file `.<app>.json` and the XDG user file `<app>/config.<ext>` are built from. A database pool that retries a connection has the first two jobs as well.

## Decision

- **Three members join the context.** `ProviderContext` gains `out`, `style`, and `graph`.
- **`out`.** The channel object a middleware receives: the output contract an action has, with the default destinations on every Command and `results` typed with a `never` argument, because a result is the action's. `out.fatal()` throws a `FatalError`, which takes the ordinary failure path as any other throw from an opener does. An ephemeral provider receives its run's `out`, and a persistent provider the outermost run's, as each already receives the host and `log`.
- **`style`.** The contextual style a configuration source receives, so a provider escapes raw data with `style.escape` before it writes it.
- **`graph`.** The frozen graph the run built, which [`inspect()`](../core/graph-inspection.md) returns, the same object a middleware and the action read. A persistent provider receives the outermost run's.
- **Still no prompts or request.** A provider asks nothing and reads no request or local input. It reads global options alone, as ADR-0108 states.

## Considered options

- **An always-on middleware in the configuration plugin that saves `out` and the application name where the provider can read them.** Rejected. Every run of every application that installs the plugin would load a middleware module to work around a context, and a second plugin with the same need would build the same workaround.
- **Only the application name, as one more member.** Rejected. The warning and the `-v` lines need `out`, and the graph is the fact core already hands a middleware, a source, and the action.
- **The prompts library as well.** Not added. No provider asks the operator a question yet, and the builds run at the dispatch boundary, where a question would be the action's job.

## Consequences

Adding a member to a context core builds is an addition, not a breaking change, so every opener compiles unchanged. `@loomcli/testing`'s `providerContext` builds the three members by its existing rules: `out`'s lanes do nothing, `style` answers every name, and an unstated `graph` asks to be stated. [Providers](../core/providers.md) carries the contract.

## Changelog

- 2026-10-28: Proposed with the configuration contract (LM-426). It replaces ADR-0108's clause that a provider receives no `out`; ADR-0108 carries a dated entry.
