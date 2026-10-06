---
type: adr
title: ADR-0055 - An invocation routes on global options, then parses the routed Command's words against one table
description: A plugin's options are global options with no difference from the application's, validated with them and typed in every action. An invocation parses in three layers - routing reads the global options and the own options of each Command with an action and children, the routed Command's words are read against one table of its local options and every global option, and each owner reads its values - with short groups under the getopt rule and every fault held except an unknown command. This supersedes the pre-scan, the first-hyphen commit, the mixed-scope fault, and the rejected per-Command table that ADR-0026 carries from ADR-0003, and ADR-0017's plugin option class.
status: accepted
created: 2026-10-03
modified: 2026-10-06
---

# ADR-0055 - An invocation routes on global options, then parses the routed Command's words against one table

## Context

Help lists `-h` and `-t` in one OPTIONS block, yet `textstat -ht` exits 2, and an application with a global `-q` fails `get -qp` the same way when `-p` is local to `get`. The cause is that Loom grew three kinds of option, and each answers every question differently:

- **Global options**, which [ADR-0003](0003-globals-are-application-owned-and-nothing-inherits.md) consumes in a pre-scan before routing. [ADR-0026](0026-applications-declare-global-options-through-a-fluent-method.md) carries those rules by reference today.
- **Plugin options**, which [ADR-0017](0017-plugins-participate-through-one-middleware-chain-with-declared-activation.md) put in the same pre-scan table as a second class: structural only, with no validator, and reaching their own plugin's middleware alone.
- **Hook-declared local options**, which [ADR-0028](0028-plugins-run-code-at-lifecycle-hooks-and-middleware-reads-the-request.md) lets a plugin attach to one Command.

The pre-scan reads one table of application globals and plugin options. In `textstat -ht` it owns `-h`, cannot classify `-t`, and rejects the group as mixed-scope. Every new option feature, such as long aliases, counted options, or input sources, would have to be designed three times.

A single left-to-right pass that tokenizes everything for owners to drain fails on arity: whether the word after `-o` is its value or a Command name depends on `-o`'s declaration. Research into clap, picocli, commander, yargs, oclif, Cobra with pflag, Click, and argparse showed what Loom was missing. clap and picocli copy the global options into every subcommand's option table when the tree is built, so after routing one table reads everything and a mixed group works. ADR-0003 rejected that copy so that each global keeps one definition and a diagnostic can name its owner. A table entry that references the one declaration keeps both properties. No mature parser deliberately accepts a Command's own option before its name; Cobra and yargs accept it only through a heuristic that lets an unknown Boolean swallow the subcommand name.

What makes routing unambiguous in Loom is two rules it already has: a group declares no options, and under [ADR-0004](0004-arguments-and-children-are-exclusive.md) a Command with children takes no arguments. A Command with an action and children may declare its own options, but a plain word after one of them can only be that option's value or the name of a child, and the Command's own declaration says which. So every option before the routed Command's name is a global option or an own option of a Command routing passed through, and its declaration is known.

[ADR-0017](0017-plugins-participate-through-one-middleware-chain-with-declared-activation.md) refused validators on plugin options because validation would have run before the chain. ADR-0028 already moved validation ahead of the chain, so that reason is gone.

## Decision

