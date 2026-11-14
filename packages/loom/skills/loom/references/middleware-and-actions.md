# Middleware and actions

This reference covers when work belongs in a Command's action and when it belongs in a plugin's middleware, how the middleware chain runs around an action, and what each one may read and write.

## Choose the mechanism

An action does one Command's work. A middleware wraps every invocation that activates it, whichever Command was routed. Most work an application adds is an action. Choose by the job:

| The job | The mechanism |
| --- | --- |
| The work of one Command | That Command's action |
| A step several actions repeat, such as reading a document | A plain function each action calls |
| A value the operator supplies that every action reads | A [global option](../../../../../docs/core/commands.md#global-options) |
| A typed value an action reads, such as a pool, a session, or data derived from global options | A [provider](../../../../../docs/core/providers.md) the Command opts in to |
| Code around every invocation, such as an audit line or a state restore | An `'always'` middleware |
| Code around an invocation when the operator asks for it, such as `--timing` | A middleware activated by its own option |
| Ending an invocation in place of the action, as `--help` and `--version` do | A middleware activated by its own option, marked `control: true`, which takes over |
| Choosing the view a result renders through | A middleware that assigns `view` |
| Adding an option or a fact to every Command at graph build | An [`onCommandAttach`](../../../../../docs/core/lifecycle-hooks.md) hook |
| Adding hints to a failure, observing log events, or adding environment variables | [`onFailure`](../../../../../docs/core/lifecycle-hooks.md#failure-hints), [`onLog`](../../../../../docs/core/lifecycle-hooks.md#observing-log-events), or [`onEnvironment`](../../../../../docs/core/plugin-contract.md#environment-preparation) |

An Application has no middleware of its own. Middleware belongs to a plugin, so an application that needs one writes a plugin and installs it in its `plugins` list, under the same [plugin contract](../../../../../docs/core/plugin-contract.md) as a first-party plugin. [Structure](structure.md) says where that plugin's files go.

## What an action reads and writes

An action receives the validated invocation. Declare a validator on the input instead of checking the value again in the action.

- **It reads** `args`, `options` (the Command's local options and every global option), `provided`, `host`, `signal`, `stdin`, `passthrough`, `supplied`, `interactive`, `graph`, and `command`. It reads the machine only through `host`; the [`host-bypass`](../../../../../docs/libs/eslint-plugin.md#host-bypass) lint rule reports `process`, `node:os` folders, and `node:child_process`.
- **Its result is data for a consumer.** Declare `result()` or `rows()` on a Command whose output a script, `--format`, or an MCP tool call reads, and emit it once through `out.results` before the action returns. On such a Command stdout carries the result alone, and `out.print` and `out.render` move to stderr, under [Stdout belongs to the result](../../../../../docs/core/results.md#stdout-belongs-to-the-result). [Results and failures](results-and-failures.md) says when to declare one.
- **Its messages are about the work.** Progress, notes, and summaries go to `info`, `success`, `warn`, `debug`, and `trace`, which write to stderr, and to `log` for log events. The run's verbosity decides whether `info`, `success`, `debug`, and `trace` write.
- **Its return value is ignored.** A normal return succeeds unless its output fails or it did not emit a declared result. A failure is a throw: `out.fatal(message)`, or a failure class such as a `FatalError` subclass, whose class decides the [exit code](../../../../../docs/core/failures.md#declared-exit-codes). Never set `process.exitCode` or call `process.exit()`.
- **Its catch is final.** An action that catches a failure and returns ends the run with what it produced, under [the ordinary failure path](../../../../../docs/core/failures.md#the-ordinary-failure-path).
- **It restores what it changes.** Restore raw mode, the cursor, or a child program in a `finally`, and register a synchronous [`onShutdown`](../../../../../docs/core/signals.md#onshutdown) handler so a shutdown that runs out of budget restores it too. Read `signal` in long work. Do not register `process.on` handlers.
- **It alone runs other Commands.** `invoke` is on the action context, not the middleware context.

## What a middleware reads and writes

A middleware reads the routed invocation after parsing and validation, under [Middleware](../../../../../docs/core/middleware.md).

- **It reads** `options` (every global option's value, or `null` while core holds a fault on a global option), `ownOptions` (its own plugin's validated options, even under a held fault), `spellings`, `request`, `graph`, `command`, `view`, `host`, and `signal`.
- **`request` is untyped and may be `null`.** It is `null` while core holds a fault and on a group, and its records are frozen and typed `unknown`. Check each value before you use it.
- **It writes** `view` before the dispatch boundary, output through `out`, `log`, and `onShutdown` handlers. Its `out` keeps the default destinations on every Command, so its `print` reaches stdout even on a Command that declares a result.
- **It cannot hand the action anything.** It cannot replace the request, `next()` takes no argument, and the action context has no member a middleware fills. A value the action needs comes from a provider.
- **It continues or takes over.** `await next()` runs the rest of the chain and resolves `'dispatched'`, `'taken-over'`, or `'cancelled'`. Returning without calling `next()` takes over: the action never runs, a held input fault is never raised, and the exit code is 0 unless the middleware or its output fails or the run is cancelled.

## Order and activation

- **Installation order.** The chain runs each activated middleware in the order of the Application's `plugins` list, and the action ends the chain. Code after `await next()` unwinds in reverse order. A plugin listed earlier wraps the plugins after it and can take over before they load.
- **Activation.** `activate` is `'always'` or a list of the plugin's own option names. A listed option activates the middleware when a token or an input source supplies it, never when only its default applies. An option the plugin's `onCommandAttach` hook declares cannot activate it, so a middleware that reads one declares `'always'`, as the formatter does. [Activation](../../../../../docs/core/plugin-contract.md#activation) states the rule.
- **Lazy loading.** Core calls `load` only when the chain reaches an activated middleware. Keep the middleware in its own module and load it with `import()`, so an invocation that does not activate it never imports it. An `'always'` middleware loads on every invocation that reaches the chain.
- **Before the chain.** An unknown command fails before any middleware runs. Every other input fault is held and raised at the dispatch boundary, where it rejects the innermost `next()` and travels outward through every awaiting middleware. Validators run before the chain, even on an invocation a middleware then takes over.
- **At the dispatch boundary.** Core builds the routed Command's providers after the last middleware continues, and closes them when the action settles, so code after `await next()` runs after every provided value has closed.
- **Invocation by name.** Each `invoke` call runs the chain again for the Command it names, so an `'always'` middleware also wraps every MCP tool call. What it writes there lands in that call's captured output.

## A middleware of the application's own

This plugin reports how long a dispatched Command took when the operator supplies `--timing`. The action knows nothing about it.

```ts
import { Application, plugin } from '@loomcli/core';
import type { Middleware, Plugin, PluginOptions } from '@loomcli/core';

const options = {
  timing: { description: 'Report how long the command took.', type: 'boolean' },
} satisfies PluginOptions;

// In the application, this is the default export of its own module, loaded with import().
const middleware: Middleware<typeof timing> = async ({ next, out }) => {
  const started = Date.now();
  const outcome = await next();
  if (outcome === 'dispatched') {
    await out.info(`Finished in ${Date.now() - started} ms.`);
  }
};

function timing(): Plugin<typeof options> {
  return plugin('notes/timing', {
    middleware: { activate: ['timing'], load: async () => ({ default: middleware }) },
    options,
  });
}

export const notes = new Application('notes', {
  description: 'Keep short notes.',
  plugins: [timing()],
}).action(({ out }) => out.print('No notes yet.'));
```

The factory's annotated return type is what lets the middleware module type-import the plugin without a type cycle. When `next()` rejects, the `await` throws, so the failure propagates and nothing is printed.

## Common mistakes

- **Per-command work in a middleware.** A middleware that branches on `command.path` to do one Command's job belongs in that Command's action.
- **A cross-cutting concern copied into every action.** An audit line, timing, or a state restore repeated in each action belongs in one middleware. A shared step that produces the action's data stays a function the actions call, and a shared typed value is a provider.
- **Setup in a middleware for the action.** A connection opened in a middleware cannot reach the action, and it opens even when a later middleware takes over or a held fault fails the run. A provider builds only at the dispatch boundary, and only for a Command that opts in.
- **Swallowing a failure.** A middleware that catches the rejection of `next()` to log it and then returns ends the run as a success. Rethrow after you log.
- **Calling `next()` without awaiting it.** The cleanup then runs before the chain it wraps has finished. A second call to `next()` rejects and continues nothing.
- **Writing stdout from a middleware on a result Command.** The bytes mix with the result a script reads. Write messages through `info`, `warn`, or `debug`, which go to stderr.
- **Expecting a default to activate.** A declared default never activates a middleware. Supply the option, or declare `'always'` and read the value.
- **Validating or normalizing input in a middleware.** A middleware cannot change what the action receives. Put the rule in the input's validator.
