---
type: adr
title: ADR-0002 - The command graph is a tree, and hidden aliases replace multi-parent attachment
description: A Command value attaches at one point in one Application's graph. Extra operator spellings are hidden aliases that route to the Command but never appear in any report.
status: accepted
created: 2026-09-07
modified: 2026-09-09
---

# ADR-0002 - The command graph is a tree, and hidden aliases replace multi-parent attachment

## Context

Because Commands are values, one value could be attached under two parents. The only real use found for that was an operator synonym, such as `ls` for `list`. A graph with shared nodes has no single canonical path for a Command, which breaks help, manifests, diagnostics, and the routed path a schema reads.

The graph is a tree. Build rejects a Command value attached under two parents in one Application. A Command that belongs in two places comes from a function that returns a fresh value per placement.

`alias(...names)` declares hidden aliases on a named Command. An alias changes routing alone. The routed path, every diagnostic, the candidate list of an unknown-command or missing-subcommand error, and the validation context all report the canonical name, whichever token the operator typed. Every canonical name and alias under one parent shares one namespace, and build rejects a repeat. `inspect()` exposes `aliases` as its own field, so a completion or manifest consumer can read them while a help consumer omits them.

## Considered options

- **Multi-parent mounting.** Rejected. It was the original scope and was re-scoped once the synonym use case was the only one left.
- **Advertised aliases with deprecation messages.** Rejected. Hidden means hidden from operators, not from tooling. An advertised second name is a second contract to keep.
- **A public live `aliases` getter on the Command.** Rejected. It contradicts the promise that collected declarations stay private. Inspection is the one typed path to graph data.
- **A separate term instead of "alias".** Rejected. The word is shared with an option's short alias and disambiguated in prose: a short alias is a spelling of one option and appears in every projection; a hidden alias is a routing courtesy.

## Consequences

The unnamed root declares no aliases. A hidden alias never appears in a candidate list or a path, so a report that shows an alias is a bug.

## Changelog

- 2026-09-09: Terminology. The glossary now names this concept an alias, an unadvertised synonym for a common mistype or inference, and retires the name hidden alias, because hidden now names a different fact: a hidden Command is a full Command kept off every listing while it still routes and runs, recorded with `docs/core.md` and the dated 2026-09-09 entry of ADR-0019. The decision here is unchanged, and "hidden aliases" in this record's title and text reads as "aliases".
