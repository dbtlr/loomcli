---
description: The phases of one invocation from argv to exit, the exit codes, the order faults are held and raised in, and invocation by name through invoke().
---

# Invocation

`run(options?)` returns `Promise<ExitCode>` and sets the same `process.exitCode`. It resolves execution failures through the output path. `invoke(path, values, options?)` runs one Command by name instead, captures what the run writes, and resolves a structured outcome, under [Invocation by name](#invocation-by-name).

| Code          | Meaning                                                            |
| ------------- | ------------------------------------------------------------------ |
| 0             | Successful execution and core output                               |
| 1             | Expected action failure, internal failure, or invalid declarations |
| 2             | Invalid invocation inputs                                          |
| 3 through 125 | An application failure whose class declares that code              |
| 129           | Cancelled by `SIGHUP`                                              |
| 130           | Cancelled by `SIGINT`, a caller-supplied abort, or the action's `cancel()` |
| 131           | Cancelled by `SIGQUIT`                                             |
| 141           | Stopped because the reader of stdout closed the pipe               |
| 143           | Cancelled by `SIGTERM`                                             |

Codes 3 through 125 belong to the application: core raises none of them, and a failure exits with one only when its class declares it under [Declared exit codes](failures.md#declared-exit-codes). An application's class may also declare 1 or 2. Core resolves no other code.

Each invocation follows this order:

1. Capture host facts and apply overrides. A working directory that cannot be read fails the run here, under [An unreadable working directory](host.md#an-unreadable-working-directory), and so does a malformed value the build baked into the [release facts](release-facts.md). Then, in an Application that declares the [color mark](color.md), read the operator's color choice from `host.argv`, which sets the run's `color` policy field before anything else prints. Then settle the run's [background](background.md), reading the operator's background choice from `host.argv` in an Application that declares the background mark, and querying the terminal when no earlier source settles it, a theme entry is adaptive or an option carries the background mark, and no skip applies.
2. Build and validate the whole Command graph, including the global options, each Command's table, every installed plugin, every command name, alias, and spelling, then, in a [development build](release-facts.md#development-builds), every validated input's [schema converter](validation.md#input-schema), then every [`onGraphBuilt`](lifecycle-hooks.md#judging-the-built-graph) hook over the frozen graph. Then settle the run's [verbosity](verbosity.md) from `host.argv`, read with the parser's own word reader against the built graph, before anything that can write a lane runs. Run [environment preparation](plugin-contract.md#environment-preparation), then validate every declared default and implied value. Then take the cooperative claim the validated [signals owner](signals.md#the-cooperative-claim) lists, under [Listening](signals.md#listening); a build failure claims nothing.
3. Copy invocation tokens for input processing.
4. Route from the root, reading option words against the global options and the own options of each Command with an action and children that routing passes through, under [Global consumption and routing](commands.md#global-consumption-and-routing). An unknown command is raised here, before the chain.
5. Parse the routed Command's remaining words against its table, up to the first bare `--`. Hold the first structural fault in word order, raising nothing yet, and keep reading so every global option is found. A routed Command that is a group holds the missing-subcommand error behind any structural fault.
6. Run the [input-source stage](input-sources.md), which fills unfilled options from the environment and then the configuration source: the global options always, and the local options when nothing is held. Then compute the run's [interaction decision](interaction.md) from the terminal facts and the interaction-marked option's value. Then validate the global options in authoring order, and, when no structural fault is held and the Command is not a group, that Command's inputs in authoring order. When any fault is held, structural, input-source, or validation, validate as well each of a plugin's own options whose tokens parsed and that no pass reached, for that plugin's middleware's [`ownOptions`](middleware.md) alone; a validator runs at most once per run, so an option whose validator threw is not validated again. Hold the first fault by the precedence below, a validator's own developer error included, so a takeover swallows a broken validator as it swallows an input fault.
7. Run the [middleware](middleware.md) of each installed plugin whose activation matched, in installation order, loading each one as the chain reaches it. Each middleware reads the request. A middleware that takes over ends the invocation here, and a held fault is never raised. When the chain continues past its last middleware it reaches the dispatch boundary, where core raises the held fault, or reads the selected view and dispatches the action.
8. Await its action. When it returns, close every [live region](output.md#live-region) the action opened that is still open, and before any failure renders, close every open region for the failure.
9. Unwind the middleware chain. Once it has unwound, close every region still open, such as one a middleware or a configuration source opened, then await the run's pending cleanups newest first under [Cleanup with defer](signals.md#cleanup-with-defer), then finish pending core output, end the run's reasons for core to listen, and set the exit status.

Error precedence follows these phases. An unknown command comes first and is raised before the chain. Then the first structural fault in word order, then a group's missing subcommand, then a validator issue. Unknown-command, misplaced-option, missing-value, repetition, and unexpected-argument diagnostics return code 2. Parsing, the input-source stage, and invocation validation run ahead of the chain so middleware can read the invocation. Core holds their faults until the dispatch boundary, and a takeover never observes them. A run cancelled before the chain starts, an abort landing inside a validator included, resolves its cancellation code under [Signals, cancellation, and cleanup](signals.md), and the held fault is never raised; core awaits the validator in flight and starts no further one. A run cancelled while the chain is running and before it reaches the dispatch boundary never reaches it: the `next()` that would have reached it resolves `'cancelled'`, the held fault and any bad `view` assignment stay unobserved, and the code is the signal's; a cancellation that lands after the action dispatched changes nothing here, and `next()` still resolves `'dispatched'`. The held fault is the input error carrying every issue collected in authoring order, or a validator's developer error, which stops validation where it happens and takes the place of anything collected before it, as [Issues and validator failures](validation.md#issues-and-validator-failures) states, or a configuration source's plugin fault or the failure it threw, which [Input sources](input-sources.md) ranks. The consequence is that a validator runs on an invocation a middleware then takes over, `app get --help` included: so a validator that reads the host or awaits a network still does so on such an invocation, and one with a side effect performs it there. A takeover skips neither invocation validation nor its effects. A declared default or implied value validates before tokens are parsed. A validator rejection, throw, or malformed result there fails before middleware can take over.

An action receives `{ args, options, supplied, interactive, passthrough, graph, command, out, host, signal, cancel, defer, style, invoke, log, stdin }`, where `log` records [log events](logging.md), and `supplied`, `interactive`, and `cancel` are described under [Interaction](interaction.md). Core attaches no input-source or token-spelling metadata to the action's input values. `graph` is the frozen graph [`inspect()`](graph-inspection.md) returns, built for this run, and `command` is the routed node inside it: the same two values the run's [middleware](middleware.md) receive, under [ADR-0041](../decisions/0041-every-action-reads-the-frozen-graph-and-its-routed-command.md). An application's action and a plugin Command's action receive them alike, so a Command whose job is to project the graph, such as [completion](../plugins/completion.md), does it in its own action. The contextual `style` includes the installed theme's custom names. Its return value is ignored, including a resolved promise value. `run()` awaits action completion but does not render its return value. `signal` is the run's cancellation signal, which [Signals, cancellation, and cleanup](signals.md) describes; a caller signal, a process signal, the action's `cancel()`, or a closed pipe can abort it. `defer` registers a cleanup that runs once, at the run's unwind or when a signal ends the process, under [Cleanup with defer](signals.md#cleanup-with-defer). `invoke` runs another Command of the same graph by name, under [Invocation by name](#invocation-by-name).

The application can run again. Each call captures host facts and builds from its declarations. Core does not call `process.exit()` or track unrelated background work. Before the action runs, it consumes no stdin but for one bounded read: the [background query](background.md), made before graph build and environment preparation, which reads a terminal stdin until the terminal answers or one second passes, and pushes every byte that is neither a reply nor an interrupt key back onto stdin, so the action reads what the operator typed. A declared content handle reads only when the action calls its read methods. It listens for process signals only while an `exit` listener, a pending cleanup, a cooperative claim, or a cancelled run's end by its signal asks it to, under [Listening](signals.md#listening), and it ends the process only by re-raising a signal it received, so that the default disposition ends it with the shell's status. Beside that re-raise, it raises a signal on its own process only for an interrupt key the background query read in raw mode, where the key arrives as a byte.

## Invocation by name

```ts
import type { FailureExitCode, FailureForm, Host, LoomError, ProgressEvent } from '@loomcli/core';

interface InvocationValues {
  readonly args?: Readonly<Record<string, string | number | boolean | readonly (string | number)[] | undefined>>;
  readonly options?: Readonly<Record<string, string | number | boolean | readonly (string | number)[] | undefined>>;
  readonly passthrough?: readonly string[];
}
interface InvokeOptions<Mapped = LoomError> {
  readonly view?: string; // the starting view selection, as a middleware's `view` assignment
  readonly failure?: (
    failure: Readonly<LoomError>,
    context: {
      readonly application: string;
      readonly path: readonly string[];
      readonly exitCode: FailureExitCode;
      readonly form: FailureForm; // see The failure form
    },
  ) => Mapped;
  readonly signal?: AbortSignal; // composed with the parent run's signal
  readonly onProgress?: (event: ProgressEvent) => void; // see Progress events
}
type InvocationOutcome<Mapped = LoomError> =
  | { readonly status: 'completed'; readonly output: string; readonly messages: string }
  | {
      readonly status: 'failed';
      readonly failure: Mapped;
      readonly form: FailureForm; // the failure form of the failure the handler received
      readonly exitCode: FailureExitCode;
      readonly output: string;
      readonly messages: string;
    }
  | { readonly status: 'cancelled'; readonly exitCode: 129 | 130 | 131 | 141 | 143 };

interface ActionContext<Args, Options = {}, Result = unknown> {
  // ...the members under Invocation...
  readonly invoke: <Mapped = LoomError>(
    path: readonly string[],
    values: InvocationValues,
    options?: InvokeOptions<Mapped>,
  ) => Promise<InvocationOutcome<Mapped>>; // bound to the graph this run built
}
declare class Application {
  // ...the members under Application declarations; published in every state, as run() is...
  invoke<Mapped = LoomError>(
    path: readonly string[],
    values: InvocationValues,
    options?: InvokeOptions<Mapped> & {
      readonly host?: Partial<Pick<Host, 'env' | 'cwd' | 'platform' | 'readSource' | 'release'>>;
    },
  ): Promise<InvocationOutcome<Mapped>>; // builds the graph for each call
}
```

```ts
import { Command } from '@loomcli/core';

import { jsonkit } from './application.js';

// An embedding host runs `jsonkit keys user -f doc.json` with named values in place of argv.
const outcome = await jsonkit.invoke(['keys'], { args: { path: 'user' }, options: { file: 'doc.json' } });
if (outcome.status === 'completed') {
  process.stdout.write(outcome.output);
}

// An action runs another Command of its own graph by name and reads its JSON view.
export const report = new Command('report').action(async ({ invoke, out, style }) => {
  const members = await invoke([], { options: { file: 'doc.json' } }, { view: 'json' });
  if (members.status === 'failed') {
    out.fatal(style.escape(members.messages));
  }
  if (members.status === 'completed') {
    await out.print(`${String(JSON.parse(members.output).length)} top-level keys`);
  }
});
```

`invoke(path, values, options?)` runs one Command of an already-built graph by its path, with named values in place of argv, captures what the run writes instead of writing it, and resolves a structured outcome. An action reaches it as `invoke` on its context, bound to the graph its own run built. An embedding host reaches it as `app.invoke`, which builds the graph for each call as `run()` does. [ADR-0059](../decisions/0059-a-command-runs-by-name-through-invoke.md) records the decision.

- **One run, spelled by name.** `invoke(path, values)` behaves as `run()` does on the argv that spells the same path and values: one table, routing and its held faults, the [input-source stage](input-sources.md), declared defaults and implied values, every validator, the middleware chain and its takeovers, [translators](failures.md#translators), failure views, [declared exit codes](failures.md#declared-exit-codes), and the precedence [Invocation](#invocation) states. A divergence between the two on the same inputs is a defect. The rules below state the only differences: values arrive by name, problems report by name, the output is captured, and the run touches no process.
- **The path.** `path` names Commands from the root, `[]` for the root. Each element reads as a plain word reads during routing: a canonical name or an [alias](commands.md#aliases) descends, and a hidden Command routes. An element that no child holds is the `UnknownCommandError` routing raises before the chain, with the partial path. So is an element after a Command that has no children, which lists no candidates, because a path names Commands alone and an argument goes under `args`. A path that ends at a group holds the missing-subcommand error, as argv does.
- **The values.** `values` mirrors the action context: `args` is keyed by argument name, `options` by the declared name of the routed Command's local options and of every global option, a plugin's included, and `passthrough` is the tail after `--`, delivered unchanged. The two records are separate because an argument and an option may share a name. An option alias, a short spelling, and a negative spelling are spellings, never keys. A key whose value is `undefined` reads as an absent key.
- **Lowering.** Each value lowers to the tokens argv would give, once, at the point the parser produces its result, and never by building argv text. So `SuppliedInputs`, every validator, and the [input schema](validation.md#input-schema) meet exactly what they meet on a command line.

  | Value                                   | Input                                    | Lowers to                                                                                         |
  | --------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
  | A string                                | A string option or a scalar argument     | That token                                                                                        |
  | A finite number                         | A string option or a scalar argument     | The token `String(value)` gives, such as `5` or `0.5`                                             |
  | `true`                                  | A Boolean option                         | The spelling that reads `true`, or absence on a `negative` option, whose absent value is `true`   |
  | `false`                                 | A Boolean option                         | The negative spelling on a `both` or `negative` option, or absence on a `positive` option         |
  | `true`                                  | A string option with an implied value    | The bare spelling, which supplies the [implied value](options.md#implied-values)                            |
  | A whole number of 0 or more             | A counted option                         | That many occurrences, so 0 is absence                                                            |
  | A string, a number, or an array of them | A multiple option or a variadic argument | One occurrence per element in order; a single value is one occurrence, and an empty array is none |

  A value no row covers is unlowerable: `null`, an object, a nested array, an array on a scalar input, a Boolean on an argument, on a counted option, or on a string option without an implied value, `false` on a string option with one, a number that is not finite, a number on a Boolean option, and a number on a counted option that is not a whole number of 0 or more. An unlowerable value supplies nothing, so an input source may still fill the option. It is an `invalid` problem of the run's `InputError`, in authoring order with the validation phase, with exit 2, and its one issue says what the input takes: `Use a string or a number.`, `Use a string, a number, or a list of them.` on a multiple option or a variadic argument, `Use true or false.` on a Boolean option, `Use a string, a number, or true.` on a string option with an implied value, `Use a string, a number, true, or a list of strings and numbers.` on a multiple option with an implied value, and `Use a whole number of 0 or more.` on a counted option. Three cases follow from the equivalence. `false` on a `positive` option is absence, so an environment binding or the configuration file may still fill it, as it fills an option a command line omits. An empty array on a required multiple option is the missing-input problem. A number on a string option with no validator reaches the action as the string `String(value)`.
- **Unknown names.** A key of `options` that the routed Command's table does not hold is an `UnknownOptionError`, and a key of `args` the routed Command does not declare is an `UnexpectedArgumentError` whose `extra` holds the name and whose `accepted` holds the number of arguments the Command declares. Each is a structural fault, held as argv's are, and the first held is the first in the order `options` keys and then `args` keys, each record in its own key order. It ranks after an unknown command and ahead of a group's missing subcommand and the validation phase, and a middleware takes it over as it takes over any held fault.
- **Reported by name.** An invocation by name types no spelling, so every problem core reports names an input by its declared name, the key the caller wrote, in place of the [reported spelling](failures.md#failure-classes) and of the spelling a parser fault names. `InputProblem.spelling` and `UnknownOptionError.spelling` hold that name. The sentences read `Option "file": Use a string or a number.`, `Option "depth" is required. Supply a value.`, `Option "min-bytes" (from TEXTSTAT_MIN_BYTES): Expected a whole number of at least 0.`, `Unknown option "verbos". Supply the name of a declared option.`, and `Command "get" declares no argument "pth". Supply the name of a declared argument.` An argument already reports under its name. A [configuration source](input-sources.md) reads `invokedBy` on its context and names a problem's option the same way.
- **Capture.** The run's stdout and stderr are capture sinks. `output` holds every byte the run wrote to stdout, decoded as UTF-8: the rendered result on a Command that declares one, and `out.print` and `out.render` text on one that does not. `messages` holds every byte the run wrote to stderr: the semantic lanes its [verbosity](verbosity.md) shows, the action's `print` and `render` on a result Command, a failure's diagnostic and its hints, and the [incomplete-result](results.md#a-sequence-that-stops-early) line. Stdin is an empty stream, `host.argv` is `[]`, and every terminal fact reads not a TTY, with no width or height, so a view's [`columns`](styles.md#width-padding-and-multiline-lanes) reads `undefined`. The captured text is plain: core resolves it as for a destination that supports no color, modifier, or hyperlink, whatever the rendering policy or `FORCE_COLOR` says, and `terminalControls` keeps the Application's setting.
- **The view.** `view` is the starting selection: the name a middleware's `view` reads before any assignment, in place of the declaration's default. A later assignment still wins, and the [formatter](../plugins/format.md) assigns only when `--format` was supplied. A name the routed Command's result does not hold and a `view` on a Command that declares no result are the view-selection defect at the dispatch boundary, exit 1, under `@loomcli/core/view-selection`, with `invoke()` named in the plugin's place: `invoke() selected view "yaml", which Command "count" does not name.` and `invoke() selected view "json" on Command "get", which declares no result.` A takeover or a cancellation leaves it unobserved, as it leaves a middleware's.
- **The outcome.** `completed` is a run that would resolve 0, a takeover included. `failed` is a run that would resolve a failure code: `exitCode` is that code, `output` and `messages` hold everything the run wrote, the failure's report included, and `failure` holds what the caller's handler returned, or the failure itself when the caller passed no handler, and `form` holds that failure's [failure form](failures.md#the-failure-form). `cancelled` is a cancelled run, and `exitCode` is the code of the cause that aborted it; its captured text is discarded. `invoke` never rejects for a call its types accept, except as [When author code fails](#when-author-code-fails) states. `Mapped` is inferred from the handler, and without one it is `LoomError`.
- **The failure path.** A failure takes `run()`'s path. A foreign throw is offered to the translators, each `onFailure` hook adds its [hints](lifecycle-hooks.md#failure-hints), and the failure's view renders, by build, into `messages`: a defect in a [distributed build](release-facts.md#development-builds) writes the generic defect message there. Then core calls the caller's `failure` handler once, for the primary failure, or, when the primary outcome succeeded and a fault reported after it set the code, such as a view's throw in an `out.render` call no code awaited, for the first such fault, with the failure as the run caught it, the translated failure and never the raw throw, and a context that holds `application`, `path`, the outcome's `exitCode`, and the failure's [failure form](failures.md#the-failure-form). The handler adds structure and never replaces the text: `messages` holds the same report `run()` writes to stderr when no [failure encoder](failure-views.md#failure-encoders) answers. It receives no style, because the form's hints are plain text, and no graph, which a failure raised at build lacks, under [ADR-0046](../decisions/0046-a-failure-view-reads-where-the-run-was-and-plugins-add-hint-lines.md). It receives the failure in both builds, its `cause` included, so what it exposes is the caller's decision. A cancellation never reaches it.
- **No encoded line.** The [failure-encoding stage](failure-views.md#failure-encoders) runs under `run()` alone. Under `invoke`, a failure's view renders into `messages` whatever media type the selected view declares, so `invoke(['paths'], …, { view: 'json' })` captures the failure's text, and the caller reads the form from the outcome and from its handler's context.
- **Spellings.** A value lowered by name is recorded in a middleware's [`spellings`](middleware.md) under the option's reported spelling, its long form, else its negative or short form, so [help](../plugins/help.md#help-variants) renders the extended page for `help: true`, as it does for `--help`.
- **Where the run was.** A run `invoke` started reads `invokedBy: 'name'` on the [failure view context](failure-views.md#failure-view-context) and the [failure hook context](lifecycle-hooks.md#failure-hints), and every other run reads `'argv'`. A hint that points at a command line skips an invocation by name: [help's hint](../plugins/suggestions.md#helps-failure-hint) and the example `--explain` hint return none for it, and the [suggestions](../plugins/suggestions.md) plugin offers declared names in place of spellings.
- **No process effects.** An invocation by name claims no process signal, even when an installed plugin holds the signals slot, and a cleanup inside `app.invoke` never starts core listening, under [Listening](signals.md#listening). It sets no `process.exitCode`, writes to no real stdout or stderr, and calls no `process.exit()`. Content preparation reads metadata but no content and rejects paths to the process stdin pipe or device, as [Content inputs](validation.md#content-inputs) states. Actions control later reads through accepted file handles. An action's `invoke` takes the call's `env`, `cwd`, `platform`, `readSource`, and [`release`](release-facts.md) from its run's host fields. `app.invoke` captures those five at entry, as `run()` does, unless `host` replaces a whole field. Its type accepts no other host field and neither `argv` nor `rendering`, and the call reads none. A working directory that capture cannot read resolves `failed`, under [An unreadable working directory](host.md#an-unreadable-working-directory). A log event of the call reaches each `onLog` with the outermost run's destination, under [Observing log events](lifecycle-hooks.md#observing-log-events): the parent run's for an action's `invoke`, and a `null` stderr for `app.invoke`, so no log record enters the captured output.
- **The graph.** An action's `invoke` reuses the graph its run built and validated, and that run's declared-value checks: no lifecycle hook runs again, and each declared default and implied value is the run's validated output, an array default copied for the call. `app.invoke` builds the graph for each call, as `run()` does, so every `onCommandAttach` and [`onGraphBuilt`](lifecycle-hooks.md#judging-the-built-graph) hook runs and every declared default and implied value validates, and a build fault is a `failed` outcome with exit 1. Both render by the run's [release facts](release-facts.md).
- **Cancellation.** Each call has its own run signal. An action's `invoke` derives it from its run's signal and the call's `signal`, and the first to abort fixes the reason. A parent's abort carries the parent's reason, so the call reads `cancelled` with the parent's code, 129, 130, 131, 141, or 143, and an abort of the call's own `signal` reads 130 as a caller abort. `app.invoke` derives it from the call's `signal` alone. A signal already aborted at the call resolves `cancelled` having run no middleware and no action. Inside the call, the rules of [Signals, cancellation, and cleanup](signals.md) hold. The call has its own `defer`, and its cleanups finish before it resolves its outcome.
- **Concurrency.** Calls may overlap, from one action or from many. Each is its own run and shares nothing mutable with another, and Loom adds no queue, limit, or timer. An application whose actions cannot overlap serializes the calls itself.
- **Nesting.** An invoked action may call `invoke` itself, under these rules, and its call's signal derives from its own run.
- **Not interactive.** An invocation by name has an empty stdin and no terminal, so its [interaction decision](interaction.md) is off: a local option that declares `required: 'non-interactive'` is required, and a question resolves without asking.
- **Its own verbosity.** Each call settles its own [verbosity](verbosity.md) from the values it lowers, so `options: { verbose: 2 }` reads as `-vv` does and the debug and trace lines it reveals land in `messages`. A call inherits nothing from its parent run's verbosity, because it behaves as the argv that spells its values.
- **Progress.** `onProgress` receives each [progress event](output.md#progress-events) of the call's run, in order, synchronously inside the `report` call or the region close that built it, so a caller reads a Command's progress while it runs. A call with no observer collects nothing. A call inherits no observer from its parent run, and the parent's observer receives none of the call's events. The call has no terminal, so none of its [live regions](output.md#live-region) draws, and a [progress line](../libs/prompts.md#progress) writes its start and end lines into `messages`.
- **Actions alone.** A middleware's context carries no `invoke`. A Command that serves other Commands by name does so in its own action, as the [MCP](../plugins/mcp.md) plugin's `mcp` Command does.
- **The call's shape.** The types reject a malformed call, such as a `path` that is not an array of strings, a `signal` that is not an `AbortSignal`, or a `failure` or an `onProgress` that is not a function. A value that bypasses them gets no rule, under [ADR-0093](../decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md): the platform's own error reports it, as a rejection of the call or as a defect of its run. A `values` key other than `args`, `options`, and `passthrough`, and a `host` field outside the five, are not read. The call copies `path` and `passthrough` where it enters, so a later change to either array changes nothing the run reads.
- **Names.** `InvocationValues`, `InvokeOptions`, and `InvocationOutcome` are exported from `@loomcli/core`, and `ActionContext` carries `invoke`. `ProgressEvent` is exported under [Progress events](output.md#progress-events).

## When author code fails

An action, a middleware, a validator, a translator, a failure view, or a hook that throws or rejects during a run, or during a call `invoke` makes, takes the [ordinary failure path](failures.md#the-ordinary-failure-path), and an author's catch is final under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). Three outcomes differ:

- **A validator's developer error.** A validator that throws, rejects, or returns a malformed result is held as the validation phase's first fault, stops validation where it happens, and takes the place of anything collected before it. Core raises it at the dispatch boundary, so a takeover swallows it as it swallows an input fault. A declared default or implied value whose validator does so fails before middleware can take over.
- **A broken failure view or hook.** It reports through the plain fallback path and forces exit 1. Under `invoke`, the outcome is `failed` with exit 1 and the report lands in `messages`.
- **A caller's handler or observer.** A `failure` handler that throws makes `invoke` reject with that throw. An `onProgress` observer that throws is called no more, and `invoke` rejects with that throw once the run settles. In both cases the run's captured text is discarded.
