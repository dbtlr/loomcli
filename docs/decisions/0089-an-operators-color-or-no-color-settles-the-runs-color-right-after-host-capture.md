---
type: adr
title: ADR-0089 - An operator's --color or --no-color settles the run's color right after host capture
description: Core gains the color mark, color true on one Boolean global option, and reads the operator's color choice from argv right after host capture and before graph build, the last spelling of the marked option before the first bare --. A positive spelling sets the run's color policy field to always and a negative one to never, over NO_COLOR, FORCE_COLOR, and the declared rendering policy, while modifiers, hyperlinks, and terminal controls keep their own policy. The marked option binds no variable and no configuration key, takes no short alias, and still parses as an ordinary option. The plugin pack adds @loomcli/plugins/color, which declares a marked --[no-]color.
status: accepted
created: 2026-10-19
modified: 2026-10-20
---

# ADR-0089 - An operator's --color or --no-color settles the run's color right after host capture

## Context

[ADR-0022](0022-renderers-return-marked-strings-that-core-resolves-and-a-theme-is-a-palette.md) gives a run one rendering policy, merged from the Application's `rendering` and `run({ rendering })`, and with `color: 'auto'` it reads `FORCE_COLOR`, then `NO_COLOR`, then the terminal. The author sets the policy. The operator can only set an environment variable, which applies to every program the shell runs.

