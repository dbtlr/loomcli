---
description: How a run is cancelled, how a signal ends the process within one bounded shutdown, how code restores what must not outlive the process, and what suspend and resume do.
---

# Signals, cancellation, and shutdown

This page states how a run is cancelled, how a signal ends the process, and how code restores what must not outlive the process. [ADR-0106](../decisions/0106-a-signal-ends-the-process-within-one-bounded-shutdown.md) records the decision. Four pieces fit together:

- **The run signal** cancels one run. It is an `AbortSignal` on the action and middleware contexts.
- **The shutdown** is what an ending signal starts: core cancels every run, gives the runs a short budget to unwind, then ends the process by the signal.
- **`onShutdown`** registers a synchronous handler that runs once, at the shutdown's end or at the process's own end, on the action and middleware contexts for a run and exported from `@loomcli/core` for a library or an embedding host.
- **`onSuspend` and `onResume`** register handlers for Ctrl-Z and `fg`.

A signal ends a Loom application within its budget, 500 ms unless the Application sets another, whatever its action does, and a second signal ends it at once.

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { Command } from '@loomcli/core';

import { convertInto } from './convert.js';

export const convert = new Command('convert', { description: 'Convert every file in a folder.' }).action(
  async ({ host, onShutdown, signal }) => {
    const scratch = mkdtempSync(join(host.tmpdir, 'convert-'));
    const remove = () => {
      rmSync(scratch, { force: true, recursive: true });
    };
    // Synchronous, so it completes even when the shutdown's budget runs out.
    onShutdown(remove);
    try {
      await convertInto(scratch, { signal });
    } finally {
      remove();
    }
  },
);
```

## The run signal

Every run creates one private cancellation controller and exposes its signal to each middleware and to the action context as `signal`. Four things can abort it.

- **A caller** passes `signal` in the run options, which is the path for an embedding host or a test. Core subscribes to it at run entry and honors an abort at every phase boundary from then on.
- **A shutdown** aborts it, with the ending signal's name as the source, under [The shutdown](#the-shutdown).
- **The action** calls `cancel()` on its context, which aborts the run signal with `{ source: 'action' }`. This is how an action ends its own run as an interrupt would. It returns nothing, a call on a signal that has already aborted changes nothing, and the action then throws `signal.reason`, which is silent, or returns. A middleware's context carries no `cancel()`. Under an invocation by name, the call's own signal aborts, so the call resolves `cancelled` with 130 and the parent run goes on.
- **The reader of the run's stdout** closes the pipe, under [ADR-0104](../decisions/0104-a-closed-reader-on-stdout-ends-the-run-with-141.md). When a write to `run()`'s stdout fails because its reader closed the pipe, which Node and Bun both report as an `EPIPE` error and Bun reports for a macOS socket stdout as `ENOTCONN`, core aborts the run signal with `{ source: 'closed-pipe', cause }`, where `cause` is the failed write's error. A closed reader is the end of the run, not a defect, following the `SIGPIPE` convention of `git` and `yes`: `app list | head -1` reads one line and stops. The write and every later stdout write reject with the signal's reason, so an action that lets the rejection propagate stays silent, a streaming row source stops as it does under any cancellation, and the run resolves 141 in both builds with no failure report, no incomplete-result line, and no failure event for the closed pipe. A failure reported before the pipe closed keeps its report, and the run still resolves 141. Only the run's own stdout ends a run this way: a closed reader on stderr and every other failed write report a broken destination under the [ordinary failure path](failures.md#the-ordinary-failure-path). An invocation by name captures its output, so it has no pipe; an action's call reads its run's closed-pipe reason and resolves `cancelled` with 141.

The first cause to abort the controller fixes the run's cancellation reason and code: 129 for `SIGHUP`, 130 for `SIGINT`, 131 for `SIGQUIT`, 143 for `SIGTERM`, 130 for a caller-supplied abort, 130 for the action's `cancel()`, and 141 for a closed pipe. A later cause changes neither, so a pipe that closes after `SIGINT` leaves 130, and a shutdown after a closed pipe leaves 141. Core keeps awaiting the chain after cancellation: a middleware or action already running reads `signal` and finishes on its own terms, within the shutdown's budget when a shutdown aborted it. Core starts nothing new after cancellation: a middleware the chain has not reached and an action not yet dispatched are skipped, a loader already in flight settles and its middleware is skipped, and the entries already running unwind in order. A loader has the standing an action has: a module import cannot be aborted, so core awaits it. A cancelled run resolves its cancellation code whenever it ends after graph build with no declaration or internal failure raised before the chain starts, whether or not the chain was reached; such a failure ends the run with its own code, an abort that lands during build included. A run whose caller signal is already aborted at entry still builds and validates the graph, and otherwise resolves 130 having loaded no plugin and run no middleware or action.

Work that must happen at the moment of cancellation, such as drawing a cancelled line, belongs in a synchronous listener added to `signal`, which runs when the shutdown begins. Work that must happen before the process ends, however it ends, such as leaving raw mode, belongs in [`onShutdown`](#onshutdown).

The signal decides the code whatever the action did afterward, because a script that sees 0 after an interrupt carries on as if the work finished. Core aborts the private signal with a reason it owns, the exported `CancellationReason`, where `cause` carries the caller's own `signal.reason` when the caller aborted and the failed write's error when the pipe closed, so a middleware reads `source` and never infers a signal name. An API that rejects with `signal.reason`, as `fetch` does, throws that reason itself; a thrown value that is the reason, or an error named `AbortError`, is silent. Any other failure after cancellation is rendered as usual, and the code stays the signal's. A first cause that arrives after the chain has settled, while core is rendering a failure or finishing output, still cancels the run and decides its code. One rule orders every code: a cancelled run, as defined above, resolves its cancellation code, and a broken failure view, `onFailure` hook, or destination in that run is reported as text without changing it; otherwise a broken failure view, `onFailure` hook, or destination forces 1 over the primary outcome, the accepted view rule; otherwise the outcome the chain and the action settle with decides, under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md).

```ts
interface CancellationReason {
  readonly source: 'SIGINT' | 'SIGTERM' | 'SIGHUP' | 'SIGQUIT' | 'caller' | 'action' | 'closed-pipe';
  readonly cause?: unknown;
}
```

## The shutdown

```ts
interface ApplicationOptions {
  // ...
  readonly shutdown?: {
    /** Milliseconds the runs get to unwind after an ending signal. Defaults to 500. */
    readonly timeout?: number;
  };
}
```

```ts
import { Application } from '@loomcli/core';

