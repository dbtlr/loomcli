---
description: "How an operator's -v and -q settle the run's verbosity right after graph build, which messages it shows, and which log events it shows as log lines."
---

# Verbosity

This page states the core rule for verbosity: how an operator's `-v` and `-q` settle the run's verbosity right after graph build, which messages it shows, and which log events it shows as log lines. The [verbose plugin](../plugins/verbose.md) documents the options that give the operator those spellings.

An operator asks a run for more detail with `-v` or `-vv`, and for less with `-q`, as cargo and clap-verbosity-flag read them. `out` tells the operator, and `log` records: `-q` hides `out.info` and `out.success`, and `-v` lets the operator read the log, as uv does, with core showing each [log event](logging.md) at `debug` and above as a log line on stderr, and `-vv` adding `trace`. Core settles the run's verbosity once, right after graph build, and every write and log line after that follows it. [ADR-0090](../decisions/0090-an-operators-v-or-q-settles-the-runs-verbosity-right-after-graph-build.md) records the verbosity, and [ADR-0174](../decisions/0174-v-shows-the-log-through-message-templates-and-out-keeps-what-the-operator-is-told.md) the log lines.

```ts
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
declare const lanes: Readonly<Record<'print' | 'info' | 'success' | 'warn' | 'error', DeclaredView<string>>>;
declare const logLine: DeclaredView<LogLine>; // under Logging
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
  .action(async ({ args, log, out }) => {
    log.debug('GET {url}', { url: args.url }); // fetchit -v and fetchit -vv
    log.trace('Reusing the open connection.'); // fetchit -vv
    await out.info('Fetched 3 records.'); // hidden under fetchit -q
    await out.warn('The cache is stale.'); // printed at every verbosity
  });
```

