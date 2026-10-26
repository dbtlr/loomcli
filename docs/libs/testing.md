---
description: The @loomcli/testing reference. The assembly check, assertAssembles, which a bun test or vitest test calls with the Application, mockProcess, the sealed process handle a test runs an Application on in its own process and reads the run's output and exit code from, with a keyboard that answers questions from scripted keys, and the five builders, actionContext, middlewareContext, failureHookContext, providerContext, and viewContext, that build the context one author function reads so a test calls that function with no Application. Recipes for cancelling at a named point, typed calls through invoke, checking that output fits the screen, testing a validator alone, and substituting a provider.
---

# Testing reference

`@loomcli/testing` ships the test helpers for a Loom application. [ADR-0099](../decisions/0099-an-assembly-check-from-loomcli-testing-replaces-loom-check.md) records the decision: the assembly check is a test, so the author's own test runner runs it while the author works and in CI. [ADR-0107](../decisions/0107-a-run-reads-the-process-through-one-process-handle.md) adds `mockProcess`, the process handle a test runs the Application on, and [ADR-0109](../decisions/0109-a-test-scripts-keys-on-the-mocks-keyboard-and-measures-and-validates-with-cores-own-functions.md) its keyboard and the core functions the recipes use. [ADR-0110](../decisions/0110-a-test-calls-one-author-function-with-a-context-the-testing-package-builds.md) adds the builders a test calls one author function with. The package imports no test runner. Its functions only return, record, or throw, so they run under `bun test`, vitest, and `node:test` alike.

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

## Testing one function alone

```ts
/** Each key whose type allows undefined may be omitted, and every other key is required. */
type Stated<Values> = {
  readonly [Key in keyof Values as undefined extends Values[Key] ? Key : never]?: Values[Key];
} & {
  readonly [Key in keyof Values as undefined extends Values[Key] ? never : Key]: Values[Key];
};

/** One record of the function's data, which may be omitted when every key in it may be. */
type StatedRecord<Name extends string, Values> = {} extends Stated<Values>
  ? { readonly [Key in Name]?: Stated<Values> }
  : { readonly [Key in Name]: Stated<Values> };

/** The members the builder fills: host, out, and log are stated member by member, every other member whole. */
type Filled<Context> = {
  readonly [Key in keyof Context]?: Key extends 'host' | 'out' | 'log'
    ? Partial<Context[Key]>
    : Context[Key];
};

/** The values argument, which may be omitted when every key in it may be. */
type ValuesArgument<Values> = {} extends Values ? [values?: Values] : [values: Values];
```

```ts
import { actionContext } from '@loomcli/testing';
import { expect, test, vi } from 'vitest';

import { getValue } from './actions/get-value.js';

test('get prints the path it reads', async () => {
  const print = vi.fn(async (_message: string) => {});
  await getValue(actionContext(getValue, { args: { path: 'name' }, options: { verbose: 0 }, out: { print } }));
  expect(print).toHaveBeenCalledWith('name');
});
```

