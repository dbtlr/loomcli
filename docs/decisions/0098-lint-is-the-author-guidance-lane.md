---
type: adr
title: ADR-0098 - Lint is the author-guidance lane
description: Author guidance that a type cannot express runs as lint rules in an ESLint plugin Loom ships, which oxlint loads through its jsPlugins slot, so an author sees it in the editor and in CI. Loom builds no check framework of its own, and a new lint rule is a contract change. @loomcli/core/undescribed leaves core's runs and becomes a lint rule. The starting rule set, shipped in 0.15.0, covers undescribed members, a discarded authoring-call result, and name shapes.
status: accepted
created: 2026-10-20
modified: 2026-10-22
---

# ADR-0098 - Lint is the author-guidance lane

## Context

Principle 7 orders the lanes that guide an author: a type first, then a lint rule the author installs, then a development diagnostic for a mistake only the assembled application reveals. Principle 6 names ESLint as a standard Loom follows. Loom ships no lint rules, so guidance a type cannot express lands in the third lane or nowhere.

`@loomcli/core/undescribed` is the clearest case. A Command, an option, or an argument without a description is a plausible mistake, because agents, MCP tools, help, and the manifest read descriptions. Core reports it by failing every `run()` and every `app.invoke()` of a development build, `--help` and completion requests included, and `Application.check()` returns it. A missing description is guidance about the source the author is writing, and the run is the latest point to deliver it. The editor is the earliest.

Other guidance has no lane at all. Declarations are immutable, so `base.option('verbose', { type: 'boolean' })` as a statement whose value nothing uses returns a new Command and changes nothing. No type and no run-time check catches that. A name the parser would reject, such as a Command name with a space, surfaces only when the module loads.

ESLint is the ecosystem's standard linter, and oxlint loads ESLint-compatible JavaScript plugins through its `jsPlugins` slot, as this repository's own lint configuration does. A rule set written for ESLint therefore runs in both tools, in the editor as the author types and in CI. TanStack ships `@tanstack/eslint-plugin-router` for the same purpose: what its router's types cannot express.

## Decision

- **The lane.** Author guidance that a type cannot express runs as lint rules in one ESLint plugin that Loom ships. The plugin is ESLint-compatible, so oxlint's `jsPlugins` slot loads it, and an author sees each rule in the editor and in CI.
- **No check framework.** Loom builds no runner, command, or rule engine of its own for guidance. Development diagnostics stay for a plausible mistake that only the assembled application reveals, such as two plugins that claim one spelling.
- **A new lint rule is a contract change.** A lint rule is part of Loom's public surface. A new one is proposed and goes through the contract process, as AGENTS.md states, and a review never adds one as a fix.
- **`undescribed` becomes a lint rule.** `@loomcli/core/undescribed` leaves core's runs: a development `run()` and `app.invoke()` no longer fail a graph that holds an undescribed member, and `Application.check()` no longer returns the fault. A lint rule reports a Command, an option, or an argument declared without a description in the source it lints. A plugin's own declarations are linted where the plugin's source is.
- **The starting rule set ships in 0.15.0.** It covers three kinds of guidance:
  - an undescribed Command, option, or argument;
  - a discarded authoring-call result, which does nothing because declarations are immutable;
  - name shapes, for the literal names the rule can read.
- **The package.** Its name and its configuration exports for ESLint flat config and for oxlint are settled when the package ships. `loom init` wires the lint configuration into a new application under [ADR-0099](0099-an-assembly-check-from-loomcli-testing-replaces-loom-check.md).

This record narrows the development-only checks of [ADR-0065](0065-release-facts-on-the-host-say-how-the-running-application-was-built.md), which name the undescribed check beside the converter check: the converter check stays, and the undescribed check leaves. It ends the undescribed rule that [ADR-0050](0050-a-packet-built-into-the-application-says-whether-it-is-in-development.md)'s 2026-10-06 entry added, which ADR-0065 carries. It narrows the rules that [ADR-0010](0010-one-graph-serves-runtime-and-projections.md) and [ADR-0051](0051-a-developer-diagnostic-teaches-the-author-what-broke-and-how-to-fix-it.md) list for core. Each carries a dated entry.

## Considered options

- **Keep the undescribed check in development runs.** Rejected. It fails a run, completion included, for guidance about source, and it reaches the author later than the editor does.
- **A `loom lint` command or a Loom rule engine.** Rejected. ESLint and oxlint already run in the editor and in CI, and a Loom-only runner is a check framework the principles rule out.
- **An oxlint-only plugin.** Rejected. An ESLint-compatible plugin runs in both tools, and an author who uses ESLint gets the same rules.

## Consequences

A development run of an application that leaves a description out now succeeds, and the author meets the gap in the editor once the lint plugin is installed. A plugin-declared or hook-declared member that the author's source does not declare is no longer reported in the application, because lint reads source. The lint package joins the release set when it ships.

## Status

Accepted in 0.15.0.

## Changelog

- 2026-10-20: Proposed with the 0.15.0 rescope.
