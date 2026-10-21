---
description: "How an operator's -v and -q settle the run's verbosity right after graph build, and how the debug and trace lanes follow it."
---

# Verbosity

This page states the core rule for verbosity: how an operator's `-v` and `-q` settle the run's verbosity right after graph build, and how the debug and trace lanes follow it. The [verbose plugin](../plugins/verbose.md) documents the options that give the operator those spellings.

An operator asks a run for more detail with `-v` or `-vv`, and for less with `-q`, as cargo and clap-verbosity-flag read them. An action writes that detail through `out.debug` and `out.trace`, beside `info`, `warn`, and `error`. Core settles the run's verbosity once, right after graph build, and every lane write after that follows it. [ADR-0090](../decisions/0090-an-operators-v-or-q-settles-the-runs-verbosity-right-after-graph-build.md) records the decision.

```ts
interface Out<Result = unknown> {
  // ...the members under Output and failures...
  debug(message: string): Promise<void>; // written from verbosity 1
  trace(message: string): Promise<void>; // written from verbosity 2
}
interface Unmarked {
  interaction?: never;
  color?: never;
  verbose?: never; // so option() and a hook's option() reject the mark
  quiet?: never;
}
// BooleanOption declares verbose?: never and quiet?: never too, and StringOption and ContentOption
// reject both through Unmarked, so only a counted option carries the verbose or quiet mark.
type CountOption = OptionSpelling &
  Described &
  Listed &
  Controlled &
  OptionExtensions & {
    type: 'count';
    interaction?: never;
    color?: never;
    // ...validate, default, multiple, required, validateOmitted, polarity, and implied stay never...
  } & (
    | ({ verbose?: never; quiet?: never } & EnvBinding)
    | { verbose: true; quiet?: never; env?: never }
    | { quiet: true; verbose?: never; env?: never }
  );
type OptionNode =
  // ...the string, content, and Boolean variants under Graph inspection...
  | {
      readonly type: 'count';
      readonly verbose: boolean;
      readonly quiet: boolean;
      // ...the other fields under Graph inspection...
    };
declare const lanes: Readonly<
  Record<'print' | 'info' | 'success' | 'warn' | 'error' | 'debug' | 'trace', DeclaredView<string>>
>;
```

```ts
import { Application } from '@loomcli/core';

const app = new Application('fetchit')
  .globalOption('verbose', {
    type: 'count',
    short: 'v',
    verbose: true,
    control: true,
    description: 'Show more detail. Repeat it for more.',
  })
  .globalOption('quiet', {
    type: 'count',
    short: 'q',
    quiet: true,
    control: true,
    description: 'Hide info and success messages.',
  })
  .argument('url', { required: true })
  .action(async ({ args, out }) => {
    await out.debug(`GET ${args.url}`); // fetchit -v and fetchit -vv
    await out.trace('Reusing the open connection.'); // fetchit -vv
    await out.info('Fetched 3 records.'); // hidden under fetchit -q
    await out.warn('The cache is stale.'); // printed at every verbosity
  });
```

