---
description: How a run receives signals and cancellation, how code cleans up before a run or the process ends, and what an action, a plugin, and a library do with each.
---

# Signals, cancellation, and cleanup

This page states how a run is cancelled, how code cleans up before its run or the process ends, and what a signal does to both. [ADR-0105](../decisions/0105-core-is-the-only-process-listener-and-cleanup-runs-on-every-path-out.md) records the decision. Three pieces fit together:

- **The run signal** cancels one run. It is an `AbortSignal` on the action and middleware contexts.
- **`defer`** registers a cleanup for one run. It runs once, at the run's unwind or when the process ends, whichever comes first.
- **`processEvents`** is the one process-wide event object, exported from `@loomcli/core`, for code that has no run: a library or an embedding host. It publishes `exit`, `suspend`, and `resume`.

Core is the only process listener Loom installs, and it listens only while someone has asked. A signal ends the process at once by default, with every cleanup done first. One plugin may claim a cooperative policy for a signal, so the run is cancelled and unwinds on its own terms.

```ts
import { rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Command } from '@loomcli/core';

import { convertInto } from './convert.js';

export const convert = new Command('convert', { description: 'Convert every file in a folder.' }).action(
  async ({ defer, signal }) => {
    const scratch = await mkdtemp(join(tmpdir(), 'convert-'));
    // Synchronous, so it also completes when a signal ends the process.
    defer(() => {
      rmSync(scratch, { force: true, recursive: true });
    });
    await convertInto(scratch, { signal });
  },
);
```

## The run signal

Every run creates one private cancellation controller and exposes its signal to each middleware and to the action context as `signal`. Four things can abort it.

