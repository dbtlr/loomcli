/*
 * The plugins ADR-0165 names under "Every other plugin" print nothing at -v or -vv: help, format,
 * color, theme, verbose, interaction, suggestions, manifest, version, background, patch-console,
 * plain, and the pack's views. One application installs them all and runs on mockProcess, its
 * action rendering through every pack view, and each run at -vv writes exactly what it writes at
 * the default verbosity: the action's stdout, and on stderr no lane line of its own.
 */
import { Application, Command, style } from '@loomcli/core';
import { background } from '@loomcli/plugins/background';
import { box } from '@loomcli/plugins/box';
import { color } from '@loomcli/plugins/color';
import { format } from '@loomcli/plugins/format';
import { heading } from '@loomcli/plugins/heading';
import { help } from '@loomcli/plugins/help';
import { interaction } from '@loomcli/plugins/interaction';
import { list } from '@loomcli/plugins/list';
import { manifest } from '@loomcli/plugins/manifest';
import { patchConsole } from '@loomcli/plugins/patch-console';
import { plain } from '@loomcli/plugins/plain';
import { prose } from '@loomcli/plugins/prose';
import { records } from '@loomcli/plugins/records';
import { rule } from '@loomcli/plugins/rule';
import { step } from '@loomcli/plugins/step';
import { suggestions } from '@loomcli/plugins/suggestions';
import { table } from '@loomcli/plugins/table';
import { theme } from '@loomcli/plugins/theme';
import { verbose } from '@loomcli/plugins/verbose';
import { version } from '@loomcli/plugins/version';
import { expect, test } from 'vite-plus/test';

import { runOnMock } from './fixtures/in-process.ts';

interface Row {
  readonly name: string;
  readonly size: number;
}

const rows: readonly Row[] = [
  { name: 'notes.md', size: 12 },
  { name: 'todo.md', size: 3 },
];

/** An application that installs every plugin that prints nothing, and renders every pack view. */
function silentApplication() {
  return new Application('notes', {
    description: 'Keep notes in sync.',
    plugins: [
      help(),
      format(),
      color(),
      theme({ accent: style.cyan }),
      verbose(),
      interaction(),
      suggestions(),
      manifest(),
      version(),
      background(),
      patchConsole(),
      plain(),
    ],
    version: '1.5.0',
  }).command(
    new Command('show', { description: 'Show the notes.' }).action(async ({ out }) => {
      await out.render('Notes', heading());
      await out.render('', rule());
      await out.render('Two notes are kept.', prose());
      await out.render('Synced.', box({ title: 'Status' }));
      await out.render(['notes.md', 'todo.md'], list());
      await out.render(rows, table<Row>());
      await out.render(rows, records<Row>({ identifier: 'name' }));
      await out.info('Checked the notes.', step());
    }),
  );
}

/** Runs `notes ...argv` and answers its status and both streams. */
async function run(argv: readonly string[]) {
  return await runOnMock(silentApplication(), { argv, env: {} });
}

test.each([
  ['an action that renders every pack view', ['show']],
  ['help', ['--help']],
  ['version', ['--version']],
  ['the manifest', ['--manifest']],
  ['a mistyped Command that suggestions answers', ['shwo']],
])('%s writes the same bytes at -vv as at the default verbosity', async (_case, argv) => {
  const plainRun = await run(argv);
  // Each case writes something, so the comparison reads bytes and not two empty runs.
  expect(`${plainRun.stdout}${plainRun.stderr}`).not.toBe('');
  for (const level of ['-v', '-vv']) {
    const verbosely = await run([level, ...argv]);
    expect(verbosely).toEqual(plainRun);
  }
});

test('the action at -vv writes no lane line to stderr but its own step', async () => {
  const { status, stderr } = await run(['-vv', 'show']);
  expect(status).toBe(0);
  expect(stderr.split('\n').filter((line) => line.startsWith('› ') || line.includes('┆'))).toEqual(
    [],
  );
});
