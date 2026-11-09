/*
 * Acceptance plan for the help Command (docs/plugins/help.md#the-help-command), run in-process on
 * mockProcess.
 *
 * - Off by default. With `help()` or `command: false`, the root holds no `help` child.
 * - The page. `notes help <path>` prints the bytes `notes <path> --help` prints, for the root, a
 *   group, a nested child, an alias, a hidden Command, and a deprecated Command.
 * - The Command. The root page lists it first, and its own page shows its usage and argument.
 * - Unknown words. A word that names no child, and a word after a leaf, fail with exit 2 and core's
 *   unknown-command sentence, followed by help's hint at the help Command's page.
 * - Collisions. An application's own `help` child or alias fails at its `command()` call.
 * - Paging. With `paging: true`, a long page goes to the pager as a `--help` page does.
 * - By name. `invoke(['help'], ...)` captures the same page.
 */

import { Application, Command } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import type { HelpSettings } from '@loomcli/plugins/help';
import { mockProcess } from '@loomcli/testing';
import type { MockFields, ProgramCall } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

/** One of the notes Commands, which does nothing. */
function note(name: string, description: string) {
  return new Command(name, { description }).action(() => undefined);
}

/** An application with a leaf, an aliased group with a child, a hidden leaf, and a deprecated leaf. */
function notes(settings: HelpSettings | undefined) {
  return new Application('notes', {
    description: 'Keep notes in a folder.',
    plugins: [settings === undefined ? help() : help(settings)],
  })
    .command(note('add', 'Add a note.'))
    .command(
      new Command('cache', { description: 'Manage the cache.' })
        .alias('c')
        .command(note('clear', 'Empty the cache.')),
    )
    .command(new Command('debug', { description: 'Dump state.', hidden: true }).action(() => {}))
    .command(
      new Command('old', {
        deprecated: 'Use add instead.',
        description: 'Add, the old way.',
      }).action(() => {}),
    );
}

/** One run's exit code and streams. */
async function run(
  argv: readonly string[],
  fields: MockFields = {},
  settings: HelpSettings = { command: true },
) {
  const mock = mockProcess({ ...fields, argv });
  const status = await notes(settings).run({ process: mock });
  return { status, stderr: mock.stderr.text, stdout: mock.stdout.text };
}

test.each([undefined, { command: false }])('with %o, help attaches no Command', (settings) => {
  const names = notes(settings)
    .inspect()
    .root.children.map(({ name }) => name);
  expect(names).toEqual(['add', 'cache', 'debug', 'old']);
});

test.each([
  [[], []],
  [['add'], ['add']],
  [['cache'], ['cache']],
  [
    ['cache', 'clear'],
    ['cache', 'clear'],
  ],
  [
    ['c', 'clear'],
    ['cache', 'clear'],
  ],
  [['debug'], ['debug']],
  [['old'], ['old']],
  [['help'], ['help']],
])('help %j prints the page --help after %j prints', async (words, path) => {
  const expected = await run([...path, '--help']);
  expect(expected.status).toBe(0);
  await expect(run(['help', ...words])).resolves.toEqual(expected);
});

test('the root page lists the help Command first', async () => {
  const { stdout } = await run(['--help']);
  expect(stdout).toContain(
    [
      'COMMANDS',
      '  help             Show help for a command.',
      '  add              Add a note.',
      '  cache <command>  Manage the cache.',
    ].join('\n'),
  );
});

test("the help Command's own page states its usage and its argument", async () => {
  await expect(run(['help', '--help'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: [
      'notes help · Show help for a command.',
      '',
      'USAGE',
      '  notes help [command...] [options]',
      '',
      'ARGUMENTS',
      '  command  The command to show help for, as you would type it. The application itself when left out.',
      '',
      'GLOBAL OPTIONS',
      '  -h, --help  Show this help.',
      '',
    ].join('\n'),
  });
});

test.each([
  [['gte'], 'Unknown command "gte". Use one of: help, add, cache.'],
  [['cache', 'clera'], 'Unknown command "clera". Use one of: clear.'],
  [['add', 'extra'], 'Unknown command "extra". Supply the name of a declared command.'],
])('help %j fails as an unknown command and prints no page', async (words, sentence) => {
  await expect(run(['help', ...words])).resolves.toEqual({
    status: 2,
    stderr: `notes: ${sentence}\nRun "notes help --help" to see the usage.\n`,
    stdout: '',
  });
});

/** An own root Command that takes the name `help`, as its name or as an alias. */
const ownHelp = {
  'an own Command aliased help': () =>
    new Command('assist', { description: 'Mine.' }).alias('help').action(() => undefined),
  'an own help Command': () => note('help', 'Mine.'),
};

test.each(Object.entries(ownHelp))('%s collides with the help Command', (_label, own) => {
  expect(() => notes({ command: true }).command(own())).toThrow(
    expect.objectContaining({
      rule: expect.objectContaining({ identity: '@loomcli/core/sibling-name-taken' }),
    }),
  );
});

test('an own help Command installs beside help() with the setting off', () => {
  const app = notes(undefined).command(note('help', 'Mine.'));
  expect(app.inspect().root.children.map(({ name }) => name)).toContain('help');
});

test('with paging on, a long page from the help Command goes to the pager', async () => {
  const terminal: MockFields = {
    env: { TERM: 'xterm-256color' },
    terminal: { columns: 80, rows: 5 },
  };
  const page = await run(['--help'], terminal, { command: true });
  const calls: ProgramCall[] = [];
  const mock = mockProcess({
    ...terminal,
    argv: ['help'],
    programs: {
      '/bin/sh': (call) => {
        calls.push(call);
        return {};
      },
    },
  });
  await expect(notes({ command: true, paging: true }).run({ process: mock })).resolves.toBe(0);
  expect(calls.map(({ args, input }) => ({ args, input }))).toEqual([
    { args: ['-c', 'exec less'], input: page.stdout },
  ]);
  expect(mock.stdout.text).toBe('');
});

test('an invocation by name captures the same page', async () => {
  const app = notes({ command: true });
  const expected = await run(['cache', '--help']);
  const outcome = await app.invoke(
    ['help'],
    { args: { command: ['cache'] } },
    { process: mockProcess() },
  );
  expect(outcome).toMatchObject({ output: expected.stdout });
});
