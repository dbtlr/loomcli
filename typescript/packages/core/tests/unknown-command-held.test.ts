import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

import { Application, Command, plugin, provider, UnknownCommandError } from '../src/index.js';
import type { MiddlewareContext, Provider } from '../src/index.js';

/*
 * Acceptance plan for the held unknown command (docs/core/middleware.md, `unknownCommand`,
 * `invokedBy`, and `exitCode`; ADR-0192).
 *
 * - Without a takeover, an unknown command prints and exits as before, and its `next()` rejects
 *   with the `UnknownCommandError` the dispatch boundary raises.
 * - Only the `'always'` middleware run: an option before the unknown word activates nothing, and
 *   no validator runs.
 * - An `'always'` middleware reads the word and the words after it, `invokedBy`, the partial path's
 *   node, and a context with no request, no options, and no view.
 * - A middleware that returns without calling `next()` takes the run over and may state the run's
 *   exit code; so may one that catches the boundary's fault. A dispatched action ignores it.
 * - An invocation by name holds the unknown path element the same way, with the path elements
 *   after it, and its `completed` outcome reports the stated code.
 */

/** A plugin whose middleware is the given function, activated as given. */
function middlewarePlugin(
  identity: string,
  middleware: (context: MiddlewareContext) => Promise<void> | void,
  activate: 'always' | ['flag'] = 'always',
) {
  return plugin(identity, {
    middleware: { activate, load: () => Promise.resolve({ default: middleware }) },
    ...(activate === 'always' ? {} : { options: { flag: { type: 'boolean' as const } } }),
  });
}

/** A validator that counts its calls, for a global option that must never be validated here. */
function countingSchema(calls: { count: number }) {
  return {
    '~standard': {
      validate: (value: unknown) => {
        calls.count += 1;
        return { value };
      },
      vendor: 'fixture',
      version: 1 as const,
    },
  };
}

/** An application whose root is a group over `add`, a `cache` group, and a hidden `secret`. */
function application(
  plugins: ReturnType<typeof plugin>[],
  calls: { count: number } = { count: 0 },
) {
  return new Application('notes', { plugins })
    .globalOption('level', { schema: countingSchema(calls), type: 'string' })
    .command(new Command('add').action(() => {}))
    .command(new Command('cache').command(new Command('clear').action(() => {})))
    .command(new Command('secret', { hidden: true }).action(() => {}));
}

/** One run's exit code and streams. */
async function printed(app: Pick<ReturnType<typeof application>, 'run'>, argv: string[]) {
  const mock = mockProcess({ argv });
  const code = await app.run({ process: mock });
  return { code, stderr: mock.stderr.text, stdout: mock.stdout.text };
}

const unknownNope = 'notes: Unknown command "nope". Use one of: add, cache.\n';

test('without a takeover an unknown command prints and exits as before', async () => {
  await expect(printed(application([]), ['nope', '--bad'])).resolves.toEqual({
    code: 2,
    stderr: unknownNope,
    stdout: '',
  });
});

test("an 'always' middleware reads the held unknown command, and its next() rejects with it", async () => {
  const seen: unknown[] = [];
  let held: unknown = undefined;
  const app = application([
    middlewarePlugin('@fixture/reader', async (context) => {
      held = context.unknownCommand;
      seen.push({
        command: context.command.path,
        invokedBy: context.invokedBy,
        options: context.options,
        ownOptions: context.ownOptions,
        request: context.request,
        spellings: context.spellings,
        unknownCommand: context.unknownCommand,
        view: context.view,
      });
      try {
        await context.next();
      } catch (error) {
        seen.push(error instanceof UnknownCommandError ? error.token : error);
        throw error;
      }
    }),
  ]);
  await expect(printed(app, ['nope', 'a', '--b', '--', 'c'])).resolves.toEqual({
    code: 2,
    stderr: unknownNope,
    stdout: '',
  });
  expect(seen).toEqual([
    {
      command: [],
      invokedBy: 'argv',
      options: null,
      ownOptions: {},
      request: null,
      spellings: {},
      unknownCommand: { rest: ['a', '--b', '--', 'c'], word: 'nope' },
      view: null,
    },
    'nope',
  ]);
  expect(Object.isFrozen(held)).toBe(true);
});

test('an unknown command under a group reads the group as the routed node', async () => {
  const paths: unknown[] = [];
  const app = application([
    middlewarePlugin('@fixture/reader', async (context) => {
      paths.push([context.command.path, context.unknownCommand]);
      await context.next();
    }),
  ]);
  await expect(printed(app, ['cache', 'nope'])).resolves.toMatchObject({ code: 2 });
  expect(paths).toEqual([[['cache'], { rest: [], word: 'nope' }]]);
});

