---
description: The @loomcli/testing reference. The assembly check, assertAssembles, which a bun test or vitest test calls with the Application, and mockProcess, the sealed process handle a test runs an Application on in its own process and reads the run's output and exit code from, with a keyboard that answers questions from scripted keys. Recipes for cancelling at a named point, typed calls through invoke, checking that output fits the screen, testing a validator alone, and substituting a provider.
---

# Testing reference

`@loomcli/testing` ships the test helpers for a Loom application. [ADR-0099](../decisions/0099-an-assembly-check-from-loomcli-testing-replaces-loom-check.md) records the decision: the assembly check is a test, so the author's own test runner runs it while the author works and in CI. [ADR-0107](../decisions/0107-a-run-reads-the-process-through-one-process-handle.md) adds `mockProcess`, the process handle a test runs the Application on, and [ADR-0109](../decisions/0109-a-test-scripts-keys-on-the-mocks-keyboard-and-measures-and-validates-with-cores-own-functions.md) its keyboard and the core functions the recipes use. The package imports no test runner. Its functions only return, record, or throw, so they run under `bun test`, vitest, and `node:test` alike.

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
  readonly streams?: readonly ('stdout' | 'stderr')[]; // the output streams on the terminal; stdout and stderr when omitted
}
interface ProgramCall {
  readonly command: string; // as the run's spawn named it
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly input: string; // what the spawn wrote to the child's stdin, or the mock's stdin text under stdin: 'inherit', decoded as UTF-8
  readonly detached: boolean;
  readonly signal: AbortSignal; // aborts when the child is ended, by the spawn's signal or a kill of an ending signal
}
interface ProgramAnswer {
  readonly code?: number; // 0 when omitted
  readonly stdout?: string | Uint8Array; // empty when omitted
  readonly stderr?: string | Uint8Array; // empty when omitted
}
type Program = (call: ProgramCall) => ProgramAnswer | Promise<ProgramAnswer>;
interface MockFacts extends Omit<ProcessFields, 'stdin' | 'stdout' | 'stderr' | 'terminal'> {
  readonly programs?: Readonly<Record<string, Program>>; // each child program by its command; none when omitted
}
type MockFields = MockFacts &
  (
    | {
        readonly stdin: string; // piped text; empty when omitted
        readonly terminal?: MockTerminal & { readonly keys?: undefined }; // no terminal when omitted
      }
    | {
        readonly stdin?: undefined; // piped text; empty when omitted
        readonly terminal?: MockTerminal & { readonly keys?: readonly string[] | undefined }; // no terminal when omitted; with keys, puts stdin on the terminal as its keyboard; each entry is what the operator types while one reader holds it
      }
  );
