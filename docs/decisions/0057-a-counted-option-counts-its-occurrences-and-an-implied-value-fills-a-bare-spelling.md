---
type: adr
title: ADR-0057 - A counted option counts its occurrences and an implied value fills a bare spelling
description: An option declares type count to read how many times it was supplied, as a number that is 0 when absent, with no value, validator, default, or presence rule. A string option declares implied to name the value a bare spelling supplies, so an explicit value is attached and the next word is never taken. Both are ordinary options on every declarer, and a parent's own option rebinds to a child's only when both read words the same way.
status: proposed
created: 2026-10-04
modified: 2026-10-04
---

# ADR-0057 - A counted option counts its occurrences and an implied value fills a bare spelling

## Context

Loom has two kinds of option. A string option takes a value, and a Boolean option takes none and reads the value of its spelling. Two forms that command-line operators know are missing.

- **A count.** `-v`, `-vv`, and `-vvv` raise a verbosity level in `ssh` and `rsync`. Loom rejects the second `-v` as a repeated option, so an author who wants a level declares a string option and asks for `--verbose 2`.
- **An optional value.** GNU `cp --backup[=CONTROL]` and `ls --color[=WHEN]` accept the spelling alone, which means a chosen value, or the spelling with an attached value. `getopt_long` calls this an optional argument. Loom's string option always takes a value, so `--backup` alone is the missing-value error.

clap (`ArgAction::Count`), argparse (`action='count'`), and pflag (`CountP`) each give a count its own kind: valueless, one per occurrence, a number in the program, and 0 when absent. `getopt_long` and pflag (`NoOptDefVal`) read an optional value as attached only, as clap does under `require_equals`; argparse's `nargs='?'` takes the next word, which is the guess this record refuses.

The original Loom specification described a counted string option instead: the option took a raw `"N"` through its validator, a ladder mapped repeated spellings to counts, and an explicit value won over the occurrences. An author needed a validator just to receive a number, and mixing a count with an explicit value needed a rule of its own.

## Decision

- **A third kind.** `type: 'count'` declares a counted option beside `'string'` and `'boolean'`. Each occurrence adds one, across every spelling, alias, and form, so `-vvv`, `-v -v -v`, and `--verbose -vv` each read 3. The action reads a `number`, and an option no occurrence supplied reads 0 unless an input source fills it.
- **A count takes no value.** It reads words as a Boolean option does: `--verbose=3` and `-v=3` are the unexpected-value error, worded for a count as `Counted option "--verbose" does not accept a value. Repeat "--verbose" to raise its count.`, and `-v3` reports `Unknown option "-3"`. In a short group a counted letter continues the walk, so `-tvv` sets `t` and counts 2.
- **A count never repeats.** The once-per-invocation rule does not apply, a repeated counted letter in a short group is no repeat, and a global count adds its occurrences before and after the Command name.
- **A count declares nothing else.** No `validate`, `default`, `required`, `validateOmitted`, `multiple`, `polarity`, or `implied`. TypeScript rejects each at the call, and the call throws for a JavaScript author: `@loomcli/core/count-option-value-rule` for the four value keys, `@loomcli/core/count-option-multiple` for `multiple`, `@loomcli/core/polarity-on-count` for `polarity`, and `@loomcli/core/implied-on-boolean-or-count` for `implied`. An author who wants a cap clamps the count in the action.
- **Input sources fill a count.** An environment variable fills it when its whole text is one or more ASCII decimal digits, and the configuration source fills it with a whole number of 0 or more. Any other value is a usage failure, as a Boolean variable outside its grammar is, with the issue `Use a whole number of 0 or more.` A source fills the count only when no occurrence supplied it.
- **An implied value fills a bare spelling.** `implied: string` on a string option names the value a bare spelling supplies. `--backup` and `-b` supply it, `--backup=numbered`, `-bnumbered`, and `-b=numbered` supply `numbered`, and `--backup=` and `-b=` supply the empty string. A bare spelling never takes the next word, so `--backup numbered` supplies the implied value and leaves `numbered` as the next word, and the missing-value error never applies. In a short group the letter takes the rest of the word, as any value letter does, and supplies the implied value only when nothing remains, so `-tb` sets `t` and the implied value and `-bt` supplies `t`.
- **An implied value is judged as a default is.** It is in the validator's input type as a string, the value an operator would otherwise type. Each run passes it through the option's validator before it reads a token, in the phase a declared default validates in, and a bare spelling supplies that validated output, so the action's type does not change. A rejected implied value is a declaration fault under `@loomcli/core/invalid-implied`, raised by `run()` whether or not the operator typed a bare spelling, because the author declared it. It combines with `multiple`, `required`, `default`, `validateOmitted`, `env`, and `aliases`: a default fills an omitted option and the implied value fills a bare one. An input source supplies explicit values alone and never the implied value. `implied` on a Boolean or counted option and an `implied` that is not a string are rejected at the call under `@loomcli/core/implied-on-boolean-or-count` and `@loomcli/core/implied-not-a-string`.
- **A parent's own option rebinds by value class.** Under [ADR-0055](0055-an-invocation-routes-on-global-options-then-parses-the-routed-commands-words-against-one-table.md), a parent's own option typed before a child's name binds to the child's option of that spelling. Whether the parse took the next word was decided against the parent's declaration, so it rebinds only when the child's option has the same value class: a string option that takes the next word, a string option with an implied value, a Boolean option, or a counted option. Any other pairing is the misplaced-option error.
- **Every option and every projection.** Both forms apply to local, global, plugin-declared, and hook-declared options. `inspect()` publishes a `count` variant of `OptionNode` with `schema: null` and no negative spelling, polarity, or default, and the string variant gains `implied`, which the manifest copies. Help prints `-b, --backup[=<control>]` with the fact `implied: <value>`, rendered as a default is, and `-v, --verbose...`. `locate` and completion read both forms with the parser's grammar, so completion offers a counted spelling again and offers values after `--backup=` but not after a bare `--backup` and a space.

