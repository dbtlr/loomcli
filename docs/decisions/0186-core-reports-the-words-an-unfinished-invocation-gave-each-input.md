---
type: adr
title: ADR-0186 - Core reports the words an unfinished invocation gave each input
description: Every position locate reports but none holds typed, the words the earlier words gave each option and each argument by name, exactly as the parser read them, so a reader that completes one input narrows by the others without a second reading of the grammar.
status: proposed
created: 2026-11-18
modified: 2026-11-18
---

# ADR-0186 - Core reports the words an unfinished invocation gave each input

## Context

[ADR-0042](0042-core-reads-a-partial-invocation-with-the-parsers-own-grammar.md) has `locate` report where the last word sits and, for an option position, which options the earlier words supplied. A reader that offers an input's values from the author's own code, such as the completer of [ADR-0187](0187-an-author-supplies-an-inputs-completion-values-from-a-named-completer.md), must know what the operator already typed for the other inputs, such as the project that narrows which task ids exist. The words are in core's parser, which has already assigned each earlier word to an option or an argument. A reader that works them out from the positions would keep a second copy of the grammar, which [ADR-0042](0042-core-reads-a-partial-invocation-with-the-parsers-own-grammar.md) exists to prevent.

## Decision

- **One member, on every position but `none`.** `command`, `option`, `value`, `argument`, and `passthrough` positions hold `typed: TypedInputs`, with two read-only maps from a declared name to `readonly string[]`: `options` and `arguments`. `TypedInputs` is exported as a type. It is additive on an output type.
- **The parser's own assignment.** `typed` is read from the state the parser already holds for the earlier words, and the positional words bind through the one function that binds a positional to its slot. No second reading of the grammar exists. The words are raw: no validator, input source, or default runs.
- **What the options hold.** The words of every occurrence in the order read, by the option's declared name, a global option's and a bound own option's alike, whatever the spelling that gave them: `--opt v`, `--opt=v`, `-o v`, an attached `-ov`, a letter of a short group, or an alias, which reads under the canonical name. A multiple option holds every word, and an arity option the words of every completed occurrence as one flat list, followed by the words an occurrence the line left open has received so far, so a reader learns which word of the tuple it completes from the count modulo the arity. A last-wins option holds its last word. A bare spelling's implied value was never typed, so it adds none. A Boolean option, a counted option, and an option no earlier word gave have no entry.
- **A held own option.** An own option of a Command with children that routing still holds unbound, because the next word may still name a child, holds its words under the name the reached Command's own entry gives its spelling, as `supplied` already lists it. The words come from the occurrences routing holds, bound as routing binds them once it ends, so no second reading of the grammar exists here either.
- **What the arguments hold.** The words each argument holds so far, a variadic argument's every word, bound as the last word reads them: the next argument until it is filled, then the variadic. The arguments after a variadic, which bind from the end of a complete line, are absent.
- **The last word is in neither map.** It is the word being completed, and the position reports it as `prefix`.

## Considered options

- **A reader rebuilds the words from `supplied`, `counts`, and the earlier words.** Rejected: it copies the grammar, which drifts from the parser without a failing test.
- **Report the words only on `value` and `argument` positions.** Rejected: the `command` position's other reading is an argument, and one member on every kind spares a reader a case.
- **Keep a tuple's structure for an arity option.** Rejected: a flat list is what the earlier words gave, and a reader that needs the grouping divides by the declared arity.
- **Leave out a held own option until routing ends, and an open arity occurrence until it completes.** Rejected: `supplied` already lists the held option, so a reader would see the option given and not its words, and a completer at the second word of a tuple could not see the first.
- **Report validated values.** Rejected: the line is unfinished, and [ADR-0042](0042-core-reads-a-partial-invocation-with-the-parsers-own-grammar.md) runs no validator.

## Consequences

This narrows ADR-0042's position members, which gain `typed`. The [graph inspection reference](../core/graph-inspection.md#locating-a-word) states the member. No other core behavior changes.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-18: Proposed so a named completer can narrow by the other inputs (LM-355). Review added a held own option's words and an open arity occurrence's received words.