// A daemon whose supervisor sends SIGTERM and waits: its runs get two seconds to finish a write.
export const notes = new Application('notes', { shutdown: { timeout: 2000 } });
```

`SIGINT` (Ctrl-C), `SIGTERM` (a supervisor or `kill`), and `SIGHUP` (a closed terminal window or a dropped SSH session) each start the process's shutdown while core [listens](#listening).

1. **Begin.** Core aborts the signal of every live run whose process handle shares the signal source, `run()` and `app.invoke` alike, with the signal's name as the source. Each abort listener runs synchronously: each open [region](output.md#live-region) draws its cancelled line, and each question leaves raw mode.
2. **Unwind.** The runs unwind on their own terms: a middleware's work after `next()` and its `finally`, an action's own `finally`, and each run's failure report and output all run as they do on any cancellation.
3. **End.** The shutdown ends at the first of three points: every live run has resolved, the budget has run out, or a second `SIGINT`, `SIGTERM`, or `SIGHUP` arrives. When the last run resolves first, the shutdown ends on the next turn of the event loop, so code that awaited `run()` runs its synchronous part. Core then writes every region frame still in its write queue, the cancelled lines drawn at the abort included, straight to the terminal and shows the cursor, calls every pending [`onShutdown`](#onshutdown) handler synchronously, newest first, removes its listeners, and re-raises the first signal, so the default action ends the process with the shell's status: 129, 130, or 143. Work still running is cut off.

The rules:

- **The budget.** It starts at the first signal and lasts `shutdown.timeout` milliseconds, 500 unless the Application sets another. It is fixed then: the process takes the longest timeout among the Applications of the runs live at the first signal, and with no live run the shutdown ends at once. A run that starts during the shutdown, such as an `app.invoke` or a nested `run()`, starts cancelled with the shutdown's source and does not extend it. A timeout of 0 skips the unwind. The timeout is a whole number of milliseconds from 0 through 2147483647, the longest a timer can wait; any other value, a negative, fractional, or non-finite one included, is a declaration error from the Application constructor, `@loomcli/core/invalid-shutdown-timeout`. Raising it gives a run more time to finish its unwind and makes every cancelled run take that much longer to end when its work does not stop, so an application keeps the work its unwind does short and lets the budget stay small.
- **`SIGQUIT`.** Ctrl-\ asks for an immediate end with a core dump, so it skips the budget: core aborts the runs, writes the region frames still in its write queue straight to the terminal and shows the cursor, calls the handlers, and re-raises `SIGQUIT` at once. A `SIGQUIT` during a shutdown ends it the same way, and the process dies by `SIGQUIT`.
- **A run that resolves inside the shutdown** resolves its signal's code and writes it to its process handle's `exitCode`, and the process still dies by the signal, so a shell that runs the application in a script loop stops the loop, as it does for any program Ctrl-C ends.
- **Nothing is awaited at the end.** Core calls handlers synchronously and never awaits what they return. A write core makes at the end is best effort: a cancelled line written to a terminal that has hung up is dropped.
- **No signal waits on another listener.** Core always re-raises once its own listeners are removed. A listener outside core, a raw `process.on` or the one `signal-exit` installs, receives the signal as it arrived and again as core re-raises it, and decides what happens next: `signal-exit` then finds itself alone, runs its own handlers, and re-raises, and an embedding host that keeps the process alive does so. Core has still cancelled the runs and called the handlers. While the process lives, a later ending signal starts a new shutdown.

## onShutdown

```ts
interface ShutdownEvent {
  /** The signal that ended the process, or `'exit'` when it ended on its own. */
  readonly cause: 'SIGHUP' | 'SIGINT' | 'SIGQUIT' | 'SIGTERM' | 'exit';
  /** The status the shell sees: 128 plus the signal's number, or the exit status. */
  readonly code: number;
}

