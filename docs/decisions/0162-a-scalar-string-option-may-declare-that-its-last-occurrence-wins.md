---
type: adr
title: ADR-0162 - A scalar string option may declare that its last occurrence wins
description: A scalar string option, an arity option included, declares lastWins true, and a later occurrence on the command line then replaces an earlier one instead of failing as a repeat, so a wrapper script or a shell alias can prepend a default that the operator's later value replaces. Occurrences count across every accepted spelling, a bare spelling that supplies an implied value included, and on an arity option the last occurrence's whole tuple replaces the earlier one. Only the last value reaches the validator, a replaced value is dropped unread with nothing printed at any verbosity, the background choice of a last-wins marked option follows the winning occurrence, and every occurrence still takes its words and still raises every fault but the repeat. The types reject the key beside multiple true and on a Boolean, counted, or content option. Source precedence, the value class, the action's type, invoke, and MCP are unchanged. OptionNode's string variant and the manifest's string option entry publish lastWins, completion offers such an option again after the earlier words supplied it, and help and the man page print nothing new. It supersedes nothing and narrows ADR-0040's spelling clause and ADR-0161's repeat and completion clauses.
status: accepted
created: 2026-11-16
modified: 2026-11-17
---

# ADR-0162 - A scalar string option may declare that its last occurrence wins

## Context

An option that is neither multiple nor counted can occur only once per invocation, across every accepted spelling, so `--editor vim --editor nano` fails with `Option "--editor" can be supplied only once. Remove the repeated option.` and exit 2. The rule catches an operator who typed one option twice by mistake.

It also blocks a common way to set a default. A wrapper script that runs `mailer --editor vim "$@"`, or a shell alias `alias draft='mailer --editor vim'`, puts the default first, and the operator's own `draft --editor nano` then fails as a repeat. An environment variable or a configuration file can carry the default instead, but only when the author bound one, and a wrapper that serves one task, such as a release script, does not want to change a variable for the whole shell.

Many parsers let the last occurrence win. argparse's `store` action and Go's `flag` and `pflag` packages, which Cobra uses, keep the last value of a repeated scalar option, and GNU tools such as `ls --color` read the last one. clap rejects a repeated scalar argument by default, and an author opts in with `Command::args_override_self` or `Arg::overrides_with`. Loom keeps the once-only rule as the default and gives an author the opt-in per option.

No record rules out a last-wins policy. [ADR-0057](0057-a-counted-option-counts-its-occurrences-and-an-implied-value-fills-a-bare-spelling.md) exempts a counted option from the once-only rule, and [ADR-0161](0161-a-string-option-may-declare-an-arity-and-each-occurrence-takes-that-many-separate-words.md) applies the rule to a scalar arity option, so this record adds an opt-in beside them and supersedes nothing.

The owner settled the shape in grooming (LM-385): strings only, one key named `lastWins`, per option alone, command-line occurrences alone, the replaced value dropped unread with nothing printed, and the projections limited to inspection, the manifest, and completion.

## Decision

