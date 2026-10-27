---
description: "The process handle a run reads its facts from and sends its effects to, the facts core copies into the host for each run, the child programs a run starts through it, and the run that fails when the working directory cannot be read."
---

# Host

## The process handle

```ts
import type { Readable, Writable } from 'node:stream';

import type {
  Background,
  Child,
  ExitCode,
  InputTerminal,
  OutputTerminal,
  ReleaseFacts,
  RenderingPolicy,
  SpawnOptions,
} from '@loomcli/core';

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
  readonly home: string; // the operator's home folder
  readonly tmpdir: string; // the folder for temporary files
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
  // starts a child program, under Child programs; core fills cwd and env from the run when the caller left them out
  spawn(
    command: string,
    args: readonly string[],
    options: SpawnOptions & { readonly cwd: string; readonly env: Readonly<Record<string, string | undefined>> },
  ): Child;
  exitCode: ExitCode | undefined; // the one member core writes
  readonly publishEnv?: (name: string, value: string) => void;
}
type ProcessFields = Partial<Omit<ProcessHandle, 'cwd' | 'exitCode' | 'publishEnv' | 'signals' | 'spawn'>> & {
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
- **The real process.** `processHandle(fields)` builds a handle over the process it runs in. Each fact it has not been given reads the process at the moment core reads it: `argv` is `process.argv` without the runtime and script prefix, `cwd()` is `process.cwd()`, `arch` is `process.arch`, `libc` is `glibc` or `musl` on Linux, from the runtime's report of a glibc version, and `undefined` elsewhere, `uid` is `process.getuid()`, or `undefined` on a runtime with none, `home` is the handle's `env.HOME` when it is set and absolute, and otherwise the home the user database holds for the process's user, which is `os.homedir()`'s fallback, or the empty string when there is none; under Bun, for a user the local database does not list, the `HOME` the process started with, and `tmpdir` is the handle's `env.TMPDIR` when it is set and absolute, and otherwise `/tmp`, on Linux and macOS alike, so the machine's `TMP` and `TEMP` never reach a run whose `env` was supplied. A supplied field replaces its whole field, so an environment map replaces the process's map rather than merging into it, and `home` and `tmpdir` follow the supplied map, so `processHandle({ env: { HOME: '/srv/notes' } })` has the home `/srv/notes`. A supplied `home` or `tmpdir` wins over the environment. An absolute `cwd` string is the working directory, read with no failure. A relative one resolves against the process's working directory each time core reads it, so a process whose own working directory cannot be read fails the run with `WorkingDirectoryError`, as `cwd()` does. It takes no `signals`, no `spawn`, and no `publishEnv`, which it decides itself. Its `exitCode` writes `process.exitCode`, its `spawn` starts a real child program, and its signal source is the real process's, which every handle `processHandle` builds shares.
- **A mock.** `mockProcess(fields)` from [`@loomcli/testing`](../libs/testing.md#mockprocess) builds a handle that reads nothing from the process. Every fact has a fixed default, its streams record what the run writes, and its signal source is its own, so a signal raised on it reaches only the runs that hold it. A mock given `terminal.keys` has a keyboard for stdin, the terminal of its own signal source, which answers a question's reads from the test's scripted keys.
- **Facts become the host.** Core copies the handle's facts into the run's [host](#host-facts) at entry, once, apart from the live width and height and `libc`, which core copies the first time the run's code reads `host.libc`, once per run, because the real process reads it from the runtime's report. Code reads the host, never the handle.
- **Effects.** `run()` writes the handle's `exitCode` once the run's code is final, and `app.invoke` never writes it. Core listens and re-raises on the handle's `signals`, under [Listening](signals.md#listening), calls `publishEnv` for the variables [environment preparation](plugin-contract.md#environment-preparation) copies out, and calls `spawn` for each [child program](#child-programs) code starts through `host.spawn`. A handle `processHandle` builds supplies `publishEnv`, which writes `process.env`, only when it was given neither `env` nor `cwd`; a mock supplies none.
- **Only the handle.** Core reads the global `process`, calls `os.homedir()`, `os.userInfo()`, and `os.tmpdir()`, and imports `node:child_process` only where it builds the real handle. The libraries that run inside a run, `@loomcli/plugins`, `@loomcli/prompts`, and `@loomcli/validators`, [`@loomcli/testing`](../libs/testing.md#mockprocess), and the [`loom` toolchain](../toolchain/README.md) do none of these but in the places ADR-0107 names, and a repository lint rule holds them to it. A plugin reads its run's host. An application's own source is held to the same rule by the [`host-bypass`](../libs/eslint-plugin.md#host-bypass) lint rule. Two checks only the real process can answer stay with the real handle. The [background](background.md) query's foreground check applies when stdin is a real terminal stream, a terminal device of the process such as `process.stdin` or a stream opened on `/dev/tty`, and for any other stdin, such as a mock's, core skips it and the query runs whenever its skips allow. The check that a [content input](validation.md#content-inputs)'s path in an invocation by name does not resolve to the process's own stdin applies to every such call, whatever its handle, because a path reaches the real file system.
- **What the handle leaves out.** The handle owns a process's facts, its effects, and the child programs it starts. Clocks, timers, randomness, the network, and the file system stay outside it, so a run reads the time and touches files as any code does, and a mock seals none of them. `tmpdir` names a folder and creates nothing.
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
| `home`             | The operator's home folder, such as `/home/me`, under [The home and temporary folders](#the-home-and-temporary-folders) |
| `tmpdir`           | The folder for temporary files, such as `/tmp`                 |
| `timeZone`         | The operator's IANA time zone, such as `America/New_York`, which a validator reads to place a local time |
| `env`              | Map of environment names to strings or `undefined`            |
| `stdin`            | Node `Readable` connection                                    |
| `stdout`, `stderr` | Node `Writable` connections                                   |
| `terminal`         | Each stream's `isTTY` value, captured once, plus output `columns` and `rows`, which are live readings, and the run's settled [`background`](background.md) |
| `readSource`       | Optional `(path, cwd) => string \| undefined`, one source file for a [Developer Diagnostic](declaration-faults.md#developer-diagnostics) |
| `raise`            | `(signal: 'SIGINT' \| 'SIGQUIT' \| 'SIGTSTP') => boolean`: raises the signal a key read in raw mode stands for on the run's signal source when `stdin` is that source's own terminal and answers `true`, and otherwise raises nothing and answers `false`, under [Raw-mode readers](signals.md#raw-mode-readers) |
| `spawn`            | `(command, args, options?) => Child`: starts a child program through the run's handle, under [Child programs](#child-programs) |
| `release`          | The [release facts](release-facts.md) the build baked in, or `{ build: 'source' }` when it baked none, with the installation the [installation record](installation-record.md) holds; frozen |

Each fact comes from the run's handle. The real process's handle reads `timeZone` from the zone `Intl.DateTimeFormat` resolves, which honours `TZ`, and core copies it once per run; no field holds the current time. An invocation by name copies it the same way, and an action's `invoke` keeps its run's. A supplied `env` replaces the process's map. Terminal facts remain independent of supplied streams. Core copies each stream's `isTTY` once, because a stream does not change kind mid-run. The real process's handle backs `host.terminal.stdout.columns`, `host.terminal.stdout.rows`, `host.terminal.stderr.columns`, and `host.terminal.stderr.rows` with a live read of the stream each time they are read, and Node and Bun both update those values when the window resizes. The type stays `number | undefined`, and a missing or zero reading is `undefined`. A supplied `terminal` holds plain numbers, which stay fixed, or its own getters, which are as live as the getters. Core keeps a handle's getter rather than copying its value. [ADR-0086](../decisions/0086-renders-fit-the-destinations-live-columns-and-tables-shrink-to-fit.md) records the decision.

`host.terminal` always holds the handle's reading. The POSIX `COLUMNS` variable in `host.env` never changes it. `COLUMNS` only narrows the `columns` that a view context reports for a destination that is a terminal, as [Width, padding, and multiline lanes](styles.md#width-padding-and-multiline-lanes) states.

Installed [environment preparation](plugin-contract.md#environment-preparation) hooks may add variables after capture and before declared values or inputs validate. Core preserves defined values, including empty strings. An argv run passes each accepted addition to its handle's `publishEnv`, when the handle has one; named invocations never do. A handle `processHandle` builds has one, which writes `process.env`, only when it was given neither `env` nor `cwd`. Other captured facts, including `timeZone` and release facts, remain unchanged.

The environment snapshot is a plain, case-sensitive map on every operating system. Keys retain their original spelling; `Path` and `PATH` are distinct lookups.

The real process's handle reads `program` from the process and the build: a compiled binary reads `[process.execPath]`, because the binary is the whole program, and any other run reads `process.execPath` followed by the absolute path of `process.argv[1]`, the script the runtime ran, or `[process.execPath]` alone when there is none. A run is a compiled binary when the build baked `compiled: true`, which `loom build` bakes for a compile target alone; the release facts do not repeat it. So `[...host.program, ...host.argv]` starts the same application again, without runtime options such as `process.execArgv`, and a [service unit](../plugins/service.md) runs `host.program`. A supplied `program` replaces the whole list, and an `invoke` keeps the outer run's.

The real process's handle reads `release` from the build and the installation record, never from the process's other facts: the facts the build baked into the artifact and, for a compiled binary built with `--release`, the installation the [installation record](installation-record.md) holds, and a supplied `release` replaces them whole, as [Release facts](release-facts.md) states. An action reads its run's build, release, and installation there and nowhere else.

Core copies argv, environment values, and each stream's `isTTY` value, and it reads terminal width and height live. It settles `host.terminal.background` once per run rather than copying it, under [Background](background.md), and a handle's `terminal` may state a background or omit it. It retains the handle's stream connections. Parsing does not modify `host.argv`. Application code owns when content is read. Core probes declared [content inputs](validation.md#content-inputs) and supplies their lazy read methods. Apart from those declared sources, core reads only these: a source file for a defect's findings in a development build, through `readSource`, under the guards [Developer Diagnostics](declaration-faults.md#developer-diagnostics) states; the installation record's `install.json`, under the rules of [Reading the installation](installation-record.md#reading-the-installation); and, for the [background](background.md) query's foreground check only, `/proc/self/stat`, or the output of `ps` for its own process where `/proc` is missing, only when it is about to query a real terminal; that `ps` is the real handle's own child, run inside its module and outside `host.spawn`. Core writes none. The real process's handle supplies `readSource(path, cwd)` as a synchronous read of a UTF-8 file that resolves both paths through symbolic links and answers `undefined` for a file outside `cwd`, for a path that is not a regular file, such as a FIFO or a device, for a file larger than 1 MiB, and for any failure. A supplied `readSource` replaces it like any other field, so a test supplies its own reader, and a reader that always answers `undefined` leaves the findings at the stack location.

The public declarations include Node stream types. The package supplies their type dependency and an explicit declaration reference. Core exports the `Host` and `Out` types, so a helper extracted out of an action, such as a reader that opens a file or `host.stdin`, states its own parameters without reading them back off the action context.

## The home and temporary folders

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { applicationDirectory, Command } from '@loomcli/core';

import { writeArchive } from './archive.js';

export const archive = new Command('archive', { description: 'Write every note to one archive.' }).action(
  async ({ host }) => {
    // With home `/home/me` and no XDG_CACHE_HOME: { path: '/home/me/.cache/notes' }.
    // With XDG_CACHE_HOME `/srv/cache` in host.env: { path: '/srv/cache/notes' }.
    const cache = applicationDirectory('cache', 'notes', host);
    const scratch = mkdtempSync(join(host.tmpdir, 'notes-export-'));
    try {
      await writeArchive(scratch, 'path' in cache ? cache.path : undefined);
    } finally {
      rmSync(scratch, { force: true, recursive: true });
    }
  },
);
```

