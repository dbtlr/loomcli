import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

import { Application, Command, encodeFailure, plugin } from '../src/index.js';
import type { MiddlewareContext } from '../src/index.js';

/*
 * Acceptance plan for the run's media type (docs/core/middleware.md, `mediaType`).
 *
 * - On a Command that declares a result, `mediaType` reads the selected view's media type, follows
 *   an assignment to `view`, and reads `undefined` for a view that declares none.
 * - On a group, it reads `undefined` until a middleware assigns one, and a later middleware reads
 *   the last assignment.
 * - A failed run at a group reads the assigned media type, so the encoder registered for it writes
 *   the failure.
 * - An assignment on a Command that declares a result is the view-selection defect at the dispatch
 *   boundary, after a bad `view` assignment, and a takeover leaves it unobserved.
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

/**
 * A text view that declares no media type, the default because it comes first, and a JSON one
 * that declares `application/json`.
 */
const views = {
  plain: { render: (data: string) => `${data}\n` },
  wire: { mediaType: 'application/json', render: (data: string) => `${JSON.stringify(data)}\n` },
};

/** An application whose root is a group over `list`, which declares a result, and `add`, which does not. */
function application(plugins: ReturnType<typeof plugin>[]) {
  return new Application('notes', { plugins })
    .command(new Command('list').result<string>({ views }).action(({ out }) => out.results('a')))
    .command(new Command('add').action(() => {}));
}

/** One run's exit code and streams. */
async function printed(
  app: Pick<ReturnType<typeof application>, 'run'>,
  argv: string[],
  build: 'development' | 'distributed' = 'distributed',
) {
  const mock = mockProcess({ argv, release: { build } });
  const code = await app.run({ process: mock });
  return { code, stderr: mock.stderr.text, stdout: mock.stdout.text };
}

/** What `mediaType` read, as text, so `undefined` is visible in a list. */
function shown(context: Pick<MiddlewareContext, 'mediaType'>): string {
  return String(context.mediaType);
}

test("on a Command that declares a result, mediaType reads the selected view's media type and follows view", async () => {
  const read: string[] = [];
  const app = application([
    middlewarePlugin('@fixture/reader', async (context) => {
      read.push(shown(context));
      context.view = 'wire';
      read.push(shown(context));
      context.view = 'plain';
      read.push(shown(context));
      await context.next();
    }),
  ]);
  await expect(printed(app, ['list'])).resolves.toEqual({ code: 0, stderr: '', stdout: 'a\n' });
  expect(read).toEqual(['undefined', 'application/json', 'undefined']);
});

test('on a group, mediaType reads undefined until a middleware assigns one, and the last assignment wins', async () => {
  const read: string[] = [];
  const app = application([
    middlewarePlugin('@fixture/first', async (context) => {
      read.push(shown(context));
      context.mediaType = 'application/x-first';
      context.mediaType = 'application/json';
      await context.next();
    }),
    middlewarePlugin('@fixture/second', (context) => {
      read.push(shown(context));
    }),
  ]);
  await expect(printed(app, [])).resolves.toEqual({ code: 0, stderr: '', stdout: '' });
  expect(read).toEqual(['undefined', 'application/json']);
});

test('a failed run at a group reads the assigned media type, so its encoder writes the failure', async () => {
  const encoder = plugin('@fixture/encoder', {
    failureEncoders: [
      encodeFailure('application/json', (form) => `${form.code}:${form.exitCode}\n`),
    ],
  });
  const app = application([
    encoder,
    middlewarePlugin('@fixture/stating', async (context) => {
      context.mediaType = 'application/json';
      await context.next();
    }),
  ]);
  await expect(printed(app, [])).resolves.toEqual({
    code: 2,
    stderr: 'missing-subcommand:2\n',
    stdout: '',
  });
});

test('a media type assigned on a Command that declares a result is the view-selection defect', async () => {
  const app = application([
    middlewarePlugin('@fixture/stating', async (context) => {
      context.mediaType = 'application/json';
      await context.next();
    }),
  ]);
  await expect(printed(app, ['list'])).resolves.toEqual({
    code: 1,
    stderr: 'notes: Something went wrong.\n',
    stdout: '',
  });
  const { code, stderr } = await printed(app, ['list'], 'development');
  expect(code).toBe(1);
  expect(stderr).toMatch(/^-- INVALID VIEW SELECTION -+ @loomcli\/core\/view-selection\n/u);
  expect(stderr).toContain(
    '\n\nPlugin "@fixture/stating" assigned media type "application/json" on Command "list", which declares a result.\n',
  );
  expect(stderr).toContain(
    'Assign mediaType only on a Command that declares no result; select a view by name on one that does.',
  );
});

test('at the root the defect names the root Command, and a bad view assignment ranks ahead of it', async () => {
  const root = new Application('notes', {
    plugins: [
      middlewarePlugin('@fixture/stating', async (context) => {
        context.mediaType = 'application/json';
        await context.next();
      }),
    ],
  })
    .result<string>({ views })
    .action(({ out }) => out.results('a'));
  const { stderr } = await printed(root, [], 'development');
  expect(stderr).toContain(
    '\n\nPlugin "@fixture/stating" assigned media type "application/json" on the root Command, which declares a result.\n',
  );
  const both = application([
    middlewarePlugin('@fixture/stating', async (context) => {
      context.mediaType = 'application/json';
      context.view = 'yaml';
      await context.next();
    }),
  ]);
  const ranked = await printed(both, ['list'], 'development');
  expect(ranked.stderr).toContain('selected view "yaml", which Command "list" does not name.');
  expect(ranked.stderr).not.toContain('assigned media type');
});

test('a takeover leaves a media type assignment on a Command with a result unobserved', async () => {
  const app = application([
    middlewarePlugin('@fixture/stating', (context) => {
      context.mediaType = 'application/json';
    }),
  ]);
  await expect(printed(app, ['list'])).resolves.toEqual({ code: 0, stderr: '', stdout: '' });
});
