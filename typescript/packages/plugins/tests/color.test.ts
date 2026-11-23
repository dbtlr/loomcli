/*
 * Acceptance plan for the color plugin (docs/plugins/color.md#color-plugin).
 *
 * - A fixture application installs `help()`, `loomTheme()`, and `color()`. Its `--help` lists
 *   `--[no-]color` among the global options. The option reads `control: true` in
 *   control-marks.test.ts, and the rest of the choice's rules are proven in
 *   packages/core/tests/color.test.ts.
 * - On a capable terminal with `FORCE_COLOR=1`, `--help --no-color` prints the page with no color
 *   escape, and piped, `--help --color` prints it with color escapes.
 * - An application that marks its own option and installs the plugin fails with the two-marks
 *   error, which packages/core/tests/color-declarations.test.ts proves.
 * - A consumer installs the packed pack, imports `@loomcli/plugins/color`, compiles against its
 *   declarations, and `pnpm check:packed` resolves the subpath from the packed tarball under Node
 *   and Bun.
 */
import { Application } from '@loomcli/core';
import { color } from '@loomcli/plugins/color';
import { help } from '@loomcli/plugins/help';
import { loomTheme } from '@loomcli/plugins/theme';
import { expect, test } from 'vite-plus/test';

import { runOnMock } from './fixtures/in-process.ts';

/** One SGR sequence and the parameters it carries. */
const sgr = new RegExp(`${String.fromCodePoint(27)}\\[(?<parameters>[0-9;]*)m`, 'gu');

/** Whether some SGR sequence in the text sets a foreground color. */
function hasColor(text: string): boolean {
  return [...text.matchAll(sgr)].some((match) =>
    (match.groups?.parameters ?? '')
      .split(';')
      .some((parameter) => /^(?:3[0-8]|9[0-7])$/u.test(parameter)),
  );
}

/** The fixture's help page for an argv, on a capable terminal or piped, under the variables given. */
async function page(argv: string[], terminal: boolean, env: Record<string, string | undefined>) {
  const application = new Application('kit', {
    description: 'A fixture application.',
    plugins: [help(), loomTheme(), color()],
  }).action(() => {});
  return await runOnMock(application, {
    argv,
    env: { COLORTERM: undefined, NO_COLOR: undefined, TERM: 'xterm', ...env },
    ...(terminal ? { terminal: { columns: 100, rows: 24 } } : {}),
  });
}

test('--no-color prints no color on a capable terminal, even under FORCE_COLOR, and --color prints it piped', async () => {
  const forced = { FORCE_COLOR: '1' };
  const colorful = await page(['--help'], true, forced);
  expect(colorful.status).toBe(0);
  expect(hasColor(colorful.stdout)).toBe(true);
  const off = await page(['--help', '--no-color'], true, forced);
  expect(off.status).toBe(0);
  expect(off.stdout).toContain('--[no-]color');
  expect(hasColor(off.stdout)).toBe(false);
  const piped = await page(['--help'], false, {});
  expect(hasColor(piped.stdout)).toBe(false);
  const on = await page(['--help', '--color'], false, {});
  expect(on.status).toBe(0);
  expect(hasColor(on.stdout)).toBe(true);
});
