---
type: adr
title: ADR-0124 - Help prints each option's bound variables and configuration key on both pages
description: The compact and the extended help page print an option's environment binding as `env:` and its configuration key as `config:` in the option's fact parenthesis, names alone and never a value, after `implied` and before `deprecated`. Help reads the key from `configInput` as the man page does, and `helpInput({ hideBindings: true })` removes both from both pages. This supersedes ADR-0040's clause that help prints no environment binding and no configuration binding on either page.
status: proposed
created: 2026-10-30
modified: 2026-10-30
---

# ADR-0124 - Help prints each option's bound variables and configuration key on both pages

## Context

[ADR-0040](0040-help-derives-compact-or-extended-from-the-spelling-the-operator-typed.md) holds that "Help prints no environment binding and no configuration binding on either page", and it rejected an ENVIRONMENT block on the extended page because "a row for a Boolean that can only be switched off needs a sentence per polarity to stay true". So an operator learns from `--help` that `--min-bytes` exists, and learns that `TEXTSTAT_MIN_BYTES` and the `minBytes` key also set it only from the man page, which prints `Environment:` and `Configuration:` under each option and an ENVIRONMENT section.

The tools operators already know print the variable on the help page. Commander always shows `env: NAME` in the parenthesis of extras after an option, beside `default:`, and never a value. clap shows `[env: NAME=value]` by default, with `hide_env` and `hide_env_values` to turn it off. Click shows `[env var: NAME]` when an option sets `show_envvar`, and Typer shows it by default. None of them shows a configuration key. The owner ruled on 2026-10-23 to reverse ADR-0040's ruling "to meet the ecosystem's likely expectations", and on 2026-10-30 that both pages print the bindings, `-h` and `--help`, in each option's dim parenthesis, Commander's placement.

An option's variables are a core fact, `env` on every `OptionNode`, in declaration order. Its configuration key is the configuration plugin's `configInput({ path })` value on the option, which the man page already reads through the descriptor. A projection that imports a descriptor reads its value whether or not the declaring plugin is installed, under [Extensions](../core/extensions.md). The graph's `configuration` fact is `null` both without a configuration source and when the source's schema does not convert, so no graph fact says whether the configuration plugin is installed.

## Decision

- **Both pages.** The compact and the extended page print the bindings of each option row they print, local and global, in that row's fact parenthesis. Help's own option binds nothing, so its row is unchanged.
- **Two facts.** `env: <names>` when the option binds a variable, the names in declaration order separated by a space, as a default that is a list of strings prints; and `config: <path>` when the option carries a `configInput` value, its dotted path as declared. The two follow `implied` and precede `deprecated`, which stays last, so `--min-bytes` reads `(default: 0, env: TEXTSTAT_MIN_BYTES, config: minBytes)` and `--total` reads `(env: TEXTSTAT_TOTAL, config: total)`.
- **Names, never a value.** Help prints no variable's value, no configuration value, and no sentence about what a value does, so a Boolean of every polarity prints its bindings alike. The page stays derived from the graph and the variant alone. This answers ADR-0040's reason for the polarity sentence: a name states where a value comes from, which is true of every polarity.
- **Each name stays whole.** Each variable name and the configuration path sit in `nowrap`, as a Details code span does, so prose wraps around them and never inside one. The row set's floor counts each, so a set too narrow for one stacks under [ADR-0087](0087-help-wraps-its-prose-to-the-destinations-columns-and-keeps-its-literals-whole.md).
- **One rule with the man page.** Help reads the configuration key from `configInput` as the man page does, whether or not the configuration plugin is installed. A configuration source another plugin declares binds through its own extension, which help does not read. A change to when the key prints changes help and the man page together.
- **One opt-out.** `helpInput` gains `hideBindings`, which holds `true` alone. An option that carries it prints neither fact on either page. The opt-out is help's alone: the man page, the manifest, and `inspect()` still publish the bindings.
- **The parenthesis grammar.** The parenthesis also begins at the first `  (` followed by `env: ` or `config: `.

## Considered options

- **The extended page alone.** Rejected by the owner's ruling of 2026-10-30, which put the bindings on both pages.
- **An ENVIRONMENT block, or a line per binding under the row.** Rejected by the same ruling, which chose Commander's placement in the parenthesis. ADR-0040's rejection of an ENVIRONMENT block on the page stands.
- **The configuration key only when the configuration plugin is installed.** Rejected. No graph fact says whether it is installed, and the man page reads the key unconditionally, so help and the man page keep one rule.
- **The value beside the name, as clap prints it.** Rejected. The page would depend on the run's environment and configuration file rather than the graph and the variant alone.
- **One `env:` fact per variable, or names separated by commas.** Rejected. A comma separates facts, so commas would read as more facts, and one label per name repeats it; the space follows the list default.
- **Two opt-outs, one per binding.** Rejected. One field covers both of an option's bindings, and it holds `true` alone, as `mcpInput`'s `exclude` does.

## Consequences

Every page that lists an option with a binding gains its facts, so textstat's `--min-bytes` and `--total` rows change on both pages. That is an output change, not a breaking change, and `helpInput` gains one optional field, so an existing declaration compiles unchanged. `HelpPage` is unchanged: a replacement already reads `env` on `OptionNode` and `configInput` through its descriptor. ADR-0040's variants, its spellings grant, and its rejection of an ENVIRONMENT block stand, and it carries a dated entry. [ADR-0032](0032-environment-and-configuration-map-into-options-through-one-core-input-source-stage.md), whose projections clause deferred the binding on help to ADR-0040, carries one too. [Help variants](../plugins/help.md#help-variants) and the [right-cell rule](../plugins/help-page.md#the-help-page) carry the contract.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-10-30: Proposed with the help bindings contract. It supersedes ADR-0040's clause that help prints no environment binding and no configuration binding on either page, and reverses its rejection of configuration bindings on the extended page. ADR-0040 and ADR-0032 carry dated entries.
