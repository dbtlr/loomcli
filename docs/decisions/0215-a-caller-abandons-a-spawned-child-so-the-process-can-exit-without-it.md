---
type: adr
title: ADR-0215 - A caller abandons a spawned child so the process can exit without it
description: The spawn contract's Child gains abandon(), which tells core the caller has stopped waiting for a child. It sends no signal. It unreferences the child, stops forwarding and capturing its output while still draining the output pipes, and closes the pipe into its stdin, so the host process can exit while the child runs. exited settles at once with a new ChildExit kind, abandoned, that carries the output captured until then; a child whose exit the runtime has already reported while a descendant holds its pipes settles as exited with its code. abandon() does nothing once exited has settled, kill and the spawn's signal still act until the child's own exit, and a mock's scripted child settles the same way. Adding the kind breaks an exhaustive switch on kind, code that reads code after ruling out unstarted or error after ruling out exited, and a hand-built process handle, whose children must implement abandon(). It extends ADR-0107's Child programs clause.
status: proposed
created: 2026-11-20
modified: 2026-11-20
---

# ADR-0215 - A caller abandons a spawned child so the process can exit without it

## Context

[ADR-0107](0107-a-run-reads-the-process-through-one-process-handle.md) makes `host.spawn` a run's one way to start a child program. A `Child` has two members: `exited`, which resolves once the child has ended and its streams have closed and never rejects, and `kill(signal)`, which delivers `SIGTERM` by default or `SIGKILL`. An attached child keeps the process alive until it ends, as [the host reference](../core/host.md#child-programs) states.

An application that bounds a child's run waits for a deadline, sends `SIGTERM`, then `SIGKILL`, then waits a bounded time for the exit. A child in an uninterruptible sleep in the kernel, such as one waiting on a hung network file system or a stuck device, does not end on `SIGKILL` until the kernel releases it. The application's bounded wait returns, and it is ready to report the failure and exit. It cannot: the real handle still references the child process and the pipes of its captured streams, so the event loop stays alive until the child ends, which may be never. A child that has exited while a process it started still holds its stdout keeps the host waiting the same way, because `exited` waits for the streams to close.

Detaching does not help. A detached child's streams are ignored, so a caller that must capture the child's output cannot start it detached, and a child already started attached cannot become detached.

The fault is in what Loom ships: core's handle holds the references, and nothing in the contract lets the caller release them. Under [principle 1](../principles.md#1-loom-owns-what-it-ships-the-author-owns-what-they-write), the decision to give up on the child is the author's, and releasing it is Loom's.

## Decision

- **`abandon()`.** `Child` gains `abandon(): void`. It tells core the caller has stopped waiting for the child, so the child no longer keeps the process alive. It sends no signal: `kill` and an abort of the spawn's `signal` still do, and a caller that wants both calls `kill` and then `abandon`.
- **What it releases.** On the real process's handle, `abandon()` releases each connection the host holds to the child, by what that connection is:
  - **The child process** is unreferenced.
  - **An output pipe**, which is every pipe the real handle creates for stdout or stderr: for a `capture` stream, for a `Writable`, and for an `inherit` whose stream is not the process's own, whether core passed the run's stream as a `Writable` or the handle was built with streams of its own, is unpiped from any `Writable`, stops collecting into the exit, and is unreferenced. The host goes on reading it while the host can service the pipe, so no destination's backpressure holds the child, but those bytes reach no stream and no exit. Bytes core handed to a `Writable` before the call stay that stream's to write, and a destination that does not drain them can still hold the process.
  - **The stdin pipe**, which the host holds when the child reads `input` or when `stdin: 'inherit'` pipes a stream that is not the process's own, is unpiped from its source and closed. The source stays open and stays the caller's. Input not yet written to the pipe is dropped, and the child reads the end of its stdin after the bytes the pipe already holds. On Bun, a write that the runtime has already queued on the pipe cannot be cancelled through `node:child_process`: queued input still reaches a child that reads it later, and while the child does not read it, it keeps a Bun process alive until the child reads it or ends. Node.js drops queued input.
  - **A descriptor the child inherits** directly, the process's own stdin, stdout, or stderr, holds no reference in the host, so nothing is released, and the child can still read and write it, the operator's terminal included.
- **The answer.** After `abandon()`, `exited` resolves at once with a new kind:

  ```ts sketch
  type ChildExit =
    | { readonly kind: 'exited'; readonly code: number; readonly stdout: ChildOutput; readonly stderr: ChildOutput }
    | { readonly kind: 'unstarted'; readonly error: Error }
    | { readonly kind: 'abandoned'; readonly stdout: ChildOutput; readonly stderr: ChildOutput };
  ```

  `abandoned` says that the caller stopped waiting, not that the child is running or has ended. `stdout` and `stderr` hold what each captured stream collected until the call, and are empty for a stream that was not captured, as an `exited` answer's are. It carries no `code`. `exited` still always settles and never rejects, and the child's later end changes nothing, because `exited` has settled.
