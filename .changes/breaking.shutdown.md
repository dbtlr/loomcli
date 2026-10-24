- Change how a signal ends a run. `SIGINT`, `SIGTERM`, and `SIGHUP` each start one bounded shutdown while a `run()` is live, from the moment it is called: core aborts the signal of every live run on the signal source, `run()` and `app.invoke` alike, with the signal's name as the source, gives the runs the shutdown budget to unwind, and then calls every pending `onShutdown` handler and re-raises the signal, so the process dies by it with the shell's status. A second ending signal ends the shutdown at once, and `SIGQUIT` skips the budget. See [Signals, cancellation, and shutdown](docs/core/signals.md#the-shutdown).
- Add `shutdown: { timeout }` to the Application options: the milliseconds the runs get to unwind after an ending signal, 500 by default. A value other than a whole number from 0 through 2147483647 is the declaration error `@loomcli/core/invalid-shutdown-timeout`.
- Add `onShutdown(handler)` to the action and middleware contexts, scoped to the run, and export `onShutdown` from `@loomcli/core`, scoped to the process, with the types `OnShutdown`, `ShutdownEvent`, and `Synchronous`. An `onShutdown` handler is synchronous by type, runs once, newest first, at the end of a shutdown or at the process's own end, and receives the cause and the status the shell sees. Export `onSuspend` and `onResume`, scoped to the process: on each Ctrl-Z core calls every suspend handler, newest first, and re-raises `SIGTSTP`, then calls every resume handler in registration order once the process runs again; they receive no event and run at every suspend and resume. Each call returns a function that removes its handler.
- Add the cancellation codes 129 for `SIGHUP` and 131 for `SIGQUIT` to `ExitCode` and to a cancelled invocation outcome's `exitCode`, the signal names `'SIGHUP'` and `'SIGQUIT'` to `CancellationReason`'s `source`, and the two rows to the manifest's exit-code table.
- Remove the plugin `signals` field and the signals slot. Core listens for every ending signal itself, so no plugin claims one, and `@loomcli/core/slot-taken` no longer covers signals.
- Change `loom build` and `loom build --watch` to stop Bun and undo what the build wrote within the shutdown budget when a signal stops `loom`, and to remove Bun's leftovers synchronously when the budget runs out first.

### Migration

**Affected surface.**

- A plugin that declares `signals`, such as `plugin('@acme/signals', { signals: ['SIGINT', 'SIGTERM'] })`, and code that relied on that claim to keep a process alive after a signal.
- A raw `process.on('SIGINT')`, `process.on('SIGTERM')`, or `process.on('SIGHUP')` listener in an application's entry. It now runs beside core: its runs are cancelled by the signal, and it hears each signal twice, once as it arrives and once when core re-raises it at the shutdown's end.
- Code after `await app.run()` in an entry. After an ending signal it gets only its synchronous part, because the shutdown ends on the next turn of the event loop and the process dies by the signal, where before the run resolved 130 or 143 and the process went on to exit with that code.

**Why.** A cooperative claim let an action that ignores its signal hold the process without bound, and a claim beside `signal-exit` never ended it. Core now listens for every ending signal while a run is live and ends the process within one bounded shutdown, under [ADR-0106](docs/decisions/0106-a-signal-ends-the-process-within-one-bounded-shutdown.md).

**Before and after.**

Before:

```ts
import { Application, plugin } from '@loomcli/core';

const signals = plugin('@acme/signals', { signals: ['SIGINT', 'SIGTERM'] });
export const app = new Application('notes', { plugins: [signals] }).action(async ({ signal }) => {
  const scratch = createScratch();
  try {
    await convert(scratch, { signal });
  } finally {
    await removeScratch(scratch);
  }
});
```

After:

```ts
import { Application } from '@loomcli/core';

export const app = new Application('notes', { shutdown: { timeout: 500 } }).action(
  async ({ onShutdown, signal }) => {
    const scratch = createScratch();
    // Synchronous, so it completes even when the shutdown's budget runs out.
    const remove = onShutdown(() => {
      removeScratchSync(scratch);
    });
    try {
      await convert(scratch, { signal });
    } finally {
      remove();
      removeScratchSync(scratch);
    }
  },
);
```

**Steps.**

1. Remove the `signals` field from every plugin definition, and remove a plugin that declared nothing else.
2. Move the wind-down a signal needs into the run's own cancellation handling: read `signal` and finish within the budget, raising `shutdown.timeout` on the Application when a supervisor waits longer.
3. Move anything that must be restored however the process ends, such as raw mode, the cursor, a child process, or a scratch file, into a synchronous `onShutdown` handler, and remove the handler once the work no longer needs it.
4. Remove a raw `process.on` listener for `SIGINT`, `SIGTERM`, or `SIGHUP` from the entry, and move its wind-down into an `onShutdown` handler or the run's own cancellation handling. A listener that stays hears each signal twice.
5. Move work that code after `await app.run()` does on the way out, such as a final write or a cleanup, into an `onShutdown` handler or the action's `finally`, because after an ending signal only the synchronous part of that code runs.

**Validation.** Run the TypeScript compiler over the application and its plugins: no plugin definition declares `signals`. Run the application, press Ctrl-C during a long action, and check that the shell reports status 130 within the budget and that the terminal and any scratch files are restored. Run the application's tests.