`host.home` is the one way Loom reads the operator's home folder, and `host.tmpdir` the one way it reads the folder for temporary files. Core's [`applicationDirectory`](installation-record.md), the configuration, completion, logging, manpage, service, and skills plugins, and the `loom` toolchain read them there, never from `HOME` or `TMPDIR` in `host.env`, so a mock's run reads the mock's folders.

- **They follow the handle's environment.** A handle's `home` is its absolute `env.HOME`, and its `tmpdir` its absolute `env.TMPDIR`, unless `home` or `tmpdir` is supplied, so an absolute `HOME` in the handle's environment and `host.home` never disagree unless `home` is supplied.
- **Copied once, before environment preparation.** Core copies both at entry, from the handle, as it copies the other facts. Environment preparation adds variables after that, so a `HOME` or `TMPDIR` that a `.env` file adds reaches `host.env` and moves no folder Loom reads.
- **XDG variables still win.** The XDG base-directory variables, such as `XDG_STATE_HOME`, `XDG_CACHE_HOME`, `XDG_CONFIG_HOME`, and `XDG_DATA_HOME`, and zsh's `ZDOTDIR`, are environment facts, so Loom reads them from `host.env`. An absolute one wins over the folder under `host.home` wherever it wins today, and an unset, empty, or relative one falls back to `host.home`.
- **A home that is not absolute.** A relative `HOME` is passed over for the user database's home, so the real process's `home` is empty only when `HOME` is unset, empty, or relative and the user database holds no home for the user, and a supplied `home` is what the caller gave. Code that places a folder under it treats a `home` that is not an absolute path as unresolved and names `HOME`, the variable an operator sets to fix it, as `applicationDirectory`'s `{ variable: 'HOME' }` answer does.
- **Who the operator is.** `host.uid` is the user's identity, and `host.env.USER` is the name to show for them, so no code calls `os.userInfo()`.