- **Two lanes.** `out.debug(message)` and `out.trace(message)` are semantic methods, as `info` is: they take a marked string, write to stderr in every case, a Command that declares a [result](results.md) included, append one newline, and render through their lane views, `lanes.debug` and `lanes.trace`. Their names are the log level names, and they are not logging: a call creates no [log event](logging.md) and reaches no `onLog` hook. `log.debug` records for a reader later, and `out.debug` writes for the operator now.
- **The verbosity.** The run's verbosity is its verbose count less its quiet count, where a verbose count above 2 reads 2 and a quiet count above 1 reads 1, so higher counts change nothing and one quiet step is the only one. The count of each is the occurrences of the option that carries its mark, and 0 when no option carries it.

  | Verbosity | Spellings | Lanes that write |
  | --- | --- | --- |
  | -1 | `-q`, `-qq` | `warn`, `error` |
  | 0 | none, `-v -q` | `info`, `success`, `warn`, `error` |
  | 1 | `-v`, `-vv -q`, `-vvvq` | `debug`, `info`, `success`, `warn`, `error` |
  | 2 | `-vv`, `-vvv` | `trace`, `debug`, `info`, `success`, `warn`, `error` |

  `print`, `render`, `draw`, `results`, the failure report, and the [incomplete-result](results.md#a-sequence-that-stops-early) line write at every verbosity, so `-q` hides `info` and `success` alone, and help, a result, a warning, and a failure always print. Of the writes to stderr, only a [live region](output.md#live-region) opened without `input: true` also follows the verbosity: at -1 core draws none.
- **A hidden call.** A call the verbosity hides checks its message, as every semantic method does, so a message that is not a string is still rejected. Then it calls no lane view, writes nothing, and its promise resolves.
- **Settled after graph build.** Right after graph build, its `onGraphBuilt` hooks included, and before [environment preparation](plugin-contract.md#environment-preparation), core settles the run's verbosity from `host.argv`, read against the built graph with the parser's own word reader, in the partial mode [`locate`](graph-inspection.md#locating-a-word) reads an unfinished invocation with. Every form reads as the ordinary parse reads it: `-v -v`, `-vv`, `--verbose -v`, `-vq`, a short group that holds a Command's own letters, such as `-vF name`, an [alias](options.md#option-aliases), and occurrences on both sides of the Command name, up to the first bare `--`. An occurrence the parse faults, such as `--verbose=2`, counts nothing. A word list that names an unknown command settles verbosity 0. That run fails in routing, and everything it writes, an `onEnvironment` warning and its failure, prints at every verbosity.
- **Why after graph build.** An `onCommandAttach` hook can declare a local option with a short spelling on any Command, so only the built graph says what each letter of a short group is. Core builds `out` at the head of the run, and nothing can write a lane before the verbosity settles: graph build's hooks receive no `out`, and the only output before it is a host-capture failure or a declaration error from graph build, which is a failure report and prints at every verbosity.
- **No mark.** An Application whose options carry neither mark settles verbosity 0, so `out.debug` and `out.trace` write nothing, and every other byte is unchanged.
- **The marks.** `verbose: true` on a counted global option, the application's or a plugin's, marks the option whose occurrences raise the verbosity, and `quiet: true` on another marks the one whose occurrence lowers it. An Application holds at most one option with each mark, and an option carries at most one of them. An author may mark a verbose option alone, and the run then has no quiet step. A marked option takes a short alias, aliases, and `shortOnly` as any counted option does. `inspect()` publishes `verbose` and `quiet` on each counted option node, `true` on the marked one, and the manifest copies both. The [verbose plugin](../plugins/verbose.md) declares marked `-v, --verbose` and `-q, --quiet`.
- **One source.** A marked option binds no environment variable and no configuration key, because the verbosity settles before environment preparation and before the [input-source stage](input-sources.md). A binding is a second source for one value that would arrive after the verbosity settled: the types reject `env` beside either mark, and a configuration binding is a declaration error.
- **The options still parse.** A marked option is an ordinary counted global option to routing, parsing, validation, and [activation](plugin-contract.md#activation), so `options.verbose` reads the count the operator typed: `3` for `-vvv`, never capped, as [ADR-0057](../decisions/0057-a-counted-option-counts-its-occurrences-and-an-implied-value-fills-a-bare-spelling.md) states, while the verbosity reads 2.
- **Every writer.** A middleware's `out` and a [configuration source](input-sources.md)'s `out` follow the run's verbosity as the action's does, so a configuration source names the file it read through `out.debug`. An [`onEnvironment`](plugin-contract.md#environment-preparation) hook's `out` keeps `warn` alone.
- **Invocations by name.** `app.invoke` and an action's `invoke` each settle their own verbosity from the values they lower: `options: { verbose: 2 }` lowers to two occurrences, read as `-vv` is, and a value the call cannot lower counts nothing. A call inherits nothing from its parent run. Both marked options of the [verbose plugin](../plugins/verbose.md) are [control options](commands.md#control-options), so an [MCP](../plugins/mcp.md) tool lists neither and a tool call that names one is rejected, and under the plugin every MCP tool call runs at verbosity 0.
- **The lines.** `lanes.debug` and `lanes.trace` are the two lane views core adds, `@loomcli/core/lanes/debug` and `@loomcli/core/lanes/trace`, and an application replaces either through `views`, as it replaces any [lane view](views.md). Their defaults follow [Width, padding, and multiline lanes](styles.md#width-padding-and-multiline-lanes). A debug line opens with `glyph.pointerSmall` and one space, and its glyph and message are `dim`. A trace line nests one step deeper: two spaces, then `glyph.lineVerticalDashed0` and one space, and its glyph and message are `dim.faint`, the `dim` token with the `faint` modifier, so a trace line fades past a debug line. Under `NO_COLOR` on a terminal the `dim` color drops and `faint` stays, and piped both lines are plain and the gutters tell them apart. At `-vv` on a terminal, the example prints this on stderr:

  ```text
  › GET https://example.com/records
    ┆ Reusing the open connection.
  ℹ Fetched 3 records.
  ⚠ The cache is stale.
  ```

- **One mark of each kind.** An Application declares one verbose-marked option and one quiet-marked option. The fault throws from the call that brings the second mark of a kind into the Application, as a [spelling collision](options.md#declaration-and-invocation-errors) does, and names each option as [Input declaration errors](options.md#input-declaration-errors) names it: [`@loomcli/core/verbose-mark`](diagnostics.md#loomclicoreverbose-mark) and [`@loomcli/core/quiet-mark`](diagnostics.md#loomclicorequiet-mark).
- **No configuration binding.** A marked option carries no configuration binding, a second source for the run's verbosity, because the run settles its verbosity before configuration. The fault throws at the moment the color mark's configuration binding throws: from `globalOption()` for an application's option and from the constructor for a plugin's option: [`@loomcli/core/verbose-mark`](diagnostics.md#loomclicoreverbose-mark) and [`@loomcli/core/quiet-mark`](diagnostics.md#loomclicorequiet-mark).

The types reject `verbose` and `quiet` on `option()`, on a hook's `option()`, and on every option type but `count`, both marks on one option, and `env` beside either. A configuration binding is an ordinary extension value to the types, so that rule reaches the runtime check alone.

## When author code fails

A lane view that throws, whether the author replaced it or not, fails its `out.debug` or `out.trace` call as it fails any `out` call, and the error takes the [ordinary failure path](failures.md#the-ordinary-failure-path). An author's catch is final under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). A call the verbosity hides calls no lane view, so a view that would throw raises nothing there.