- **One kind of global option.** `Application.globalOption(name, config)` and a plugin's `options` record take one configuration: everything `option()` takes except the presence rules, under [ADR-0044](0044-a-global-option-declares-no-presence-rule.md). A plugin's option may carry a validator, an environment binding, and extensions. Who declared a global option, the application or a plugin, changes nothing about how it parses, validates, or reaches its readers.
- **Where an option is accepted decides what it declares.** A global option is accepted on every Command and declares no presence rule. A local option is accepted on one Command and may declare one. A hook-declared option stays an ordinary local option of its Command.
- **Global values reach every reader.** Every global option's validated value reaches every action, typed through registration and the plugin tuple, and every middleware's `options`. Activation still lists the plugin's own option names, and `spellings` still covers the plugin's own options alone, under [ADR-0040](0040-help-derives-compact-or-extended-from-the-spelling-the-operator-typed.md). `OptionNode.scope` is removed, because nothing distinguishes two kinds of global option.
- **One table per Command.** At graph build, after the `onCommandAttach` hooks have run, each Command gets one spelling table. It covers the Command's local options, hook-declared ones included, and every global option, so a group's table holds the global options alone. Each entry references its one declaration, so a diagnostic still names the declaring Command or plugin. The collision rules stand: a global and a local option share no key and no spelling, and two Commands may reuse one spelling with different value classes.
- **Three layers.**
  1. *Route.* Words before the first bare `--` are read from the root. A plain word that names a child or an alias descends, and one that names no child is the unknown-command error, the one fault raised before the chain. A plain word under a Command with no children ends routing as that Command's first argument. An option word is read against the global options and, at a Command with an action and children, that Command's own options, so a declaration routing knows says whether the next word is its value, and routing then continues. An option word those options do not declare stops routing at the Command reached. A Command's own option read this way binds to the Command routing finally reaches: one that Command does not declare is an unknown option, and one it declares with another value class is misplaced and names it, because the word the parent's declaration read is never read again under another.
  2. *Parse the routed Command's words* against its table, up to the first bare `--`.
  3. *Owners read their values.* Global values go to every action and every middleware, and local values to the routed Command's action and the request.
- **Option words.** An option word is `--` followed by at least one character, or `-` followed by an ASCII letter. Every other word is a plain word: `-`, `-5`, `-.5`, and `-1e3` are values or arguments, with no `--` escape. A separate word is an option's value unless it is an option word or the bare `--`.
- **Short groups follow `getopt`.** A Boolean letter is set and the walk continues to the next character, which must be a declared letter. A value letter ends the group: the rest of the word is its value, with one leading `=` stripped, or the next word is its value when nothing remains. `-n5`, `-n=5`, `-nwords`, and `-vn5` are accepted, and `-n=` is an empty string. The walk stops at the first letter that faults, so the characters after it are never read as letters.
- **A misplaced option names its Command.** When an option word is one the routed Command's table does not hold, and a visible Command below it declares the spelling, the fault is the new `MisplacedOptionError`, which names those Commands. The word that stopped routing is the usual case. `ShortGroupError` is removed, because the `getopt` rule and the end of the pre-scan leave it no reason.
- **Every fault but an unknown command is held.** A fault is held whenever core knows which Command was reached, so help can take over `textstat -ht`, the misplaced `jsonkit -F name select`, and a structural fault on a global option. Parsing continues past the first fault to collect the global options, the first fault in word order is the one held, and an occurrence that faulted supplies nothing. The global options are filled by the input sources and validated whatever was held. A middleware's `options` is `null` when a global option has a structural fault or a validation problem, whichever fault is held, and `request` is `null` while core holds any fault.
- **One grammar for the parser and completion.** `locate` reads through the same three layers, under [ADR-0042](0042-core-reads-a-partial-invocation-with-the-parsers-own-grammar.md).

## Considered options

- **Commit routing at the first hyphen word.** Rejected. It keeps the pre-scan, and with it the mixed-scope fault that opened this record.
- **One value class per spelling across the whole application.** Rejected. It makes the token stream self-delimiting, but it forbids what every mature parser allows: sibling Commands using one spelling with different classes, as `git commit -n` and `git log -n 5` do.
- **One pass that tokenizes everything into a queue the owners drain.** Rejected. A pass blind to declarations cannot know an option's arity.
- **Accept an option that only a Command below declares before that Command's name.** Rejected. No mature parser supports it deliberately, and the parsers that accept it do so by guessing which words are values. An own option of the Command routing has reached is not this case: its own declaration gives the option's arity, so routing guesses nothing when it carries on to the child.
- **Stop routing at a parent's own option.** Rejected. The words after it would be the parent's arguments, which a Command with children never takes, so `jsonkit --format json paths` could only fail.
- **A plugin's option reaches its own plugin alone.** Rejected. It keeps two kinds of global option with different readers, which is the drift this record ends.
- **Keep `ShortGroupError` as a base for future group faults.** Rejected. A class nothing throws is a dead name to match, adding a class later is not breaking, and removing one is.
- **`options` is `null` under any held fault, as `request` is.** Rejected. A wrapping plugin would lose its own settings on every failing run, which is the run it most needs them on.
- **A negative-number grammar for hyphen words that are not options.** Rejected. Defining an option word by what a declaration can claim needs no number grammar, and covers `-.5` and `-1e3` alike.
- **Reuse `UnknownOptionError` for a misplaced option.** Rejected. The option is not unknown, and the suggestions plugin would answer it with near spellings instead of the Command that declares it.

