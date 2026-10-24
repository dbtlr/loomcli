---
type: adr
title: ADR-0107 - A run reads the process through one process handle
description: Every run binds one process handle at entry and never replaces it. The handle holds every process fact core reads and receives every process effect core makes, core reads the global process only where it builds the real handle, and run() and app.invoke take { process } in place of host overrides. @loomcli/testing builds a sealed mock handle, and signals reach only the runs whose handle shares the signal source.
status: proposed
created: 2026-10-24
modified: 2026-10-24
---

# ADR-0107 - A run reads the process through one process handle

## Context

[ADR-0009](0009-core-captures-the-host-and-resolves-an-exit-code.md) has `run()` capture the host from the process and accept whole-field overrides, and [ADR-0059](0059-a-command-runs-by-name-through-invoke.md) gives `app.invoke` five of those overrides. Every field a caller omits falls back to the process the run happens to be in. So a test that states `argv` alone reads the developer's `NO_COLOR`, `COLUMNS`, `HOME`, and every bound variable, and the real stdin, terminal facts, platform, and time zone, and its result changes with the machine. Loom's own process-test helper strips a list of known variables before each child starts for that reason.

Core also reaches the process directly, outside the host. `run()` writes `process.exitCode`, core's signal listeners and re-raise act on the global `process`, environment preparation writes `process.env`, and first-party code reads `process.getuid()`, `process.arch`, and `process.report`. A host override cannot reach any of these, so none of them can be stated by a test, and an in-process test changes the exit status of the test runner's own worker.

Replacing the global `process` in a test does not answer it. The test runner lives in the same worker and writes to the same `process`, the only practical replacement is a runner's own stubbing API, which a runner-neutral testing package cannot depend on, and tests running concurrently in one worker share the one global.

## Decision

