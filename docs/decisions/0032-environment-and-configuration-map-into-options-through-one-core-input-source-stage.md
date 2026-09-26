---
type: adr
title: ADR-0032 - Environment and configuration map into options through one core input-source stage
description: An option may name the environment variable that supplies it, and one installed plugin may declare the configuration source that answers for options carrying its binding. Core fills each unfilled option from argv, then the environment, then the configuration source, then the declared default, in one stage between local parsing and validation, so a filled value is supplied in every sense and everything downstream reads options.
status: accepted
created: 2026-09-24
modified: 2026-09-26
---

# ADR-0032 - Environment and configuration map into options through one core input-source stage

## Context

An operator often sets a value once for a shell, a project, or a machine instead of typing it on every invocation. The two common carriers are the environment and a configuration file. Without a core seam, each application reads `host.env` inside its action and each configuration plugin invents its own merge, so a value from either skips the schema, the presence rules, the validation context, and the diagnostics a typed option carries, and a plugin option read from the environment cannot activate its middleware.

The governing principle is that the environment and configuration map into options, and everything downstream reads options. A value from either is an alternative to giving the option, in every way: it satisfies `required`, it reaches the schema as the option's raw value, it activates a plugin exactly as the flag would, and the action cannot tell where it came from.

## Decision

- **Precedence.** For each option, the first tier that supplies a value wins: argv, then the environment, then the configuration source, then the declared default, which for a Boolean option is its polarity's absent value. The order is fixed and core-owned. No input and no plugin reorders it.
- **One stage.** Core fills options in one input-source stage after local parsing and before validation. It fills global and plugin options whatever local parsing held, so activation reads the same values whether or not the local tokens were well formed. Every environment and configuration fault is held like any validation fault under ADR-0028 and raised only at the dispatch boundary, so a takeover such as `--help` still ends the run first.
- **Environment binding.** An option binds a variable only by naming it, `env: 'TEXTSTAT_LIMIT'`, on its declaration. Core derives no name, applies no prefix, and accepts no `env: true`. Local, global, and plugin options may bind, and the author of the declaration names the variable, so a plugin author names it for a plugin option. Arguments cannot bind, and neither can a multiple string option, whose list comes from the configuration source. A name matches `[A-Za-z_][A-Za-z0-9_]*` and is read case-sensitively, with no uppercase rule. Within one invocation's scope, the routed Command's local options, the globals, and the plugin options, a variable binds at most one option.
- **Values from the environment.** An empty variable is unset and falls through to the next tier, as core's existing `NO_COLOR` and `FORCE_COLOR` rule treats an empty value. A Boolean option reads its variable through a closed grammar, `true`, `1`, `false`, and `0`, case-insensitive. The variable states the option's value, not a spelling, so `false` means false under every polarity. Any other value is a usage failure naming the variable.
- **Host conventions stay host policy.** `NO_COLOR`, `FORCE_COLOR`, and `TERM` remain presence-based core rendering policy under ADR-0022. They are not environment bindings, and the grammar above does not apply to them.
- **Configuration source.** A plugin definition may declare `source: { binding, load }`. `binding` is an option-target extension descriptor the plugin defines; an option carrying a value of it is configuration-bound, so core knows which options to ask about without knowing what the binding means. Core holds no store, file format, or path grammar. After argv and the environment, core collects the in-scope options that are still unfilled, configuration-bound, and hold no environment fault. When there are none, the source is never loaded. Otherwise core loads it lazily, as it loads a middleware, and calls it once, asynchronously, with the host, the plugin's own resolved option values, and every request. It answers each option with a value of the option's raw type and a label, or with no answer. One application has at most one configuration source, and a second declaration is a build error naming both plugins, as a second claim on the signals slot is.
- **Plugin faults.** A source that throws, or answers with a value of the wrong type, is a fault of that plugin, held and reported at the dispatch boundary as an internal error with code 1. A missing or malformed configuration file is not a core fault; the configuration plugin decides how to treat it.
- **Supplied in every sense.** A filled value satisfies `required`, does not trigger `validateOmitted` because the schema receives the filled value and not `undefined`, and appears in the validation context's `supplied` record as the raw value. Provenance is internal to core's failure messages, and nothing publishes it.
- **Diagnostics.** A failure on a filled value keeps the option as its subject and adds the source in parentheses, `Option "--limit" (from TEXTSTAT_LIMIT): <issue>`. The environment's label is the variable name, and the configuration source supplies its own label for each answer, such as `limits.bytes in <file>`. Argv messages are unchanged.
- **Projections.** `inspect()` publishes the bound variable as `env` on both `OptionNode` variants. The manifest's option entry gains an `env` key, an ordinary change under its stability rule. Help prints no environment binding until the help-variants contract defines extended help, and there extended help alone prints it.

