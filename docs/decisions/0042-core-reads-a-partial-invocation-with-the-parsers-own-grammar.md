---
type: adr
title: ADR-0042 - Core reads a partial invocation with the parser's own grammar
description: Core exports locate(graph, words), a pure function that reads the words of an unfinished invocation against the graph and reports where the last word sits. The parser and locate share one implementation of the token grammar, so completion never keeps a second copy of it.
status: proposed
created: 2026-09-26
modified: 2026-09-26
---

# ADR-0042 - Core reads a partial invocation with the parser's own grammar

## Context

To offer words, shell completion must know where the word under the cursor sits: a Command name, an option spelling, the value of one option, an argument, or the passthrough tail. Answering that means applying Loom's token grammar to a line the operator has not finished: the global pre-scan that stops at the first bare `--`, routing through child names and aliases, the first hyphen token that commits to a Command, long values after `=` or in the next token, short groups, Boolean options that take no value, variadic arguments, and passthrough.

That grammar lives only in core's parser, which is internal, reads a complete invocation, and throws at its first fault. With [ADR-0041](0041-every-action-reads-the-frozen-graph-and-its-routed-command.md), the graph carries every fact the grammar needs, so a plugin could rebuild the rules from graph facts. A second copy would drift from the parser without a failing test, and drift between projections is what the product exists to prevent.

## Decision

- **One export.** Core exports `locate(graph, words)`, which returns a `WordPosition`: the kind of place the last word fills, the routed `CommandNode`, the input it belongs to when it belongs to one, and the part of the word being completed.
- **One grammar.** The parser and `locate` read tokens through one implementation of the grammar. A change to the grammar changes both, so completion cannot disagree with the parser about where a word sits.
- **Structure alone.** `locate` applies the grammar's structural rules to the complete words and reads the last word as the parser would read it next. It runs no validator, no input source, no middleware, and no requirement check, because the line is unfinished. A structural fault among the complete words, or a last word the grammar places nowhere, reads as `none`.
- **Pure.** `locate` is synchronous, reads no host fact, throws nothing for any list of strings, and reads the graph it is given. It reads neither `hidden` nor `deprecated`, because routing selects and parsing binds without reading either; a projection that reads the position decides what to offer.

## Considered options

- **The completion plugin reads the line from graph facts.** Rejected. It needs no core export, but it is a second grammar that drifts from the parser, and only tests that compare the two copies would notice.
- **The callback runs the real dispatch in a completion mode.** Rejected. It is a plugin-specific lane through core's dispatch, which ADR-0033 refused.

## Consequences

The parser is refactored in the implementation so that its token reading is the function `locate` also calls. The public surface gains `locate` and the `WordPosition` type, and nothing an existing consumer uses changes.

## Status

Proposed with the shell completion contract. It moves to accepted when the implementation ships `locate` over the parser's own token reading and the completion plugin reads positions from it under Node and Bun.

## Changelog

- 2026-09-26: Proposed with the shell completion contract.
