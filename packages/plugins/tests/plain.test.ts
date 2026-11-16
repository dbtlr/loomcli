/*
 * Acceptance plan for the plain plugin (docs/plugins/plain.md).
 *
 * - A fixture application installs `help()`, `manifest()`, and `plain()`. Its `--help` lists
 *   `--plain` with its description among the global options, and its `--manifest` marks the option
 *   `control` and `plain`. The option reads `control: true` in control-marks.test.ts, and the rest
 *   of the switch's rules are proven in packages/core/tests/plain-switch.test.ts.
 * - On a terminal stderr, `--plain` makes a region without input read `live` `false`.
 * - An application that marks its own option and installs the plugin fails with the two-marks
 *   error under `@loomcli/core/plain-mark`.
 */
import { Application, DeclarationError } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { manifest } from '@loomcli/plugins/manifest';
import { plain } from '@loomcli/plugins/plain';
import { expect, test } from 'vite-plus/test';

import { runOnMock } from './fixtures/in-process.ts';

/** The fixture application, whose action notes whether a region without input is live. */
function kit(seen: { live?: boolean } = {}) {
  return new Application('kit', {
    description: 'A fixture application.',
    plugins: [help(), manifest(), plain()],
  }).action(({ out }) => {
    seen.live = out.region().live;
  });
}

test('help lists --plain with its description among the global options', async () => {
  const run = await runOnMock(kit(), { argv: ['--help'], env: {} });
  expect(run.status).toBe(0);
  expect(run.stdout).toMatch(
    /--plain\s+Never redraw: print progress as plain lines and ask questions line by line\./u,
  );
});

test('the manifest marks --plain as a control option that carries the plain mark', async () => {
  const run = await runOnMock(kit(), { argv: ['--manifest'], env: {} });
  expect(run.status).toBe(0);
  const document: unknown = JSON.parse(run.stdout);
  expect(document).toMatchObject({
    globals: expect.arrayContaining([
      expect.objectContaining({ control: true, long: '--plain', name: 'plain', plain: true }),
    ]),
  });
});

test('on a terminal stderr, --plain turns the switch on, so a region without input is not live', async () => {
  for (const [argv, live] of [
    [[], true],
    [['--plain'], false],
  ] as const) {
    const seen: { live?: boolean } = {};
    const run = await runOnMock(kit(seen), {
      argv: [...argv],
      env: { TERM: 'xterm-256color' },
      terminal: { columns: 40, rows: 24 },
    });
    expect(run.status).toBe(0);
    expect(seen.live).toBe(live);
  }
});

test('the plugin beside an option of its own that carries the mark is the two-marks error', () => {
  let rule: string | undefined = undefined;
  try {
    new Application('kit', { plugins: [plain()] }).globalOption('accessible', {
      plain: true,
      type: 'boolean',
    });
  } catch (error) {
    rule = error instanceof DeclarationError ? error.rule?.identity : undefined;
  }
  expect(rule).toBe('@loomcli/core/plain-mark');
});
