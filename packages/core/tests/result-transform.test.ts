import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

import { Application, Command, InputError, plugin } from '../src/index.js';
import type { MiddlewareContext, ResultTransform } from '../src/index.js';

/*
 * Acceptance plan for the run's result transform (docs/core/middleware.md, `transform`).
 *
 * - A transform a middleware assigns reshapes a value result once before the selected view renders.
 * - Under rows it reshapes each row as the row arrives, under a row view and a whole view alike.
 * - The last assignment before the dispatch boundary wins, and one made after it changes nothing.
 * - With none assigned, `transform` reads undefined and the result renders as it is.
 * - A throw in the transform fails the run with its own exit code, and rows already written stay.
 */

/** A plugin whose always-on middleware is the given function. */
function middlewarePlugin(
  identity: string,
  middleware: (context: MiddlewareContext) => Promise<void> | void,
) {
  return plugin(identity, {
    middleware: { activate: 'always', load: () => Promise.resolve({ default: middleware }) },
  });
}

/** A middleware that assigns each transform in turn, then continues. */
function assigning(...transforms: ResultTransform[]) {
  return middlewarePlugin('@fixture/transform', async (context) => {
    for (const transform of transforms) {
      context.transform = transform;
    }
    await context.next();
  });
}

/** Wraps a value in brackets, so the line shows which transform ran and how often. */
const bracketed: ResultTransform = (value) => `[${String(value)}]`;

/** A view that prints its data as JSON on one line. */
const line = { render: (data: unknown) => `${JSON.stringify(data)}\n` };

/** A row view that prints each row as JSON on its own line, between a head and a tail. */
const rowLines = {
  head: () => 'head\n',
  row: (row: unknown) => `${JSON.stringify(row)}\n`,
  tail: (count: number) => `tail:${count}\n`,
};

/** An application over `get`, which declares a value, and `list`, whose rows come from `rows`. */
function application(
  plugins: ReturnType<typeof plugin>[],
  rows: () => Iterable<unknown> = () => ['a', 'b'],
) {
  return new Application('notes', { plugins })
    .command(
      new Command('get').result<unknown>({ views: { line } }).action(({ out }) => out.results('a')),
    )
    .command(
      new Command('list')
        .rows<unknown>({ views: { rows: rowLines, whole: line } })
        .action(({ out }) => out.results(rows())),
    );
}

/** One run's exit code and streams. */
async function printed(app: Pick<ReturnType<typeof application>, 'run'>, argv: string[]) {
  const mock = mockProcess({ argv, release: { build: 'distributed' } });
  const code = await app.run({ process: mock });
  return { code, stderr: mock.stderr.text, stdout: mock.stdout.text };
}

test('a transform reshapes a value result once before the view renders it', async () => {
  const calls: unknown[] = [];
  const app = application([
    assigning((value) => {
      calls.push(value);
      return bracketed(value);
    }),
  ]);
  await expect(printed(app, ['get'])).resolves.toEqual({ code: 0, stderr: '', stdout: '"[a]"\n' });
  expect(calls).toEqual(['a']);
});

test('under rows a transform reshapes each row as it arrives, under a row view', async () => {
  const events: string[] = [];
  function* rows() {
    events.push('yield:a');
    yield 'a';
    events.push('yield:b');
    yield 'b';
  }
  const app = application(
    [
      assigning((value) => {
        events.push(`transform:${String(value)}`);
        return bracketed(value);
      }),
    ],
    rows,
  );
  await expect(printed(app, ['list'])).resolves.toEqual({
    code: 0,
    stderr: '',
    stdout: 'head\n"[a]"\n"[b]"\ntail:2\n',
  });
  expect(events).toEqual(['yield:a', 'transform:a', 'yield:b', 'transform:b']);
});

test('under rows a whole view receives each row through the transform', async () => {
  const app = application([
    assigning(bracketed),
    middlewarePlugin('@fixture/view', async (context) => {
      context.view = 'whole';
      await context.next();
    }),
  ]);
  await expect(printed(app, ['list'])).resolves.toEqual({
    code: 0,
    stderr: '',
    stdout: '["[a]","[b]"]\n',
  });
});

test('the last assignment before the boundary wins, whichever middleware made it', async () => {
  const app = application([
    assigning(
      () => 'first',
      () => 'second',
    ),
    middlewarePlugin('@fixture/later', async (context) => {
      context.transform = bracketed;
      await context.next();
    }),
  ]);
  await expect(printed(app, ['get'])).resolves.toEqual({ code: 0, stderr: '', stdout: '"[a]"\n' });
});

test('an assignment after the dispatch boundary changes nothing', async () => {
  const contexts: MiddlewareContext[] = [];
  const app = new Application('notes', {
    plugins: [
      middlewarePlugin('@fixture/keeper', async (context) => {
        contexts.push(context);
        context.transform = bracketed;
        await context.next();
      }),
    ],
  })
    .result<string>({ views: { line } })
    .action(({ out }) => {
      // The action runs past the boundary, so this assignment reaches a fixed selection.
      for (const context of contexts) {
        context.transform = () => 'late';
      }
      return out.results('a');
    });
  await expect(printed(app, [])).resolves.toEqual({ code: 0, stderr: '', stdout: '"[a]"\n' });
});

test('with no transform assigned, transform reads undefined and the result renders as it is', async () => {
  const read: unknown[] = [];
  const app = application([
    middlewarePlugin('@fixture/reader', async (context) => {
      read.push(context.transform);
      await context.next();
    }),
  ]);
  await expect(printed(app, ['get'])).resolves.toEqual({ code: 0, stderr: '', stdout: '"a"\n' });
  await expect(printed(app, ['list'])).resolves.toEqual({
    code: 0,
    stderr: '',
    stdout: 'head\n"a"\n"b"\ntail:2\n',
  });
  expect(read).toEqual([undefined, undefined]);
});

test('a throw in the transform fails the run with its exit code, and the rows written stay', async () => {
  const app = application([
    assigning((value) => {
      if (value === 'b') {
        throw new InputError('Row "b" has no such field. Supply another field.', []);
      }
      return value;
    }),
  ]);
  const { code, stderr, stdout } = await printed(app, ['list']);
  expect(code).toBe(2);
  expect(stdout).toBe('head\n"a"\n');
  expect(stderr).toContain('Row "b" has no such field. Supply another field.');
});
