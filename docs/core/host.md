---
description: "What core reads from the host: the working directory, the environment, and the streams."
---

# Host

`run({ host: partialHost })` overrides selected host fields. Omitted fields use process capture at invocation entry, before graph build, except that terminal width and height are read live. `run({ signal })` supplies a caller-owned `AbortSignal` that cancels the run, as [Signals and cancellation](signals.md) describes; it is the path for an embedding host or a test, and it composes with an installed signals owner. A `signal` slot holding a value that is not an `AbortSignal` is a defect reported before the graph is built, under `@loomcli/core/run-options`, whose sentence is `run() received a signal that is not an AbortSignal.` and whose correction is `Supply the signal of an AbortController.`, rendered by build under [Development builds](release-facts.md#development-builds), and the run returns 1.

| Field              | Value                                                         |
| ------------------ | ------------------------------------------------------------- |
| `argv`             | Application tokens without the runtime and script prefix      |
| `program`          | The runtime and script prefix `argv` omits: the words that start this application again; frozen |
| `platform`         | Captured process platform string, such as `linux` or `win32` |
| `cwd`              | Working directory; a capture that throws fails the run, under [An unreadable working directory](#an-unreadable-working-directory) |
| `timeZone`         | The operator's IANA time zone, such as `America/New_York`, which a validator reads to place a local time |
| `env`              | Map of environment names to strings or `undefined`            |
| `stdin`            | Node `Readable` connection                                    |
| `stdout`, `stderr` | Node `Writable` connections                                   |
| `terminal`         | Each stream's `isTTY` value, captured once, plus output `columns` and `rows`, which are live readings, and the run's settled [`background`](background.md) |
| `readSource`       | Optional `(path, cwd) => string \| undefined`, one source file for a [Developer Diagnostic](declaration-faults.md#developer-diagnostics) |
| `release`          | The [release facts](release-facts.md) the build baked in, or `{ build: 'source' }` when it baked none, with the installation the [installation record](installation-record.md) holds; frozen |

An override replaces its whole field. Process capture reads `timeZone` once per run from the zone `Intl.DateTimeFormat` resolves, which honours `TZ`, and no field holds the current time. An invocation by name captures it the same way, and an action's `invoke` keeps its run's. An environment override replaces the captured map. Terminal facts remain independent of stream overrides. Process capture reads each stream's `isTTY` once, because a stream does not change kind mid-run. It backs `host.terminal.stdout.columns`, `host.terminal.stdout.rows`, `host.terminal.stderr.columns`, and `host.terminal.stderr.rows` with a live read of the stream each time they are read, and Node and Bun both update those values when the window resizes. The type stays `number | undefined`, and a missing or zero reading is `undefined`. A supplied terminal override supplies plain numbers, which stay fixed, or its own getter, which is as live as the getter. Core keeps a supplied getter rather than copying its value. [ADR-0086](../decisions/0086-renders-fit-the-destinations-live-columns-and-tables-shrink-to-fit.md) records the decision.

`host.terminal` always holds the real reading, or the value the override supplied. The POSIX `COLUMNS` variable in `host.env` never changes it. `COLUMNS` only narrows the `columns` that a view context reports for a destination that is a terminal, as [Width, padding, and multiline lanes](styles.md#width-padding-and-multiline-lanes) states.

Installed [environment preparation](plugin-contract.md#environment-preparation) hooks may add variables after capture and before declared values or inputs validate. Core preserves defined values, including empty strings. Only argv runs with neither `host.cwd` nor `host.env` overridden copy accepted additions to `process.env`; named invocations never do. Other captured facts, including `timeZone` and release facts, remain unchanged.

The environment snapshot is a plain, case-sensitive map on every operating system, including Windows. Keys retain their original spelling; `Path` and `PATH` are distinct lookups. It does not retain the Windows `process.env` object's case-insensitive lookup.

Core captures `program` from the process and the build: a compiled binary reads `[process.execPath]`, because the binary is the whole program, and any other run reads `process.execPath` followed by the absolute path of `process.argv[1]`, the script the runtime ran, or `[process.execPath]` alone when there is none. A run is a compiled binary when the build baked `compiled: true`, which `loom build` bakes for a compile target alone; the release facts do not repeat it. So `[...host.program, ...host.argv]` starts the same application again, without runtime options such as `process.execArgv`, and a [service unit](../plugins/service.md) runs `host.program`. A `program` override replaces the whole list, and an `invoke` keeps the outer run's.

Core reads `release` from the build and the installation record, never from the process: process capture reads the facts the build baked into the artifact and, for a compiled binary built with `--release`, the installation the [installation record](installation-record.md) holds, and a `release` override replaces them whole, as [Release facts](release-facts.md) states. An action reads its run's build, release, and installation there and nowhere else.

Core copies argv, environment values, and each stream's `isTTY` value, and it reads terminal width and height live. It settles `host.terminal.background` once per run rather than capturing it, under [Background](background.md), and `RunOptions.host` takes the `HostOverrides` type, whose `terminal` may omit `background`. It retains the supplied stream connections. Parsing does not modify `host.argv`. Application code owns when content is read. Core probes declared [content inputs](validation.md#content-inputs) and supplies their lazy read methods. Apart from those declared sources, core reads only these: a source file for a defect's findings in a development build, through `readSource`, under the guards [Developer Diagnostics](declaration-faults.md#developer-diagnostics) states; the installation record's `install.json`, under the rules of [Reading the installation](installation-record.md#reading-the-installation); and, for the [background](background.md) query's foreground check only, `/proc/self/stat`, or the output of `ps` for its own process where `/proc` is missing, only when it is about to query a real terminal. Core writes none. Process capture supplies `readSource(path, cwd)` as a synchronous read of a UTF-8 file that resolves both paths through symbolic links and answers `undefined` for a file outside `cwd`, for a path that is not a regular file, such as a FIFO or a device, for a file larger than 1 MiB, and for any failure. An override replaces it like any other field, so a test supplies its own reader, and a reader that always answers `undefined` leaves the findings at the stack location.

The public declarations include Node stream types. The package supplies their type dependency and an explicit declaration reference. Core exports the `Host` and `Out` types, so a helper extracted out of an action, such as a reader that opens a file or `host.stdin`, states its own parameters without reading them back off the action context.

## An unreadable working directory

```ts
class WorkingDirectoryError extends LoomError {
  static override readonly code: string; // 'working-directory-unreadable'; the exit code is LoomError's 1
  constructor(options?: ErrorOptions); // the message is fixed
}
```

```ts
import { WorkingDirectoryError } from '@loomcli/core';

import { jsonkit } from './application.js';

// The host process sits in a directory another process removed, such as a deleted git worktree.
// run() writes `jsonkit: The current working directory cannot be read. Change to a directory that
// exists and run the command again.` to stderr and resolves 1; invoke() resolves failed.
const outcome = await jsonkit.invoke(['keys'], { options: { file: '/srv/doc.json' } });
if (outcome.status === 'failed' && outcome.failure instanceof WorkingDirectoryError) {
  // outcome.form.code is 'working-directory-unreadable', and outcome.exitCode is 1.
}
```

A process whose working directory was removed cannot read it, and the platform's `process.cwd()` throws. Core captures the working directory for every run, so the run fails cleanly under one rule, as git does, and neither door rejects with the platform's error.

- **Captured once.** `run()` and `app.invoke` capture `cwd` through one shared step, once per run. When the read throws, the run fails with `WorkingDirectoryError` before the graph builds. A `host.cwd` override replaces the capture, so it never meets the failure, and an action's `invoke` reads its run's `cwd` and captures nothing.
- **The failure.** `WorkingDirectoryError` exits 1, and its [failure code](failures.md#failure-codes) is `working-directory-unreadable`. Its `message` is `The current working directory cannot be read. Change to a directory that exists and run the command again.`, and core's default text opens it with the application name, as it opens a usage error's line. It is an operator failure, not a defect, so both builds print the same bytes. Its `cause` is the value the capture threw.
- **Where it reports.** It is raised before the graph builds, so its `path` is `[]`, no `onFailure` hook runs, and no view override applies, because overrides register at build: core's default text writes it. The [failure view context](failure-views.md#failure-view-context) reads `view` and `mediaType` as `undefined`, so no [failure encoder](failure-views.md#failure-encoders) answers it.
- **No second capture.** The failure path writes through the streams and terminal facts the same capture read, or their overrides, and reads no host field from the process again, apart from process capture's live width and height behind `host.terminal`. `run()` resolves 1 and sets `process.exitCode` to 1. `app.invoke` resolves `failed` with exit 1, the failure, its [failure form](failures.md#the-failure-form), and the line in `messages`.
- **Names.** `WorkingDirectoryError` is exported from `@loomcli/core`.

### An unreadable working directory acceptance

An unreadable working directory is proven when public APIs alone produce these results under Node and Bun:

- **Both builds.** A process test removes its working directory and runs jsonkit's bundle and jsonkit's source with `keys -f <absolute path>`. Each writes exactly `jsonkit: The current working directory cannot be read. Change to a directory that exists and run the command again.` and one newline to stderr, writes nothing to stdout, prints no stack, and exits 1. The same run with `--format json` on `paths` writes the same text line.
- **Embedding.** `jsonkit.invoke(['keys'], …)` from a removed directory resolves `failed` with exit 1, a `WorkingDirectoryError`, the form `{ code: 'working-directory-unreadable', exitCode: 1, message, hints: [] }`, and the line in `messages`, and never rejects.
- **Overrides.** `run({ host: { cwd } })` and `app.invoke` with `host: { cwd }` from a removed directory complete, and an action's `invoke` in such a run completes with its run's `cwd`.
- **The class.** `WorkingDirectoryError.code` reads `working-directory-unreadable` and `WorkingDirectoryError.exitCode` reads 1 without an instance.
