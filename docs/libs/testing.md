---
description: The @loomcli/testing reference. The assembly check, assertAssembles, which a bun test or vitest test calls with the Application, and mockProcess, the sealed process handle a test runs an Application on in its own process and reads the run's output and exit code from.
---

# Testing reference

`@loomcli/testing` ships the test helpers for a Loom application. [ADR-0099](../decisions/0099-an-assembly-check-from-loomcli-testing-replaces-loom-check.md) records the decision: the assembly check is a test, so the author's own test runner runs it while the author works and in CI. [ADR-0107](../decisions/0107-a-run-reads-the-process-through-one-process-handle.md) adds `mockProcess`, the process handle a test runs the Application on. The package imports no test runner. Its functions only return, record, or throw, so they run under `bun test`, vitest, and `node:test` alike.

## Install

```sh
bun add -d @loomcli/testing
```

`@loomcli/core` is a peer dependency. The package needs the same core version as the application.

## assertAssembles

```ts
function assertAssembles(application: Pick<Application, 'check'>): void;
```

`assertAssembles` calls `application.check()`. It returns when the list of faults is empty. Otherwise it throws one `Error` whose message holds a lead line, then the Developer Diagnostic of each fault in the order `check()` returns them, each after a blank line. The test runner prints the message and fails the test.

```text
The application does not assemble: 2 faults.

-- SHARED NAME -------------------------------------- @fixture/probe/shared-name

The first hook rejects the graph.

Each Command answers to a name of its own.

-- SHARED NAME -------------------------------------- @fixture/probe/shared-name

The second hook rejects the graph.

Each Command answers to a name of its own.
```

The error's `cause` is the list of `DeclarationError` values, so a test that wants one fault reads its `rule` or `sentence` from there.

The parameter accepts an application in any authoring state, because `check()` is published in every state. The test passes the application as the module exports it.

### A test under bun test

Place the test beside the application module, as `src/application.test.ts`, which is where `loom init` writes it.

```ts
/// <reference types="bun" />
import { test } from 'bun:test';
import { assertAssembles } from '@loomcli/testing';

import { application } from './application.js';

// Keep this test. It fails CI for a fault that only the assembled application reveals, which
// the operator would otherwise meet on the first run.
test('the application assembles', () => {
  assertAssembles(application);
});
```

### A test under vitest

```ts
import { assertAssembles } from '@loomcli/testing';
import { test } from 'vitest';

import { application } from './application.js';

test('the application assembles', () => {
  assertAssembles(application);
});
```

## What it covers

`assertAssembles` covers what `Application.check()` covers, and builds no rule of its own:

- Every build rule `inspect()` applies. A build-rule fault ends the build, so it is the one fault in the list.
- The input-schema converter check, whatever the release facts read, and every `onGraphBuilt` hook. Past a built graph, each failing converter and each rejecting or broken hook is its own fault, and the build goes on.

It does not pass a declared default or an implied value through its validator. A validator may answer asynchronously and read the run's host, so a bad default surfaces on the application's first run, which reports it.

## mockProcess

```ts
import type { Readable, Writable } from 'node:stream';

import type { Background, ProcessFields, ProcessHandle, ProcessSignal } from '@loomcli/core';

interface MockTerminal {
  readonly columns: number;
  readonly rows: number;
  readonly background?: Background; // settles the run's background, so no query runs
  readonly streams?: readonly ('stdout' | 'stderr')[]; // the streams on the terminal; stdout and stderr when omitted
}
interface MockFields extends Omit<ProcessFields, 'stdin' | 'stdout' | 'stderr' | 'terminal'> {
  readonly stdin?: string; // piped text; empty when omitted
  readonly terminal?: MockTerminal; // no terminal when omitted
}
interface RecordingStream extends Writable {
  readonly text: string; // everything written to the stream, decoded as UTF-8
}
interface MockProcess extends ProcessHandle {
  readonly stdin: Readable;
  readonly stdout: RecordingStream;
  readonly stderr: RecordingStream;
  readonly transcript: readonly { readonly stream: 'stdout' | 'stderr'; readonly text: string }[];
  readonly endedBy: ProcessSignal | undefined; // the signal that ended the mock's process, if one did
  resize(columns: number, rows: number): void;
}

function mockProcess(fields?: MockFields): MockProcess;
```

```ts
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vitest';

import { application } from './application.js';

const fixture = new URL('./fixtures/doc', import.meta.url).pathname;

test('keys prints each top-level key of the file', async () => {
  const mock = mockProcess({ argv: ['keys', '--file', 'doc.json'], cwd: fixture });
  const code = await application.run({ process: mock });
  expect(code).toBe(0);
  expect(mock.exitCode).toBe(0);
  expect(mock.stdout.text).toBe('name\nversion\n');
  expect(mock.stderr.text).toBe('');
});

test('the usage error fits an 80-column terminal', async () => {
  const mock = mockProcess({ argv: ['kyes'], terminal: { columns: 80, rows: 24 } });
  await application.run({ process: mock });
  expect(mock.exitCode).toBe(2);
});
```

