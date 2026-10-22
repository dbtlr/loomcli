---
type: adr
title: ADR-0104 - A closed reader on stdout ends the run with 141
description: When a write to run()'s own stdout fails because its reader closed it, reported as EPIPE, or as ENOTCONN on a macOS socket, core aborts the run signal with the closed-pipe reason, writes no report and no incomplete-result line, and resolves 141, the status the SIGPIPE convention gives. Every other failed write stays a broken destination with exit 1.
status: accepted
created: 2026-10-21
modified: 2026-10-22
---

# ADR-0104 - A closed reader on stdout ends the run with 141

## Context

An operator pipes an application into a reader that stops early, such as `app list | head -1`. Once the reader exits, the next write to the application's stdout fails with `EPIPE`, which Node and Bun both report. Under [ADR-0007](0007-failures-are-public-classes-with-class-keyed-renderers.md), that failure is a broken destination: core writes its fallback report to stderr and returns 1. The operator asked for one line and reads `Something went wrong.` beside it, and a script under `set -o pipefail` sees a failure where nothing failed.

Command-line tools treat a closed reader as the end of the run, not as a defect. A C program such as `yes` dies of `SIGPIPE`, which a shell reports as 141, 128 plus the signal number 13. `git` and Go programs that write to stdout follow the same convention. Node and Bun ignore `SIGPIPE`, so the write fails and the run sees the error instead of ending. Principle 6 has Loom follow the convention, and principle 2 has the operator see no error line for a run that did what the operator asked.

[ADR-0018](0018-one-run-signal-carries-cancellation-and-one-owner-brackets-process-signals.md) already carries every reason a run stops early on its one run signal, and the first cause to abort it fixes the reason and the code.

## Decision

- **Only the run's own stdout.** A write to `run()`'s stdout that fails with the error code `EPIPE` ends the run. A stdout that is a socket, which a parent spawning through libuv hands its child, reports the same closed reader as `ENOTCONN` on macOS when Bun writes it with `send()` after the peer is gone, so that code ends the run too. Detection reads the code, so it holds under Node and Bun alike. A stdout that is also the run's stderr does not end the run this way.
- **A cause of the run signal.** Core aborts the run signal with the `CancellationReason` source `closed-pipe`, whose `cause` is the failed write's error. The first-cause rule of ADR-0018 holds: a pipe that closes after `SIGINT` keeps 130, and `SIGINT` after a closed pipe keeps 141. For a plugin that owns the signals slot, `SIGINT` after a closed pipe takes the existing force path, as after any cause.
- **141, with nothing on stderr.** The run resolves 141 in a distributed and a development build. Core writes no failure report, no incomplete-result line, and no failure event for the closed pipe.
- **Writes reject with the signal's reason.** The write that met the closed pipe and every later stdout write reject with the run signal's reason. An action that awaits a write stops there, and one that lets the rejection propagate stays silent, because a thrown value that is the signal's reason is silent under ADR-0018. A streaming row source stops as it does on any cancellation.
- **A failure reported first keeps its report.** A failure the run reported before the pipe closed keeps its report, and the run still resolves 141, because cancellation outranks every failure code.
- **Every other failed write stays a broken destination.** A closed reader on stderr, and a stdout write that fails with any other error, such as `ENOSPC`, keep ADR-0007's fallback report and exit 1.
- **Captured output is untouched.** An [invocation by name](0059-a-command-runs-by-name-through-invoke.md) captures its output, so it has no pipe. An action's `invoke()` reads its run's closed-pipe reason and resolves `cancelled` with 141.
- **No translator sees it.** The closed pipe's `EPIPE` error is the signal's cause, not a foreign throw, so it is never offered to a translator.
- **The types.** `ExitCode` and a cancelled invocation outcome's `exitCode` gain 141, and the manifest's exit-code table gains its row. 141 is a reserved code, so no failure class declares it.

## Considered options

- **Exit 0 quietly.** Rejected. The run did not finish its output, and a script under `pipefail` cannot tell a truncated run from a complete one.
- **A broken destination with exit 1.** Rejected. It writes an error line for a run that did what the operator asked, and it reads a closed reader as a defect, which no other command-line tool does.
- **141, by the `SIGPIPE` convention.** Chosen. It is the status `git`, `yes`, and Go programs give under `pipefail`, so an operator's script reads it as it reads theirs.

## Consequences

A translator an author wrote for an `EPIPE` error no longer receives a closed stdout pipe's error, so such a run exits 141 in place of the translated class's code. ADR-0007's broken-destination rule narrows to every failed write but a closed reader on the run's stdout. ADR-0018 gains a fourth cause, and [ADR-0095](0095-the-type-bounds-a-declared-exit-code.md) and [ADR-0097](0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md) read 141 among the cancellation codes. ADR-0007 and ADR-0018 carry dated entries.

## Status

Accepted in 0.15.0.

## Changelog

- 2026-10-21: Proposed with the implementation.
- 2026-10-21: Revised before acceptance. `ENOTCONN` joins `EPIPE`, because Bun 1.4.0 on macOS reports a socket stdout's closed reader with it.