test('an option before the unknown word activates nothing, and no validator runs', async () => {
  const ran: string[] = [];
  const calls = { count: 0 };
  const app = application(
    [
      middlewarePlugin(
        '@fixture/flagged',
        () => {
          ran.push('flagged');
        },
        ['flag'],
      ),
      middlewarePlugin('@fixture/always', async (context) => {
        ran.push('always');
        await context.next();
      }),
    ],
    calls,
  );
  await expect(printed(app, ['--flag', '--level', 'x', 'nope'])).resolves.toEqual({
    code: 2,
    stderr: unknownNope,
    stdout: '',
  });
  expect(ran).toEqual(['always']);
  expect(calls.count).toBe(0);
});

test('a routed run reads no unknown command and invokedBy argv', async () => {
  const seen: unknown[] = [];
  const app = application([
    middlewarePlugin('@fixture/reader', async (context) => {
      seen.push([context.unknownCommand, context.invokedBy, context.exitCode]);
      await context.next();
    }),
  ]);
  await expect(printed(app, ['add'])).resolves.toMatchObject({ code: 0 });
  expect(seen).toEqual([[null, 'argv', undefined]]);
});

test('a takeover states the exit code the run ends with, and prints nothing', async () => {
  const app = application([
    middlewarePlugin('@fixture/taker', (context) => {
      context.exitCode = 3;
    }),
  ]);
  await expect(printed(app, ['nope'])).resolves.toEqual({ code: 3, stderr: '', stdout: '' });
});

test('a takeover that states no code exits 0', async () => {
  const app = application([middlewarePlugin('@fixture/taker', () => {})]);
  await expect(printed(app, ['nope'])).resolves.toEqual({ code: 0, stderr: '', stdout: '' });
});

test("a middleware that catches the boundary's fault and returns takes the run over with its code", async () => {
  const app = application([
    middlewarePlugin('@fixture/catcher', async (context) => {
      context.exitCode = 4;
      await context.next().catch(() => 'taken-over');
    }),
  ]);
  await expect(printed(app, ['nope'])).resolves.toEqual({ code: 4, stderr: '', stdout: '' });
});

test('a caught provider opener failure takes over before dispatch and keeps its stated code', async () => {
  const seen: string[] = [];
  const broken: Provider<'broken', string> = provider('broken', {
    load: async () => ({
      default: () => {
        throw new Error('provider unavailable');
      },
    }),
  });
  const app = new Application('notes', {
    plugins: [
      middlewarePlugin('@fixture/outer', async (context) => {
        seen.push(await context.next());
      }),
      middlewarePlugin('@fixture/catcher', async (context) => {
        try {
          await context.next();
        } catch {
          context.exitCode = 75;
        }
      }),
    ],
  }).command(
    new Command('add', { uses: [broken] }).action(() => {
      seen.push('action');
    }),
  );
  await expect(printed(app, ['add'])).resolves.toEqual({ code: 75, stderr: '', stdout: '' });
  expect(seen).toEqual(['taken-over']);
});

test('a dispatched action ignores a stated exit code', async () => {
  const app = application([
    middlewarePlugin('@fixture/stater', async (context) => {
      context.exitCode = 5;
      await context.next();
    }),
  ]);
  await expect(printed(app, ['add'])).resolves.toEqual({ code: 0, stderr: '', stdout: '' });
});

test('a failure after a stated code keeps the failure code', async () => {
  const app = application([
    middlewarePlugin('@fixture/stater', (context) => {
      context.exitCode = 6;
      throw new Error('broken');
    }),
  ]);
  await expect(printed(app, ['nope'])).resolves.toMatchObject({ code: 1 });
});

test('an invocation by name holds an unknown path element with the elements after it', async () => {
  const seen: unknown[] = [];
  const app = application([
    middlewarePlugin('@fixture/reader', async (context) => {
      seen.push([context.unknownCommand, context.invokedBy, context.command.path]);
      await context.next();
    }),
  ]);
  const outcome = await app.invoke(['nope', 'x'], {}, { process: mockProcess({}) });
  expect(outcome).toMatchObject({
    exitCode: 2,
    messages: unknownNope,
    status: 'failed',
  });
  expect(seen).toEqual([[{ rest: ['x'], word: 'nope' }, 'name', []]]);
});

test("an invocation by name's completed outcome reports a takeover's stated code", async () => {
  const app = application([
    middlewarePlugin('@fixture/taker', (context) => {
      context.exitCode = 7;
    }),
  ]);
  await expect(app.invoke(['nope'], {}, { process: mockProcess({}) })).resolves.toEqual({
    exitCode: 7,
    messages: '',
    output: '',
    status: 'completed',
  });
  await expect(application([]).invoke(['add'], {}, { process: mockProcess({}) })).resolves.toEqual({
    messages: '',
    output: '',
    status: 'completed',
  });
});
