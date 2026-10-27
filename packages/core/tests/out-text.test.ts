/*
 * Acceptance plan for a view's text without a write (docs/core/output.md#a-views-text-without-a-write).
 *
 * - The same bytes. From an action and from a middleware, `out.text` returns exactly the bytes
 *   `out.render` with the same data and view writes next, for a bare view and for a declared view
 *   under an application override, on a terminal at two widths, piped, and under `NO_COLOR`,
 *   `FORCE_COLOR`, and `COLUMNS`.
 * - The destination. From the action of a Command that declares a result, the text resolves for
 *   stderr, and from a middleware on the same Command it resolves for stdout.
 * - Nothing written. An action that calls `out.text` and returns writes no byte and exits 0.
 * - A view that throws. `out.text` throws that value; an action that catches it exits 0.
 * - By name. Under `app.invoke`, the text is the plain text the capture holds.
 */

import { Application, Command, FatalError, override, plugin, translate, view } from '@loomcli/core';
import type { Middleware, Plugin, View } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

/** A view whose bytes name the color depth and the width it resolved at. */
const banner: View<string> = {
  render: (name, { columns, style }) =>
    `${style.hex('#C97B36', { ansi16: 'yellow', ansi256: 172 }).bold(style.escape(name))} ${String(columns)}\n`,
};

/** What `out.text` returned and what `out.render` then wrote, from one action. */
async function textAndRender(options: Parameters<typeof mockProcess>[0]) {
  let text = '';
  const app = new Application('banner').action(async ({ out }) => {
    text = out.text('loom', banner);
    await out.render('loom', banner);
  });
  const mock = mockProcess(options);
  await expect(app.run({ process: mock })).resolves.toBe(0);
  return { text, written: mock.stdout.text };
}

test.each([
  {
    name: 'a terminal at 40 columns',
    options: { env: { TERM: 'xterm-256color' }, terminal: { columns: 40, rows: 24 } },
  },
  {
    name: 'a terminal at 100 columns',
    options: { env: { TERM: 'xterm-256color' }, terminal: { columns: 100, rows: 24 } },
  },
  { name: 'a pipe', options: { env: { TERM: 'xterm-256color' } } },
  {
    name: 'NO_COLOR',
    options: {
      env: { NO_COLOR: '1', TERM: 'xterm-256color' },
      terminal: { columns: 80, rows: 24 },
    },
  },
  { name: 'FORCE_COLOR on a pipe', options: { env: { FORCE_COLOR: '3' } } },
  {
    name: 'COLUMNS=60',
    options: {
      env: { COLUMNS: '60', TERM: 'xterm-256color' },
      terminal: { columns: 100, rows: 24 },
    },
  },
])('on $name, out.text returns the bytes out.render writes next', async ({ options }) => {
  const { text, written } = await textAndRender(options);
  expect(written).not.toBe('');
  expect(text).toBe(written);
});

test("under an application override of a declared view, out.text returns the override's bytes", async () => {
  const declared = view<string>('test/out-text/banner', { render: (name) => `default ${name}\n` });
  let text = '';
  const app = new Application('banner', {
    plugins: [plugin('test/out-text/views', { views: [declared] })],
    views: [
      override(declared, { render: (name, { style }) => `${style.bold(name)} overridden\n` }),
    ],
  }).action(async ({ out }) => {
    text = out.text('loom', declared);
    await out.render('loom', declared);
  });
  const mock = mockProcess({
    env: { TERM: 'xterm-256color' },
    terminal: { columns: 80, rows: 24 },
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(mock.stdout.text).toBe('\u001B[1mloom\u001B[22m overridden\n');
  expect(text).toBe(mock.stdout.text);
});

test("on a Command that declares a result, the action's out.text resolves for stderr and a middleware's for stdout", async () => {
  const texts: Record<string, string> = {};
  const recorder: Middleware<Plugin> = async ({ next, out }) => {
    texts.middleware = out.text('loom', banner);
    await next();
  };
  const app = new Application('banner', {
    plugins: [
      plugin('test/out-text/recorder', {
        middleware: { activate: 'always', load: async () => ({ default: recorder }) },
      }),
    ],
  }).command(
    new Command('get')
      .result<string>({ views: { plain: { render: (value) => `${value}\n` } } })
      .action(({ out }) => {
        texts.action = out.text('loom', banner);
        return out.results('done');
      }),
  );
  const mock = mockProcess({
    argv: ['get'],
    env: { TERM: 'xterm-256color' },
    terminal: { columns: 80, rows: 24, streams: ['stderr'] },
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  // Stderr is the terminal and stdout a pipe, so each text names the stream it resolved for.
  expect(texts.action).toBe('\u001B[38;5;172;1mloom\u001B[39;22m 80\n');
  expect(texts.middleware).toBe('loom undefined\n');
});

test('an action that only calls out.text writes nothing and exits 0', async () => {
  const app = new Application('banner').action(({ out }) => {
    out.text('loom', banner);
  });
  const mock = mockProcess({
    env: { TERM: 'xterm-256color' },
    terminal: { columns: 80, rows: 24 },
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(mock.stdout.text).toBe('');
  expect(mock.stderr.text).toBe('');
});

class BrokenViewError extends Error {
  constructor() {
    super('The view broke.');
    this.name = 'BrokenViewError';
  }
}
const broken: View<string> = {
  render: () => {
    throw new BrokenViewError();
  },
};

test('a view that throws makes out.text throw that value, and an action that catches it exits 0', async () => {
  let caught: unknown = undefined;
  const app = new Application('banner').action(({ out }) => {
    try {
      out.text('loom', broken);
    } catch (error) {
      caught = error;
    }
  });
  const mock = mockProcess({});
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(caught).toBeInstanceOf(BrokenViewError);
  expect(mock.stdout.text).toBe('');
});

/** How a run whose action lets a throwing view's failure escape through `write` ends. */
async function outcome(write: 'render' | 'text') {
  const app = new Application('banner', {
    translators: [translate(BrokenViewError, () => new FatalError('translated'))],
  }).action(async ({ out }) => {
    if (write === 'text') {
      out.text('loom', broken);
    } else {
      await out.render('loom', broken);
    }
  });
  const mock = mockProcess({});
  const code = await app.run({ process: mock });
  // The two calls reach the view through different frames, so the report is compared without them.
  const report = mock.stderr.text.replaceAll(/^ +at .*\n/gmu, '');
  return { code, report, stdout: mock.stdout.text };
}

test('a throw from out.text that escapes fails the run as the same throw from out.render does', async () => {
  const rendered = await outcome('render');
  expect(rendered.code).not.toBe(0);
  await expect(outcome('text')).resolves.toEqual(rendered);
});

test('under app.invoke, out.text returns the plain text the capture holds', async () => {
  let text = '';
  const app = new Application('banner').action(async ({ out }) => {
    text = out.text('loom', banner);
    await out.render('loom', banner);
  });
  const result = await app.invoke([], {});
  expect(result).toMatchObject({ output: 'loom undefined\n', status: 'completed' });
  expect(text).toBe('loom undefined\n');
});