## Considered options

- **The original counted string option.** Rejected. A count that is a string through a validator makes every author write a validator to receive a number, and the ladder and the explicit-value rule are two rules no operator expects. The clap, argparse, and pflag count is valueless and needs neither.
- **A count that accepts an explicit value, as `--verbose=3`.** Rejected. Mixing an explicit value with occurrences needs a precedence rule, and an operator who wants a level from a script sets the variable the option binds.
- **A count with a declared maximum.** Rejected. Core adds no limit to what an operator supplies, and an action clamps its own count.
- **A bare spelling that takes the next word when it can.** Rejected. Whether `--backup numbered` means the value `numbered` or an argument would depend on the word, which is the guess ADR-0055 refused for routing. GNU `getopt_long`, clap's `require_equals`, and pflag's `NoOptDefVal` all read an optional value as attached only.
- **An implied value that bypasses the validator.** Rejected. The action's type would then have to admit a value its validator never saw, and the implied value is what an operator would otherwise type.
- **Validating the implied value at each bare spelling.** Rejected. A rejected implied value is the author's declaration, not the operator's input, so it would reach the operator as an input problem they cannot fix. Judging it as a default is judged reports it to the author on every run.
- **An implied value on a Boolean option.** Rejected. A Boolean option takes no value, so the value a bare spelling supplies is already its polarity's.

## Consequences

`OptionConfig` gains `CountOption`, `OptionNode` and the manifest's option entry gain a `count` variant, the string variants gain `implied`, and `SourceAnswer.value` and `SuppliedInputs.options` admit a number for a counted option. A consumer that switches on an option's `type` meets a third value. The manifest's arrival of the variant and the field is an ordinary change under its stability rule: an option entry may arrive with a new `type`, and a consumer reads an entry whose `type` it does not know by the fields it does know. `UnexpectedValueError` keeps its class and facts and gains a sentence for a counted spelling. ADR-0055's value class gains the two new members, and its short-group rule gains the counted letter and the implied-value letter; neither changes a form ADR-0055 already accepts.

## Status

Proposed 2026-10-04 with the contract in [Counted options](../core.md#counted-options), [Implied values](../core.md#implied-values), [Short groups](../core.md#short-groups), and [Global consumption and routing](../core.md#global-consumption-and-routing). It moves to accepted inside the release PR of the release that ships the implementation: jsonkit's global `-v, --verbose` counting across spellings and both sides of the Command name and writing its stderr line, `--verbose=2` failing with the counted sentence, a fixture string option with an implied value reading each form of the contract, a parent's own option rebinding only within one value class, both forms filled from the environment and the configuration source as the contract states, help, the manifest, completion, and suggestions rendering both forms, and every new declaration rule rejected at the call, under Node and Bun.

## Changelog

- 2026-10-04: Proposed with the contract.