## Considered options

- **Derived variable names from the application name and the option name, or `env: true`.** Rejected. An agent or an operator cannot find a variable that appears nowhere in the source, and a rename of the option would silently rename the variable.
- **Reorderable precedence per input or per plugin.** Rejected, as ADR-0013 rejects plugin-reorderable precedence. A fixed order is one rule an operator learns once.
- **Environment bindings on arguments.** Rejected. A positional is identified by its place among bare tokens, and a value from outside the token stream has no place.
- **A list grammar for multiple options in the environment.** Rejected. Every separator is a character some value holds, and the configuration source already carries lists as lists.
- **A Boolean variable read by presence, as `NO_COLOR` is.** Rejected for bindings. `VERBOSE=0` meaning true surprises every reader; presence stays the rule for the host conventions core already owns.
- **A configuration store in core, with a file format and a key grammar.** Rejected. Core would own a format decision for every application. The binding descriptor lets core know which options are configuration-bound while the plugin owns what the binding means.
- **Publishing where a value came from on the request or the action context.** Rejected. An action that branches on provenance breaks the principle that a filled value is an alternative to giving the option.

## Consequences

The invocation order gains the input-source stage between local parsing and validation, and activation reads resolved values instead of the pre-scan alone; ADR-0017 and ADR-0028 carry dated entries for both. ADR-0006's omission rules read "omitted" as unfilled by every tier, and ADR-0005's validation context reports filled raw values in `supplied`; each carries a dated entry. ADR-0010 gains the `env` graph fact, ADR-0025 applies its universal-facts rule to `env`, and ADR-0013 gains the configuration source as a single-owner position, each by a dated entry. A plugin option filled from a Boolean variable can now produce a core usage failure, the one input error core raises for a plugin option. `StringOption`, `BooleanOption`, and the plugin option declarations gain `env`, `PluginDefinition` gains `source`, and core exports the source's resolver, context, and answer types. A run that calls a configuration source builds the graph it passes as requests, as a run with a middleware chain does.

## Status

Accepted 2026-09-24 with the implementation. Core reads `env` on string, Boolean, and plugin options, applies the input source build rules in `inspect()` and `run()`, fills unfilled options in one stage between local parsing and validation, loads a declared configuration source only when an in-scope option is still unfilled, configuration-bound, and free of an environment fault, and publishes `env` through `inspect()` and the manifest. textstat binds `--min-bytes` to `TEXTSTAT_MIN_BYTES` and `--total` to `TEXTSTAT_TOTAL`, and the acceptance in [Input sources](../core.md#input-sources) passes under Node and Bun through a fixture configuration plugin.

## Changelog

- 2026-09-24: Accepted with the implementation. A Boolean variable outside the grammar leaves its option unfilled for the source as well as for the default, so the source is never asked about it and no lower tier fills it. Core reads every answer before it fills any, so an answer the rule rejects leaves every requested option unfilled. A diagnostic on a negative-only Boolean option names it by `--no-<name>`, the one spelling an operator types for it. An empty list a source answers for a required multiple option reports the required message with the source in parentheses, as every failure on a filled value does. The resolver-failure sentence supplies its full stop only where the thrown message carries none, as the extension value diagnostic does.
- 2026-09-26: [ADR-0038](0038-a-configuration-source-warns-and-reports-input-problems-through-the-ordinary-channels.md), proposed, supersedes the clause that every throw from a source is a fault of that plugin: a thrown `InputError` reports with code 2, and the source context gains `out`, `style`, and `graph`. Every other rule here stands.