- **One process handle per run.** A process handle holds every process fact core reads and receives every process effect core makes. `run({ process })` and `app.invoke(path, values, { process })` bind one handle when the run enters, and core never replaces it during the run. A run given none binds the real process's handle, and an action's `invoke` binds its own run's.
- **The facts.** The handle holds `argv`, `program`, `env`, a `cwd()` read that throws when the working directory cannot be read, `platform`, `arch`, `libc`, `uid`, `timeZone`, `release`, an optional `readSource`, the three streams, and their terminal facts. Core copies them into the run's Host at entry, as ADR-0009 captures them today, and the Host gains `arch`, `libc`, `uid`, and `raise`. Terminal width and height stay live reads, as [ADR-0086](0086-renders-fit-the-destinations-live-columns-and-tables-shrink-to-fit.md) states, through the handle's terminal facts.
- **The effects.** The handle's `exitCode` is the one member core writes, and `run()` writes it once the run's code is final; `app.invoke` never does. The handle's `signals` is the signal source core listens on and re-raises on, and its `exit` event is the process's own end. An optional `publishEnv` receives the variables environment preparation copies out, under [ADR-0084](0084-dotenv-prepares-an-allowlisted-environment-before-inputs.md).
- **Core reads the global `process` in one module.** That module builds the real process's handle. Every other read of a process fact and every process effect goes through the run's handle, in core and in the libraries that run inside an author's run: `@loomcli/plugins`, `@loomcli/prompts`, and `@loomcli/validators`, in `@loomcli/testing`, whose mock reads nothing from the process, and in the `loom` toolchain, an Application Loom ships. A repository lint rule bans the `process` global in their source. The exceptions are named in the rule's configuration: the configuration plugin's guard of the YAML library's debug variables, which must touch the global because the library reads it; the toolchain's application reader, which is its own child program; and the toolchain's Bun signal forwarding, until it moves onto `onShutdown`.
- **`processHandle(fields)` builds the real process's handle.** `@loomcli/core` exports it. A supplied field replaces its whole field, apart from `signals` and `publishEnv`, which it does not take, as ADR-0009's overrides do, so an environment map replaces the process's map rather than merging into it. Every handle it builds shares the real process's signal source, writes `exitCode` to `process.exitCode`, and supplies `publishEnv`, which writes `process.env`, only when neither `env` nor `cwd` was supplied.
- **`mockProcess(fields)` builds a sealed handle.** `@loomcli/testing` exports it. Every fact has a fixed default that reads nothing from the process, a supplied field replaces its default, the streams record what a run writes, and the handle has a signal source of its own. Its defaults and members are stated in the [testing reference](../libs/testing.md#mockprocess). A test runs an Application through `app.run({ process: mockProcess(...) })` and reads the mock, so the package adds no second way to run one.
- **One lane per signal source.** [ADR-0106](0106-a-signal-ends-the-process-within-one-bounded-shutdown.md)'s lane belongs to a signal source, not to the process. The real process's source keeps its lane under `globalThis[Symbol.for('loomcli.processLane')]`, shared by every copy of core and every handle `processHandle` builds, so one process still listens once and re-raises once. That global object also holds the real process's one signal source, which every copy's `processHandle` uses, and a `WeakMap` from every other source to its lane, so every copy of core resolves the same lane for any source and a mock's lane goes once nothing holds the mock. A mock's source has a lane of its own, so a signal raised on a mock reaches only the runs that hold it, and a shutdown on the real process never reaches them. A `run()` asks its source's lane to listen from the moment it is called, before its first await.
- **A raw-mode reader raises through the host.** A reader that reads keys in raw mode calls `host.raise(signal)` for the key it read. It raises the signal on the run's signal source when `host.stdin` is that source's own terminal, `process.stdin` for the real process, and answers `true`; for any other stdin, a mock's included, it raises nothing and answers `false`, and the reader cancels the run as ADR-0106 states. So the prompts library and an author's reader follow the rule without reading the handle.
- **Checks only the real process can answer.** Two checks read the real process and live in the module that builds the real handle. The background query's check that the process is in its terminal's foreground applies when the run's stdin is a real terminal stream, a terminal device of the process such as `process.stdin` or a stream opened on `/dev/tty`, whatever the handle; for any other stdin, such as a mock's, there is no job control to compare, so core skips the check and the query runs whenever [ADR-0092](0092-core-settles-each-runs-background-once-and-a-theme-entry-may-adapt-to-it.md)'s skips allow it. The check that a content input's path in an invocation by name does not resolve to the process's own stdin, macOS's included, applies to every such call, whatever its handle, because a path reaches the real file system.
- **What goes.** `RunOptions.host`, the `HostOverrides` type, and `app.invoke`'s `host` option. `RunOptions` keeps `rendering` and `signal`.

## Considered options

- **Keep host overrides and add sealed defaults in the testing package.** Rejected. The direct reads of `process.exitCode`, signals, `getuid`, and the architecture stay out of reach, and two ways remain to give a run its facts.
- **Replace the global `process` in tests.** Rejected, for the reasons in the context: the runner shares it, only a runner-specific API replaces it, and concurrent tests share it.
- **Keep `host` beside `process`, applied on top of the handle.** Rejected. Two places would set the same fact, and their precedence would need its own rule.
- **A run entry in the testing package that wraps `run()` and returns the exit code and captured streams.** Rejected. It is a second way to run an Application, and everything the mock gains, such as raising a signal, would have to be threaded through the entry's options.
- **One lane per process for every handle.** Rejected. A signal a test raises on a mock would shut down every run in the worker, and the real process's shutdown would reach a test's runs.
- **One lane per handle object.** Rejected. Two handles `processHandle` built over the same process would each listen on it and each re-raise.
- **The real machine's platform, time zone, and working directory as the mock's defaults.** Rejected. The test's result would change with the machine, which is the leak the handle removes.

## Consequences

Every fact and effect of a run can be stated, so a test runs in the test's own process with nothing taken from the machine, and the shutdown, `onShutdown` order, and re-raise of ADR-0106 are testable in-process through a mock's signal source. A real signal on a real terminal, a pseudo-terminal, a real shell, and a process's own exit status remain what a process test proves, under [ADR-0103](0103-process-acceptance-comes-from-looms-own-pipeline-and-the-packed-consumer.md).

Removing `RunOptions.host`, `HostOverrides`, and `app.invoke`'s `host` is a breaking change with a migration: `run({ host: fields })` becomes `run({ process: processHandle(fields) })`, and a test that wants nothing from the machine uses `mockProcess(fields)` instead. `ProcessHandle` is a type a caller may implement by hand, so a required member a later release adds to it is breaking for such a caller; `processHandle` and `mockProcess` build complete handles. Adding `arch`, `libc`, `uid`, and `raise` to the Host is not breaking, because core builds the Host.

ADR-0009, ADR-0051, ADR-0059, ADR-0065, ADR-0071, ADR-0084, ADR-0086, ADR-0089, ADR-0092, ADR-0102, ADR-0103, and ADR-0106 carry dated entries naming what this record changes in each.

## Status

Proposed. It moves to accepted with the release that ships the process handle, `processHandle`, and `mockProcess`, once the lint rule holds over the six packages with only the named exceptions, and a mock's run is proven to read nothing from the test's process under Node and Bun.

## Changelog

- 2026-10-24: Proposed.
