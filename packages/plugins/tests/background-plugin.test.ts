/*
 * Acceptance plan for the background plugin (docs/plugins/background.md#background-plugin).
 *
 * - A fixture application installs `loomTheme()` and `background()`. Its `--help` lists the
 *   `--background` row with its description and accepted values, its manifest marks the option
 *   `control` and `background` with the enum schema, and every other string option node reads
 *   `background: false`.
 * - On a scripted light terminal, `--background=dark` prints the Loom theme's dark side and writes
 *   no query, and `--background=blue` fails with exit 2 and `Supply dark or light.`
 * - An application that marks its own option and installs the plugin fails with the two-marks
 *   error.
 * - A consumer installs the packed pack, imports `@loomcli/plugins/background`, compiles against
 *   its declarations, and `pnpm check:packed` resolves the subpath from the packed tarball under
 *   Node and Bun.
 */

// Acceptance plan: see packages/core/tests/background.test.ts.

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { backgroundApplication } from './fixtures/background-app.ts';
import { runOnMock } from './fixtures/in-process.ts';

const fixture = new URL('fixtures/background-run.mjs', import.meta.url);

/**
 * Runs the fixture application on a mock terminal 200 columns wide, so help never wraps, whose
 * keyboard would see core's background query; a query the run writes lands on stderr.
 */
async function run(argv: string[]) {
  return await runOnMock(
    backgroundApplication(),
    {
      argv,
      env: { COLORTERM: 'truecolor', TERM: 'xterm-256color' },
      terminal: { columns: 200, keys: [], rows: 24 },
    },
    { rendering: { color: 'always' } },
  );
}

/** The Loom theme's highlight on each background at truecolor, around the word it styles. */
const highlight = {
  dark: '\u001b[38;2;201;123;54mSaved\u001b[39m',
  light: '\u001b[38;2;156;90;30mSaved\u001b[39m',
};

// A process test under ADR-0103: the query is read from a terminal in raw mode, and only the
// Process fixture's scripted terminal answers it with a background.
test('the scripted light terminal answers the query, and the Loom theme prints its light side', () => {
  expect(invoke(fixture, [])).toEqual({
    status: 0,
    stderr: 'queried 1\n',
    stdout: `${highlight.light} light\n`,
  });
});

test('--background=dark prints the dark side and writes no query', async () => {
  await expect(run(['--background=dark'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: `${highlight.dark} dark\n`,
  });
});

test('--background=blue fails validation with exit 2 and the plugin issue', async () => {
  const result = await run(['--background=blue']);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain('Supply dark or light.');
});

test('help lists the option with its description and accepted values', async () => {
  const { stdout } = await run(['--help']);
  const page = stdout.replaceAll(String.fromCodePoint(27), '').replaceAll(/\[[\d;]*m/gu, '');
  expect(page).toContain(
    '--background <background>  Pick colors for this terminal background instead of detecting it.',
  );
  expect(page).toContain('One of: dark, light.');
});

test('the manifest marks the option control and background with the enum schema', async () => {
  const { stdout } = await run(['--manifest']);
  const document = JSON.parse(stdout);
  const globals = Object.fromEntries(
    document.globals.map((entry: { name: string }) => [entry.name, entry]),
  );
  expect(globals.background).toMatchObject({
    background: true,
    control: true,
    schema: { enum: ['dark', 'light'] },
    type: 'string',
  });
  expect(globals.tag.background).toBe(false);
});
