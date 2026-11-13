/*
 * Acceptance plan for a message's own view (docs/core/output.md#a-messages-own-view).
 *
 * A semantic method that receives a view keeps its level, its destination and the verbosity it
 * writes at, and draws the message through the view alone. Each case runs a fixture Application
 * through public APIs and a mock process, under Node and Bun:
 *
 * - The look. A passed bare view replaces the lane view, glyph and gutter included, on stderr for
 *   `info` and on stdout for `print`, and `print` on a Command that declares a result moves to
 *   stderr with its view.
 * - The level. A call `-q` hides calls no view, the passed one included, and `out.debug(text,
 *   lanes.warn)` draws a warning's look from `-v` alone.
 * - Resolution. A declared view passed to a call resolves through the application's override,
 *   and an override of the method's own lane plays no part when the call passes a view.
 * - One line break. Every message ends with exactly one line break, whichever view drew it: a
 *   view's text without one gains it, one that ends with LF or CRLF, inside a style frame or not,
 *   gains none, the empty string writes one, and the default `print` lane follows the same rule.
 * - Before the chain. An `onEnvironment` hook's `warn` draws through a passed view.
 */
import { Application, lanes, override, plugin, style } from '@loomcli/core';
import type { View } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

/** A view that frames the message in brackets and ends it with its own line break. */
const bracketed: View<string> = { render: (message) => `[${message}]\n` };

/** A view that draws the message bare, with no line break of its own. */
const bare: View<string> = { render: (message) => `> ${message}` };

/** An application that marks `-v` and `-q`, so a test can move the run's verbosity. */
function marked(name: string) {
  return new Application(name)
    .globalOption('verbose', { short: 'v', type: 'count', verbose: true })
    .globalOption('quiet', { quiet: true, short: 'q', type: 'count' });
}

/** Runs an application with the words given, piped, and returns what each stream holds. */
async function written(app: { run: Application['run'] }, argv: readonly string[] = []) {
  const mock = mockProcess({ argv: [...argv], env: {} });
  const code = await app.run({ process: mock });
  return { code, stderr: mock.stderr.text, stdout: mock.stdout.text };
}

test('a passed view replaces the lane view on the lane destination, glyph and gutter included', async () => {
  const app = new Application('look').action(async ({ out }) => {
    await out.info('Building', bracketed);
    await out.print('data', bare);
  });
  await expect(written(app)).resolves.toEqual({
    code: 0,
    stderr: '[Building]\n',
    stdout: '> data\n',
  });
});

test('print with a view moves to stderr on a Command that declares a result', async () => {
  const app = new Application('result')
    .result<string>({ views: { text: { render: (value) => `${value}\n` } } })
    .action(async ({ out }) => {
      await out.print('note', bare);
      await out.results('value');
    });
  await expect(written(app)).resolves.toEqual({ code: 0, stderr: '> note\n', stdout: 'value\n' });
});

test('a call the verbosity hides calls no view, the passed one included', async () => {
  const throwing: View<string> = {
    render: () => {
      throw new Error('A hidden call called its view.');
    },
  };
  const app = marked('hidden').action(async ({ out }) => {
    await out.info('Building', throwing);
    await out.debug('Detail', throwing);
    await out.warn('Kept', bracketed);
  });
  await expect(written(app, ['-q'])).resolves.toEqual({
    code: 0,
    stderr: '[Kept]\n',
    stdout: '',
  });
});

test("a debug call drawn in a warning's look writes from -v alone", async () => {
  const app = marked('level').action(async ({ out }) => {
    await out.debug('The cache is stale.', lanes.warn);
  });
  await expect(written(app)).resolves.toMatchObject({ stderr: '' });
  await expect(written(app, ['-v'])).resolves.toMatchObject({
    stderr: '⚠ The cache is stale.\n',
  });
});

test("a declared view passed to a call resolves through the application's override", async () => {
  const app = new Application('declared', {
    views: [override(lanes.warn, { render: (message) => `WARN ${message}` })],
  }).action(async ({ out }) => {
    await out.info('Careful', lanes.warn);
  });
  await expect(written(app)).resolves.toMatchObject({ stderr: 'WARN Careful\n' });
});

test("an override of the method's own lane plays no part when the call passes a view", async () => {
  const app = new Application('own', {
    views: [override(lanes.info, { render: (message) => `INFO ${message}` })],
  }).action(async ({ out }) => {
    await out.info('Plain');
    await out.info('Framed', bracketed);
  });
  await expect(written(app)).resolves.toMatchObject({ stderr: 'INFO Plain\n[Framed]\n' });
});

test.each([
  { expected: 'done\n', name: 'text without a line break gains one', text: 'done' },
  { expected: 'done\n', name: 'text ending with LF gains none', text: 'done\n' },
  { expected: 'done\r\n', name: 'text ending with CRLF gains none', text: 'done\r\n' },
  { expected: 'done\n\n', name: 'text ending with two line breaks keeps both', text: 'done\n\n' },
  { expected: '\n', name: 'the empty string writes one line break', text: '' },
])('a passed view: $name', async ({ expected, text }) => {
  const app = new Application('breaks').action(async ({ out }) => {
    await out.warn('ignored', { render: () => text });
  });
  await expect(written(app)).resolves.toMatchObject({ stderr: expected });
});

test('a line break inside a style frame ends the message, with color on', async () => {
  const app = new Application('styled').action(async ({ out }) => {
    await out.warn('done', { render: (message, context) => context.style.red(`${message}\n`) });
  });
  const mock = mockProcess({ env: { FORCE_COLOR: '1' } });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(mock.stderr.text).toBe('\u001B[31mdone\n\u001B[39m');
});

test('the default print lane ends a message that ends with a line break with that one alone', async () => {
  const app = new Application('print').action(async ({ out }) => {
    await out.print('done\n');
    await out.print(style.dim('dim\n'));
    await out.print('spaced\n\n');
    await out.info('note\n');
  });
  await expect(written(app)).resolves.toEqual({
    code: 0,
    stderr: 'ℹ note\n',
    stdout: 'done\ndim\nspaced\n\n',
  });
});

test("an onEnvironment hook's warn draws through a passed view", async () => {
  const app = new Application('environment', {
    plugins: [
      plugin('fixture/environment', {
        onEnvironment: async ({ out }) => {
          await out.warn('Using defaults', bracketed);
          return {};
        },
      }),
    ],
  }).action(() => undefined);
  await expect(written(app)).resolves.toEqual({
    code: 0,
    stderr: '[Using defaults]\n',
    stdout: '',
  });
});
