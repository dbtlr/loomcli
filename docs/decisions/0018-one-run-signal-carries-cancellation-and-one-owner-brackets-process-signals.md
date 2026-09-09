---
type: adr
title: ADR-0018 - One run signal carries cancellation, and one slot owner brackets process signals
description: Each run has one private cancellation signal, fed by a caller-supplied AbortSignal or by the single plugin that owns the signals slot. Core installs and removes the process listeners for that owner inside one run, stays cooperative on a first signal, re-raises a repeated one, and resolves 130 or 143.
status: accepted
created: 2026-09-08
modified: 2026-09-09
---

# ADR-0018 - One run signal carries cancellation, and one slot owner brackets process signals

## Context

ADR-0009 says core installs no signal or cleanup handlers. That holds for an embedded run and for tests, and it leaves every command-line application to write its own interrupt handling. Once plugins exist, a spinner, a prompt in raw mode, and a graceful-shutdown policy can each want the same listener, and one process cannot arbitrate three owners after the fact.

Each run creates one private controller and exposes its signal to every middleware and to the action. A caller feeds it through `run({ signal })`, which is the embedding path and keeps ADR-0009's whole-field overrides. An installed plugin feeds it by claiming the signals slot, naming `SIGINT`, `SIGTERM`, or both. The slot has one owner and a second claim fails at build. Core installs the listeners once the graph has built and validated, so a build failure touches the process not at all, and removes them on every exit path of the run, because only core knows the run bracket, an Application can run again, and a test must leak no listener. With no owner and no run signal, core installs nothing, so ADR-0009 stays true by default. This record amends the sentence in ADR-0009 that core installs no signal handlers, and it binds in that sentence's place when it is accepted.

Core subscribes to a caller signal at run entry and honors an abort at every phase boundary. The first cause to abort the controller fixes the reason and the code, and a later cause changes neither. Core keeps awaiting whatever is already running, never ends the process on a first signal, starts nothing new after cancellation, and lets moment-of-signal work such as cursor restoration run in synchronous abort listeners the plugin adds before it changes terminal state. Any process signal that arrives after cancellation is the force path: core removes its own listeners and re-raises, so the default disposition ends the process with the conventional status when no other listener remains. Core does not own the process. A re-raised signal reaches every listener still installed: an embedding host's own listener, and a second slot-owning run in the same process, which applies its own rule: not yet cancelled, it cancels and absorbs the signal; already cancelled, it removes its listeners and re-raises in turn. The force path is defined for one slot-owning run per process, and with several the process ends only once no run's listener remains. When a listener outside core keeps the process alive, the run that re-raised observes no further signals and keeps awaiting. A cancelled run resolves its cancellation code whenever it ends after graph build with no declaration or internal failure raised before the chain starts, whether or not the chain was reached; such a failure ends the run with its own code. An embedding host that runs several Applications in one process supplies the caller signal and installs no slot owner. A cancelled run resolves 130 for `SIGINT`, 143 for `SIGTERM`, and 130 for a caller-supplied abort, whatever the action did afterward, because a script that sees 0 after an interrupt carries on as if the work finished. Cancellation ranks above a broken failure renderer or destination, which ADR-0007 otherwise turns into 1: a signal is a fact about the run and a broken pipe is a fact about the sink, and `app stream | head -1` followed by an interrupt must still report the interrupt. ADR-0007 carries a dated entry for that ranking, which binds with this record. The published exit code type widens by two members.

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

Accepted 2026-09-09 with the code that brackets a run for a slot owner, proved under test that a second claim fails at build and that no listener survives a run, and resolved the cancellation codes.

## Changelog

- 2026-09-09: Accepted. The plugin seam landed across pull request 35, pull request 36 (branch `feat/lm-60-plugins`), and the third pull request of LM-60, whose number is not yet assigned. That third pull request implements `run({ signal })`, the private per-run cancellation controller and its `{ source, cause? }` reason, the signals slot with its build-time single-owner and `SIGINT`/`SIGTERM`-only rules, the bracketed process listeners core installs after graph build and removes on every exit path, the force path that re-raises a repeated signal, `ChainOutcome`'s `'cancelled'`, and the widened `ExitCode` (`0 | 1 | 2 | 130 | 143`). `packages/core/tests/plugins.test.ts` proves that a second claim on the signals slot fails at build, that a signal outside `SIGINT` and `SIGTERM` fails at build, and that one signal claimed twice fails at build, because core installs one listener per entry. `packages/core/tests/cancellation.test.ts` proves, under Node and under Bun, that `process.listenerCount` is 0 before a run, 1 per claimed signal during it, and 0 after, including across two runs of one Application; that a `SIGINT` during a cooperative action resolves 130 and a `SIGTERM` resolves 143; that a repeated `SIGINT` ends the process through the default disposition; that a caller abort resolves 130 with `source: 'caller'` and the caller's own reason as `cause`; and that a caller signal already aborted at entry resolves 130 having loaded no plugin and installed no listener. The sentence this record amends in [ADR-0009](0009-core-captures-the-host-and-resolves-an-exit-code.md), "installs no signal or cleanup handlers," now binds as amended: core installs process listeners only on behalf of the one installed plugin that owns the signals slot, only inside one run, and only after the graph has built.
