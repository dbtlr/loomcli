import { DeclarationError } from '@loomcli/core';
/*
 * Acceptance plan for the Loom theme (docs/plugins/theme.md).
 *
 * The implementation increment proves these cases through public APIs:
 *
 * - Packed consumers import both factories and `LoomThemeOverrides` from the same subpath. Neither
 *   import installs a plugin. Installing either with another theme fails the existing identity or
 *   theme-slot check.
 * - Every default emits the exact foreground in the dark table at each depth under a dark
 *   background, and in the light table under a light one, with no background or modifier operation.
 *   A nested `primary` restores terminal foreground inside a colored span while preserving the
 *   surrounding background and modifiers.
 * - Omitted and `undefined` overrides retain defaults. A replacement chain discards the original
 *   mapping, both of its sides, and their fallbacks, and emits the same bytes under both
 *   backgrounds; an adaptive replacement emits its own sides. `style` inherits the enclosing style,
 *   and `style.resetForeground` restores terminal foreground. Custom `undefined` keys remain valid
 *   tokens.
 * - Compiler checks cover literal custom names, an adaptive override and an adaptive custom key,
 *   independent imported styles, invalid values, reserved names, and semantic references. An editor
 *   completion check suggests all seven core keys and omits keys already supplied.
 * - A fixture application installs `loomTheme()` and styles a token with the default highlight on
 *   a color terminal. Under ordinary piping or automatic `NO_COLOR`, the same content and layout
 *   contain no color escapes. Help and version restyling remains a separate increment.
 * - Process fixtures run on Node and Bun against the built packages. Packed-consumer evidence
 *   exercises the published declarations and the named palette at each color depth.
 *
 * `scripts/check-theme-contract.mjs` checks the built factory export against the compiler and
 * editor. `check:types` runs it after the existing declaration checks, so `pnpm verify` and PR CI
 * include it. It verifies compilation and editor completion, not palette merging or output
 * behavior. For a standalone run, use `pnpm build && node scripts/check-theme-contract.mjs`.
 */
import { expect, test } from 'vite-plus/test';

import { run as fixtureRun } from './fixtures/loom-theme.js';

async function palette(options: Record<string, unknown> = {}) {
  return await fixtureRun([JSON.stringify(options)]);
}

test.each([
  [{}, ['90', '33', '32', '93', '31', '34']],
  [
    { TERM: 'xterm-256color' },
    ['38;5;245', '38;5;172', '38;5;108', '38;5;178', '38;5;131', '38;5;67'],
  ],
  [
    { COLORTERM: 'truecolor' },
    [
      '38;2;139;147;163',
      '38;2;201;123;54',
      '38;2;122;143;123',
      '38;2;226;185;61',
      '38;2;192;69;50',
      '38;2;91;125;163',
    ],
  ],
])('the Loom palette supplies only the specified foregrounds at %j', async (env, colors) => {
  const names = ['dim', 'highlight', 'success', 'warning', 'error', 'info'];
  await expect(
    palette({ env, rendering: { color: 'always', modifiers: 'always' } }),
  ).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: `primary|${names
      .map((name, index) => `\u001b[${colors[index]}m${name}\u001b[39m`)
      .join('|')}`,
  });
});

test.each([
  [{}, ['90', '33', '32', '93', '31', '34']],
  [
    { TERM: 'xterm-256color' },
    ['38;5;243', '38;5;130', '38;5;65', '38;5;94', '38;5;131', '38;5;60'],
  ],
  [
    { COLORTERM: 'truecolor' },
    [
      '38;2;95;107;122',
      '38;2;156;90;30',
      '38;2;78;107;80',
      '38;2;138;109;14',
      '38;2;192;69;50',
      '38;2;74;107;145',
    ],
  ],
])(
  'the Loom palette supplies its light foregrounds on a light background at %j',
  async (env, colors) => {
    const names = ['dim', 'highlight', 'success', 'warning', 'error', 'info'];
    const rendering = { color: 'always', modifiers: 'always' };
    await expect(palette({ background: 'light', env, rendering })).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: `primary|${names
        .map((name, index) => `\u001b[${colors[index]}m${name}\u001b[39m`)
        .join('|')}`,
    });
  },
);