/** A handler's own type, which a handler that returns a promise does not satisfy. */
type Synchronous<Returned> = Returned extends PromiseLike<unknown> ? never : Returned;

type OnShutdown = <Returned>(
  handler: (event: ShutdownEvent) => Synchronous<Returned>,
) => () => void;

interface ActionContext<Args, Options = {}, Result = unknown> {
  readonly onShutdown: OnShutdown;
  // ...
}
// MiddlewareContext carries the same member.

// @loomcli/core
export declare const onShutdown: OnShutdown;
```

```ts
import { onShutdown } from '@loomcli/core';

// A spinner library that hides the cursor shows it again however the process ends.
export function hideCursor(stream: NodeJS.WriteStream): () => void {
  const show = () => stream.write('\u001B[?25h');
  stream.write('\u001B[?25l');
  const remove = onShutdown(show);
  return () => {
    remove();
    show();
  };
}
```

`onShutdown(handler)` registers a handler that restores what must not outlive the process, such as raw mode, the cursor, a [child program](../glossary.md#compilation-and-invocation), or a scratch file, and returns a function that removes it.

- **Synchronous by type.** A handler that returns a promise does not compile, so `onShutdown(async () => …)` is a type error. Core calls a handler synchronously and never awaits what it returns. A handler does its restoring at once, as `setRawMode`, `child.kill`, and `rmSync` do, and keeps it short: it runs while the operator waits for the prompt back.
- **When it runs.** Once, at the end of a [shutdown](#the-shutdown), or at the process's own `exit` event, for a normal end, a `process.exit()` call, or an uncaught exception, whichever comes first. Core calls every pending handler newest first, so code that set up last tears down first. The handlers it calls are those pending when it starts calling them: one a handler registers while they run is not called, because the process is ending, and calling it would let a handler that registers another keep the process from ending. `cause` is the ending signal's name, or `'exit'` at the process's own end, and `code` is the status the shell sees: 129, 130, 131, or 143 for a signal, and the exit status otherwise.
- **Scoped to a run.** A handler from an action's or a middleware's `onShutdown` belongs to that run: it is removed when the run ends while no shutdown is under way, so nothing leaks into the next run or the next test. A run's ordinary cleanup is its own `finally`, which also runs within the budget when a shutdown cancels the run. A handler registered after its run has ended is never called.
- **Scoped to the process.** A handler from the exported `onShutdown` stays until the returned function removes it or the process ends. A library and an embedding host, which have no run, use it.
- **Invocation by name.** A call has its own `onShutdown`, scoped to the call. An action's call counts with its run, so its handlers keep core listening. A handler inside `app.invoke` never starts core listening, because `app.invoke` makes no process effect, though a shutdown under way calls it.
- **A handler that fails.** A handler that throws is caught, and the rest still run. A run-scoped handler's throw is an `error` [log event](logging.md), `A shutdown handler failed.`, with the thrown value under `error` and the plugin whose middleware registered it, or `null` for an action's. A process-scoped handler's throw is dropped, because no run is there to log it.

## Suspend and resume

```ts
// @loomcli/core
export declare function onSuspend<Returned>(handler: () => Synchronous<Returned>): () => void;
export declare function onResume<Returned>(handler: () => Synchronous<Returned>): () => void;
```

`SIGTSTP`, which Ctrl-Z sends from a cooked terminal, suspends the process, and `SIGCONT`, which `fg` sends, resumes it.

- **Suspend.** Core calls each suspend handler synchronously, newest first, then removes its `SIGTSTP` listener and raises `SIGTSTP` on its signal source, so the default action stops the process, as the glibc manual describes and vim and less do. A handler restores cooked mode and shows the cursor, as vim and less do before they stop.
- **Resume.** A raise to the process's own self returns once the process continues, so as soon as the raise returns, core listens for `SIGTSTP` again and calls each resume handler in registration order. A handler enters raw mode again and redraws. Where nothing stops the process, the raise returns at once and the resume handlers run right after the suspend handlers: a process in an orphaned process group, which no shell can resume, such as an application that leads its own terminal session under `docker run -it`, `ssh -t`, or `tmux new`, does not stop, and neither does a mock. Either way the next Ctrl-Z suspends again. A `SIGCONT` with no suspend before it calls none.
- **Nothing cancels.** A suspend cancels no run and starts no shutdown.
- **Removal.** Each returns a function that removes the handler, and a handler stays until that function runs or the process ends. Handlers are synchronous by type, as `onShutdown`'s are, and a handler that throws is caught while the rest still run.

## Raw-mode readers

In raw mode the terminal sends a key as a byte instead of a signal, so a reader that reads keys from its signal source's own terminal, `process.stdin` for the real process, raises the signal the key stands for on that signal source through [`host.raise`](host.md#host-facts): `SIGINT` for Ctrl-C (0x03), `SIGQUIT` for Ctrl-\ (0x1c), and `SIGTSTP` for Ctrl-Z (0x1a). A key then means at a question what it means at a cooked terminal: Ctrl-C starts the shutdown, and Ctrl-Z suspends. A reader whose stdin is any other stream, such as one an embedding host gives `processHandle` or a mock's, raises no signal, because the process is not that terminal's, and `host.raise` answers `false`: Ctrl-C and Ctrl-\ call the action's `cancel()`, so the run ends with 130 and the process goes on, and Ctrl-Z does nothing. End of input, stdin closing or Ctrl-D with nothing typed, still ends the run through the action's `cancel()`. Core's own readers follow this rule, the [background query](background.md) and the [prompts library](../libs/prompts.md)'s questions, and so does a reader an author writes.

Core's terminal users restore the terminal through these handlers:

- **A question** leaves raw mode at the abort, registers a run-scoped `onShutdown` handler that leaves raw mode and shows the cursor while it is open, and registers suspend and resume handlers that restore the terminal and redraw the question.
- **A live region** draws its cancelled line at the abort. At the shutdown's end, core writes every region frame still in its write queue straight to the terminal and shows the cursor, so the cancelled line lands even when the budget is 0 or the signal is `SIGQUIT`. A suspend erases the open regions and a resume redraws them.
- **The background query** restores raw mode through an `onShutdown` handler while its read is open, and an interrupt key it reads ends its wait at once, as an abort does.

## Listening

Core listens for a signal only while someone has asked, so a library still installs nothing nobody asked for.

| Core listens for                                               | While                                                                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `SIGINT`, `SIGTERM`, `SIGHUP`, `SIGQUIT`, and the `exit` event | a `run()` is live and no shutdown has cut it off, or an `onShutdown` handler is registered, process-scoped or in such a run whose outermost run is `run()` |
| `SIGTSTP` and `SIGCONT`                                        | an `onSuspend` or `onResume` handler is registered                                                     |

A live `run()` asks from the moment it is called, before its first await, because the application that calls it owns the process for that run, so every run an application starts on argv unwinds within the budget on Ctrl-C, whatever it has open. An `app.invoke` makes no process effect, so it never asks. With none of these, core holds no listener, and every signal has its default effect: the process ends at once with the shell's status, or stops on `SIGTSTP`. Core adds a listener when the first reason appears and removes it when the last one ends, so an Application can run again and a test leaks no listener. A run still live when a shutdown ends has been cut off: it keeps no listener, and neither does a handler it registers afterward, because a listener core added right after its re-raise would catch that re-raise itself. A later `run()` or a handler from the exported `onShutdown` makes core listen again. Core's own terminal users register handlers too, so a question asked or progress drawn inside an `app.invoke` still restores the terminal when a shutdown comes.

- **One lane per signal source.** The handlers and the listeners live in one lane per [signal source](host.md#the-process-handle), and core listens and re-raises on the source of each run's process handle. The real process's source keeps its lane under `globalThis[Symbol.for('loomcli.processLane')]`, shared by every handle `processHandle` builds. The first copy of `@loomcli/core` to load creates it, and every later copy uses the one it finds, so two installed copies listen once and re-raise once. It also holds the real process's one signal source, which every copy's `processHandle` uses, and a `WeakMap` from every other source to its lane, so every copy resolves the same lane for any source and a mock's lane goes once nothing holds the mock. Its shape is a contract across versions of core, and it only grows: no version removes a member or changes what one accepts, and every member takes one object argument, so a later version adds fields beside the earlier ones. A copy that finds the lane lacks a member it would call goes without what that member provides and never creates a second lane. Core's own tests pin the members. A mock's signal source has a lane of its own, so a signal raised on a mock reaches only the runs that hold it, and a shutdown on the real process never reaches them. A handler from the exported `onShutdown`, `onSuspend`, or `onResume` belongs to no run, so it lives in the real process's lane. [ADR-0107](../decisions/0107-a-run-reads-the-process-through-one-process-handle.md) records the decision.
- **Names.** `onShutdown`, `onSuspend`, and `onResume` are exported from `@loomcli/core`, and so are the types `OnShutdown`, `ShutdownEvent`, `Synchronous`, and `CancellationReason`.

## When author code fails

An action, a middleware, or a loader that throws or rejects takes the [ordinary failure path](failures.md#the-ordinary-failure-path), and an author's catch is final under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). Cancellation is the exception, because it is the run's state and not a caught failure: a cancelled run resolves its cancellation code even when code catches the cancellation and returns, since the first cause to abort the run signal fixes the reason and the code. An author's catch decides a failure's outcome, not whether the run was cancelled, and a broken failure view, `onFailure` hook, or destination in a cancelled run is reported as text without changing the code. A handler's failure follows [A handler that fails](#onshutdown).

```ts
type ExitCode = 0 | FailureExitCode | 129 | 130 | 131 | 141 | 143;
```

`ExitCode` is `0`, every code a failure class can declare under [Declared exit codes](failures.md#declared-exit-codes), and the cancellation codes: 129 for `SIGHUP`, 130 for `SIGINT`, a caller abort, and the action's `cancel()`, 131 for `SIGQUIT`, 141 for a closed pipe, and 143 for `SIGTERM`. A consumer that switches exhaustively on it handles that range.