## Consequences

This record supersedes, as [ADR-0026](0026-applications-declare-global-options-through-a-fluent-method.md) carries them from ADR-0003 through ADR-0024, the global pre-scan before routing, the commit of routing at the first hyphen token, the mixed-scope short group fault, and the rejection of copying the globals into every Command's spelling table. One Application-owned declaration of each global option, no inheritance between Commands, no local option on a group, values winning over route names, and the global and local collision rules stand. It supersedes ADR-0017's plugin option class: its structural-only configuration, its refusal of a validator, and its reach limited to the plugin's own middleware.

It is breaking for plugin authors and for code that matches failures: a plugin's option configuration widens to the global option configuration, `PluginStringOption` and its forbidden-key rule go, `OptionNode.scope` is removed, `MiddlewareContext.options` holds every global option and can be `null`, and `ShortGroupError` is removed. A newly accepted form, such as `textstat -ht`, `get -qp` with a global `-q`, `-n5`, `--depth -5`, or `jsonkit --format json paths`, where a parent's own option reaches the child that declares it, is not breaking. `-mt`, where `m` takes a value, now means that `m` is `t` instead of failing; the option's validator catches most such typos.

Faults move between raised and held, and their order changes on purpose: a structural fault on a global option is held and help takes it over, the option word that stopped routing ranks ahead of a group's missing subcommand, and a failure view's `path` is the path routing reached for every held fault. A global option's validator now runs on an invocation that holds a local structural fault, the cost ADR-0028 already accepted for a validator ahead of a takeover.

[ADR-0004](0004-arguments-and-children-are-exclusive.md), [ADR-0013](0013-core-installs-no-plugins-and-composes-first-in-wins.md), [ADR-0017](0017-plugins-participate-through-one-middleware-chain-with-declared-activation.md), [ADR-0026](0026-applications-declare-global-options-through-a-fluent-method.md), [ADR-0028](0028-plugins-run-code-at-lifecycle-hooks-and-middleware-reads-the-request.md), [ADR-0032](0032-environment-and-configuration-map-into-options-through-one-core-input-source-stage.md), [ADR-0040](0040-help-derives-compact-or-extended-from-the-spelling-the-operator-typed.md), [ADR-0042](0042-core-reads-a-partial-invocation-with-the-parsers-own-grammar.md), and [ADR-0044](0044-a-global-option-declares-no-presence-rule.md) carry dated entries.

## Status

Accepted in 0.8.0.

## Changelog

- 2026-10-03: Proposed with the contract.
- 2026-10-06: [ADR-0064](0064-a-failure-class-declares-a-failure-code-and-a-plugin-encodes-the-failure-form-by-media-type.md), proposed, widens the validation pass for one reader. Under a held structural fault the routed Command's own declarations still go unvalidated, except each local option a plugin's hook declared whose tokens parsed, which core validates for that plugin's middleware's `ownOptions` alone. The structural fault stays the held fault, whatever that validator answers, and this record's precedence is unchanged. So the formatter keeps `--format json` under `textstat --format json --bogus one.txt`, and the failure writes as JSON. It binds when ADR-0064 is accepted.