- **A child that has exited.** When the runtime has already reported the child process's exit and its pipes are still open, because a process it started holds them, `abandon()` releases the pipes as above and settles `exited` as `exited` with the child's code and the output captured until the call. The child has exited, so its answer stays the true one. A child whose exit the runtime has not yet reported when the caller calls `abandon()` settles as `abandoned`: the call never waits for an exit.
- **When it does nothing.** `abandon()` does nothing once `exited` has settled, whichever kind settled it, so a child whose streams have closed, a child that never started, and a child already abandoned keep their answer. Calling it twice is harmless. The first settlement wins: a child the runtime has not yet reported as unable to start when the caller abandons it settles as `abandoned`.
- **A detached child.** A detached child already holds no reference and has no captured stream. `abandon()` on one settles `exited` as `abandoned` with empty output, so the call means the same on every child.
- **Signalling after abandoning.** Until the child process's own exit, `kill(signal)` after `abandon()` still delivers its signal, and an abort of the spawn's `signal` still sends `SIGTERM`, while the host runs. The settled answer stays as it is. Delivering a signal does not end a child that handles it or that the kernel holds, which is why a caller abandons it.
- **The mock.** A `mockProcess` scripted child implements `abandon()` the same way: `exited` settles at once as `abandoned` with empty output, because a script delivers its output only with its answer, and whatever the script answers later is discarded and reaches no stream. `abandon()` does not abort the signal the script's call receives, because it sends no signal. Until the script answers, a later `kill` of an ending signal or an abort of the spawn's signal still aborts the script's signal, so a script that waits on it ends, and the settled answer stays `abandoned`.
- **The documents.** The host reference's Child programs section, its example, and the `Child` and `ChildExit` doc comments change with this record, and so do the testing reference's account of a scripted child's `exited` and the examples in the output reference's Lending the terminal and the prompts reference that read `code` after ruling out `unstarted`.

## Considered options

- **`exited` stays pending, or rejects, after `abandon()`.** Rejected. A pending `exited` leaves every awaiting caller hanging, which is the leak in another form, and a rejection breaks ADR-0107's promise that `exited` never rejects, which every caller of `spawn` relies on.
- **`abandon()` sends `SIGKILL` first.** Rejected. A caller abandons a child because `SIGKILL` already failed to end it, and a caller that wants to give up without signalling could not. One method, one effect.
- **Destroy the output pipes in place of draining them.** Rejected. A child that writes to a closed pipe receives `SIGPIPE` from the kernel, which ends most programs, so the call would end the child at once by another route while promising to send no signal. Draining spares the child only while the host runs; see Consequences.
- **Unreference the child process alone.** Rejected. The pipes of its captured streams are handles of their own on the event loop, so the process still cannot exit.
- **An abandoned answer for a child that has exited while a descendant holds its pipes.** Rejected. The child's code is known, and hiding it behind `abandoned` would tell the caller less than core knows.
- **A time limit on `spawn` that abandons by itself.** Rejected. `spawn` sets no time limit, and a caller composes one from `AbortSignal.timeout`, so the caller also owns when to give up.
- **Detach, or a detached child with captured streams.** Rejected. A detached child runs in its own process group so that it outlives the run, and the decision to give up comes after the child has started attached.

## Consequences

Adding `abandoned` to `ChildExit` is a breaking change. An exhaustive `switch` on `kind` no longer compiles until it handles `abandoned`. Code that reads `code` after ruling out `unstarted`, which is the host reference's own pattern, must also rule out `abandoned`, and code that reads `error` after ruling out `exited` must rule it out too. Code that never calls `abandon()` never receives the kind, so the migration is one branch: narrow on `kind === 'exited'` before reading `code`, and on `kind === 'unstarted'` before reading `error`. A hand-built `ProcessHandle`'s `spawn` must return children that implement `abandon()`, as ADR-0107's Consequences state for a required member added to `ProcessHandle`; `processHandle()` and `mockProcess()` return complete children.

The host drains an abandoned child's output pipes only while it runs. Once the host exits, those pipes have no reader, and the child's next write to a captured or piped stream meets a closed pipe, which ends the child when `SIGPIPE` has its default disposition; a child that handles or ignores it gets `EPIPE` and goes on. A child abandoned with ignored output, or with the process's own descriptors inherited, keeps running and writing after the host exits. A job meant to outlive the run starts detached.

An abandoned child that is still running when the host exits is an orphan. It stays in the host's process group, so a Ctrl-C at the terminal still reaches it while that group is the terminal's foreground group.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-20: Proposed with `Child.abandon()` (LM-588). It extends ADR-0107's **Child programs** clause with a third member of `Child` and a third kind of `ChildExit`.
- 2026-11-20: Revised after the contract review (LM-588). Release follows each connection: output pipes are unpiped and drained while the host runs, the stdin pipe is unpiped and closed, with Bun's queued input named as its limit, and directly inherited descriptors stay the child's. A child that has exited while a descendant holds its pipes settles as `exited` with its code. Signalling after `abandon()` follows the child's own exit, not the settling of `exited`, and an abort sends `SIGTERM`. The Consequences state that output pipes close when the host exits, and the migration names every break.
- 2026-11-20: Revised after the delta review (LM-588). A child settles as `exited` only when the runtime has reported its exit by the call. An output pipe is every pipe the real handle creates, `inherit` on a handle's own supplied streams included. Bun's limit is input the runtime has queued, with no fixed size. Draining frees the child from backpressure only while the host services the pipe, and a closed pipe ends a child whose `SIGPIPE` has its default disposition. The documents list names the output and prompts references' examples, and an abort, like `kill`, still signals the child.
