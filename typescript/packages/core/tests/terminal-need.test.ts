/*
 * Acceptance plan for a Command that needs a terminal (docs/core/commands.md#a-command-that-needs-a-terminal).
 *
 * - The test. A Command that declares `needsTerminal()` runs when stdin and stderr are terminals
 *   and the run is not under CI, whatever stdout is and whatever the interaction mark reads. Run
 *   with stdin piped, with stderr redirected, or under `CI=true`, it fails before the action with
 *   `TerminalUnavailableError`, exit 1, failure code `terminal-unavailable`, and the sentence the
 *   reference states. A Command that declares nothing runs everywhere.
 * - By name. `app.invoke` and an action's `invoke` refuse it with the same failure, because an
 *   invocation by name has no terminal.
 * - The graph. `inspect()` publishes `needsTerminal` on every Command node, and a group that
 *   declares it is the command-without-action fault.
 */
import {
  Application,
  Command,
  DeclarationError,
  FatalError,
  plugin,
  TerminalUnavailableError,
} from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

const sentence =
  'Command "top" needs a terminal. Run "monitor top" with stdin and stderr at a terminal, outside CI.';

/** An application whose `top` Command needs a terminal and records each dispatch. */
function monitor() {
  const ran: string[] = [];
  const app = new Application('monitor')
    .globalOption('input', {
      description: 'Ask no questions.',
      interaction: true,
      polarity: 'negative',
      type: 'boolean',
    })
    .command(
      new Command('top', { description: 'Show a live view.' }).needsTerminal().action(() => {
        ran.push('top');
      }),
    )
    .command(
      new Command('list').action(async ({ invoke }) => {
        const outcome = await invoke(['top'], {});
        ran.push(outcome.status === 'failed' ? outcome.form.code : outcome.status);
      }),
    );
  return { app, ran };
}

test.each([
  { name: 'every stream a terminal', streams: undefined },
  { name: 'stdout piped', streams: ['stderr'] as const },
])('a declared Command runs at a terminal: $name', async ({ streams }) => {
  const { app, ran } = monitor();
  const mock = mockProcess({
    argv: ['top'],
    terminal: { columns: 80, keys: [], rows: 24, ...(streams ? { streams } : {}) },
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(ran).toEqual(['top']);
});

test('a declared Command runs at a terminal with interaction turned off', async () => {
  const { app, ran } = monitor();
  const mock = mockProcess({
    argv: ['top', '--no-input'],
    terminal: { columns: 80, keys: [], rows: 24 },
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(ran).toEqual(['top']);
});

test.each([
  { env: {}, name: 'stdin piped', terminal: { columns: 80, rows: 24 } },
  {
    env: {},
    name: 'stderr redirected',
    terminal: { columns: 80, keys: [], rows: 24, streams: ['stdout'] as const },
  },
  { env: { CI: 'true' }, name: 'under CI', terminal: { columns: 80, keys: [], rows: 24 } },
])('a declared Command fails before its action without a terminal: $name', async (scenario) => {
  const { app, ran } = monitor();
  const mock = mockProcess({ argv: ['top'], env: scenario.env, terminal: scenario.terminal });
  await expect(app.run({ process: mock })).resolves.toBe(1);
  expect(ran).toEqual([]);
  expect(mock.stderr.text).toBe(`${sentence}\n`);
});

test.each([
  { name: 'a missing required argument', values: [] },
  { name: 'a rejected value', values: ['nope'] },
])('the terminal fault outranks $name with stdin piped', async ({ values }) => {
  const codes: string[] = [];
  const ran: string[] = [];
  const app = new Application('monitor', {
    plugins: [
      plugin('fixture/terminal-rank', {
        onLog: (event) => {
          if (event.failure) {
            codes.push(event.failure.code);
          }
        },
      }),
    ],
  }).command(
    new Command('top')
      .needsTerminal()
      .argument('interval', { required: true, validate: z.string().regex(/^\d+$/u) })
      .action(() => {
        ran.push('top');
      }),
  );
  const mock = mockProcess({
    argv: ['top', ...values],
    terminal: { columns: 80, rows: 24, streams: ['stderr'] },
  });
  await expect(app.run({ process: mock })).resolves.toBe(1);
  expect(codes).toEqual(['terminal-unavailable']);
  expect(mock.stderr.text).toBe(`${sentence}\n`);
  expect(ran).toEqual([]);
});

test('a Command that declares nothing runs without a terminal', async () => {
  const ran: string[] = [];
  const app = new Application('monitor').command(
    new Command('top').action(() => {
      ran.push('top');
    }),
  );
  await expect(app.run({ process: mockProcess({ argv: ['top'] }) })).resolves.toBe(0);
  expect(ran).toEqual(['top']);
});

test('app.invoke refuses a declared Command with the same failure', async () => {
  const { app, ran } = monitor();
  const outcome = await app.invoke(['top'], {}, { process: mockProcess() });
  expect(ran).toEqual([]);
  expect(outcome).toMatchObject({ exitCode: 1, status: 'failed' });
  if (outcome.status !== 'failed') {
    return;
  }
  expect(outcome.failure).toBeInstanceOf(TerminalUnavailableError);
  expect(outcome.failure).toBeInstanceOf(FatalError);
  expect(outcome.failure.message).toBe(sentence);
  expect(outcome.failure).toMatchObject({ command: ['top'] });
  expect(outcome.form.code).toBe('terminal-unavailable');
  expect(TerminalUnavailableError.code).toBe('terminal-unavailable');
});

test("an action's invoke refuses a declared Command, even at a terminal", async () => {
  const { app, ran } = monitor();
  const mock = mockProcess({ argv: ['list'], terminal: { columns: 80, keys: [], rows: 24 } });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(ran).toEqual(['terminal-unavailable']);
});

test('the root names the application in its sentence', async () => {
  const app = new Application('monitor').needsTerminal().action(() => undefined);
  const mock = mockProcess();
  await expect(app.run({ process: mock })).resolves.toBe(1);
  expect(mock.stderr.text).toBe(
    'The root Command needs a terminal. Run "monitor" with stdin and stderr at a terminal, outside CI.\n',
  );
});

test('inspect() publishes needsTerminal on every Command node', () => {
  const { app } = monitor();
  const graph = app.inspect();
  expect(graph.root.needsTerminal).toBe(false);
  expect(graph.root.children.map((child) => [child.name, child.needsTerminal])).toEqual([
    ['top', true],
    ['list', false],
  ]);
});

test('a group that declares it needs a terminal is a Command without an action', () => {
  const group = new Command('watch')
    .needsTerminal()
    .command(new Command('cpu').action(() => undefined));
  let thrown: unknown = undefined;
  try {
    new Application('monitor').command(group);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(DeclarationError);
  expect(thrown).toMatchObject({
    correction:
      'Declare needsTerminal on the Command whose action needs it, or register an action.',
    rule: { identity: '@loomcli/core/command-without-action' },
    sentence: 'Command "watch" needs a terminal but registers no action.',
  });
});
