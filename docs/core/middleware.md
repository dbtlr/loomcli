---
description: "The middleware chain: what a middleware sees, how it continues or ends a run, and its order."
---

# Middleware

An invocation runs one chain. After routing has selected a Command, and after core has parsed that Command's words, run the input-source stage, and validated the invocation, holding any fault it found, core runs the middleware of each installed plugin whose activation matched, in installation order. The selected Command's action terminates the chain. A middleware surrounds the whole request: it reads the request before the action runs, it can set the view the result renders through, and its code after `await next()` runs after the action. A middleware receives:

```ts
interface MiddlewareContext<Options extends PluginOptions = PluginOptions> {
  readonly options: (PluginOptionValues<Options> & Readonly<Record<string, unknown>>) | null;
  readonly ownOptions: Partial<PluginOptionValues<Options>> & Readonly<Record<string, unknown>>;
  readonly spellings: PluginOptionSpellings<Options>;
  readonly graph: CommandGraph;
  readonly command: CommandNode;
  readonly request: Request | null;
  get view(): string | null;
  set view(name: string);
  readonly host: Host;
  readonly out: Out;
  readonly signal: AbortSignal;
  readonly onShutdown: OnShutdown; // see onShutdown
  readonly log: Log; // see Logging
  readonly next: () => Promise<ChainOutcome>;
}
interface Request {
  readonly stdin?: Content | undefined;
  readonly args: Readonly<Record<string, unknown>>;
  readonly options: Readonly<Record<string, unknown>>;
  readonly passthrough: readonly string[];
}
type PluginOptionSpellings<Options extends PluginOptions> = {
  readonly [Name in keyof Options & string]?: string;
};
type ChainOutcome = 'dispatched' | 'taken-over' | 'cancelled';
type Middleware<P extends Plugin | ((...args: never[]) => Plugin)> = (
  context: MiddlewareContext<OptionsOf<P>>,
) => Promise<void> | void;
```