- **The declaration.** A string option declares `lastWins: true`: `.option('editor', { lastWins: true, short: 'e', type: 'string' })`. A local option, a global option, an option a plugin declares, and an option a lifecycle hook declares take it alike, because they are one kind of option. A scalar string option takes it, with or without an [implied value](../core/options.md#implied-values), and so does a scalar [arity option](../core/options.md#option-value-arity) and the [background-marked](../core/background.md) option. The types reject the key beside `multiple: true`, because a multiple option collects every occurrence, and on a Boolean, counted, or content option. `lastWins: false` and an omitted key keep the once-only rule. There is no application-wide or per-Command switch: each option that wants the policy declares it.
- **The type.** The setting is one interface that the scalar members of the string option shapes take, and every other shape declares the key `never`:

  ```ts
  /**
   * The repeat policy of a string option that collects no list. A multiple option collects every
   * occurrence, and a Boolean, counted, or content option declares no policy, so each of them
   * declares `lastWins?: never`.
   */
  interface LastWins {
    /**
     * `true` lets a later occurrence on the command line replace an earlier one, so a wrapper
     * script or an alias that puts a default first yields to the operator's later value. Omitted or
     * `false`, a second occurrence is the repeated-option error.
     *
     * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/options.md#last-occurrence-wins
     */
    lastWins?: boolean;
  }

  type Multiplicity = ListBinding | ({ multiple?: false } & StringBinding & LastWins);

  type ListBinding =
    | { multiple: true; env?: never; envDelimiter?: never; envAllowEmpty?: never; lastWins?: never }
    | {
        multiple: true;
        env: string | readonly [string, ...string[]];
        /** The non-empty string that separates the items of the variable's value. */
        envDelimiter: string;
        envAllowEmpty?: never;
        /** Never declared: a multiple option collects every occurrence, so none replaces another. */
        lastWins?: never;
      };

  type ArityBinding =
    | { multiple: true; env?: never; envDelimiter?: never; envAllowEmpty?: never; lastWins?: never }
    | ({ multiple?: false; env?: never; envDelimiter?: never; envAllowEmpty?: never } & LastWins)
    | ({
        multiple?: false;
        env: string | readonly [string, ...string[]];
        /** The non-empty string that separates the words of the variable's value. */
        envDelimiter: string;
        envAllowEmpty?: never;
      } & LastWins);
  ```

  `BackgroundOption` intersects `LastWins` beside its other facts. `BooleanFacts`, `CountOption`, and the shared member object of `ContentOption` each declare `lastWins?: never`, as they declare `arity?: never`. `StringBinding`, `OptionValue`, and every declaration constraint are unchanged.
- **The last occurrence supplies the value.** An occurrence is counted across every accepted spelling of the option, its long spelling, its short alias, a letter of a short group, and each [alias](../core/options.md#option-aliases), as the once-only rule counts them, among the words before the first bare `--`, in word order. The last occurrence that supplies a value supplies the option, so `mailer --editor vim -e nano` and `mailer --editor=vim --editor nano` each read `nano`. A bare spelling that supplies an implied value is an occurrence like any other, so with `backup` implying `simple`, `--backup=numbered --backup` reads `simple` and `--backup -b=numbered` reads `numbered`. On an arity option the last occurrence's whole tuple replaces the earlier one, so `--resize 800 600 --resize 1024 768` reads `['1024', '768']`.
- **A replaced value is dropped unread.** Only the last occurrence's value reaches the option's validator in the invocation phase. A replaced value is never validated there, so a replaced value the validator would reject fails nothing. An [implied value](../core/options.md#implied-values) is the exception it already is: it is part of the declaration and validates in the default phase, before any token is parsed, whether or not an occurrence uses it, under [Validation](../core/validation.md#validation-context). It never reaches the [supplied record](../core/validation.md#validation-context), which holds the last value, and nothing names it at any verbosity: no warning, no `out.debug` line, no log event. A replaced value may be a secret, and the wrapper meant it to be replaced.
- **Each occurrence is still read.** Each occurrence takes its words as it does today, and every fault an occurrence finds other than the repeat is still raised and held, wherever the occurrence sits: a missing value, too few words for an arity option, and a value attached to an arity option. So `mailer --editor --to x --editor nano` is the missing-value error for the first `--editor`, and `--resize 800 --resize 1024 768` is the missing-value error that names the count. A faulted occurrence supplies nothing and replaces nothing, as a faulted occurrence does today. An option with any faulted occurrence is still absent from a middleware's [`ownOptions`](../core/middleware.md), as today's rule states for every option, so for a plugin's last-wins `--fmt`, `--fmt json --fmt` gives its middleware no `fmt` under `ownOptions`.
- **Routing.** `lastWins` changes neither the type the action reads nor the option's [value class](../glossary.md#inputs), so a parent's own option rebinds to the routed Command's option of the same spelling exactly as it does today, under [ADR-0055](0055-an-invocation-routes-on-global-options-then-parses-the-routed-commands-words-against-one-table.md) and [ADR-0152](0152-routing-reads-a-groups-own-options-as-it-reads-a-parents-own-options.md). The declaration an occurrence binds to decides whether a later occurrence replaces it or repeats it. A global last-wins option takes its last occurrence before the first bare `--` at any placement, whichever layer read each occurrence.
- **Sources.** `lastWins` decides among command-line occurrences alone. The precedence of [ADR-0032](0032-environment-and-configuration-map-into-options-through-one-core-input-source-stage.md), argv, then the environment, then the configuration source, then the default, is unchanged: argv supplies a last-wins option when any occurrence supplied it, and the winning occurrence beats every other tier as any command-line value does. With `env: 'MAILER_EDITOR'`, `MAILER_EDITOR=emacs mailer --editor vim --editor nano` reads `nano`.
- **Invocation by name and MCP.** `invoke()` and every MCP tool call supply one structured value per option, which lowers to one occurrence under [ADR-0059](0059-a-command-runs-by-name-through-invoke.md), so neither changes.
- **Spellings.** A middleware's `spellings` records, for its own plugin's last-wins option, the spelling of the occurrence that supplied the value, its last, as a multiple string option and a counted option record their last.
- **The background mark.** On the background-marked option, `lastWins: true` makes the parse take the last occurrence, so `--background=dark --background=light` runs with `light` and no longer fails the parse. The run's background choice then follows that same occurrence: it reads the last occurrence of a marked spelling that supplies a value, and answers only when that value is `dark` or `light`. So under an author's validator that also accepts `auto`, `--background=light --background=auto` reads `auto` under `options.background` and the run settles its background from the later steps, as if no choice were made, because a replaced value decides nothing. Without the setting the choice keeps today's rule, the last occurrence whose value is `dark` or `light`, which only a run whose parse already fails as a repeat can tell apart.
- **Inspection.** The string variant of `OptionNode` gains `lastWins`, after `arity`, and the content variant omits it, as it omits `arity`:

  ```ts
  /**
   * Whether a later occurrence on the command line replaces an earlier one instead of failing as
   * a repeat. `false` unless the declaration says `true`.
   */
  readonly lastWins: boolean;
  ```

  The content variant reads `Omit<StringOptionNode, 'type' | 'arity' | 'background' | 'envAllowEmpty' | 'lastWins'>`.
- **The manifest.** The manifest's string option entry copies `lastWins` after `arity`, as `readonly lastWins: boolean;`, and a content option entry carries none, as it carries no `arity`.
- **Completion.** A last-wins option is offered again after the earlier words supplied it, because another occurrence replaces its value. The rule lives in the package-internal module help and completion share, which help reads only for a counted option's `...`, so help's page does not change. `locate` reads every occurrence of a last-wins option as it reads the first, under the one grammar of [ADR-0042](0042-core-reads-a-partial-invocation-with-the-parsers-own-grammar.md), so after `--editor vim`, a last word `--editor=` is a `value` position and an earlier repeated occurrence is no structural fault.
- **Help, the man page, and MCP.** None of them prints or publishes the setting. Help prints no `repeatable` fact and no `...` for a last-wins option, the man page follows help, and MCP's tool schema takes one value as before.

The contract is in [Last occurrence wins](../core/options.md#last-occurrence-wins), [Commands and global options](../core/commands.md), [Input sources](../core/input-sources.md#precedence), [Validation](../core/validation.md#validation-context), [Middleware](../core/middleware.md), [Background](../core/background.md), [Graph inspection](../core/graph-inspection.md), [Manifest plugin](../plugins/manifest.md), [Completion plugin](../plugins/completion.md), and the [glossary](../glossary.md#inputs).

## Considered options

- **Last-wins for every scalar option, as argparse and pflag read one.** Rejected by the owner's ruling. The once-only rule stays the default, and the policy is per option.
- **An application-wide or per-Command switch.** Rejected by the owner's ruling. A setting on the option is the one place every projection already reads an option's facts.
- **The policy on a Boolean or counted option.** Rejected by the owner's ruling. A counted option already counts every occurrence, and a repeated Boolean option still fails as today.
- **A line that names a replaced value.** Rejected by the owner's ruling. Nothing is printed at any verbosity, so a replaced secret never reaches stderr or a log file.
- **One `repeat` setting, `'error'`, `'last'`, or `'collect'`, in place of `multiple`.** Not taken. It would rename `multiple`, which every multiple option declares today, for a policy one more key states.

## Consequences

A declaration that compiled before compiles and runs the same. The string option shapes gain an optional input member, and `ListBinding` gains an optional `never` member, neither of which breaks an author's code. `OptionNode`'s string variant and the manifest's string option entry gain `lastWins`, a new member of output types. The parser's repeat check reads the setting, and so does the rule completion shares with help. Core gains no declaration rule and no failure class.

[ADR-0040](0040-help-derives-compact-or-extended-from-the-spelling-the-operator-typed.md)'s clause that a repeated option other than a multiple string option is already a usage error, so it has one spelling, is narrowed: a last-wins option records the spelling of its last occurrence. ADR-0161's clause that a scalar arity option supplied twice is the `RepeatedOptionError` is narrowed: a scalar arity option that declares `lastWins: true` takes its last tuple. So is its clause that completion offers a scalar arity option once: such an option is offered again. ADR-0040 and ADR-0161 carry dated entries.

## Status

Accepted in 0.19.0.

## Changelog

- 2026-11-16: Proposed with the contract (LM-385). It supersedes nothing, and narrows ADR-0040's spelling clause and ADR-0161's repeat and completion clauses. ADR-0040 and ADR-0161 carry dated entries.
- 2026-11-16: Implementation (LM-385): the background choice on a last-wins marked option follows the winning occurrence, an implied value still validates in the default phase, and an option with any faulted occurrence stays absent from `ownOptions`, each settled from the contract review.
