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

Each run creates one private controller and exposes its signal to every middleware and to the action. A caller feeds it through `run({ signal })`, which is the embedding path and keeps ADR-0009's whole-field overrides. An installed plugin feeds it by claiming the signals slot, naming `SIGINT`, `SIGTERM`, or both. The slot has one owner and a second claim fails at build. Core installs the listeners once the graph has built and validated, so a build failure touches the process not at all, and removes them on every exit path of the run, because only core knows the run bracket, an Application can run again, and a test must leak no listener. With no owner and no run signal, core installs nothing, so ADR-0009 stays true by default. This record amends the sentence in ADR-0009 that core installs no signal handlers, and it binds in that sentence's place when it is accepted.

Core subscribes to a caller signal at run entry and honors an abort at every phase boundary. The first cause to abort the controller fixes the reason and the code, and a later cause changes neither. Core keeps awaiting whatever is already running, never ends the process on a first signal, starts nothing new after cancellation, and lets moment-of-signal work such as cursor restoration run in synchronous abort listeners the plugin adds before it changes terminal state. Any process signal that arrives after cancellation is the force path: core removes its own listeners and re-raises, so the default disposition ends the process with the conventional status when no other listener remains. Core does not own the process. A re-raised signal reaches every listener still installed: an embedding host's own listener, and a second run in the same process that owns the slot, which receives it as its own signal and escalates with the first. When a listener outside core keeps the process alive, that run observes no further signals and keeps awaiting. An embedding host that runs several Applications in one process supplies the caller signal and installs no slot owner. A cancelled run resolves 130 for `SIGINT`, 143 for `SIGTERM`, and 130 for a caller-supplied abort, whatever the action did afterward, because a script that sees 0 after an interrupt carries on as if the work finished. Cancellation ranks above a broken failure renderer or destination, which ADR-0007 otherwise turns into 1: a signal is a fact about the run and a broken pipe is a fact about the sink, and `app stream | head -1` followed by an interrupt must still report the interrupt. ADR-0007 carries a dated entry for that ranking, which binds with this record. The published exit code type widens by two members.

## Considered options

- **Core always installs listeners.** Rejected. A library must not install process listeners for an embedding host or a test that never asked for them.
- **Only the caller owns signals.** Rejected. The earlier design did this because a separate caller adapter existed. Core now captures the host itself, so the caller is the application's own entry script, and every application would repeat the same listener code.
- **Any plugin may install its own listeners.** Rejected. That is the ad hoc arbitration a spinner ends up writing, and it fails when two plugins both need the interrupt.
- **Enter cleanup without waiting for the action.** Rejected. It only worked because a caller was going to kill the process. Core never calls `process.exit()`, so it awaits cooperatively and leaves force to the repeated signal.
- **A per-function cleanup budget.** Rejected. Core awaits cleanup the way it awaits actions.
- **Letting a normal return after cancellation resolve 0.** Rejected. The shell convention reports why the process stopped, and scripts depend on it.

## Consequences

The exit code type gains 130 and 143. Re-raising a repeated signal is the one way core takes part in ending a process, and it works only when core's listener was the last one. An action that ignores the signal holds the process until a repeated signal with no other listener, or a supervisor, ends it. A listener that blocks the event loop delays the second signal's handling as it delays everything else.

## Status

Proposed. The record moves to accepted with the code that brackets a run for a slot owner, proves under test that a second claim fails at build and that no listener survives a run, and resolves the cancellation codes.
