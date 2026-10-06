---
type: adr
title: ADR-0062 - A control option is marked by the plugin that declares it, and core never reads the fact
description: An option config takes control, a Boolean core fact that marks an option as controlling the invocation rather than feeding the Command's work. Whoever declares the option sets it; help, version, the manifest, the formatter, and the configuration plugin set it on their options. inspect() and the manifest publish it, the MCP tool listing omits marked options, help is unchanged, and core behaves the same at run time.
status: accepted
created: 2026-10-05
modified: 2026-10-06
---

# ADR-0062 - A control option is marked by the plugin that declares it, and core never reads the fact

## Context

A projection that lists what a Command needs, such as an MCP tool's input schema, must leave out the options that control the invocation instead of feeding the work: `--help`, `--version`, `--manifest`, and `--format`. An agent that sets `help: true` on a tool call gets a help page, and one that sets `format` fights the view the projection selected.

The projection cannot tell these options apart by origin. Under [ADR-0055](0055-an-invocation-routes-on-global-options-then-parses-the-routed-commands-words-against-one-table.md) a plugin's options are global options with no record of their declarer, and the graph names no plugin as the source of anything. The formatter's `--format` is a hook-declared local option, the Command's own in every respect. A list kept by the projection would name options it does not own and go stale when a plugin adds one.

## Decision

- **A core fact on an option.** Every option config takes `control?: boolean`: a local option, a global option, a plugin's option, and an option a lifecycle hook declares. An omitted `control` reads `false`, and a value that is not a Boolean is the `@loomcli/core/flag-not-boolean` declaration error. An argument is always the Command's input, so `control` on an argument is the `@loomcli/core/misplaced-listing-fact` error.
- **The declarer marks it.** Help, version, the manifest, the formatter, and the configuration plugin set `control: true` on `--help`, `--version`, `--manifest`, `--format`, and `--config`, and the private example plugin `@loom/explain` sets it on `--explain`. An application sets it on an option of its own that does the same kind of job.
- **Core never reads it.** Routing, parsing, input sources, validation, activation, and dispatch behave as they would without it. `invoke()` accepts a control option like any other, so an invocation by name still behaves as the argv that spells it.
- **Its readers.** `inspect()` publishes `control` on every `OptionNode` variant, and the manifest copies it. The MCP tool listing omits a marked option. Help is unchanged and lists every option it listed before.

## Considered options

- **An exclusion list given at MCP installation.** Rejected. Every application would repeat it, and it would go stale when a plugin adds an option.
- **Excluding a plugin's options by origin.** Rejected. The graph records no origin, by ADR-0055's design, and the formatter's `--format` is a local option no origin test would catch.
- **An extension the MCP plugin defines.** Rejected. Help, version, and the manifest would have to import an MCP declarations module to mark their own options, and the fact is about the option, not about MCP. Every projection that lists inputs can read a core fact with nothing installed.
- **Rejecting a control option in `invoke()`.** Rejected. It would break the argv equivalence that `invoke()` rests on, and a takeover by name is harmless.

## Consequences

The manifest document gains `control` on every option entry, an ordinary change under its stability rule. Help and the manifest may read the fact later to separate control options on a page. The configuration plugin marks `--config`, because it says where the run reads its configuration rather than feeding the Command's work, and the private example plugin marks `--explain`, a takeover like `--help`.

## Status

Accepted in 0.9.0.

## Changelog

- 2026-10-05: Proposed with the contract.