`mockProcess(fields)` builds a [process handle](../core/host.md#the-process-handle) that reads nothing from the process the test runs in. A test passes it to `run({ process })`, then reads what the run wrote and the exit code it set from the mock. A test may pass it to `app.invoke(path, values, { process })` too, for its facts alone: an invocation by name writes to none of the handle's streams and sets no exit code, so the test reads the outcome's `output` and `messages`. The run is core's own `run()`, so the package adds no second way to run an Application.

- **Sealed defaults.** A field the test does not supply holds a fixed value, so a test's result is the same on every machine and under either runtime:

  | Field       | Default                                                         |
  | ----------- | --------------------------------------------------------------- |
  | `argv`      | `[]`, which runs the root                                        |
  | `env`       | `{}`                                                             |
  | `cwd`       | `/loom-test`, a path that does not exist, so no file is found by accident |
  | `platform`  | `linux`                                                          |
  | `arch`      | `x64`                                                            |
  | `libc`      | `glibc` when `platform` is `linux`, and `undefined` otherwise    |
  | `uid`       | `1000`                                                           |
  | `timeZone`  | `UTC`                                                            |
  | `program`   | `['/loom-test/runtime', '/loom-test/app.js']`                    |
  | `release`   | `{ build: 'source' }`                                            |
  | `readSource`| none, so a defect's Developer Diagnostic quotes no source line   |
  | `stdin`     | empty and already ended, not a terminal                          |
  | `stdout`, `stderr` | recording streams, not terminals                          |
  | `exitCode`  | `undefined` until a run writes it                                |

- **Supplied fields.** A supplied field replaces its default whole, as `processHandle`'s fields replace the process's, so `env: { HOME: home }` is the run's entire environment. A `cwd` function stands in for the read, so `cwd: () => { throw new Error('ENOENT'); }` fails the run with the unreadable working directory. A test that wants the machine's environment passes `env: process.env` itself. Give `cwd` as an absolute path: a relative one reaches the file system relative to the test process's own working directory, as any relative path does.
- **Piped stdin.** `stdin` is text the run reads as piped input: the stream yields it, then ends, once over the mock's life, so a second run on the mock reads an ended stdin. Stdin is never a terminal, so the run's [interaction decision](../core/interaction.md) is off.
- **The terminal.** The mock's `terminal` is a `ProcessTerminal` over its own streams, in which no stream is a terminal, no width or height is reported, and no background is stated unless `terminal` says otherwise. `terminal` puts the streams it names, stdout and stderr when `streams` is omitted, on a terminal `columns` wide and `rows` high, so a stream it leaves out reads as piped, as `app | less` pipes stdout. The width and height are live: `resize(columns, rows)` changes what the next read returns, as a window resize does. A stated `background` settles the run's background, so no query runs. Color follows the run's own rules, so a test sets it as an operator does, through `FORCE_COLOR`, `NO_COLOR`, or a `--color` spelling.
- **What it records.** `stdout.text` and `stderr.text` hold everything written to each stream, decoded as UTF-8, and `transcript` holds each write in the order the run made it, tagged by stream. `exitCode` holds the code `run()` wrote; `app.invoke` writes none. Recording reads no clock and adds no timeout, so a run that never resolves leaves the test to its runner's own timeout.
- **Signals.** The mock's `signals` is a source of its own. `mock.signals.raise(signal)` delivers the signal to the runs that hold the mock and reaches no other run and no real process. An ending signal, `SIGHUP`, `SIGINT`, `SIGQUIT`, or `SIGTERM`, raised while nothing listens for it, as the re-raise that ends a shutdown is, ends the mock's process: `endedBy` records the signal, and the mock delivers no later signal and records no later write or exit status, as an ended process writes nothing. `run()` still resolves when its run ends, so a test of a run that ignores its signal reads `endedBy` and does not await the run. A `SIGTSTP` or `SIGCONT` raised while nothing listens does nothing, so a test that suspends raises `SIGCONT` itself. A `run()` listens on the mock's source from the moment it is called, so a signal raised right after the call reaches the run. The mock accepts `exit` listeners and never calls them, because its process never ends except by a signal no listener heard. The mock has no `publishEnv`, so environment preparation changes no environment outside the run.
- **One run or several.** A mock records every run given it, in order, so a test that runs twice reads both runs' writes. A test that wants each run apart builds a mock per run.
- **Names.** `mockProcess` is exported from `@loomcli/testing`, and so are the types `MockFields`, `MockTerminal`, `MockProcess`, and `RecordingStream`.