interface RecordingStream extends Writable {
  readonly text: string; // everything written to the stream, decoded as UTF-8
}
interface MockStdin extends Readable {
  readonly isTTY: boolean; // true for a keyboard
  readonly isRaw: boolean; // whether a reader holds the keyboard in raw mode; false for piped text
}
interface MockProcess extends ProcessHandle {
  readonly stdin: MockStdin;
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

test('revision prints the commit git reports, with no git run', async () => {
  const calls: (readonly string[])[] = [];
  const mock = mockProcess({
    argv: ['revision'],
    programs: {
      git: ({ args }) => {
        calls.push(args);
        return { stdout: '3f2a9c1\n' };
      },
    },
  });
  await application.run({ process: mock });
  expect(calls).toEqual([['rev-parse', 'HEAD']]);
  expect(mock.stdout.text).toBe('3f2a9c1\n');
});
```

`mockProcess(fields)` builds a [process handle](../core/host.md#the-process-handle) that reads nothing from the process the test runs in. A test passes it to `run({ process })`, then reads what the run wrote and the exit code it set from the mock. A test may pass it to `app.invoke(path, values, { process })` too, for its facts alone: an invocation by name writes to none of the handle's streams and sets no exit code, so the test reads the outcome's `output` and `messages`. The run is core's own `run()`, so the package adds no second way to run an Application.

- **Sealed defaults.** A field the test does not supply holds a fixed value, so a test's result is the same on every machine and under either runtime:

  | Field       | Default                                                         |
  | ----------- | --------------------------------------------------------------- |
  | `argv`      | `[]`, which runs the root                                        |
  | `env`       | `{}`                                                             |
  | `cwd`       | `/loom-test`, a path that does not exist, so no file is found by accident |
  | `home`      | `env.HOME` when it is absolute, else `/loom-test/home`, a path that does not exist |
  | `tmpdir`    | `env.TMPDIR` when it is absolute, else `/loom-test/tmp`, a path that does not exist |
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
  | `programs`  | none, so a run that starts a child program fails                 |
  | `exitCode`  | `undefined` until a run writes it                                |

- **Supplied fields.** A supplied field replaces its default whole, as `processHandle`'s fields replace the process's, so `env: { HOME: home }` is the run's entire environment, and its home is that `HOME`, as the real handle's is. A supplied `home` or `tmpdir` wins over the environment. A `cwd` function stands in for the read, so `cwd: () => { throw new Error('ENOENT'); }` fails the run with the unreadable working directory. A test that wants the machine's environment passes `env: process.env` itself. Give `cwd` as an absolute path: a relative one reaches the file system relative to the test process's own working directory, as any relative path does.
- **Folders.** By default `home` and `tmpdir` name folders that do not exist, so a run that reads its home finds nothing and a run that writes a scratch file fails. A test whose run writes files supplies real ones, such as `env: { HOME: mkdtempSync(join(tmpdir(), 'notes-home-')) }`, and removes them itself.
- **Piped stdin.** `stdin` is text the run reads as piped input: the stream yields it, then ends, once over the mock's life, so a second run on the mock reads an ended stdin. Piped stdin is not a terminal, so the run's [interaction decision](../core/interaction.md) is off. A mock whose terminal has `keys` has a keyboard in its place, below.
- **The terminal.** The mock's `terminal` is a `ProcessTerminal` over its own streams, in which no stream is a terminal, no width or height is reported, and no background is stated unless `terminal` says otherwise. `terminal` puts the output streams it names, stdout and stderr when `streams` is omitted, on a terminal `columns` wide and `rows` high, so a stream it leaves out reads as piped, as `app | less` pipes stdout. The width and height are live: `resize(columns, rows)` changes what the next read returns, as a window resize does. A stated `background` settles the run's background, so no query runs. Color follows the run's own rules, so a test sets it as an operator does, through `FORCE_COLOR`, `NO_COLOR`, or a `--color` spelling.
- **The keyboard.** `terminal.keys` puts stdin on the terminal as its keyboard: stdin is a terminal, accepts raw mode, and is the mock's signal source's own terminal, so the run's [interaction decision](../core/interaction.md) is on when stderr is on the terminal too, as `streams` omitted puts it, unless the application's intent turns it off. `keys: []` is a keyboard with nothing typed. The types make `keys` and piped `stdin` exclusive, because a run's stdin is one or the other. `stdin.isRaw` reads whether a reader holds the keyboard in raw mode.
- **When keys arrive.** The keyboard hands over its next entry each time a reader other than core's background query switches stdin to raw mode: when a [question](prompts.md) opens, and when a run resumes after Ctrl-Z, because the resume enters raw mode again. One entry is what the operator types while one reader holds the keyboard, so it holds every key for one question, an answer the question rejects and the answer typed after it included: `'bad\r\u007f\u007f\u007f8080\r'` types `bad`, submits it, erases it, and submits `8080`. Two questions open at once share one hold and one entry. No key arrives on a timer or in answer to printed text, so a test's keys reach the same reads on every run.
- **Interrupt keys.** An entry may hold Ctrl-C (`'\u0003'`), Ctrl-\ (`'\u001c'`), and Ctrl-Z (`'\u001a'`). A reader raises the signal a key stands for on the mock's signal source, as it does at a real terminal, under [Raw-mode readers](../core/signals.md#raw-mode-readers): Ctrl-C starts the run's shutdown, so `run()` resolves 130, `exitCode` reads 130, and `endedBy` reads `'SIGINT'` once the shutdown re-raises it; Ctrl-Z runs the suspend handlers, then the resume handlers, and the resume takes the next entry. A raised interrupt drops the keys of its entry that were still unread, as a cooked terminal flushes its input, so a test that answers a question and then presses Ctrl-C at the next one puts each in an entry of its own: `keys: ['8080\r', '\u0003']`.
- **The background query.** A keyboard mock answers core's [background query](../core/background.md) at once with the DA1 reply alone, as a terminal that reports no background does, so the query has no answer and settlement continues at `COLORFGBG`, no entry is used, and nothing waits on the query's deadline. Core writes the query only when the test's `env` sets `TERM`. A test that wants a background states `terminal.background`, and then no query runs.
- **Running out of keys.** A switch to raw mode with no entry left fails the keyboard with the error `mockProcess has no keys left for this read. Add an entry to terminal.keys.`: once the switch returns, stdin emits it as an `error`, so the reader's pending read rejects with it, whether the switch opens a question or resumes one after Ctrl-Z. The run fails through the ordinary failure path, with exit code 1 and the sentence in its Developer Diagnostic on stderr, as a child program with no script does. Entries left over when the run ends are never read.
- **What it records.** `stdout.text` and `stderr.text` hold everything written to each stream, decoded as UTF-8, and `transcript` holds each write in the order the run made it, tagged by stream. `exitCode` holds the code `run()` wrote; `app.invoke` writes none. Recording reads no clock and adds no timeout, so a run that never resolves leaves the test to its runner's own timeout.
- **Child programs.** No child program runs. A run's [`host.spawn`](../core/host.md#child-programs) calls the script `programs` holds under the exact command the run named, with no `PATH` lookup, so `git` and `/usr/bin/git` are two scripts. The script receives the call, with the `cwd` and `env` core filled in, and answers the child's exit code and output: a `capture` stream holds it in the exit, an `inherit` stream writes it to the mock's own stream, so `transcript` holds it, a `Writable` receives it, and `ignore` drops it. An invocation by name writes to none of the handle's streams, so under `app.invoke` core passes the call's capture sink as a `Writable` in place of `inherit`, and the output reaches the outcome. Under `stdin: 'inherit'` the call's `input` is the mock's `stdin` text. `exited` resolves after the script answers, never before `spawn` returns. A script that throws stands for a program that could not start, and the exit is `unstarted` with what it threw as its `error`. The call's `signal` aborts when the child is ended: by the spawn's `signal`, which ends it with `SIGTERM`, or by a `kill` of an ending signal, `SIGHUP`, `SIGINT`, `SIGKILL`, `SIGQUIT`, or `SIGTERM`. The child then ends at once with code 128 plus that signal's number and no output, whatever the script answers later. A `kill` of `SIGTSTP` or `SIGCONT` aborts nothing and does not end the child. A command with no script throws from `spawn`, `mockProcess has no program for "git". Add a "git" entry to programs.`, naming the command, so the run fails with it.
- **What it does not seal.** A mock seals the process, not the machine. Clocks, timers, randomness, the network, and the file system stay real, so a run reads the real time, and a test that compares output holding a timestamp or an elapsed time masks it before comparing.
- **Signals.** The mock's `signals` is a source of its own, and its `terminal` is the keyboard when the mock has one, and `undefined` otherwise. `mock.signals.raise(signal)` delivers the signal to the runs that hold the mock and reaches no other run and no real process. An ending signal, `SIGHUP`, `SIGINT`, `SIGQUIT`, or `SIGTERM`, raised while nothing listens for it, as the re-raise that ends a shutdown is, ends the mock's process: `endedBy` records the signal, and the mock delivers no later signal and records no later write or exit status, as an ended process writes nothing. `run()` still resolves when its run ends, so a test of a run that ignores its signal reads `endedBy` and does not await the run. A `SIGTSTP` or `SIGCONT` raised while nothing listens does nothing, so core's re-raise of `SIGTSTP` stops nothing and returns at once, and a `SIGTSTP` a test raises runs the suspend handlers and then the resume handlers back to back. A `run()` listens on the mock's source from the moment it is called, so a signal raised right after the call reaches the run. The mock accepts `exit` listeners and never calls them, because its process never ends except by a signal no listener heard. The mock has no `publishEnv`, so environment preparation changes no environment outside the run.
- **One run or several.** A mock records every run given it, in order, so a test that runs twice reads both runs' writes. A test that wants each run apart builds a mock per run.
- **Names.** `mockProcess` is exported from `@loomcli/testing`, and so are the types `MockFields`, `MockTerminal`, `MockProcess`, `MockStdin`, `RecordingStream`, `Program`, `ProgramCall`, and `ProgramAnswer`.

## Recipes

Each recipe uses core's own entry points with a mock, so none of them needs an API of its own.

### Answering questions

```ts
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vitest';

import { application } from './application.js';

test('setup saves the port the operator types', async () => {
  const mock = mockProcess({
    argv: ['setup'],
    terminal: { columns: 80, keys: ['8080\r', 'y\r'], rows: 24 },
  });
  await application.run({ process: mock });
  expect(mock.exitCode).toBe(0);
  expect(mock.stdout.text).toBe('Saved port 8080.\n');
});

test('Ctrl-C at the second question ends the run with 130', async () => {
  const mock = mockProcess({
    argv: ['setup'],
    terminal: { columns: 80, keys: ['8080\r', '\u0003'], rows: 24 },
  });
  await expect(application.run({ process: mock })).resolves.toBe(130);
});
```

The question frames land on `stderr`, a live region on the mock's terminal, so `mock.stderr.text` holds every redraw with its control sequences. A test asserts the answer's effect, the exit code, and the final screen text rather than each frame.

### Cancelling at a named point

A signal raised on the mock reaches the runs that hold it, so a test cancels where it chooses:

- **Before dispatch.** Raise right after calling `run()`: `const running = application.run({ process: mock }); mock.signals.raise('SIGINT');`. The run listens from the moment it is called, so it resolves 130 and its action never runs.
- **When a child program starts.** Raise from inside its script in `programs`, such as `git: () => { mock.signals.raise('SIGTERM'); return {}; }`, and the run resolves 143.
- **After an answer.** Put Ctrl-C in the entry after it, as above.
- **When a progress event arrives, in an invocation by name.** `app.invoke` never listens on the mock's signal source, so it cancels through its `signal` instead: abort a controller from `onProgress`, and the outcome is `{ status: 'cancelled', exitCode: 130 }`.

### Typed calls through invoke

`app.invoke(path, values, { process: mock, onProgress })` runs one Command with typed values on the mock's facts and returns the [invocation outcome](../core/invocation.md#invocation-by-name), with the run's output and messages as text. `onProgress` receives each [progress event](../core/output.md#progress-events) in order, so a test collects them in an array and compares it.

```ts
import type { ProgressEvent } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vitest';

import { application } from './application.js';

test('sync reports its progress to the end', async () => {
  const events: ProgressEvent[] = [];
  const outcome = await application.invoke(['sync'], { options: { all: true } }, {
    onProgress: (event) => events.push(event),
    process: mockProcess(),
  });
  expect(outcome.status).toBe('completed');
  expect(events.at(-1)?.state).toBe('ended');
});
```

### Checking that output fits the screen

A test reads the bytes the run wrote, so it measures them with core's [`width`](../core/styles.md#measuring-written-text), the measure core renders with, and strips styles with the runtime's own `stripVTControlCharacters` from `node:util`:

```ts
import { stripVTControlCharacters } from 'node:util';

import { width } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vitest';

import { application } from './application.js';

test('the colored list fits a 60-column terminal', async () => {
  const mock = mockProcess({
    argv: ['list'],
    env: { FORCE_COLOR: '1' },
    terminal: { columns: 60, rows: 24 },
  });
  await application.run({ process: mock });
  for (const line of mock.stdout.text.split('\n')) {
    expect(width(line)).toBeLessThanOrEqual(60);
  }
  expect(stripVTControlCharacters(mock.stdout.text)).toContain('NAME');
});
```

### Testing a validator alone

A validator that reads its [validation context](../core/validation.md#validation-context), such as `path()` reading the working directory or `dateTime()` the time zone, is tested with no Application through core's [`validationOptions`](../core/validation.md#validation-options-outside-a-run), which builds the options a run passes, over a mock's facts:

```ts
import { validationOptions } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { path } from '@loomcli/validators';
import { expect, test } from 'vitest';

const fixture = new URL('./fixtures/doc', import.meta.url).pathname;

test('path rejects a file the working directory does not hold', async () => {
  const options = validationOptions(mockProcess({ cwd: fixture }), {
    input: { global: false, kind: 'option', name: 'file' },
    phase: 'invocation',
  });
  const result = await path({ access: 'read' })['~standard'].validate('missing.json', options);
  expect(result.issues?.[0]?.message).toBe('Expected a readable file that exists.');
});
```

### Substituting a provider

A provider's opener loads through `import()`, so the test runner's module mocking substitutes it, under [Testing a Command that uses a provider](../core/providers.md#testing-a-command-that-uses-a-provider). Core has no member that supplies a provided value to a run.