## Child programs

```ts
import type { Writable } from 'node:stream';

import type { ProcessSignal } from '@loomcli/core';

type SpawnOptions = {
  readonly cwd?: string; // host.cwd when omitted; a relative path resolves against it
  readonly env?: Readonly<Record<string, string | undefined>>; // host.env when omitted, replaced whole when given
} & (
  | ({
      readonly detached?: false;
      readonly stdout?: 'capture' | 'ignore' | 'inherit' | Writable; // 'capture' when omitted
      readonly stderr?: 'capture' | 'ignore' | 'inherit' | Writable; // 'capture' when omitted
      readonly signal?: AbortSignal; // an abort ends the child with SIGTERM
    } & (
      | { readonly input?: string | Uint8Array; readonly stdin?: never } // written to the child's stdin, which then ends; an empty stdin when omitted
      | { readonly stdin: 'inherit'; readonly input?: never } // the run's own stdin
    ))
  | { readonly detached: true } // its own process group, every stream ignored, and the process never waits for it
);
interface ChildOutput {
  readonly bytes: Uint8Array; // everything the child wrote to a captured stream; empty for any other
  readonly text: string; // the bytes decoded as UTF-8
}
type ChildExit =
  | { readonly kind: 'exited'; readonly code: number; readonly stdout: ChildOutput; readonly stderr: ChildOutput }
  | { readonly kind: 'unstarted'; readonly error: Error }; // no program answered to the command, or the runtime refused it
interface Child {
  readonly exited: Promise<ChildExit>; // never rejects
  kill(signal?: ProcessSignal | 'SIGKILL'): void; // SIGTERM when omitted; does nothing once the child has exited
}
```

