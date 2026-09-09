---
type: adr
title: ADR-0018 - One run signal carries cancellation, and one slot owner brackets process signals
description: Each run has one private cancellation signal, fed by a caller-supplied AbortSignal or by the single plugin that owns the signals slot. Core installs and removes the process listeners for that owner inside one run, stays cooperative on a first signal, re-raises a repeated one, and resolves 130 or 143.
status: proposed
created: 2026-09-08
modified: 2026-09-08
---

# ADR-0018 - One run signal carries cancellation, and one slot owner brackets process signals

## Context

ADR-0009 says core installs no signal or cleanup handlers. That holds for an embedded run and for tests, and it leaves every command-line application to write its own interrupt handling. Once plugins exist, a spinner, a prompt in raw mode, and a graceful-shutdown policy can each want the same listener, and one process cannot arbitrate three owners after the fact.

Each run creates one private controller and exposes its signal to every middleware and to the action. A caller feeds it through `run({ signal })`, which is the embedding path and keeps ADR-0009's whole-field overrides. An installed plugin feeds it by claiming the signals slot, naming `SIGINT`, `SIGTERM`, or both. The slot has one owner and a second claim fails at build. Core installs the listeners at the start of a run and removes them in the run's cleanup, because only core knows the run bracket, an Application can run again, and a test must leak no listener. With no owner and no run signal, core installs nothing, so ADR-0009 stays true by default.

A first signal aborts the controller with a reason naming the signal. Core keeps awaiting the chain, never ends the process on a first signal, and lets moment-of-signal work such as cursor restoration run in synchronous abort listeners the plugin adds before it changes terminal state. A repeated signal is the force path: core removes its listeners and re-raises, so the default disposition ends the process with the conventional status. A cancelled run resolves 130 for `SIGINT`, 143 for `SIGTERM`, and 130 for a caller-supplied abort, whatever the action did afterward, because a script that sees 0 after an interrupt carries on as if the work finished.

## Considered options

- **Core always installs listeners.** Rejected. A library must not install process listeners for an embedding host or a test that never asked for them.
- **Only the caller owns signals.** Rejected. The earlier design did this because a separate caller adapter existed. Core now captures the host itself, so the caller is the application's own entry script, and every application would repeat the same listener code.
- **Any plugin may install its own listeners.** Rejected. That is the ad hoc arbitration a spinner ends up writing, and it fails when two plugins both need the interrupt.
- **Enter cleanup without waiting for the action.** Rejected. It only worked because a caller was going to kill the process. Core never calls `process.exit()`, so it awaits cooperatively and leaves force to the repeated signal.
- **A per-function cleanup budget.** Rejected. Core awaits cleanup the way it awaits actions.
- **Letting a normal return after cancellation resolve 0.** Rejected. The shell convention reports why the process stopped, and scripts depend on it.

## Consequences

The exit code type gains 130 and 143. ADR-0009's statement that core installs no signal handlers gains the qualification that it installs them only on behalf of a slot owner and only inside one run, and that re-raising a repeated signal is the one way core ends a process. An action that ignores the signal holds the process until a repeated signal or a supervisor ends it.

## Status

Proposed. The record moves to accepted with the code that brackets a run for a slot owner, proves under test that a second claim fails at build and that no listener survives a run, and resolves the cancellation codes.
