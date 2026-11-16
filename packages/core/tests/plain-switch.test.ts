/*
 * Acceptance plan for the plain switch (docs/core/output.md#the-plain-switch, ADR-0169).
 *
 * Each case runs an Application through public APIs on a mock process in the test's own process,
 * under Node and Bun:
 *
 * - When it is on. A spelling of the plain-marked option before the first bare `--`, an alias's
 *   long spelling included, or `ACCESSIBLE` set and not empty, `0` and `false` included, turns the
 *   switch on, with or without a marked option. `ACCESSIBLE` empty, a spelling after `--`, and a
 *   word that attaches a value leave it off, and the attached value fails the parse as an ordinary
 *   Boolean option's does. A repeated spelling is the repetition error.
 * - The option still parses. `options.plain` reads what the operator typed, never the switch.
 * - What it turns off. With the switch on, a region without `input: true` on a terminal stderr
 *   reads `live` `false`, `out.draw` keeps the Application's `terminalControls` setting, a signal
 *   that ends the run shows no cursor unless the Application preserves controls, and a streamed
 *   message writes each completed line once, on a terminal stderr and on a terminal stdout.
 * - What it leaves alone. With the switch on, `-q` still hides the info lane, `NO_COLOR` and
 *   `FORCE_COLOR` still decide color, and `--no-input` still turns interaction off, while the
 *   switch alone leaves interaction on.
 * - Declarations. A second marked option and a configuration binding on the marked one fail under
 *   `@loomcli/core/plain-mark`, and `inspect()` publishes `plain` on each Boolean option node.
 */
import { Application, DeclarationError } from '@loomcli/core';
import type { Out } from '@loomcli/core';
import { configuration } from '@loomcli/plugins/config';
import { configInput } from '@loomcli/plugins/config/extension';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

/** The plain-marked option an application declares as its own. */
const marked = { plain: true, type: 'boolean' } as const;

/** An application that marks `--plain`, aliased `--accessible`, and takes any bare words. */
function plainApplication() {
  return new Application('notes')
    .globalOption('plain', { ...marked, aliases: ['accessible'] })
    .globalOption('quiet', { quiet: true, short: 'q', type: 'count' })
    .globalOption('input', { interaction: true, polarity: 'negative', type: 'boolean' })
    .argument('words', { variadic: true });
}

/** What one run on a terminal stderr saw: each region's `live`, the option, and interaction. */
async function seen(argv: readonly string[], env: Record<string, string | undefined> = {}) {
  const facts: Record<string, unknown> = {};
  const app = plainApplication().action(({ interactive, options, out }) => {
    facts.live = out.region().live;
    facts.option = options.plain;
    facts.interactive = interactive;
  });
  const mock = mockProcess({
    argv: [...argv],
    env: { TERM: 'xterm-256color', ...env },
    terminal: { columns: 40, keys: [], rows: 24 },
  });
  const code = await app.run({ process: mock });
  return { code, facts, stderr: mock.stderr.text };
}

test.each([
  { argv: [], env: {}, live: true },
  { argv: ['--plain'], env: {}, live: false },
  { argv: ['--accessible'], env: {}, live: false },
  { argv: ['word', '--plain'], env: {}, live: false },
  { argv: ['--', '--plain'], env: {}, live: true },
  { argv: [], env: { ACCESSIBLE: '1' }, live: false },
  { argv: [], env: { ACCESSIBLE: '0' }, live: false },
  { argv: [], env: { ACCESSIBLE: 'false' }, live: false },
  { argv: [], env: { ACCESSIBLE: '' }, live: true },
])('with argv $argv and $env, a region without input reads live $live', async (scenario) => {
  const run = await seen(scenario.argv, scenario.env);
  expect(run.code).toBe(0);
  expect(run.facts.live).toBe(scenario.live);
});

