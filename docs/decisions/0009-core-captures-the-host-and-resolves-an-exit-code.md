---
type: adr
title: ADR-0009 - Core captures the host itself, accepts whole-field overrides, and resolves an exit code
description: run() snapshots the process, replaces any supplied host field entirely, uses Node streams in its public contract, never calls process.exit, never rejects, and may run the same Application again.
status: accepted
created: 2026-09-07
modified: 2026-10-07
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

- 2026-09-08: ADR-0018, proposed, amends the sentence "installs no signal or cleanup handlers" and binds in its place when it is accepted. Until then this record binds as written. Under the amendment, core still installs no handlers of its own and `run()` still never calls `process.exit()`; core installs process listeners only on behalf of the one installed plugin that owns the signals slot, only inside one run and only after the graph has built, and it re-raises a repeated signal so that the default disposition ends the process when no other listener remains. `run({ signal })` joins the run options as the caller-owned cancellation path, and the exit code set gains 130 and 143. Host capture, whole-field overrides, and exit-code resolution are unchanged.
- 2026-09-09: ADR-0018 is accepted. The entry above binds as written, and the amended sentence now governs in the original's place.
- 2026-09-29: [ADR-0051](0051-a-developer-diagnostic-teaches-the-author-what-broke-and-how-to-fix-it.md), proposed, adds one optional host field, `readSource`, which process capture supplies as a synchronous UTF-8 read and a host override may replace. Core calls it only in a development build, only while it reports a defect, and only for a file whose resolved path lies under `host.cwd`, to print the author's source lines. Application code still owns every other file access. [ADR-0050](0050-a-packet-built-into-the-application-says-whether-it-is-in-development.md) gives the Application a `packet` option, a build fact, and core reads no environment variable or process property to learn the build. Both bind when accepted.
- 2026-09-30: [ADR-0050](0050-a-packet-built-into-the-application-says-whether-it-is-in-development.md) is accepted, so the `packet` option in the entry above binds with ADR-0051.
- 2026-10-05: [ADR-0059](0059-a-command-runs-by-name-through-invoke.md), proposed, leaves `run()` as this record states it: it captures the host, accepts whole-field overrides, resolves an exit code alone, and sets `process.exitCode`. An embedding host that wants a structured outcome calls `invoke()` instead, which runs one Command by name, captures what it writes, and resolves `completed`, `failed`, or `cancelled`. That outcome is the one result this record's rejected option protects: a failed call still reports one outcome whichever way it failed. `app.invoke()` captures `env`, `cwd`, `platform`, and `readSource` as `run()` does, or takes whole-field overrides of those four, and an invocation by name installs no listener, sets no `process.exitCode`, and touches no real stdio. It binds when that record is accepted.
- 2026-10-06: Host capture fails a run cleanly when the working directory cannot be read, as the [unreadable working directory](../core.md#an-unreadable-working-directory) contract states. `run()` and `app.invoke()` capture `cwd` once per run in one shared step, and a throwing capture fails the run with the core failure class `WorkingDirectoryError`, failure code `working-directory-unreadable`, exit 1, and the sentence `<app>: The current working directory cannot be read. Change to a directory that exists and run the command again.`, the same bytes in both builds. The failure path reuses that capture and reads no host field from the process again, so `run()` resolves 1 and `app.invoke()` resolves `failed`. A `host.cwd` override skips the capture, and an action's `invoke` reads its run's `cwd`. `Host.cwd` stays a required string: warning and continuing with no working directory was rejected, because the configuration plugin's lookup, the path validator, and an author's `resolve(host.cwd)` have no meaning without it. This record's override and exit code rules are unchanged.
- 2026-10-07: [ADR-0065](0065-release-facts-on-the-host-say-how-the-running-application-was-built.md), proposed, adds one host field, `release`, the frozen release facts. Host capture fills it for `run()` and `app.invoke` from the define the build baked, never from the process, and reads `{ build: 'source' }` when the build baked none. A whole-field override replaces it as any host field, which is how a test supplies facts, and an action's `invoke` reads its run's facts. A malformed baked value fails the run before the graph builds, under `@loomcli/core/invalid-release-facts`, with exit 1. The `packet` option the 2026-09-29 entry names is removed. It binds when that record is accepted.