[NO_COLOR](https://no-color.org/) asks a command-line application for one more thing: a per-run argument, such as `--color` or `--no-color`, overrides `NO_COLOR`. Its FAQ also says `NO_COLOR` concerns color alone, not bold, underline, or italic.

Loom has no seam for that argument. The policy is fixed when the run starts, before anything is parsed. An author who declares a `--no-color` option reads its value in the action, after graph build, environment preparation, the input-source stage, and validation have each had a chance to print. A dotenv warning, a configuration source's warning, an unknown command, and a declaration error from graph build all print before any action runs, and they ignore the operator.

## Decision

- **The color mark.** `color: true` on one Boolean global option, the application's or a plugin's, marks it, modeled on the interaction mark of [ADR-0082](0082-an-action-asks-through-the-prompts-library-and-one-interaction-decision-governs-questions-and-conditional-requiredness.md). At most one option of an Application carries it.
- **The color choice.** Right after host capture and its overrides, and before graph build, core reads the run's color choice from `host.argv` alone: the last word before the first bare `--` that equals one of the marked option's spellings, its long spelling and its aliases' long spellings in the forms its polarity generates. A positive spelling sets the run's `color` policy field to `'always'`, and a negative one sets it to `'never'`. With no such word, the declared and merged policy applies exactly as before.
- **Exact without a parser.** The read needs no parse because of [ADR-0055](0055-an-invocation-routes-on-global-options-then-parses-the-routed-commands-words-against-one-table.md)'s grammar: an option word is never a separate value, so a value that is an option word is attached in one word, and a global option's spelling cannot be a local option's. A lifecycle hook declares no global option, so the spellings are known before graph build. A word that attaches a value, such as `--color=x`, equals no spelling and supplies nothing, and the ordinary parse reports it where it always does. A short group can hold letters of the routed Command's own options, which only the parse can read, so the marked option takes no short alias.
- **The last word wins.** `--color --no-color` sets `'never'`. The parse still reports the pair as the repetition failure every Boolean option meets, and that failure prints with color off.
- **Precedence.** The choice beats `NO_COLOR`, `FORCE_COLOR`, and `rendering.color` on the Application and on `run()`. It sets the `color` field alone, so `modifiers`, `hyperlinks`, and `terminalControls` keep their own policy, as `rendering: { color: 'always' }` already leaves them.
- **Every byte after capture.** Everything the run prints after host capture follows the resolved color. Only a failure of host capture itself can print before the choice is read. In an Application that declares a marked option, such a failure prints with the `color` field `'never'`, because the operator's choice could not be read and off is the safe reading. An Application with no marked option behaves exactly as before in every case.
- **One source.** The marked option binds no environment variable and no configuration key. Each binding is a declaration error under `@loomcli/core/color-mark`, a second source for one value: the environment already speaks for color through `NO_COLOR` and `FORCE_COLOR`, and configuration is read after parsing, too late for the output before it. An `env` binding throws from the declaring call. A configuration binding is a value of the installed source's descriptor, which only the Application constructor knows, so it throws from `globalOption()` for an application's option and from the constructor for a plugin's.
- **The option still parses.** The marked option routes, parses, validates, and activates as an ordinary Boolean global option, so the action reads in `options` the value the choice used, or its polarity's absent value when the operator typed neither spelling.
- **Invocations by name.** `app.invoke`, an action's `invoke`, and an MCP tool call keep capturing plain text, and their `host.argv` is empty, so the choice never applies to them.
- **Projections.** `inspect()` publishes `color` on each Boolean option node, `true` on the marked one, and the manifest copies it.
- **The color plugin.** `@loomcli/plugins/color` exports `color()`, which takes no settings and declares the global Boolean option `color` with `polarity: 'both'`, `control: true`, the mark, and the description `Turn color on or off, overriding NO_COLOR.` It adds no middleware, Command, view, or hook, and claims no slot. An application that wants another spelling marks its own option.

The contract and its acceptance are in [Color](../core/color.md) and [Color plugin](../plugins/color.md).

## Considered options

- **Settling color after the input-source stage, where the interaction decision is computed.** Rejected. Environment preparation warnings, configuration warnings, an unknown command, and graph build's declaration errors all print before that point, and they would ignore the operator.
- **Holding early output in a buffer and resolving unknown-command runs through the input-source stage.** Rejected. It adds a buffer and a second path through the run for output that a read of argv already settles.
- **A string option `--color[=WHEN]` with `always`, `never`, and `auto`, as GNU tools have.** Not chosen. The standard's pair is the Boolean, and `auto` is what a run with neither spelling already does.
- **An application environment variable or configuration key for color.** Rejected. Color follows a standard, so only `NO_COLOR` and `FORCE_COLOR` speak for the environment, and configuration is read after parsing, so it could not govern the output before it.
- **`--no-color` turning modifiers and hyperlinks off too.** Rejected. NO_COLOR's FAQ states that it concerns color alone and not bold, underline, or italic, and the operator's per-run choice follows the same rule.
- **Reading a short alias in the choice.** Rejected. A short group's letters can belong to the routed Command's own options, so a read without the parse could disagree with it.
- **Each occurrence that the parse rejects supplying nothing, a repetition included.** Rejected. `--color --no-color` would read the first spelling and print in color, although the operator's last word asked for none.

## Consequences

Option configuration accepts `color`, `OptionNode`'s Boolean variant and the manifest's Boolean option entry gain `color`, and core gains the rule `@loomcli/core/color-mark`. An Application with no marked option sees no change in any byte. One with a marked option reads argv once more per run, for its spellings alone.

The marked option's value in `options` says what the operator typed, never whether color is on: with neither spelling it reads its absent value while the policy may turn color on. A repetition such as `--color --no-color` sets the choice from the last word, while the parse keeps its own reading of the pair and the run fails before the action.

This narrows ADR-0022's precedence, where explicit policy and then the variables decided the `color` field: the operator's choice now comes first for that field alone. It narrows [ADR-0009](0009-core-captures-the-host-and-resolves-an-exit-code.md)'s host capture with a read of `host.argv` that follows it and comes before graph build, and narrows [ADR-0084](0084-dotenv-prepares-an-allowlisted-environment-before-inputs.md)'s statement that an imported `NO_COLOR` or `FORCE_COLOR` affects subsequent output, which no longer turns color on or off once the operator chose. It narrows [ADR-0032](0032-environment-and-configuration-map-into-options-through-one-core-input-source-stage.md)'s rule that any global option may bind a variable or a configuration key, for the marked option alone. ADR-0055's grammar and parse are unchanged, and no clause of ADR-0082 changes. ADR-0009, ADR-0022, ADR-0032, and ADR-0084 carry dated entries.

The glossary gains Color choice and Color mark.

## Status

Accepted in 0.14.0.

## Changelog

- 2026-10-19: Proposed with the color mark, color choice, and color plugin contract.
- 2026-10-19: [ADR-0090](0090-an-operators-v-or-q-settles-the-runs-verbosity-right-after-graph-build.md), proposed, reads a second run-wide setting from argv at another point: the run's verbosity settles right after graph build, with the parser's own word reader, because the common standard's `-v`, `-vv`, and `-vq` need short groups and an `onCommandAttach` hook can declare a local short option that only the built graph knows. The color choice keeps its read right after host capture and its ban on a short alias, because color governs the bytes graph build itself prints, while no lane writes before graph build ends. No clause of this record changes.
