---
type: adr
title: ADR-0009 - Core captures the host itself, accepts whole-field overrides, and resolves an exit code
description: run() snapshots the process, replaces any supplied host field entirely, uses Node streams in its public contract, never calls process.exit, never rejects, and may run the same Application again.
status: accepted
created: 2026-09-07
modified: 2026-09-08
---

# ADR-0009 - Core captures the host itself, accepts whole-field overrides, and resolves an exit code

## Context

The boundary between core and the process decides how an application is tested, embedded, and run.

`run(options?)` captures host facts at entry: argument tokens, working directory, environment, the standard streams, and terminal facts. A supplied `host` override replaces its whole field; a supplied environment map replaces the captured map rather than merging into it. Core copies argv, environment values, and terminal facts, retains the supplied stream connections, and never modifies `host.argv`. The environment snapshot is a plain case-sensitive map on every operating system.

The public contract uses Node `Readable` and `Writable` for the streams. `run()` resolves `Promise<ExitCode>` and sets `process.exitCode`; it never rejects, never calls `process.exit()`, consumes no stdin, and installs no signal or cleanup handlers. An Application can run again, and each run captures the host and builds the graph anew.

## Considered options

- **A caller-built invocation request, with core never probing the host.** Rejected. It was the earlier specification's rule. An ordinary application would have to construct a request to run at all, and the common case must be `await app.run()`.
- **Merging a supplied environment into the captured one.** Rejected. Whole-field replacement is predictable in tests; a merge hides which values came from the process.
- **WHATWG streams in the public contract.** Rejected for now. They make byte payloads explicit but need conversion at the process boundary and raise reader-lock ownership questions. The first consumers are process CLIs that already hold Node streams.
- **Exposing an error object or a status callback from `run()`.** Rejected. Failures reach the caller through the output path and the exit code, so an embedding host observes one result whichever way the invocation failed.
- **Forbidding graph reuse.** Rejected. The earlier specification prohibited a second run. Removing the guard costs nothing and does not commit core to a cached or long-lived service runtime.

## Consequences

Application code owns file access and stdin reads. Tests drive a real Application through `run({ host })` with captured streams, and the built examples run as real processes under Node and Bun.

## Changelog

- 2026-09-08: ADR-0018 qualifies the signal sentence. Core still installs no signal or cleanup handlers of its own, and `run()` still never calls `process.exit()`. With the plugin contract, core installs process listeners only on behalf of the one installed plugin that owns the signals slot, only for the duration of one run, and it re-raises a repeated signal so the default disposition ends the process. `run({ signal })` joins the run options as the caller-owned cancellation path, and the exit code set gains 130 and 143. The decision is unchanged.
