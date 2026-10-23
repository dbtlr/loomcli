---
description: "The process handle a run reads its facts from and sends its effects to, the facts core copies into the host for each run, and the run that fails when the working directory cannot be read."
---

# Host

## The process handle

```ts
import type { Readable, Writable } from 'node:stream';

import type { Background, ExitCode, InputTerminal, OutputTerminal, ReleaseFacts, RenderingPolicy } from '@loomcli/core';

type ProcessSignal = 'SIGHUP' | 'SIGINT' | 'SIGQUIT' | 'SIGTERM' | 'SIGTSTP' | 'SIGCONT';
type SignalListener<Event extends ProcessSignal | 'exit'> = Event extends 'exit' ? (code: number) => void : () => void;

interface SignalSource {
  readonly terminal: Readable | undefined; // the stdin of the terminal this source's process is attached to
  on<Event extends ProcessSignal | 'exit'>(event: Event, listener: SignalListener<Event>): void;
  off<Event extends ProcessSignal | 'exit'>(event: Event, listener: SignalListener<Event>): void;
  raise(signal: ProcessSignal): void; // delivers the signal to this source's process
}
interface ProcessTerminal {
  readonly stdin: InputTerminal;
  readonly stdout: OutputTerminal; // columns and rows may be getters, read live
  readonly stderr: OutputTerminal;
  readonly background?: Background | undefined; // a stated background settles the run's, with no query
}
interface ProcessHandle {
  readonly argv: readonly string[];
  readonly program: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  cwd(): string; // throws when the working directory cannot be read
  readonly platform: string;
  readonly arch: string;
  readonly libc: 'glibc' | 'musl' | undefined;
  readonly uid: number | undefined;
  readonly timeZone: string;
  readonly release: ReleaseFacts;
  readonly readSource?: (path: string, cwd: string) => string | undefined;
  readonly stdin: Readable;
  readonly stdout: Writable;
  readonly stderr: Writable;
  readonly terminal: ProcessTerminal;
  readonly signals: SignalSource;
  exitCode: ExitCode | undefined; // the one member core writes
  readonly publishEnv?: (name: string, value: string) => void;
}
type ProcessFields = Partial<Omit<ProcessHandle, 'cwd' | 'exitCode' | 'publishEnv' | 'signals'>> & {
  readonly cwd?: string | (() => string);
};

function processHandle(fields?: ProcessFields): ProcessHandle; // the real process, each supplied field replacing its own

interface RunOptions {
  rendering?: RenderingPolicy;
  process?: ProcessHandle;
  signal?: AbortSignal;
}
```

```ts
import { processHandle } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';

import { jsonkit } from './application.js';
import { panel } from './panel.js';

const fixture = new URL('./fixtures/doc', import.meta.url).pathname;

// An embedding host runs jsonkit on its own process, with stdout sent to one of its streams.
await jsonkit.run({ process: processHandle({ argv: ['keys', 'user'], stdout: panel }) });

// A test runs it with nothing taken from the machine, then reads what the run wrote.
const mock = mockProcess({ argv: ['keys', 'user'], cwd: fixture });
await jsonkit.run({ process: mock });
// mock.exitCode is 0, and mock.stdout.text holds the keys.
```

A process handle holds every process fact a run reads and receives every process effect it makes. [ADR-0107](../decisions/0107-a-run-reads-the-process-through-one-process-handle.md) records the decision.