- **A caller** passes `signal` in the run options, which is the path for an embedding host or a test. Core subscribes to it at run entry and honors an abort at every phase boundary from then on.
- **A process signal** aborts it, on the [immediate path](#the-immediate-path) and under a [cooperative claim](#the-cooperative-claim) alike, with the signal's name as the source.
- **The action** calls `cancel()` on its context, which aborts the run signal with `{ source: 'action' }`. This is how code that reads keys in raw mode, where Ctrl-C arrives as a byte rather than as `SIGINT`, ends the run as an interrupt would: a [question](../libs/prompts.md) calls it on Ctrl-C and on end of input. It returns nothing, a call on a signal that has already aborted changes nothing, and the action then throws `signal.reason`, which is silent, or returns. A middleware's context carries no `cancel()`. Under an invocation by name, the call's own signal aborts, so the call resolves `cancelled` with 130 and the parent run goes on.
- **The reader of the run's stdout** closes the pipe, under [ADR-0104](../decisions/0104-a-closed-reader-on-stdout-ends-the-run-with-141.md). When a write to `run()`'s stdout fails because its reader closed the pipe, which Node and Bun both report as an `EPIPE` error and Bun reports for a macOS socket stdout as `ENOTCONN`, core aborts the run signal with `{ source: 'closed-pipe', cause }`, where `cause` is the failed write's error. A closed reader is the end of the run, not a defect, following the `SIGPIPE` convention of `git` and `yes`: `app list | head -1` reads one line and stops. The write and every later stdout write reject with the signal's reason, so an action that lets the rejection propagate stays silent, a streaming row source stops as it does under any cancellation, and the run resolves 141 in both builds with no failure report, no incomplete-result line, and no failure event for the closed pipe. A failure reported before the pipe closed keeps its report, and the run still resolves 141. Only the run's own stdout ends a run this way: a closed reader on stderr and every other failed write report a broken destination under the [ordinary failure path](failures.md#the-ordinary-failure-path). An invocation by name captures its output, so it has no pipe; an action's call reads its run's closed-pipe reason and resolves `cancelled` with 141.

The first cause to abort the controller fixes the run's cancellation reason and code: 129 for `SIGHUP`, 130 for `SIGINT`, 131 for `SIGQUIT`, 143 for `SIGTERM`, 130 for a caller-supplied abort, 130 for the action's `cancel()`, and 141 for a closed pipe. A later cause changes neither, so a pipe that closes after `SIGINT` leaves 130, and `SIGINT` after a closed pipe leaves 141, though that `SIGINT` takes the immediate path, as any signal does once every claimant is cancelled. Under a cooperative claim, core keeps awaiting the chain: a middleware or action already running reads `signal` and finishes on its own terms. Core starts nothing new after cancellation: a middleware the chain has not reached and an action not yet dispatched are skipped, a loader already in flight settles and its middleware is skipped, and the entries already running unwind in order. A loader has the standing an action has: a module import cannot be aborted, so core awaits it, and a loader that never settles holds the run open exactly as an action that ignores the signal does, until the immediate path or a supervisor ends the process. A cancelled run resolves its cancellation code whenever it ends after graph build with no declaration or internal failure raised before the chain starts, whether or not the chain was reached; such a failure ends the run with its own code, an abort that lands during build included. A run whose caller signal is already aborted at entry still builds and validates the graph, and otherwise resolves 130 having loaded no plugin and run no middleware or action.

Work that must happen at the moment of cancellation, such as drawing a cancelled line, belongs in a synchronous listener added to `signal`. It runs on the immediate path too, because core aborts the run signal before it calls any cleanup. Work that must happen however the run ends, such as leaving raw mode, belongs in [`defer`](#cleanup-with-defer).

The signal decides the code whatever the action did afterward, because a script that sees 0 after an interrupt carries on as if the work finished. Core aborts the private signal with a reason it owns, the exported `CancellationReason`, where `cause` carries the caller's own `signal.reason` when the caller aborted and the failed write's error when the pipe closed, so a middleware reads `source` and never infers a signal name. An API that rejects with `signal.reason`, as `fetch` does, throws that reason itself; a thrown value that is the reason, or an error named `AbortError`, is silent. Any other failure after cancellation is rendered as usual, and the code stays the signal's. A first signal that arrives after the chain has settled, while core is rendering a failure or finishing output, still cancels the run and decides its code; a further signal in that window changes the code no further. One rule orders every code: a cancelled run, as defined above, resolves its signal's code, and a broken failure view, `onFailure` hook, or destination in that run is reported as text without changing it; otherwise a broken failure view, `onFailure` hook, or destination forces 1 over the primary outcome, the accepted view rule; otherwise the outcome the chain and the action settle with decides, under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md).

```ts
interface CancellationReason {
  readonly source: 'SIGINT' | 'SIGTERM' | 'SIGHUP' | 'SIGQUIT' | 'caller' | 'action' | 'closed-pipe';
  readonly cause?: unknown;
}
```

## Cleanup with defer

```ts
interface ActionContext<Args, Options = {}, Result = unknown> {
  readonly defer: Defer;
  // ...
}
// MiddlewareContext carries the same member.

type Defer = <Returned>(cleanup: () => Returned) => () => Returned | undefined;
```

```ts
import { once } from 'node:events';
import type { ReadStream } from 'node:tty';

import type { ActionContext } from '@loomcli/core';

// Reads one key in raw mode and leaves the terminal cooked however the run ends.
export async function readKey(context: Pick<ActionContext<unknown>, 'defer'>, input: ReadStream): Promise<string> {
  input.setRawMode(true);
  const leaveRawMode = context.defer(() => input.setRawMode(false));
  try {
    const [chunk] = await once(input, 'data');
    return String(chunk);
  } finally {
    leaveRawMode(); // cooked again now, with nothing left for the unwind
  }
}
```

`defer(cleanup)` registers a cleanup for the run whose context it is on, and returns a function that runs the cleanup now and removes it.

- **Exactly once.** A cleanup runs at the first of three points: a call of the function `defer` returned, the run's unwind, or the [immediate path](#the-immediate-path) or the [`exit` backstop](#ending-by-the-signal). The returned function returns what the cleanup returned on its first call and `undefined` on every later call, and once core has run the cleanup it does nothing and returns `undefined`.
- **At the unwind.** Once the chain has settled and core has closed the run's open [regions](output.md#live-region), core awaits each pending cleanup in turn, newest first, before it renders the failure report. So the terminal is restored before the report prints, and a line a cleanup writes lands above the report. A cleanup that a cleanup registers runs next, because it is the newest.
- **On a signal.** On the immediate path, core calls each pending cleanup synchronously, newest first, and awaits none. A promise a cleanup returns is started, and its rejection is caught. So a cleanup that restores the terminal or the process must do its work synchronously, as `setRawMode` and `rmSync` do; work after an `await` may never happen.
- **A middleware's `finally`.** On the immediate path, no `finally` block runs, a middleware's included, because the process ends without unwinding the chain. A middleware that changes terminal or process state restores it through `defer`.
- **When a cleanup fails.** Every cleanup runs, whatever an earlier one did. At the unwind, the first cleanup that throws or rejects in a run that would otherwise succeed is the run's failure, as if the action had thrown it: it takes the [ordinary failure path](failures.md#the-ordinary-failure-path), translators included. Any other throw changes no outcome: in a run that already failed or was cancelled, after that first throw, or on the immediate path or the `exit` backstop, core publishes it as an `error` [log event](logging.md) with the thrown value under `error`, and writes no report.
- **Removed with its run.** No cleanup outlives its run, so nothing leaks into the next run or the next test. A cleanup registered after its run's cleanups have run is called at once.
- **Invocation by name.** A call has its own `defer`. Its cleanups run at the call's unwind, in the same order, and finish before the call resolves its outcome. An action's call counts with its run, so its pending cleanups keep core listening and are called on the immediate path. A cleanup inside `app.invoke` never starts core listening, because `app.invoke` touches no process, though the immediate path still calls it when core is listening for another reason.
- **Where it is.** `defer` is on the action and middleware contexts alone. A configuration source, a runtime hook, and code outside a run use `processEvents` or their own `finally`.

## Process events

```ts
// @loomcli/core
export const processEvents: ProcessEvents;

interface ProcessEventMap {
  readonly exit: ProcessExitEvent;
  readonly suspend: Event;
  readonly resume: Event;
}
interface ProcessEvents extends EventTarget {
  addEventListener<Type extends keyof ProcessEventMap>(
    type: Type,
    listener: (event: ProcessEventMap[Type]) => void,
    options?: AddEventListenerOptions,
  ): void;
  removeEventListener<Type extends keyof ProcessEventMap>(
    type: Type,
    listener: (event: ProcessEventMap[Type]) => void,
    options?: EventListenerOptions,
  ): void;
}
declare class ProcessExitEvent extends Event {
  readonly cause: 'SIGINT' | 'SIGTERM' | 'SIGHUP' | 'SIGQUIT' | 'exit';
  readonly code: number;
}
```

```ts
import { processEvents } from '@loomcli/core';

// A spinner library that hides the cursor shows it again however the process ends.
export function hideCursor(stream: NodeJS.WriteStream): () => void {
  const show = () => stream.write('\u001B[?25h');
  stream.write('\u001B[?25l');
  processEvents.addEventListener('exit', show, { once: true });
  return () => {
    processEvents.removeEventListener('exit', show);
    show();
  };
}
```

`processEvents` is the one process event object. Any action, middleware, hook, library, or embedding host may add and remove listeners.

- **One per process.** It lives under `globalThis[Symbol.for('loomcli.processEvents')]`. The first copy of `@loomcli/core` to load creates it, and every later copy uses the one it finds, so two installed copies listen once and re-raise once. Its shape is a contract across versions of core.
- **`exit`.** It fires when the process is about to end: on the immediate path, at the [`exit` backstop](#ending-by-the-signal) after a cooperative run, and at the process's own `exit` event for a normal end, a `process.exit()` call, or an uncaught exception. It fires at most once per process. `cause` is the signal's name when a signal ends the process and `'exit'` otherwise. `code` is the status the shell sees: 128 plus the signal's number for a signal, which is 129, 130, 131, or 143, and the exit code otherwise.
- **`exit` listeners are synchronous and run newest first.** Unlike a plain `EventTarget`, core calls the newest registration first, so code that set up last tears down first. The process ends after the last listener returns, so a returned promise is never awaited. A listener that throws is caught, and the rest still run.
- **`suspend` and `resume`.** On `SIGTSTP`, which Ctrl-Z sends from a cooked terminal, core calls each `suspend` listener synchronously, newest first, and then stops the process by raising `SIGSTOP` on itself. On the `SIGCONT` that follows, which `fg` sends, core calls each `resume` listener in registration order. A listener restores cooked mode and shows the cursor on suspend, and enters raw mode again and redraws on resume. A suspend cancels no run. A `SIGCONT` with no suspend before it fires nothing.
- **A raw-mode reader joins suspend.** In raw mode, Ctrl-Z reaches the reader as the byte 0x1a, not as a signal, so a reader raises `SIGTSTP` on the process for it, and the suspend runs as it would from a cooked terminal.
- **Other signals.** `SIGWINCH` is not a process event: a terminal stream's `resize` event serves redraws. `SIGPIPE` is not one either: a closed reader on stdout ends the run as a [closed pipe](#the-run-signal).
- **Removal.** An `AbortSignal` in the listener options removes the listener when it aborts, so `{ signal: context.signal }` removes an action's listener when its run is cancelled.

## Listening

Core listens for a signal only while someone has asked, so a library still installs nothing nobody asked for.

| Core listens for                                              | While                                                                                                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `SIGINT`, `SIGTERM`, `SIGHUP`, `SIGQUIT`, and the `exit` event | an `exit` listener is registered, a cleanup is pending in a run whose outermost run is `run()`, or a live `run()` holds a cooperative claim |
| `SIGTSTP` and `SIGCONT`                                        | a `suspend` or `resume` listener is registered                                                                                              |

With none of these, core holds no listener, and every signal has its default effect: the process ends with the shell's status, or stops on `SIGTSTP`. Core adds a listener when the first reason appears and removes it when the last one ends, so an Application can run again and a test leaks no listener. An invocation by name never claims a signal.

A raw `process.on` listener stays allowed, and core never forbids going around the lane. It costs what it costs without Loom: it takes over that signal's default disposition. While a listener outside core is installed for a signal, core's immediate path still cancels every run, calls every cleanup and `exit` listener, and removes its own listeners, but it does not re-raise, so that listener decides whether the process ends. This is how `signal-exit` treats a listener it does not own.

## The cooperative claim

```ts
interface PluginDefinition<Options extends PluginOptions, Theme extends ThemeMapping = ThemeMapping> {
  // ...
  signals?: readonly CooperativeSignal[];
}
type CooperativeSignal = 'SIGINT' | 'SIGTERM' | 'SIGHUP';
```

```ts
import { Application } from '@loomcli/core';
import { signals } from '@loomcli/plugins/signals';

// A daemon ends at once on Ctrl-C and unwinds cooperatively when its supervisor sends SIGTERM.
export const notes = new Application('notes', {
  plugins: [signals({ cooperative: ['SIGTERM'] })],
});
```

A plugin claims the signals slot by listing the signals it makes cooperative. The [signals plugin](../plugins/signals.md) is the first-party claim.

- **Per signal.** A listed signal is cooperative. An unlisted signal takes the immediate path. `SIGQUIT` cannot be listed, because Ctrl-\\ asks for an immediate end with a core dump.
- **One owner.** The slot has one owner: a second claim is a declaration error from the Application constructor naming both plugins, [`@loomcli/core/slot-taken`](diagnostics.md#loomclicoreslot-taken). A signal listed twice is listed once. An empty list claims nothing and leaves the slot free.
- **What cooperative means.** The first signal cancels the run and core absorbs it, so the process stays up while the chain unwinds on its own terms. Core awaits the cleanups, renders the failure report, resolves the signal's code, and the process then [ends by the signal](#ending-by-the-signal). A later signal finds the claimant cancelled, so it takes the immediate path: pressing Ctrl-C again always ends the process at once, with the terminal restored.

### Several runs in one process

Core holds one listener per signal for the whole process, so one rule decides what a signal does, whatever runs are live. A signal is cooperative while at least one live run claims it and is not yet cancelled. Core then cancels every live run that is not yet cancelled, claimant or not, with that signal as the source, absorbs the signal, and lets each run unwind. Otherwise the signal takes the immediate path for every run. A run that claims nothing is unwound cooperatively beside a claimant, because one process cannot both end now and stay up for another run. An embedding host that runs several Applications in one process supplies `run({ signal })` and installs no claim.

## The order

### The immediate path

A signal that no live, uncancelled run claims, every `SIGQUIT`, and every signal after the claimants are cancelled takes this path:

1. Core aborts every live run's signal with the signal as the source. Each abort listener runs synchronously: each open [region](output.md#live-region) closes with `'cancellation'` and draws its cancelled line, and each question leaves raw mode.
2. Core calls every pending cleanup, of every live run, synchronously, newest first.
3. Core fires `exit` on `processEvents`, and its listeners run synchronously, newest first.
4. Core removes its listeners and re-raises the signal, so the default disposition ends the process with the shell's status: 129, 130, 131, or 143. When a listener outside core remains for that signal, core does not re-raise.

Nothing on this path is awaited, and core sets no timer. A write on this path is best effort: a cancelled line written to a terminal that has hung up is dropped.

### The cooperative path

1. The first signal cancels every live, uncancelled run, as under [Several runs in one process](#several-runs-in-one-process).
2. The chain unwinds on its own terms, and core closes each run's open regions with `'cancellation'` once its signal aborts.
3. Core awaits each run's pending cleanups, newest first.
4. Core renders the run's failure report, if any, and the run resolves the signal's code and sets `process.exitCode`.
5. When the process ends, it [ends by the signal](#ending-by-the-signal).

Any signal after step 1 takes the immediate path for whatever has not run.

### A normal end

1. The chain settles, and core closes each open region with `'completion'`, or with `'failure'` when a report follows.
2. Core awaits the pending cleanups, newest first.
3. Core renders the failure report, if any, and the run resolves its code.

`exit` listeners run only when the process itself ends, at its own `exit` event.

### Ending by the signal

A run cancelled by a signal resolves that signal's code and sets `process.exitCode`, and the author's code after `run()` still runs. When the process then ends on its own, core's backstop at the process's `exit` event fires `exit` on `processEvents` and, if `process.exitCode` still holds that run's code, re-raises the signal, so the process dies by it. A shell that runs the application in a script loop follows wait-and-cooperative-exit: it stops the script only when its child died by `SIGINT`, so a normal exit with 130 would leave the loop running through every Ctrl-C. A host that sets another exit code, or keeps the process running, is unaffected.

## When author code fails

An action, a middleware, a loader, or a cleanup that throws or rejects takes the [ordinary failure path](failures.md#the-ordinary-failure-path), and an author's catch is final under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). Cancellation is the exception, because it is the run's state and not a caught failure: a cancelled run resolves its cancellation code even when code catches the cancellation and returns, since the first cause to abort the run signal fixes the reason and the code. An author's catch decides a failure's outcome, not whether the run was cancelled, and a broken failure view, `onFailure` hook, or destination in a cancelled run is reported as text without changing the code. A cleanup's failure follows [When a cleanup fails](#cleanup-with-defer), and an `exit`, `suspend`, or `resume` listener that throws is caught.

```ts
type ExitCode = 0 | FailureExitCode | 129 | 130 | 131 | 141 | 143;
```

`ExitCode` is `0`, every code a failure class can declare under [Declared exit codes](failures.md#declared-exit-codes), and the cancellation codes: 129 for `SIGHUP`, 130 for `SIGINT`, a caller abort, and the action's `cancel()`, 131 for `SIGQUIT`, 141 for a closed pipe, and 143 for `SIGTERM`. A consumer that switches exhaustively on it handles that range.