test('ACCESSIBLE turns the switch on in an Application that marks no option', async () => {
  const lives: boolean[] = [];
  const app = new Application('notes').action(({ out }) => {
    lives.push(out.region().live);
  });
  for (const env of [{}, { ACCESSIBLE: '1' }]) {
    const mock = mockProcess({
      env: { TERM: 'xterm-256color', ...env },
      terminal: { columns: 40, rows: 24 },
    });
    await expect(app.run({ process: mock })).resolves.toBe(0);
  }
  expect(lives).toEqual([true, false]);
});

test('options.plain reads what the operator typed, never whether the switch is on', async () => {
  await expect(seen(['--plain'])).resolves.toMatchObject({ facts: { option: true } });
  await expect(seen([], { ACCESSIBLE: '1' })).resolves.toMatchObject({ facts: { option: false } });
});

test('a word that attaches a value turns nothing on and fails the parse as a Boolean option does', async () => {
  const run = await seen(['--plain=yes']);
  expect(run.code).toBe(2);
  expect(run.facts).toEqual({});
  expect(run.stderr).toContain(
    'Boolean option "--plain" does not accept a value. Supply the flag alone.',
  );
});

test('a repeated spelling is the repetition error', async () => {
  const run = await seen(['--plain', '--plain']);
  expect(run.code).toBe(2);
  expect(run.stderr).toContain(
    'Option "--plain" can be supplied only once. Remove the repeated option.',
  );
});

test.each([
  { preserve: false, text: 'up' },
  { preserve: true, text: '\u001B[1Aup' },
])(
  'with the switch on, preserving controls $preserve, out.draw writes $text',
  async ({ preserve, text }) => {
    const rendering = preserve ? { terminalControls: 'preserve' as const } : {};
    const app = new Application('notes', { rendering }).action(async ({ out }) => {
      await out.draw(undefined, { render: () => '\u001B[1Aup' });
    });
    const mock = mockProcess({
      env: { ACCESSIBLE: '1', TERM: 'xterm-256color' },
      terminal: { columns: 40, rows: 24, streams: ['stderr'] },
    });
    await expect(app.run({ process: mock })).resolves.toBe(0);
    expect(mock.stderr.text).toBe(text);
  },
);

test.each([
  { preserve: false, text: 'ℹ working\n' },
  { preserve: true, text: 'ℹ working\n\u001B[?25h' },
])(
  'with the switch on, preserving controls $preserve, a signal that ends the run writes $text',
  async ({ preserve, text }) => {
    const ready = Promise.withResolvers<void>();
    const rendering = preserve ? { terminalControls: 'preserve' as const } : {};
    const app = new Application('notes', { rendering }).action(async ({ out, signal }) => {
      await out.info('working');
      ready.resolve();
      await new Promise((resolve) => {
        signal.addEventListener('abort', resolve, { once: true });
      });
    });
    const mock = mockProcess({
      env: { ACCESSIBLE: '1', TERM: 'xterm-256color' },
      terminal: { columns: 40, rows: 24, streams: ['stderr'] },
    });
    const running = app.run({ process: mock });
    await ready.promise;
    mock.signals.raise('SIGINT');
    await expect(running).resolves.toBe(130);
    // The shutdown ends, and restores the terminal, on the turn after the run resolves.
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    expect([mock.endedBy, mock.stderr.text]).toEqual(['SIGINT', text]);
  },
);

/** An async iterable that yields each part in turn. */
async function* chunks(...parts: readonly string[]): AsyncGenerator<string> {
  for (const part of parts) {
    yield part;
  }
}

/** The writes a run made to the streams on the terminal, with `--plain`, as `stream:text`. */
async function streamedWrites(
  streams: readonly ('stdout' | 'stderr')[],
  write: (out: Out) => Promise<void>,
): Promise<string[]> {
  const mock = mockProcess({
    argv: ['--plain'],
    env: { TERM: 'xterm-256color' },
    terminal: { columns: 40, rows: 24, streams },
  });
  const app = new Application('notes')
    .globalOption('plain', marked)
    .action(async ({ out }) => write(out));
  await expect(app.run({ process: mock })).resolves.toBe(0);
  return mock.transcript.map(({ stream, text }) => `${stream}:${text}`);
}