```ts
import { Command, FatalError } from '@loomcli/core';

export const revision = new Command('revision', { description: 'Print the commit the notes folder is at.' }).action(
  async ({ host, out, signal }) => {
    const exit = await host.spawn('git', ['rev-parse', 'HEAD'], { cwd: 'notes', signal }).exited;
    if (exit.kind === 'unstarted') {
      throw new FatalError('notes cannot find git. Install git, then run the command again.');
    }
    if (exit.code !== 0) {
      throw new FatalError(`git could not read the notes folder: ${exit.stderr.text.trim()}`);
    }
    await out.print(exit.stdout.text.trim());
  },
);
```

`host.spawn(command, args, options)` starts a child program through the run's process handle. It is the one way a run starts another program, a [child program](../glossary.md#compilation-and-invocation): Loom's own children start this way, the service plugin's `systemctl`, `loginctl`, and `launchctl`, the MCP plugin's `claude` and `codex`, the completion plugin's profile query, the skills, completion, and manpage refreshes, the update notices' refresh, and the toolchain's `git`, `pnpm`, and `bun`, and the help plugin's pager, so a [mock](../libs/testing.md#mockprocess)'s run starts no real program. The one child core starts outside it is the [background](background.md) query's `ps`, which the foreground check runs where `/proc` is missing: it is the real handle's own child, run inside the real handle's module, and a mock's run never reaches it. [ADR-0107](../decisions/0107-a-run-reads-the-process-through-one-process-handle.md) records the decision.

- **No shell.** `command` is a path, or a name the `PATH` of the child's environment resolves, and each word of `args` reaches the child as it is. No shell runs, so no word is evaluated or split. A caller that needs one names it as the program, as [help paging](../plugins/help.md#help-paging) runs `/bin/sh -c` for the operator's `PAGER`, the one child Loom ships that runs through a shell.
- **Where it runs.** The child runs in `host.cwd` and with `host.env`, which holds what environment preparation added, unless the options name others. A relative `cwd` resolves against `host.cwd`, and a supplied `env` is the child's entire environment, as a supplied field is everywhere else. Core fills both before it calls the handle's `spawn`, so the handle always receives an absolute `cwd` and a whole `env`.
- **Its stdin.** The child reads `input` and then the end of its stdin, or an ended stdin when there is no `input`, so it reads the run's stdin only under `stdin: 'inherit'`. A child that exits before it reads all of its `input` closes the pipe early, which is no failure: the rest of the input is dropped, and the exit reports the child's code. `stdin: 'inherit'` gives the child the run's own stdin, the descriptor itself when that is the real process's own, so an interactive child such as `$EDITOR`, `git commit` without `-m`, or `ssh` reads the operator's keys. A type allows `input` or `stdin: 'inherit'`, never both.
- **Its streams.** A `capture` stream collects every byte the child writes to it, with no limit, into the exit's `stdout` or `stderr`. An `ignore` stream discards them. An `inherit` stream is the run's own stream of the same name, `host.stdout` or `host.stderr`. A `Writable` receives the bytes through a pipe as the child writes them, so the child never sees a terminal there. Neither stream is ended, so the run writes after the child.
- **What the handle receives.** Core passes `inherit`, for stdin, stdout, or stderr, to the handle's `spawn` only when the run's stream is the handle's own stream. Otherwise, under `app.invoke`, an action's `invoke`, an MCP tool call, or any run whose stream is a capture sink, core passes the run's stream as a `Writable`, and for stdin, which an invocation by name does not have, no `input`, so the child reads an ended stdin. The handle answers `inherit` with its own stream: the real process's handle passes the descriptor when the stream is `process.stdin`, `process.stdout`, or `process.stderr`, so the child sees a terminal there as the run does, and pipes any other stream; a mock answers it from its own streams.
- **Waiting for it.** `spawn` returns the child at once, and the real handle's `spawn` never throws: a child that cannot start arrives through `exited`. A [mock](../libs/testing.md#mockprocess)'s `spawn` throws for a command it has no script for, so a test learns of the missing script at once instead of through an `unstarted` exit that code may pass over; code that must survive any handle catches a throw from `spawn` as it handles `unstarted`. `exited` resolves once the child has ended and its streams have closed, and it never rejects. `code` is the child's exit code, or 128 plus the number of the signal that ended it, as a shell reports. `unstarted` means no child ran: no program answered to the command, or the runtime refused to start it, and `error` is the runtime's error, whose `code`, such as `ENOENT`, says which. An attached child keeps the process alive until it ends.
- **Ending it.** An abort of `signal` ends the child with `SIGTERM`, and a signal already aborted ends it as soon as it starts. Passing the run's `signal` ends the child when the run is cancelled, a [shutdown](signals.md#the-shutdown) included. `kill(signal)` delivers a signal to the child, such as one the run forwards, or `SIGKILL`, which no child can handle, for an [`onShutdown`](signals.md#onshutdown) handler that must end the child before the process ends. `spawn` sets no time limit; a caller that wants one passes `AbortSignal.timeout(ms)`, or combines it with the run's signal through `AbortSignal.any`.
- **Detached.** With `detached: true` the child starts in a process group of its own, with every stream ignored and no input, and the process never waits for it, so it outlives the run and a Ctrl-C at the terminal does not reach it. It takes no `signal`, because nothing in the run ends it, which is what the update notices' refresh needs.
- **Names.** The types `SpawnOptions`, `Child`, `ChildExit`, and `ChildOutput` are exported from `@loomcli/core`.

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