- `options` holds the validated value of every global option, the application's and every plugin's, keyed by declared name. The plugin's own options are typed from its declaration, and every other key reads `unknown`, because a plugin compiles without the Application that installs it. It is `null` when a global option has a structural fault or a validation problem, whichever fault is held, so a middleware never reads a global value no validator accepted; a fault on a local option alone leaves it set, so a wrapping plugin keeps its own settings on a run that fails. It is also `null` when a configuration source fails or a validator throws, because core then holds no validated value to give. Each value is a copy frozen to every depth, as the request's values are, so a middleware copies a value before changing it. `Middleware` accepts the plugin type or its factory's type, with or without parameters, and the exported `OptionsOf` extracts the declared options from either, so `Middleware<typeof help>` reads them from the factory's annotated return type.
- `ownOptions` holds the validated value of each option the plugin itself declared that validated in this run, keyed by declared name: each key of its `options`, typed from the declaration, and each local option its [`onCommandAttach`](lifecycle-hooks.md) hook declared on the routed Command, typed `unknown`, because nothing a hook adds reaches the types. It holds them whether or not core holds a fault for another input, so a plugin reads its own setting on a run that fails, as the [formatter](../plugins/format.md) reads `--format` under a held fault. An option whose validator rejected it or threw, or whose validation never ran, is absent. Under any held fault, structural, input-source, or validation, core still validates each of the plugin's own options whose tokens parsed and that no pass reached, so `textstat --format json --bogus one.txt` under an unknown option and `textstat --format json -c missing.json one.txt` under a configuration file that cannot be read both read `json` under `format`. An option the invocation omitted, or whose own occurrence faulted, such as `--format` with no value, is not validated by that pass, and on a group no local option validates, under [Invocation](invocation.md). That validation serves `ownOptions` alone: the held fault stays the one raised, whatever the validator answers. A validator runs at most once per run, so that pass keeps every value an earlier pass validated before a validator threw and never calls a validator a second time: when another input's validator throws after `--format json` validated, the formatter reads `json` and the failure is written as the JSON line, and the `--format` validator was called once. An option the invocation omitted that has no default reads `undefined`, as an action reads it. Each value is a copy frozen to every depth, as under `options`, and the record is frozen. Another plugin's options and the application's never appear in it.
- `spellings` holds, for each of the plugin's own options that the invocation supplied as a token, the spelling that supplied it: `--help`, `-h`, or `--no-total`, the spelling alone without a value attached with `=`, `-t` for a letter inside a short group such as `-tV`, and `-n` for a value letter whose value is attached, as in `-n5`. An option filled by the [input sources](input-sources.md), or left to its default, has no entry, and neither does an option of the plugin the invocation did not supply, nor an occurrence that faulted. An option other than a multiple string option or a counted option is supplied at most once, because a repeat is the repeated-option usage error of [Global consumption and routing](commands.md#global-consumption-and-routing), so it has one spelling, its first well-formed occurrence's; a multiple string option and a counted option record the spelling of their last occurrence. A bare spelling of a string option with an [implied value](options.md#implied-values) records that spelling, as `--backup` or `-b`. The record is frozen, and the exported `PluginOptionSpellings` types it from the declaration. A plugin reads the spellings of its own declared options alone, whatever its activation, although `options` holds every global option's value, so the action, the request, and the graph still cannot tell which tier supplied a value. [ADR-0040](../decisions/0040-help-derives-compact-or-extended-from-the-spelling-the-operator-typed.md) records the decision, and [help variants](../plugins/help.md#help-variants) are its first reader.
- `graph` is the frozen graph `inspect()` returns, and `command` is the routed node inside it, so `jsonkit get --help` renders help for `get`, `jsonkit --help` for the root, and `store cache --help` for the `cache` group. An unknown command fails in routing before any middleware runs. A group's missing subcommand is held behind any structural fault and raised at the dispatch boundary, so a middleware can take over a group invocation, and with no takeover `store cache` reports the missing subcommand and `store cache --verbose` the unknown option.
- `request` is the routed Command's invocation after parsing and validation, the exported `Request`: the argument values under `args`, the local option values under `options`, each as the validator output an action receives, and the passthrough tokens. It is `null` while core holds a fault and on a group, so a middleware never reads a half-parsed invocation. The records are untyped: a middleware runs ahead of every action and the graph carries no type for a value, so it checks what it reads. Every array and plain object is copied and frozen to any depth, so a middleware reads a separate snapshot of those action inputs; a value that is neither, a class instance or a `Date` a validator produced, is shared by reference because core cannot copy it meaningfully. The request provides no supported path to replace validated action inputs. A validator's output determines the value the action receives. Additional context data, including data a middleware derives from these inputs, belongs to the separate typed context contribution design. Global option values are not here; a middleware reads them under `options`.
- `view` names the view the result renders through, on a Command that declares a [result](results.md). It reads as the declaration's default until a middleware assigns one, and as `null` on a Command that declares none; it accepts a string alone. It is one value per run: the last assignment before the dispatch boundary wins, whichever middleware made it and whether or not that middleware had already called `next()`, and an assignment after the boundary changes nothing. A name the record does not hold, or an assignment on a Command with no result, is rejected at the boundary under [`@loomcli/core/view-selection`](diagnostics.md#loomclicoreview-selection), because a plugin that selects a view has the name checked first, as the [formatter](../plugins/format.md) does through its option's validator. Core spells no view name of its own.
- `next()` continues the invocation: every later middleware, then the dispatch boundary. The dispatch boundary is the point the chain reaches when its last middleware continues: there core raises a held fault, or else reads `view` and dispatches the action, so a held fault ranks ahead of a bad assignment. A held fault is raised there and not before, so a wrapper installed ahead of help still reaches help's takeover; the innermost `next()` rejects with it, the rejection propagates outward through every awaiting `next()`, and the fault keeps its exit code and rank, so a wrapping plugin sees a validator issue the way it sees an action failure. Otherwise it resolves when the rest of the chain has settled, with `'dispatched'` when the action ran, `'taken-over'` when a later middleware returned without calling its own `next()`, and `'cancelled'` when the run was cancelled before the action ran, so a wrapping plugin knows what it wrapped. `'cancelled'` wins over `'taken-over'`, so a later middleware that returns because it saw the abort reports as cancelled, the order the exit codes follow. It rejects with the failure the rest of the chain raised. A middleware that catches the rejection and returns decides the outcome: the run ends with what that middleware produces, under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). A later middleware that catches the failure the rest of the chain raised and returns reports to its callers as `'taken-over'` when the action never ran and `'dispatched'` when it did.
- `next` is live until the middleware's own result settles. Calling it twice, or calling it after the middleware has returned, rejects the call, and nothing is parsed or dispatched.
- A middleware that returns without calling `next()` has taken over the invocation. A held fault is never raised, nothing later in the chain runs, and the exit code is 0 unless the middleware throws, its output fails, or the run was cancelled, under the precedence in [Signals, cancellation, and shutdown](signals.md). So `jsonkit get --help` renders while `get` is missing its required `path`, and `jsonkit select --bogus --help` renders too, as they did when the chain ran ahead of parsing. Because the chain runs in installation order, `jsonkit --help --version` prints help when help is installed first.
- Core calls a plugin's `load` at the moment the chain reaches that plugin, not before. A takeover earlier in the chain therefore never loads a later plugin, and `jsonkit --help --version` never imports the version middleware module.
- Work after `await next()` returns, or in a `finally` around it, is the plugin's cleanup, and it runs in reverse installation order because the awaited calls unwind. A middleware reads the outcome directly: the value `next()` resolved, the failure it rejected with, or `signal.aborted` with a reason naming the signal. The order holds for a middleware that awaits `next()`. A middleware that calls `next()` without awaiting it still holds the chain open, because core awaits the middleware's own result and the downstream promise both, but its own cleanup then runs whenever it returns, ahead of the chain it started. A `next()` the middleware never observes, by awaiting it or attaching a handler, has no catcher, so its rejection is that middleware's outcome.
- Work after `await next()` and a `finally` block run when the chain unwinds. Under a [shutdown](signals.md#the-shutdown) the chain unwinds within the budget, so a `finally` runs if the unwind finishes inside it, and work still running when the budget runs out is cut off. A middleware that changes terminal or process state, such as raw mode, the cursor, or a child process, restores it through [`onShutdown`](signals.md#onshutdown), a synchronous handler that runs at the shutdown's end even when the budget runs out, and removes the handler when its run ends while no shutdown is under way.
- `out` follows the output contract an action has, with the default destinations on every Command and `results` typed with a `never` argument, since a result is the action's promise under [Results](results.md). Output a middleware issues counts toward completion the same way, and a middleware whose promise never settles holds the run open exactly as an action would.

```ts
// src/middleware.ts, loaded only when --help or -h is supplied
import type { Middleware } from '@loomcli/core';

import type { help } from './plugin.js';
import { helpPage } from './views.js';

const middleware: Middleware<typeof help> = ({ command, graph, out, spellings }) =>
  out.render({ command, graph, variant: spellings.help === '-h' ? 'compact' : 'extended' }, helpPage);

export default middleware;
```

```ts
// An always-on wrapper: cleanup in finally, the outcome from next()
const timing: Middleware<typeof timer> = async ({ next, out }) => {
  const started = performance.now();
  try {
    const outcome = await next();
    if (outcome === 'dispatched') await out.info(`${Math.round(performance.now() - started)} ms`);
  } finally {
    stopClock();
  }
};
```

## When author code fails

A middleware that throws or rejects takes the [ordinary failure path](failures.md#the-ordinary-failure-path), and a middleware's catch is final under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). A `FatalError` or other failure a middleware throws before its `next()` has settled, or without calling it, resolves through that path with its class's exit code, a [declared code](failures.md#declared-exit-codes) included. The outcome depends on the moment:

- **Before dispatch.** If a middleware fails before the chain reaches dispatch, its failure determines the outcome and the held input fault stays unraised.
- **At dispatch.** If dispatch raises the held fault, the rejection propagates through every awaiting `next()`, and a middleware that catches it decides the outcome.
- **After `next()` has settled.** A throw during unwinding is that middleware's own failure, as a throwing `finally` is in JavaScript, and the chain's outcome is what it settles with.
- **A misused `next()`.** The rejection of a second call, or of a call after the middleware returned, is an ordinary failure, so a middleware that lets it propagate fails the run and one that catches it decides the outcome. A misuse call no code awaits or attaches to has no catcher, so core reports its [`@loomcli/core/next-misuse`](diagnostics.md#loomclicorenext-misuse) defect after the chain settles and returns 1, as it reports an output call no code observed under the ordinary failure path, whether the call came while the middleware ran or later, from a timer, while the run was still open.
- **A bad view selection.** The assignment fails at the dispatch boundary as an internal error, exit 1, naming the plugin, under [`@loomcli/core/view-selection`](diagnostics.md#loomclicoreview-selection).
