---
description: The operator's color choice and how core settles it for a run.
---

# Color

An operator turns color on or off for one run with `--color` or `--no-color`. [NO_COLOR](https://no-color.org/) asks a command-line application for exactly this: an argument given for one run overrides `NO_COLOR`. Core reads the operator's color choice from argv right after host capture, before anything else prints, so every byte the run writes follows it. [ADR-0089](../decisions/0089-an-operators-color-or-no-color-settles-the-runs-color-right-after-host-capture.md) records the decision.

```ts
import { Application } from '@loomcli/core';

const app = new Application('notes')
  .globalOption('color', {
    type: 'boolean',
    polarity: 'both',
    aliases: ['colour'],
    color: true,
    control: true,
    description: 'Turn color on or off, overriding NO_COLOR.',
  })
  .action(({ options, out }) => {
    // With stderr redirected, as in notes --colour 2> notes.log, the success glyph still prints in color, and options.color reads true.
    // With neither spelling, the rendering policy decides, and options.color reads false.
    out.success('Saved.');
  });
```

- **The color choice.** Right after host capture and its overrides, and before graph build, core reads the run's color choice from `host.argv` alone. The choice is the last word before the first bare `--` that equals a spelling of the marked option. The spellings are the option's long spelling and its aliases' long spellings, in the forms its polarity generates, so the option above reads `--color`, `--no-color`, `--colour`, and `--no-colour`. A positive spelling sets the run's `color` policy field to `'always'`, and a negative spelling sets it to `'never'`. When no word matches, the run has no choice, and the `color` field follows the declared and merged policy under [Rendering policies](styles.md#rendering-policies) exactly as it does without a mark. An Application with no marked option reads no choice.
- **Exact without parsing.** Under the grammar of [String values and token consumption](options.md#string-values-and-token-consumption), an option word is never a separate value, so a value that is an option word is attached in one word, as `--pattern=--color` is, and a global option's spelling cannot be a local option's. So a word that equals a marked spelling is that option wherever it sits, under every routed Command. A lifecycle hook declares no global option, so every spelling is known before graph build. A word that attaches a value, such as `--color=x`, equals no spelling and supplies nothing. The ordinary parse still reports it later at its usual place, as `Boolean option "--color" does not accept a value. Supply the flag alone.`, and the run's color follows the declared policy.
- **The last word wins.** `--color --no-color` sets `'never'`. The ordinary parse still reads the pair as the repetition every option that is neither multiple nor counted meets, so the run fails with `Option "--no-color" can be supplied only once. Remove the repeated option.` and exit 2, and that line prints with no color.
- **What it overrides.** The choice beats `NO_COLOR`, `FORCE_COLOR`, and `rendering.color` from the Application and from `run()`. It sets the `color` field alone. `modifiers`, `hyperlinks`, and `terminalControls` keep their own policy, because `NO_COLOR` speaks for color alone. So `--no-color` on a terminal keeps bold, and `notes --color | less -R` prints colors and, under automatic modifiers, no bold, as `rendering: { color: 'always' }` does. Depth still follows the depth hints under [Rendering policies](styles.md#rendering-policies), which core reads from the run's environment on each emission, so forced color with no depth hint prints sixteen colors.
- **Every byte after capture.** Every byte the run writes after host capture follows the resolved color: a declaration error that graph build raises, an [`onEnvironment`](plugin-contract.md#environment-preparation) warning such as [dotenv](../plugins/dotenv.md)'s, a configuration source's warning, an unknown command, help, a result, and a failure. Only a failure of host capture itself can print before core reads the choice: an [unreadable working directory](host.md#an-unreadable-working-directory), malformed baked [release facts](release-facts.md), and any other failure of the first step of [Invocation](invocation.md). In an Application that declares a marked option, such a failure prints with the `color` field `'never'`, because the operator's choice could not be read. Its modifiers and hyperlinks keep their policy. An Application with no marked option prints it as before. Core's fallback output carries no theme, so today no byte differs.
- **The option still parses.** The marked option is an ordinary Boolean global option to routing, parsing, validation, and [activation](plugin-contract.md#activation), so its value reaches every action and middleware as `options.color`. Whenever the run reaches the action, that value matches the choice: `true` after a positive spelling, `false` after a negative one, and its polarity's absent value when the operator typed neither, because the option has no binding. It says what the operator typed, never whether color is on.
- **One source.** The marked option binds no environment variable and no configuration key. Color follows a standard, so the environment speaks for it only through `NO_COLOR` and `FORCE_COLOR`, and the configuration source answers after parsing, too late for the output before it. A binding is a second source for one value: the types reject `env` beside the mark, and a configuration binding is the declaration error below.
- **Invocations by name.** `app.invoke`, an action's `invoke`, and so every [MCP](../plugins/mcp.md) tool call read no choice. Their `host.argv` is `[]`, and their captured text stays plain under [Invocation by name](invocation.md#invocation-by-name), whatever the policy says.
- **The mark.** `color: true` on a Boolean global option, the application's or a plugin's, marks it. At most one option of an Application carries the mark. `inspect()` publishes `color` on each Boolean option node, `true` on the marked one, and the manifest copies it. The [color plugin](../plugins/color.md) declares a marked `--[no-]color`.

| Rejected declaration | Diagnostic | Rule |
| --- | --- | --- |
| Two marked options in one Application | `Global option "paint" and plugin "@loomcli/plugins/color" option "color" both declare color. Mark one option.` Each option is named as [Input declaration errors](options.md#input-declaration-errors) names it, and the fault throws from the call that brings the second mark into the Application, as a [spelling collision](options.md#declaration-and-invocation-errors) does. | `@loomcli/core/color-mark` |
| A configuration binding on the marked option | `Option "color" declares color and carries configuration binding "@loomcli/plugins/config/input", a second source for the run's color. Remove the binding; the run reads its color before configuration.` The binding names the installed source's descriptor. Only the Application knows which source is installed, and its constructor holds every plugin, so the fault throws from `globalOption()` for an application's option and from the constructor for a plugin's option. A value of a descriptor whose plugin the Application does not install is inert under [Input sources](input-sources.md), and no fault. | `@loomcli/core/color-mark` |

The types reject `color` on `option()` and on every option type but `boolean`, and `env` and `short` beside `color: true`. A configuration binding is an ordinary extension value to the types, because only the installed source makes it a binding, so that rule reaches the runtime check alone.

### Color acceptance

The color choice is proven when public APIs alone produce these results under Node and Bun, through a fixture Application that marks its own option and through jsonkit with the [color plugin](../plugins/color.md), with a host that reports a capable terminal where a case says so. Each case prints through text that carries both a color and `bold`: a fixture lane message styled with both, or the fixture's failure view override that styles its line with both. A build declaration error is read from a development build, whose Developer Diagnostic resolves through core's default styles. Through jsonkit, the cases read its help page:

- **The pair.** On a capable terminal, `--no-color` prints no color escape and keeps bold, also with `FORCE_COLOR=1`. Piped, `--color` prints color escapes and no bold. `--color --no-color` prints its repetition failure with no color escape, and `--no-color --color` prints it in color. A spelling after the bare `--` changes nothing, and an alias spelling, such as `--no-colour`, works as the long spelling does.
- **The variables.** With `NO_COLOR=1`, `--color` prints color, and with `FORCE_COLOR=1`, `--no-color` prints none. With neither spelling, every byte is unchanged under each combination of the two variables, on a terminal and piped.
- **The declared policy.** `--no-color` beats `rendering: { color: 'always' }` on the Application and on `run()`, and `--color` beats `'never'` on each.
- **Before the chain.** An unknown command, a dotenv warning, a configuration source's warning, and a declaration error an `onGraphBuilt` hook raises each print with no color escape under `--no-color` on a capable terminal, and in color under `--color` piped.
- **Host capture.** On a capable terminal, a build that bakes malformed release facts prints its Developer Diagnostic with no color escape in an Application that marks an option, even under `--color` and `FORCE_COLOR=1`, and one that marks none prints it as today. An unreadable working directory's line holds no style and is unchanged byte for byte.
- **A faulting word.** `--color=x` fails with the usage failure above, exit 2, and the line follows the declared policy: in color on a capable terminal, with no color escape piped, and with none under `NO_COLOR=1`.
- **The option.** `options.color` reads `true`, `false`, and the absent value for a positive spelling, a negative spelling, and neither.
- **Declarations.** Each row above throws its sentence under `@loomcli/core/color-mark` from the moment the row names, and the negative type checks reject the rules the types state.
- **By name.** `jsonkit.invoke` with the plugin installed captures plain text under `FORCE_COLOR=1` with `color` supplied as `true`, and a fixture Application's invocation by name captures plain text under `FORCE_COLOR=1` and `rendering: { color: 'always' }`.
