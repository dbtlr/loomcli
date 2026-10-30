---
type: adr
title: ADR-0128 - A string option's binding may let a defined empty variable supply the empty string
description: A scalar string option that binds env may declare envAllowEmpty true, which the types accept there alone. Under it, the first name in list order that the environment defines supplies the option, its value empty or not, so APP_PREFIX= fills an empty string that keeps the configuration source and the default from applying. Without it an empty variable stays unset, as ADR-0032 rules. A dotenv file's empty assignment supplies the empty string the same way. The graph publishes the key as envAllowEmpty on the string variant of OptionNode, the manifest copies it, and the man page says so in the variable's ENVIRONMENT entry. This narrows ADR-0032's clause that an empty variable is unset.
status: proposed
created: 2026-10-30
modified: 2026-10-30
---

# ADR-0128 - A string option's binding may let a defined empty variable supply the empty string

## Context

[ADR-0032](0032-environment-and-configuration-map-into-options-through-one-core-input-source-stage.md) rules that "an empty variable is unset and falls through to the next tier, as core's existing `NO_COLOR` and `FORCE_COLOR` rule treats an empty value". So an operator who sets `APP_PREFIX=` cannot clear a prefix the configuration file or the default supplies, although `--prefix=` clears it, because the parser preserves an empty value in argv. The dotenv plugin already keeps a defined empty value: under [ADR-0102](0102-dotenv-imports-every-variable-the-process-has-not-set.md) a file's `FOO=` imports the empty string, and a process's own empty `FOO` wins over the file, so both reach the environment tier as `''` and fall through there.

The ecosystem splits. Click and Typer treat an empty variable as unset and offer no setting. Viper treats it as unset unless the application calls `AllowEmptyEnv(true)`, and Rust's `config` crate makes it a choice through `ignore_empty`. clap and Commander treat it as supplied. The owner approved the proposal that follows Viper: an opt-in, with today's fallthrough the default.

## Decision

- **The author opts in per binding.** A scalar string option that binds `env` may declare `envAllowEmpty: true`. The types accept the key there alone, so they reject it on an option that binds no variable, on a multiple option, and on a Boolean, counted, or content option. `envAllowEmpty: false` and an omitted key read alike. Core holds no runtime check for the key, under [ADR-0093](0093-a-value-that-bypasses-the-types-gets-no-rule.md).
- **A defined empty variable supplies the option.** Under the key, the first name in list order that the environment defines supplies the option, its value empty or not, and a name the environment does not define is skipped as before. So with `env: ['APP_PREFIX', 'LEGACY_PREFIX']`, `APP_PREFIX=` fills `''`, and `LEGACY_PREFIX` is never read. Without the key, an empty variable stays unset and falls through to the next name and then to the next tier, as ADR-0032 rules.
- **The empty string is an ordinary fill.** It is the environment tier's fill, so the configuration source is never asked for the option and the default never applies. It satisfies `required`, it passes the option's validator as any value does, and it never fills the implied value. A validator that rejects an empty value rejects it, and the failure names the variable: `Option "--prefix" (from APP_PREFIX): <issue>`.
- **A dotenv file's empty assignment supplies it too.** A file's `FOO=` that dotenv imports is a defined empty variable, so under the key it supplies `''`, as a process's own empty `FOO` does. The dotenv plugin does not change.
- **The key is published.** The string variant of `OptionNode` gains `envAllowEmpty`, `true` when the binding declares the key `true` and otherwise `false`. A content option's node, which is the string variant without `background`, is also without `envAllowEmpty`. The manifest copies the key after `envDelimiter`. The man page's ENVIRONMENT entry for each of the option's variables reads `Supplies --prefix, even with an empty value.`.

## Considered options

- **An empty variable is always supplied, as clap and Commander read it.** Rejected. Every application that binds a variable today would change, and the default would part from the `NO_COLOR` and `FORCE_COLOR` rule ADR-0032 follows.
- **One switch for the whole application, as Viper's `AllowEmptyEnv` is.** Not taken. Whether an empty value clears an option is a fact about that option, such as a prefix, and a key on the binding is published beside the names it governs.
- **The key on a multiple string option.** Not taken. An empty value splits into one empty item under [ADR-0127](0127-a-multiple-option-binds-a-variable-whose-value-its-authors-delimiter-splits-into-the-list.md), never into an empty list, so the key would fill `['']` where clearing a configured list wants `[]`, and a rule that fills an empty list is a separate grammar.
- **The key on a Boolean, counted, or content option.** Rejected. The Boolean and counted grammars reject an empty value, so the key would turn an unset variable into a usage failure, and a content option reads its value as a path, which an empty string does not name.
- **In a list, an empty name under the key falls through to a later non-empty name.** Rejected. The key states that a defined variable speaks for the option, so the first defined name is the one that supplies it, as the first non-empty name supplies it without the key.

## Consequences

The scalar string option's binding gains `envAllowEmpty`, an optional key, so a declaration that compiled before still compiles and runs the same, and no application changes its code. The input-source stage reads a bound variable's definedness, rather than its emptiness, for an option that declares the key. `OptionNode`'s string variant and the manifest's string option entry gain `envAllowEmpty`, an addition to objects core and the manifest build, and the man page's ENVIRONMENT entry gains a clause. Core gains no declaration rule and no diagnostic. [Input sources](../core/input-sources.md), [Options](../core/options.md), [Graph inspection](../core/graph-inspection.md), [Manifest plugin](../plugins/manifest.md), [Man pages plugin](../plugins/manpage.md), [Dotenv plugin](../plugins/dotenv.md), and the [glossary](../glossary.md) carry the contract.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-10-30: Proposed with the contract. It narrows ADR-0032's clause that an empty variable is unset, for a scalar string option whose binding declares `envAllowEmpty: true`. ADR-0032 carries a dated entry.