- **One handle per run.** `run({ process })` and `app.invoke(path, values, { process })` bind the handle when the run enters, and core never replaces it during the run. A run given none binds `processHandle()`, and an action's [`invoke`](invocation.md#invocation-by-name) binds its own run's handle.
- **The real process.** `processHandle(fields)` builds a handle over the process it runs in. Each fact it has not been given reads the process at the moment core reads it: `argv` is `process.argv` without the runtime and script prefix, `cwd()` is `process.cwd()`, `arch` is `process.arch`, `libc` is `glibc` or `musl` on Linux, from the runtime's report of a glibc version, and `undefined` elsewhere, and `uid` is `process.getuid()`, or `undefined` on a runtime with none. A supplied field replaces its whole field, so an environment map replaces the process's map rather than merging into it, and an absolute `cwd` string is the working directory, read with no failure. A relative one resolves against the process's working directory each time core reads it, so a process whose own working directory cannot be read fails the run with `WorkingDirectoryError`, as `cwd()` does. It takes no `signals` and no `publishEnv`, which it decides itself. Its `exitCode` writes `process.exitCode`, and its signal source is the real process's, which every handle `processHandle` builds shares.
- **A mock.** `mockProcess(fields)` from [`@loomcli/testing`](../libs/testing.md#mockprocess) builds a handle that reads nothing from the process. Every fact has a fixed default, its streams record what the run writes, and its signal source is its own, so a signal raised on it reaches only the runs that hold it.
- **Facts become the host.** Core copies the handle's facts into the run's [host](#host-facts) at entry, once, apart from the live width and height. Code reads the host, never the handle.
- **Effects.** `run()` writes the handle's `exitCode` once the run's code is final, and `app.invoke` never writes it. Core listens and re-raises on the handle's `signals`, under [Listening](signals.md#listening), and calls `publishEnv` for the variables [environment preparation](plugin-contract.md#environment-preparation) copies out. A handle `processHandle` builds supplies `publishEnv`, which writes `process.env`, only when it was given neither `env` nor `cwd`; a mock supplies none.
- **Only the handle.** Core reads the global `process` only where it builds the real handle. The libraries that run inside a run, `@loomcli/plugins`, `@loomcli/prompts`, and `@loomcli/validators`, and the [`loom` toolchain](../toolchain/README.md) read it nowhere but the places ADR-0107 names. A plugin reads its run's host. Two checks only the real process can answer stay with the real handle. The [background](background.md) query's foreground check applies only when stdin is the real process's own terminal, and for any other stdin core skips it and the query runs whenever its skips allow. The check that a [content input](validation.md#content-inputs)'s path does not resolve to the process's own stdin applies to every run, because a path reaches the real file system whatever the handle.
- **A hand-built handle.** A caller may implement `ProcessHandle` itself. It implements every member, and a required member a later release adds is a breaking change for it, so `processHandle` and `mockProcess` are the ways to build one.
- **Names.** `processHandle` is exported from `@loomcli/core`, and so are the types `ProcessHandle`, `ProcessFields`, `ProcessTerminal`, `SignalSource`, `SignalListener`, `ProcessSignal`, and `RunOptions`.

## Host facts

`run({ signal })` supplies a caller-owned `AbortSignal` that cancels the run, as [Signals, cancellation, and shutdown](signals.md) describes; it is the path for an embedding host or a test, and a [shutdown](signals.md#the-shutdown) aborts the run as well. The run's host holds these facts, copied from its process handle at invocation entry, before graph build, except that terminal width and height are read live.

| Field              | Value                                                         |
| ------------------ | ------------------------------------------------------------- |
| `argv`             | Application tokens without the runtime and script prefix      |
| `program`          | The runtime and script prefix `argv` omits: the words that start this application again; frozen |
| `platform`         | The process's platform string, such as `linux` or `darwin`    |
| `arch`             | The process's CPU architecture, such as `x64` or `arm64`      |
| `libc`             | `glibc` or `musl` on Linux, and `undefined` elsewhere          |
| `uid`              | The process's user ID, or `undefined` on a runtime with none   |
| `cwd`              | Working directory; a `cwd()` read that throws fails the run, under [An unreadable working directory](#an-unreadable-working-directory) |
| `timeZone`         | The operator's IANA time zone, such as `America/New_York`, which a validator reads to place a local time |
| `env`              | Map of environment names to strings or `undefined`            |
| `stdin`            | Node `Readable` connection                                    |
| `stdout`, `stderr` | Node `Writable` connections                                   |
| `terminal`         | Each stream's `isTTY` value, captured once, plus output `columns` and `rows`, which are live readings, and the run's settled [`background`](background.md) |
| `readSource`       | Optional `(path, cwd) => string \| undefined`, one source file for a [Developer Diagnostic](declaration-faults.md#developer-diagnostics) |
| `raise`            | `(signal: 'SIGINT' \| 'SIGQUIT' \| 'SIGTSTP') => boolean`: raises the signal a key read in raw mode stands for on the run's signal source when `stdin` is that source's own terminal and answers `true`, and otherwise raises nothing and answers `false`, under [Raw-mode readers](signals.md#raw-mode-readers) |
| `release`          | The [release facts](release-facts.md) the build baked in, or `{ build: 'source' }` when it baked none, with the installation the [installation record](installation-record.md) holds; frozen |

Each fact comes from the run's handle. The real process's handle reads `timeZone` from the zone `Intl.DateTimeFormat` resolves, which honours `TZ`, and core copies it once per run; no field holds the current time. An invocation by name copies it the same way, and an action's `invoke` keeps its run's. A supplied `env` replaces the process's map. Terminal facts remain independent of supplied streams. Core copies each stream's `isTTY` once, because a stream does not change kind mid-run. The real process's handle backs `host.terminal.stdout.columns`, `host.terminal.stdout.rows`, `host.terminal.stderr.columns`, and `host.terminal.stderr.rows` with a live read of the stream each time they are read, and Node and Bun both update those values when the window resizes. The type stays `number | undefined`, and a missing or zero reading is `undefined`. A supplied `terminal` holds plain numbers, which stay fixed, or its own getters, which are as live as the getters. Core keeps a handle's getter rather than copying its value. [ADR-0086](../decisions/0086-renders-fit-the-destinations-live-columns-and-tables-shrink-to-fit.md) records the decision.

`host.terminal` always holds the handle's reading. The POSIX `COLUMNS` variable in `host.env` never changes it. `COLUMNS` only narrows the `columns` that a view context reports for a destination that is a terminal, as [Width, padding, and multiline lanes](styles.md#width-padding-and-multiline-lanes) states.

Installed [environment preparation](plugin-contract.md#environment-preparation) hooks may add variables after capture and before declared values or inputs validate. Core preserves defined values, including empty strings. An argv run passes each accepted addition to its handle's `publishEnv`, when the handle has one; named invocations never do. A handle `processHandle` builds has one, which writes `process.env`, only when it was given neither `env` nor `cwd`. Other captured facts, including `timeZone` and release facts, remain unchanged.

The environment snapshot is a plain, case-sensitive map on every operating system. Keys retain their original spelling; `Path` and `PATH` are distinct lookups.

The real process's handle reads `program` from the process and the build: a compiled binary reads `[process.execPath]`, because the binary is the whole program, and any other run reads `process.execPath` followed by the absolute path of `process.argv[1]`, the script the runtime ran, or `[process.execPath]` alone when there is none. A run is a compiled binary when the build baked `compiled: true`, which `loom build` bakes for a compile target alone; the release facts do not repeat it. So `[...host.program, ...host.argv]` starts the same application again, without runtime options such as `process.execArgv`, and a [service unit](../plugins/service.md) runs `host.program`. A supplied `program` replaces the whole list, and an `invoke` keeps the outer run's.

The real process's handle reads `release` from the build and the installation record, never from the process's other facts: the facts the build baked into the artifact and, for a compiled binary built with `--release`, the installation the [installation record](installation-record.md) holds, and a supplied `release` replaces them whole, as [Release facts](release-facts.md) states. An action reads its run's build, release, and installation there and nowhere else.

Core copies argv, environment values, and each stream's `isTTY` value, and it reads terminal width and height live. It settles `host.terminal.background` once per run rather than copying it, under [Background](background.md), and a handle's `terminal` may state a background or omit it. It retains the handle's stream connections. Parsing does not modify `host.argv`. Application code owns when content is read. Core probes declared [content inputs](validation.md#content-inputs) and supplies their lazy read methods. Apart from those declared sources, core reads only these: a source file for a defect's findings in a development build, through `readSource`, under the guards [Developer Diagnostics](declaration-faults.md#developer-diagnostics) states; the installation record's `install.json`, under the rules of [Reading the installation](installation-record.md#reading-the-installation); and, for the [background](background.md) query's foreground check only, `/proc/self/stat`, or the output of `ps` for its own process where `/proc` is missing, only when it is about to query a real terminal. Core writes none. The real process's handle supplies `readSource(path, cwd)` as a synchronous read of a UTF-8 file that resolves both paths through symbolic links and answers `undefined` for a file outside `cwd`, for a path that is not a regular file, such as a FIFO or a device, for a file larger than 1 MiB, and for any failure. A supplied `readSource` replaces it like any other field, so a test supplies its own reader, and a reader that always answers `undefined` leaves the findings at the stack location.

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

// The process sits in a directory another process removed, such as a deleted git worktree.
// run() writes `jsonkit: The current working directory cannot be read. Change to a directory that
// exists and run the command again.` to stderr and resolves 1; invoke() resolves failed.
const outcome = await jsonkit.invoke(['keys'], { options: { file: '/srv/doc.json' } });
if (outcome.status === 'failed' && outcome.failure instanceof WorkingDirectoryError) {
  // outcome.form.code is 'working-directory-unreadable', and outcome.exitCode is 1.
}
```

A process whose working directory was removed cannot read it, and the platform's `process.cwd()` throws, so the real process's `cwd()` throws. Core reads the working directory for every run, so the run fails cleanly under one rule, as git does, and neither door rejects with the platform's error.

- **Read once.** `run()` and `app.invoke` call the handle's `cwd()` through one shared step, once per run. When it throws, the run fails with `WorkingDirectoryError` before the graph builds. An absolute `cwd` string given to `processHandle` and any `cwd` string given to `mockProcess` never throw, a relative one given to `processHandle` throws when the process's own working directory cannot be read, a `cwd` function given to either throws as it chooses, so a test reaches the failure in-process, and an action's `invoke` reads its run's `cwd` and calls nothing.
- **The failure.** `WorkingDirectoryError` exits 1, and its [failure code](failures.md#failure-codes) is `working-directory-unreadable`. Its `message` is `The current working directory cannot be read. Change to a directory that exists and run the command again.`, and core's default text opens it with the application name, as it opens a usage error's line. It is an operator failure, not a defect, so both builds print the same bytes. Its `cause` is the value the capture threw.
- **Where it reports.** It is raised before the graph builds, so its `path` is `[]`, no `onFailure` hook runs, and no view override applies, because overrides register at build: core's default text writes it. The [failure view context](failure-views.md#failure-view-context) reads `view` and `mediaType` as `undefined`, so no [failure encoder](failure-views.md#failure-encoders) answers it.
- **No second read.** The failure path writes through the streams and terminal facts the run copied from its handle and reads no fact from the handle again, apart from the live width and height behind `host.terminal`. `run()` resolves 1 and writes 1 to the handle's `exitCode`. `app.invoke` resolves `failed` with exit 1, the failure, its [failure form](failures.md#the-failure-form), and the line in `messages`.
- **Names.** `WorkingDirectoryError` is exported from `@loomcli/core`.