test('with the switch on, a streamed message on a terminal stderr writes each completed line once', async () => {
  const writes = await streamedWrites(['stdout', 'stderr'], (out) =>
    out.info(chunks('Fetched the ', 'first page.\nThen the sec', 'ond', ' page.')),
  );
  expect(writes).toEqual([
    'stderr:ℹ Fetched the first page.\n',
    'stderr:  Then the second page.\n',
  ]);
});

test('with the switch on, a streamed print on a terminal stdout writes each completed line once', async () => {
  const writes = await streamedWrites(['stdout'], (out) =>
    out.print(chunks('ab', 'c\nde', 'f\ng', 'h')),
  );
  expect(writes).toEqual(['stdout:abc\n', 'stdout:def\n', 'stdout:gh\n']);
});

test('with the switch on, -q still hides the info lane', async () => {
  const app = plainApplication().action(async ({ out }) => {
    await out.info('hidden');
    await out.warn('shown');
  });
  const mock = mockProcess({
    argv: ['--plain', '-q'],
    env: { TERM: 'xterm-256color' },
    terminal: { columns: 40, rows: 24 },
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(mock.stderr.text).toBe('⚠ shown\n');
});

test.each([
  { colored: true, env: { FORCE_COLOR: '1' } },
  { colored: false, env: { NO_COLOR: '1' } },
])('with the switch on and $env, color is on: $colored', async ({ colored, env }) => {
  const app = plainApplication().action(async ({ out, style }) => {
    await out.print(style.red('shown'));
  });
  const mock = mockProcess({
    argv: ['--plain'],
    env: { COLORTERM: 'truecolor', TERM: 'xterm-256color', ...env },
    terminal: { columns: 40, rows: 24 },
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(mock.stdout.text.includes('\u001B[31m')).toBe(colored);
});

test('the switch leaves interaction on, and --no-input still turns it off beside it', async () => {
  await expect(seen(['--plain'])).resolves.toMatchObject({ facts: { interactive: true } });
  await expect(seen(['--plain', '--no-input'])).resolves.toMatchObject({
    facts: { interactive: false },
  });
});

/** The rule and the sentence of the declaration fault `declare` throws. */
function fault(declare: () => unknown): { rule: string | undefined; text: string } {
  try {
    declare();
  } catch (error) {
    if (error instanceof DeclarationError) {
      return { rule: error.rule?.identity, text: [error.sentence, error.correction].join(' ') };
    }
    throw error;
  }
  throw new Error('The declaration threw nothing.');
}

const rule = '@loomcli/core/plain-mark';

test('a second plain-marked option is a declaration error under the plain-mark rule', () => {
  const thrown = fault(() =>
    new Application('notes').globalOption('plain', marked).globalOption('accessible', marked),
  );
  expect(thrown.rule).toBe(rule);
  expect(thrown.text).toContain(
    'Global option "plain" and global option "accessible" both declare plain. Mark one option.',
  );
});

test('a configuration binding on the plain-marked option is a declaration error', () => {
  const config = configuration({ schema: z.record(z.string(), z.unknown()) }).plugin;
  const thrown = fault(() =>
    new Application('notes', { plugins: [config] }).globalOption('plain', {
      ...marked,
      extensions: [configInput({ path: 'plain' })],
    }),
  );
  expect(thrown.rule).toBe(rule);
  expect(thrown.text).toContain(
    `Global option "plain" declares plain and carries configuration binding "@loomcli/plugins/config/input", a second source for the run's plain switch.`,
  );
});

test('inspect() publishes plain on each Boolean option node, true on the marked one alone', () => {
  const graph = new Application('notes')
    .globalOption('plain', marked)
    .globalOption('quiet', { type: 'boolean' })
    .action(() => undefined)
    .inspect();
  expect(graph.globals.map((node) => [node.name, node.type === 'boolean' && node.plain])).toEqual([
    ['plain', true],
    ['quiet', false],
  ]);
});