test('a whole-token override is one value on both backgrounds', async () => {
  const options = {
    overrides: { highlight: ['cyan'] },
    rendering: { color: 'always', modifiers: 'always' },
    tokens: ['highlight'],
  };
  const fixtureResult1 = await palette({ ...options, background: 'dark' });
  const dark = fixtureResult1.stdout;
  expect(dark).toBe('\u001b[36mhighlight\u001b[39m');
  const fixtureResult2 = await palette({ ...options, background: 'light' });
  expect(fixtureResult2.stdout).toBe(dark);
});

test('defaults change foregrounds while preserving enclosing backgrounds and modifiers', async () => {
  const fixtureResult3 = await palette({
    outer: true,
    rendering: { color: 'always', modifiers: 'always' },
    tokens: ['primary', 'dim', 'highlight'],
  });
  expect(fixtureResult3.stdout).toBe(
    '\u001b[44;1mprimary\u001b[31m|\u001b[90mdim\u001b[31m|\u001b[33mhighlight\u001b[39;49;22m',
  );
});

test('undefined keeps a default, replacements remove it, and custom undefined names inherit', async () => {
  const fixtureResult4 = await palette({
    overrides: {
      absent: null,
      highlight: null,
      identifier: ['magenta'],
      success: ['cyan', 'bold'],
    },
    rendering: { color: 'always', modifiers: 'always' },
    tokens: ['highlight', 'success', 'identifier', 'absent'],
  });
  expect(fixtureResult4.stdout).toBe(
    '\u001b[33mhighlight\u001b[39m|\u001b[36;1msuccess\u001b[39;22m|\u001b[35midentifier\u001b[39m|absent',
  );
  const fixtureResult5 = await palette({
    outer: true,
    overrides: { highlight: [], success: ['resetForeground'] },
    rendering: { color: 'always', modifiers: 'always' },
    tokens: ['highlight', 'success'],
  });
  expect(fixtureResult5.stdout).toBe('\u001b[31;44;1mhighlight|\u001b[39msuccess\u001b[49;22m');
});

test.each([
  {},
  { env: { NO_COLOR: '1' }, tty: true },
  { env: { FORCE_COLOR: '1' }, rendering: { color: 'never' } },
  { bare: true, rendering: { color: 'always' } },
  { absent: true, rendering: { color: 'always' } },
])(
  'theme installation leaves plain destinations and bare mappings uncolored: %j',
  async (options) => {
    await expect(palette(options)).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: 'primary|dim|highlight|success|warning|error|info',
    });
  },
);

test('FORCE_COLOR retains precedence over NO_COLOR without a TTY', async () => {
  const fixtureResult6 = await palette({
    env: { FORCE_COLOR: '1', NO_COLOR: '1' },
    tokens: ['success'],
  });
  expect(fixtureResult6.stdout).toBe('\u001b[32msuccess\u001b[39m');
});

test.each(['identity', 'slot'])(
  'the named theme retains the existing %s collision rule',
  async (collision) => {
    await expect(palette({ collision })).rejects.toThrow(DeclarationError);
    await expect(palette({ collision })).rejects.toThrow('@loomcli/plugins/theme');
    await expect(palette({ collision })).rejects.toThrow(
      collision === 'identity' ? 'Install each plugin once.' : 'theme slot',
    );
  },
);

test('installing the named theme leaves unmarked text unchanged', async () => {
  await expect(
    palette({ literal: 'plain', rendering: { color: 'always', modifiers: 'always' } }),
  ).resolves.toEqual({ status: 0, stderr: '', stdout: 'plain' });
});