A unit test calls one author function with a context that `@loomcli/testing` builds for it, and no Application is assembled or run. An action is a function, and the test calls it with an input. The package has five builders, one for each kind of function: [`actionContext`](#actioncontext) for an extracted action handler, [`middlewareContext`](#middlewarecontext) for a middleware, [`failureHookContext`](#failurehookcontext) for an `onFailure` hook, [`providerContext`](#providercontext) for a provider's opener, and [`viewContext`](#viewcontext) for a view. `getValue` above is the extracted handler of [Modular authoring](../core/commands.md#modular-authoring).

- **Typed from the function.** A builder takes the function under test and infers its type parameters from the function's own type, so `actionContext(getValue, values)` for a handler typed `ActionHandler<typeof get>` returns the exact context `getValue` takes. Each builder returns its concrete core context type, built with no type assertion. The builder never calls the function; the test does.
- **The function's own data.** The test states the data the function reads, typed exactly as the function reads it, such as an action's `args`, `options`, and `provided`. No default, validator, input source, or environment preparation runs, and the builder copies, checks, and freezes nothing, so each member holds the value the test stated. A key whose type allows `undefined` may be omitted and reads `undefined`. Every other key is required, so a registered global option whose value is never `undefined`, such as a count or a Boolean, is required too, and one that may be unset, such as a string with no default, may be omitted. A record whose every key may be omitted, such as the `args` of a Command with no required argument, may itself be omitted and reads `{}`, and so may the whole values argument.
- **The rest is filled.** The builder fills every other member of the context, and a member the test states replaces the builder's. `host`, `out`, and `log` are stated member by member, so `out: { print }` keeps the builder's other `out` methods. Every other member is stated whole.
- **Members that return nothing do nothing.** `out`'s semantic lanes, `print`, `info`, `success`, `warn`, `error`, `debug`, and `trace`, and `out.render` and `out.results`, resolve and write nothing, and call no view. `log`'s levels do nothing. `cancel` does nothing. `onShutdown`, `onSuspend`, and `onResume` keep no handler and return a remover that does nothing.
- **Members that answer, answer empty.** `out.draw` resolves `0`. `out.region()` returns a region whose `draw`, `end`, and `report` do nothing, whose `live` is `false`, whose `closedBy` stays `undefined`, and whose `signal` never aborts. The context's `signal` never aborts, so a test that wants `cancel` to abort it states both from one `AbortController`: `signal: controller.signal, cancel: () => controller.abort()`.
- **Members whose answer the function reads throw.** `next`, `invoke`, and `host.spawn` return information the function goes on to read, so the builder invents none: each throws a sentence that names the member and tells the test to state its own, below. `graph` and `command` may be omitted, and a read of an omitted one throws the same way.
- **`out.fatal`.** `out.fatal(message)` throws core's `FatalError` with the message, because its type is `never`, so the test expects the rejection: `await expect(async () => handler(context)).rejects.toThrow(FatalError)`.
- **`host`.** The `Host` a run on `mockProcess()` captures, with streams that keep nothing, under [its sealed defaults](#mockprocess): `argv` `[]`, `env` `{}`, `cwd` `/loom-test`, `home` `/loom-test/home`, `tmpdir` `/loom-test/tmp`, `platform` `linux`, `arch` `x64`, `libc` `glibc` while `platform` is `linux`, `uid` `1000`, `timeZone` `UTC`, `program` `['/loom-test/runtime', '/loom-test/app.js']`, `release` `{ build: 'source' }`, and no `readSource`. `stdin` is empty and already ended, `stdout` and `stderr` accept every write and keep nothing, and `terminal` reports no stream as a terminal, no width or height, and no background. `raise` answers `false`. A stated `host` replaces each field it names, whole, as `mockProcess`'s fields replace its defaults: `env: { HOME: home }` is the entire environment, `home` and `tmpdir` follow an absolute `HOME` and `TMPDIR`, `libc` follows `platform`, and a stated `home`, `tmpdir`, or `libc` wins.
- **`style`.** Core's [`contextualStyle`](../core/styles.md#marked-text-outside-a-run), which marks text for every token name, a theme's included, so a function that names its theme's tokens runs with no theme installed. Nothing the builder holds resolves a color.
- **The other defaults.** `interactive` is `false`, `passthrough` is `[]`, and `supplied` is `{ args: {}, options: {} }`.
- **Nothing from a run.** No Application, Command, or plugin is the subject, and nothing comes from core's run machinery: no view registry, theme, settle step, dispatch boundary, activation, or close. A test that wants any of them runs the Application on a mock instead.
- **Names.** `actionContext`, `middlewareContext`, `failureHookContext`, `providerContext`, and `viewContext` are exported from `@loomcli/testing`, and so are the types `ActionValues`, `MiddlewareValues`, `FailureHookValues`, `ProviderValues`, and `ViewValues`.

Each throw is an `Error` whose message opens with the builder that built the context. `next()` and `invoke()` return a promise that rejects with it, and `host.spawn()` and a read of `graph` or `command` throw it:

| Member | Message |
| --- | --- |
| `next()` | `middlewareContext has no next for this middleware to call. Add next to its values, such as next: async () => 'dispatched'.` |
| `invoke(path, …)` | `actionContext has no invoke for "sync". Add invoke to its values, such as invoke: async () => ({ status: 'completed', output: '', messages: '' }).`, naming the path's words joined by spaces |
| `host.spawn(command, …)` | `actionContext has no spawn for "git". Add spawn to host in its values.`, naming the command as the call named it |
| `graph` | `actionContext has no graph. Add graph to its values, such as application.inspect().` |
| `command` | `actionContext has no command. Add command to its values, such as the node at its path in application.inspect().` |

### actionContext

```ts
import type { Action, ActionContext, StdinContext } from '@loomcli/core';

type ActionValues<Args, Options, Result, Stdin extends StdinContext, Provided> =
  StatedRecord<'args', Args> &
  StatedRecord<'options', Options> &
  StatedRecord<'provided', Provided> &
  Stated<Stdin> &
  Filled<Omit<ActionContext<Args, Options, Result, Provided>, 'args' | 'options' | 'provided' | 'stdin'>>;

function actionContext<Args, Options, Result, Stdin extends StdinContext, Provided>(
  handler: Action<Args, Options, Result, Stdin, Provided>,
  ...values: ValuesArgument<ActionValues<Args, Options, Result, Stdin, Provided>>
): Omit<ActionContext<Args, Options, Result, Provided>, 'stdin'> & Stdin;
```

```ts
import { actionContext } from '@loomcli/testing';
import { expect, test, vi } from 'vitest';

import { listNotes } from './actions/list-notes.js';

test('list prints each title the pool returns', async () => {
  const print = vi.fn(async (_message: string) => {});
  // The test's own pool, of the type the handler's provided pool has.
  const pool = { query: async () => [{ title: 'Groceries' }, { title: 'Taxes' }] };
  await listNotes(actionContext(listNotes, { options: { verbose: 0 }, out: { print }, provided: { pool } }));
  expect(print.mock.calls).toEqual([['Groceries'], ['Taxes']]);
});
```

- **The handler.** An extracted handler, typed `ActionHandler<typeof declaration>` as [Modular authoring](../core/commands.md#modular-authoring) writes it. An inline `.action()` handler has no public way to reach it, under [Functions with no builder](#functions-with-no-builder).
- **`args` and `options`.** The values the handler reads after validation: its own arguments, and its options with the global options' values included.
- **`provided`.** The test's own values, under each provider's name, typed from the handler's context. No opener loads and no value is closed. A run still takes no provided value, so a test of `run()` or `invoke` substitutes the opener, under [Substituting a provider](#substituting-a-provider).
- **`stdin`.** Required when the Command declares a required stdin, because the handler's context types it `Content`, and otherwise it may be omitted. The test writes the `Content` itself, such as `{ kind: 'stdin', name: 'stdin', path: undefined, stream: () => Readable.from(['{}']), text: async () => '{}' }`.
- **`out.results`.** It resolves and keeps nothing, so a test that reads the result states `out: { results }` with its own function.
- **`invoke`.** A stated `invoke` may answer a `completed` or `cancelled` outcome. Its type is generic over the failure handler's `Mapped`, so a function that answers `failed` does not compile, and a test of a handler's failure branch runs the Application on a mock through `app.invoke`. Give a mock its return type, as `vi.fn(async (): Promise<{ readonly status: 'completed'; readonly output: string; readonly messages: string }> => ({ status: 'completed', output: '', messages: '' }))` does.

### middlewareContext

```ts
import type { MiddlewareContext, PluginOptions, Request } from '@loomcli/core';

type MiddlewareValues<Options extends PluginOptions> = {
  readonly options: MiddlewareContext<Options>['options'];
  readonly request: Request | null;
  readonly view: string | null;
} & StatedRecord<'ownOptions', MiddlewareContext<Options>['ownOptions']> &
  StatedRecord<'spellings', MiddlewareContext<Options>['spellings']> &
  Filled<
    Omit<MiddlewareContext<Options>, 'options' | 'ownOptions' | 'spellings' | 'request' | 'view'>
  >;

function middlewareContext<Options extends PluginOptions>(
  middleware: (context: MiddlewareContext<Options>) => Promise<void> | void,
  values: MiddlewareValues<Options>,
): MiddlewareContext<Options>;
```

```ts
import type { ChainOutcome } from '@loomcli/core';
import { middlewareContext } from '@loomcli/testing';
import { expect, test, vi } from 'vitest';

import middleware from '../src/middleware.js';

test('--dry-run takes over before the action', async () => {
  const info = vi.fn(async (_message: string) => {});
  const next = vi.fn(async (): Promise<ChainOutcome> => 'dispatched');
  const context = middlewareContext(middleware, {
    next,
    options: { dryRun: true },
    out: { info },
    ownOptions: { dryRun: true },
    request: { args: {}, options: {}, passthrough: [] },
    view: null,
  });
  await middleware(context);
  expect(next).not.toHaveBeenCalled();
  expect(info).toHaveBeenCalledWith('Dry run: nothing was changed.');
});
```

- **The middleware.** The default export of the module its plugin's `middleware.load` imports. The test imports that module itself, so no loader runs and no activation is checked.
- **`options`, `request`, and `view`.** Required, each typed as the middleware reads it. `null` states the case core hands it in: `options` while a global option has a structural fault or was rejected, `request` while core holds a fault or on a group, and `view` on a Command that declares no view.
- **`ownOptions` and `spellings`.** Each may be omitted and reads `{}`, because every key in it may be omitted.
- **An assigned view.** The context keeps the last view the middleware assigns, and a read of `view` returns it, so a test reads `context.view` after the call. No check runs on it, because no dispatch boundary follows.
- **`next`.** It rejects with its sentence unless the test states it. Give a mock its return type, as `vi.fn(async (): Promise<ChainOutcome> => 'dispatched')` does, because inside `vi.fn` a bare `async () => 'dispatched'` widens to `Promise<string>`.

### failureHookContext

```ts
import type { FailureHook, FailureHookContext } from '@loomcli/core';

type FailureHookValues = Stated<
  Pick<FailureHookContext, 'application' | 'path' | 'invokedBy' | 'view' | 'mediaType'>
> &
  Filled<Pick<FailureHookContext, 'style' | 'log' | 'graph' | 'command'>>;

function failureHookContext(hook: FailureHook, values: FailureHookValues): FailureHookContext;
```

```ts
import { UnknownCommandError } from '@loomcli/core';
import { failureHookContext } from '@loomcli/testing';
import { expect, test } from 'vitest';

import { hints } from '../src/hints.js';

test('an unknown command at the command line points at help', () => {
  const context = failureHookContext(hints, { application: 'notes', invokedBy: 'argv', path: [] });
  expect(hints(new UnknownCommandError('lsit', ['list']), context)).toBe('Run notes --help to list the commands.');
});
```

- **The hook.** An `onFailure` hook takes the failure and its context, so the builder returns the context, the second argument, and the test calls `hook(failure, context)` with a failure it constructs.
- **The data.** `application`, `path`, and `invokedBy` are required, and `view` and `mediaType` may be omitted, as for a run that reached no Command's result.
- **The rest.** `style` and `log` are filled as above, and `graph` and `command` may be omitted.

### providerContext

```ts
import type { ProviderContext } from '@loomcli/core';

type ProviderValues<Globals, Provided> = StatedRecord<'options', Globals> &
  StatedRecord<'provided', Provided> &
  Filled<Pick<ProviderContext<Globals, Provided>, 'host' | 'log' | 'signal' | 'onShutdown'>>;

function providerContext<Globals, Provided>(
  opener: (context: ProviderContext<Globals, Provided>) => unknown,
  ...values: ValuesArgument<ProviderValues<Globals, Provided>>
): ProviderContext<Globals, Provided>;
```

```ts
import { providerContext } from '@loomcli/testing';
import { expect, test } from 'vitest';

import open from '../src/open-session.js';
import { testPool } from './test-pool.js';

test('the session starts with the token option', async () => {
  const session = await open(
    providerContext(open, { options: { token: 't0k3n' }, provided: { pool: testPool() } }),
  );
  expect(session.token).toBe('t0k3n');
});
```

- **The opener.** The default export of the module its provider's `load` imports, typed `Opener<typeof declaration>` as [The opener](../core/providers.md#the-opener) writes it. The test imports that module itself, so no `load` runs. The builder calls no `close`, so a test closes what the opener built when that matters.
- **`options` and `provided`.** The global option values the provider reads and the values of the providers it uses, typed as the opener reads them. A run freezes `options` to every depth; the builder holds what the test stated.
- **The rest.** `host`, `log`, `signal`, and `onShutdown` are filled as above. The context has no `out`, as a run's has none.

### viewContext

```ts
import type { RowView, View, ViewContext } from '@loomcli/core';

type ViewValues = Filled<ViewContext>;

function viewContext<Data>(view: View<Data> | RowView<Data>, values?: ViewValues): ViewContext;
```

```ts
import { viewContext } from '@loomcli/testing';
import { expect, test } from 'vitest';

import { notice } from '../src/views/notice.js';

test('the notice wraps at 30 columns and keeps the path whole', () => {
  const message = 'Copy the file to /srv/releases/2026-10-17/archive.tar.gz and restart the service.';
  expect(notice.render(message, viewContext(notice, { columns: 30 }))).toBe(
    'Copy the file to\n/srv/releases/2026-10-17/archive.tar.gz\nand restart the service.\n',
  );
});
```

- **Either shape.** A whole view and a row view alike: the test calls `render`, or `head`, `row`, and `tail`, with the context. A declared view's own function runs, whatever override an Application would install, because no view registry is read.
- **`columns`.** `undefined` unless the test states it, as for a destination that is not a terminal, so a test states `columns` to reach what a view does on a terminal.
- **`background`.** `undefined` unless the test states it, as for a run where no source settled it.
- **The measures.** `plain`, `wrap`, and `expandTabs` are core's own [exports](../core/styles.md#marked-text-outside-a-run), and `width(text)` is core's `width` of `plain(text)`, so all four read marked text as a run's view context does on a destination with main glyph forms. A test of a `linux` console's compatibility forms runs the Application on a mock whose `env` sets `TERM` to `linux`.

### Functions with no builder

- **An inline `.action()` handler.** It has no public way to reach it, so a test runs its Command through `app.invoke` on a mock, under [Typed calls through invoke](#typed-calls-through-invoke). To unit-test a handler, extract it, as [Modular authoring](../core/commands.md#modular-authoring) does, and call it with `actionContext`.
- **A failure view.** It reads a `FailureViewContext`, which `viewContext` does not build, so a test runs the Application on a mock to the failure.
- **A configuration source.** Its resolver reads a `SourceContext`, which no builder builds, so a test runs the Application on a mock with the option unfilled.
- **`onCommandAttach` and `onGraphBuilt`.** They read the graph an Application builds, so a test installs the plugin on a small Application and reads `application.inspect()`, or checks that it assembles with [`assertAssembles`](#assertassembles).
- **`onLog` and `onEnvironment`.** Their arguments are plain values and functions, so a test writes them by hand:

```ts
import { Writable } from 'node:stream';

import type { LogEvent } from '@loomcli/core';
import { expect, test } from 'vitest';

import { writeEvent } from '../src/on-log.js';

test('an error event writes one line to stderr', () => {
  let written = '';
  const stderr = new Writable({
    write: (chunk, _encoding, done) => {
      written += String(chunk);
      done();
    },
  });
  const event: LogEvent = {
    application: { name: 'notes', version: '1.0.0' },
    fields: {},
    level: 'error',
    message: 'Sync failed.',
    path: ['sync'],
    plugin: null,
    run: '0'.repeat(32),
    time: '2026-10-26T12:00:00.000Z',
  };
  writeEvent(event, { env: {}, home: '/loom-test/home', platform: 'linux', stderr });
  expect(written).toBe('error: Sync failed.\n');
});
```

```ts
import { expect, test } from 'vitest';

import { regionDefault } from '../src/on-environment.js';

test('an unset region defaults to us-east-1', async () => {
  const warnings: string[] = [];
  const additions = await regionDefault({
    host: { cwd: '/loom-test', env: {} },
    log: { debug() {}, error() {}, info() {}, trace() {}, warn() {} },
    out: {
      warn: async (message) => {
        warnings.push(message);
      },
    },
  });
  expect(additions).toEqual({ REGION: 'us-east-1' });
  expect(warnings).toEqual([]);
});
```

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

A provider's opener loads through `import()`, so the test runner's module mocking substitutes it, under [Testing a Command that uses a provider](../core/providers.md#testing-a-command-that-uses-a-provider). Core has no member that supplies a provided value to a run. A test that calls one extracted handler states its provided values through [`actionContext`](#actioncontext) instead, and no opener loads.