- **Log lines.** At verbosity 1 core shows every log event at `debug`, `info`, `warn`, and `error` as a log line on stderr, at verbosity 2 it adds `trace`, and at 0 and -1 it shows none. It shows the event the `log` call created, through the declared [log-line view](logging.md#at--v), which fills the message's placeholders from its fields and trails the rest, and the record keeps the message as written. A failure event never shows, because core already reported the failure. Core shows them with or without an `onLog` hook installed, and a `log` call creates an event when the verbosity shows its level even when no hook hears it.
- **The verbosity.** The run's verbosity is its verbose count less its quiet count, where a verbose count above 2 reads 2 and a quiet count above 1 reads 1, so higher counts change nothing and one quiet step is the only one. The count of each is the occurrences of the option that carries its mark, and 0 when no option carries it.

  | Verbosity | Spellings | Lanes that write | Log lines shown |
  | --- | --- | --- | --- |
  | -1 | `-q`, `-qq` | `warn`, `error` | none |
  | 0 | none, `-v -q` | `info`, `success`, `warn`, `error` | none |
  | 1 | `-v`, `-vv -q`, `-vvv -q` | `info`, `success`, `warn`, `error` | `debug`, `info`, `warn`, `error` |
  | 2 | `-vv`, `-vvv` | `info`, `success`, `warn`, `error` | `trace`, `debug`, `info`, `warn`, `error` |

  `print`, `render`, `draw`, `results`, the failure report, and the [incomplete-result](results.md#a-sequence-that-stops-early) line write at every verbosity, so `-q` hides `info` and `success` alone, and help, a result, a warning, and a failure always print. Of the writes to stderr, only a [live region](output.md#live-region) opened without `input: true` also follows the verbosity: at -1 core draws none.
- **A hidden call.** A message that is neither a string nor an async iterable of strings gets no rule, under [ADR-0093](../decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md). A call the verbosity hides calls no view, neither its lane view nor one the call passed, writes nothing, and its promise resolves. A hidden [streamed message](output.md#a-streamed-message) is read to its end and its text discarded: its promise resolves when the iterable ends and rejects when it throws, as it does at a verbosity that shows it. A log event the verbosity hides calls no log-line view, and with no `onLog` hook installed its `log` call creates no event and reads nothing from the call.
- **Settled after graph build.** Right after graph build, its `onGraphBuilt` hooks included, and before [environment preparation](plugin-contract.md#environment-preparation), core settles the run's verbosity from `host.argv`, read against the built graph with the parser's own word reader, in the partial mode [`locate`](graph-inspection.md#locating-a-word) reads an unfinished invocation with. Every form reads as the ordinary parse reads it: `-v -v`, `-vv`, `--verbose -v`, `-vq`, a short group that holds a Command's own letters, such as `-vF name`, an [alias](options.md#option-aliases), and occurrences on both sides of the Command name, up to the first bare `--`. An occurrence the parse faults, such as `--verbose=2`, counts nothing. A word list that names an unknown command settles verbosity 0. That run holds the unknown command, and everything it writes, an `onEnvironment` warning and its failure, prints at every verbosity.
- **Why after graph build.** An `onCommandAttach` hook can declare a local option with a short spelling on any Command, so only the built graph says what each letter of a short group is. Core builds `out` at the head of the run, and nothing can write a lane before the verbosity settles: graph build's hooks receive no `out`, and the only output before it is a host-capture failure or a declaration error from graph build, which is a failure report and prints at every verbosity. No context that carries `log` runs before it either, so no log event waits for the verbosity.
- **No mark.** An Application whose options carry neither mark settles verbosity 0, so it shows no log line, and every other byte is unchanged.
- **The marks.** `verbose: true` on a counted global option, the application's or a plugin's, marks the option whose occurrences raise the verbosity, and `quiet: true` on another marks the one whose occurrence lowers it. An Application holds at most one option with each mark, and an option carries at most one of them. An author may mark a verbose option alone, and the run then has no quiet step. A marked option takes a short alias, aliases, and `shortOnly` as any counted option does. `inspect()` publishes `verbose` and `quiet` on each counted option node, `true` on the marked one, and the manifest copies both. The [verbose plugin](../plugins/verbose.md) declares marked `-v, --verbose` and `-q, --quiet`.
- **One source.** A marked option binds no environment variable and no configuration key, because the verbosity settles before environment preparation and before the [input-source stage](input-sources.md). A binding is a second source for one value that would arrive after the verbosity settled: the types reject `env` beside either mark, and a configuration binding is a declaration error.
- **The options still parse.** A marked option is an ordinary counted global option to routing, parsing, validation, and [activation](plugin-contract.md#activation), so `options.verbose` reads the count the operator typed: `3` for `-vvv`, never capped, as [ADR-0057](../decisions/0057-a-counted-option-counts-its-occurrences-and-an-implied-value-fills-a-bare-spelling.md) states, while the verbosity reads 2.
- **Every writer.** A middleware's `out`, a [configuration source](input-sources.md)'s, and a [provider](providers.md#the-opener)'s follow the run's verbosity as the action's does, and each one's `log` shows at it, so a configuration source names the file it read through `log.debug`. An [`onEnvironment`](plugin-contract.md#environment-preparation) hook's `out` holds `warn` alone, and its `log` shows at the verbosity, which settles before environment preparation. An [`onLog`](lifecycle-hooks.md#observing-log-events) hook's destination holds a `log` whose events show at the outermost run's verbosity and never return to that hook; core logs no event before that run's verbosity settles, so a line always reads the settled verbosity, and core holds no line for later.
- **The first-party plugins' lines.** The first-party plugins that act on files, programs, or the environment say what they did at `-v`, one `log.debug` call per act, and how they decided at `-vv`, one `log.trace` call per place looked or thing passed over, each with a constant [message template](logging.md#message-templates) and its values in fields, and repeat no confirmation the default verbosity already prints. Their [change events](logging.md#change-events) are `info` events, so `-v` shows them too. Each plugin's page lists its lines under its **At -v and in the log** section: the [configuration plugin](../plugins/config.md#at--v-and-in-the-log), [dotenv](../plugins/dotenv.md#at--v-and-in-the-log), [self-update](../plugins/self-update.md#at--v-and-in-the-log), the [service plugin](../plugins/service.md#at--v-and-in-the-log), [completion](../plugins/completion.md#at--v-and-in-the-log), [man pages](../plugins/manpage.md#at--v-and-in-the-log), the [skills plugin](../plugins/skills.md#at--v-and-in-the-log), [MCP](../plugins/mcp.md#at--v-and-in-the-log), the [logging plugin](../plugins/logging.md#at--v-and-in-the-log), and the [external-commands plugin](../plugins/external-commands.md#at--v-and-in-the-log), whose `debug` and `trace` lines reach only a log destination, because a run that names an unknown command settles verbosity 0. Every other first-party plugin logs nothing. [ADR-0165](../decisions/0165-first-party-plugins-say-what-they-did-at-v-and-record-each-change-they-make-as-a-log-event.md) records the lines, and [ADR-0174](../decisions/0174-v-shows-the-log-through-message-templates-and-out-keeps-what-the-operator-is-told.md) moves them onto `log`.
- **Invocations by name.** `app.invoke` and an action's `invoke` each settle their own verbosity from the values they lower: `options: { verbose: 2 }` lowers to two occurrences, read as `-vv` is, and a value the call cannot lower counts nothing. A call inherits nothing from its parent run. Its `out` follows its own verbosity, while its log lines follow the outermost run's: under `app.invoke`, the outermost run, they land in its `messages` when its values ask for them, and under an action's `invoke`, an MCP tool call included, they show on the parent run's stderr at the parent's verbosity and never in the call's `messages`. Both marked options of the [verbose plugin](../plugins/verbose.md) are [control options](commands.md#control-options), so an [MCP](../plugins/mcp.md) tool lists neither and a tool call that names one is rejected, and under the plugin every MCP tool call runs at verbosity 0.
- **The lines.** A debug, info, warn, or error line opens with `glyph.pointerSmall` in its level's style, and a trace line nests one step deeper, two spaces and `glyph.lineVerticalDashed0`, and fades whole, under [At -v](logging.md#at--v). At `-vv` on a terminal, the example prints this on stderr:

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

A lane view that throws, whether the author replaced it or not, fails its call as it fails any `out` call, and the error takes the [ordinary failure path](failures.md#the-ordinary-failure-path). An author's catch is final under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). A log-line view an application replaced that throws never reaches the `log` call, which returns `undefined`; core reports it once the chain settles, as it reports an output call no code observed. A call or an event the verbosity hides calls no view, so a view that would throw raises nothing there.
