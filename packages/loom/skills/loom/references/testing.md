# Testing

This reference covers how to test a Loom application: the assembly check, a whole run in the test's own process, one function with a built context, and the few cases that need a child process.

## Keep the assembly check

`loom init` writes `src/application.test.ts`, which passes the Application to `assertAssembles` from `@loomcli/testing`. Keep it. It runs `Application.check()`: every build rule, the input-schema converter check, and every plugin's `onGraphBuilt` hook, such as the MCP plugin's tool-name check. A fault there fails CI with its Developer Diagnostic instead of failing an operator's run.

- Import the Application from the application module. Never import the entry, `src/main.ts`, because importing it runs the application.
- The check does not run a declared default or an implied value through its validator, under [What it covers](../../../../../docs/libs/testing.md#what-it-covers). A whole run of each Command does, so write at least one.

## Run the whole application in the test's process

Most tests run the Application through its own `run()` on a mock process handle: `await app.run({ process: mockProcess(fields) })`. The run parses, validates, applies defaults, translates, renders, and resolves the exit code exactly as it does for an operator, and it reads no process fact from the machine. Read `mock.stdout.text`, `mock.stderr.text`, and the resolved code. [mockProcess](../../../../../docs/libs/testing.md#mockprocess) states every field.

- **Sealed defaults.** A field the test omits holds a fixed value, not the machine's: `argv` is `[]`, `env` is `{}`, `cwd` is `/loom-test`, which does not exist, `platform` is `linux`, stdin is empty, no stream is a terminal, and no child program can start. `release` is `{ build: 'source' }`, a development build, so a defect writes its Developer Diagnostic; state `release: { build: 'distributed' }` to see what an operator sees.
- **A supplied field replaces its default whole.** `env: { HOME: home }` is the run's entire environment.
- **Files.** Give `cwd` as an absolute path to a fixture folder, or to a folder the test makes with `mkdtempSync` and removes after. The default home and temporary folders do not exist, so a run that writes there fails.
- **Child programs.** `programs` scripts each child program by the exact command the run names, with no `PATH` lookup, so `git` and `/usr/bin/git` are two scripts. A command with no script throws from `host.spawn`, which fails the run. Assert the arguments the script received.
- **The terminal.** `terminal: { columns, rows }` puts the output streams on a terminal of that size, and `terminal.keys` answers questions, under [Answering questions](../../../../../docs/libs/testing.md#answering-questions).
- **What stays real.** Clocks, timers, randomness, the network, and the file system. Mask a timestamp or an elapsed time before comparing.
- **One mock per run.** A mock records every run given it, so a second run on it reads both runs' writes.
- **Typed calls.** `app.invoke(path, values, { process: mock })` runs one Command by name on the mock's facts and returns its outcome: `output` and `messages` as text, and for a failure its `exitCode` and failure `form`. It writes nothing to the mock's streams.

```ts
import { Application, FatalError } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vitest';

class NotARepositoryError extends FatalError {
  static override readonly code = 'not-a-repository';

  constructor() {
    super('The folder is not a git repository. Run revision inside one.');
    this.name = 'NotARepositoryError';
  }
}

// A real test imports the Application from the application module instead.
const revision = new Application('revision').action(async ({ host, out, signal }) => {
  const exit = await host.spawn('git', ['rev-parse', 'HEAD'], { signal }).exited;
  if (exit.kind === 'unstarted' || exit.code !== 0) {
    throw new NotARepositoryError();
  }
  await out.print(exit.stdout.text.trim());
});

test('revision prints the commit git reports, with no git run', async () => {
  const calls: (readonly string[])[] = [];
  const mock = mockProcess({
    programs: {
      git: ({ args }) => {
        calls.push(args);
        return { stdout: '3f2a9c1\n' };
      },
    },
  });
  await expect(revision.run({ process: mock })).resolves.toBe(0);
  expect(calls).toEqual([['rev-parse', 'HEAD']]);
  expect(mock.stdout.text).toBe('3f2a9c1\n');
  expect(mock.stderr.text).toBe('');
});

test('outside a repository, revision fails with its own sentence and failure code', async () => {
  const mock = mockProcess({ programs: { git: () => ({ code: 128 }) } });
  await expect(revision.run({ process: mock })).resolves.toBe(1);
  expect(mock.stderr.text).toBe('The folder is not a git repository. Run revision inside one.\n');

  const outside = mockProcess({ programs: { git: () => ({ code: 128 }) } });
  const outcome = await revision.invoke([], {}, { process: outside });
  expect(outcome.status === 'failed' ? outcome.form.code : outcome.status).toBe('not-a-repository');
});
```

## Assert what the application promises

- **Exact bytes where the operator reads them.** Compare stdout and your own failure sentences whole, and compare the exit code. For a failure a script or an agent branches on, assert its failure code from `invoke`'s outcome rather than parsing the text.
- **State every fact the behavior reads, and write the expected value literally.** Never derive an expected value from the real `process.platform`, `process.env`, `os.homedir()`, or the machine's time zone. The run reads the mock, not the machine, so such an expectation agrees with the run only by accident. To test the macOS branch, pass `platform: 'darwin'` and expect the macOS answer.
- **Do not pass `env: process.env`** unless the test is about the machine's environment. It makes the result depend on the machine, and on CI, `CI=true` turns interaction off.
- **Your behavior, not Loom's.** Assert that a declaration reaches the operator: the option binds, the default applies, the result renders through your view, the failure exits with your code. Loom tests its own layouts and catalog sentences.
- **The final effect of a live region,** not each frame. A question or a progress line redraws on stderr, so assert the answer's effect, the exit code, and the final text.

## Test one function with a built context

When an action, a middleware, a hook, or a view holds logic worth testing alone, call it with the context its builder makes, under [Testing one function alone](../../../../../docs/libs/testing.md#testing-one-function-alone): `actionContext`, `middlewareContext`, `failureHookContext`, `providerContext`, `viewContext`, or `environmentContext`. No Application runs.

- **Extract the action.** `actionContext` takes an extracted handler, typed `ActionHandler<typeof command>`. An inline `.action()` handler has no public way to reach it. [Structure](structure.md) shows where the extracted handler lives.
- **State the inputs whole.** State `args`, `options`, and `provided` exactly as the handler reads them. `options` includes every registered global option, and `provided` is `{}` for a Command with no provider. No default, validator, or input source runs.
- **Know what an unstated member does.** The semantic lanes, `out.render`, and `out.results` resolve and keep nothing, so state `out: { results }` with your own function to read the result. `next`, `invoke`, `out.text`, and a view's measures throw or reject with a sentence that asks you to state them, and so does a read of `host`, `graph`, `command`, or another fact you did not state. An unstated `style` returns its text unchanged.
- **No core machinery runs.** A thrown error reaches the test as the function threw it: no translator answers it and no failure view renders it. Test translation, failure text, and exit codes through a whole run.
- **Functions with no builder.** A failure view and a configuration source have no builder, so test them through a whole run. Test an `onCommandAttach` or `onGraphBuilt` hook by installing its plugin on a small Application and reading `inspect()`, or with `assertAssembles`.

```ts
import { Command } from '@loomcli/core';
import type { ActionHandler } from '@loomcli/core';
import { table } from '@loomcli/plugins/table';
import { actionContext } from '@loomcli/testing';
import { expect, test, vi } from 'vitest';

interface Entry {
  key: string;
  kind: string;
}

// In an application, the handler lives in its own module and type-imports the Command.
const listKeys: ActionHandler<typeof keys> = async ({ args, out }) => {
  const document: unknown = JSON.parse(args.document);
  const entries: Entry[] =
    typeof document === 'object' && document !== null
      ? Object.entries(document).map(([key, value]) => ({ key, kind: typeof value }))
      : [];
  await out.results(entries);
};

export const keys = new Command('keys')
  .argument('document', { required: true })
  .rows<Entry>({ views: { table: table({ columns: ['key', 'kind'] }) } })
  .action(listKeys);

test('keys emits one row for each top-level key', async () => {
  const results = vi.fn(async (_rows: Iterable<Entry> | AsyncIterable<Entry>) => {});
  const context = actionContext(listKeys, {
    args: { document: '{"a":1}' },
    options: {},
    out: { results },
    provided: {},
  });
  await listKeys(context);
  expect(results).toHaveBeenCalledWith([{ key: 'a', kind: 'number' }]);
});

test('a malformed document reaches the test as the SyntaxError, untranslated', async () => {
  const context = actionContext(listKeys, { args: { document: '{' }, options: {}, provided: {} });
  await expect(Promise.resolve().then(() => listKeys(context))).rejects.toThrow(SyntaxError);
});
```

## Start a child process only when the behavior needs one

A [process test](../../../../../docs/glossary.md#toolchain) starts the application as a child process. Write one only for behavior that only a process has: a signal delivered by the operating system and the exit status the shell sees, a pseudo-terminal, a real shell, the framing of real stdio, or what the built bundle loads in a fresh process. Everything else runs on a mock.

A signal does not need a process. `mock.signals.raise('SIGINT')` reaches the runs on that mock alone, so the run resolves 130, and Ctrl-C in `terminal.keys` raises it at a question. [Cancelling at a named point](../../../../../docs/libs/testing.md#cancelling-at-a-named-point) shows where to raise it.
