import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

function palette(options: Record<string, unknown> = {}) {
  return invoke(new URL('fixtures/loom-theme.mjs', import.meta.url), [JSON.stringify(options)]);
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
])('the Loom palette supplies only the specified foregrounds at %j', (env, colors) => {
  const names = ['dim', 'highlight', 'success', 'warning', 'error', 'info'];
  expect(palette({ env, rendering: { color: 'always', modifiers: 'always' } })).toEqual({
    status: 0,
    stderr: '',
    stdout: `primary|${names
      .map((name, index) => `\u001b[${colors[index]}m${name}\u001b[39m`)
      .join('|')}`,
  });
});

test('defaults change foregrounds while preserving enclosing backgrounds and modifiers', () => {
  expect(
    palette({
      outer: true,
      rendering: { color: 'always', modifiers: 'always' },
      tokens: ['primary', 'dim', 'highlight'],
    }).stdout,
  ).toBe(
    '\u001b[44;1mprimary\u001b[31m|\u001b[90mdim\u001b[31m|\u001b[33mhighlight\u001b[39;49;22m',
  );
});

test('undefined keeps a default, replacements remove it, and custom undefined names inherit', () => {
  expect(
    palette({
      overrides: {
        absent: null,
        highlight: null,
        identifier: ['magenta'],
        success: ['cyan', 'bold'],
      },
      rendering: { color: 'always', modifiers: 'always' },
      tokens: ['highlight', 'success', 'identifier', 'absent'],
    }).stdout,
  ).toBe(
    '\u001b[33mhighlight\u001b[39m|\u001b[36;1msuccess\u001b[39;22m|\u001b[35midentifier\u001b[39m|absent',
  );
  expect(
    palette({
      outer: true,
      overrides: { highlight: [], success: ['resetForeground'] },
      rendering: { color: 'always', modifiers: 'always' },
      tokens: ['highlight', 'success'],
    }).stdout,
  ).toBe('\u001b[31;44;1mhighlight|\u001b[39msuccess\u001b[49;22m');
});

test.each([
  {},
  { env: { NO_COLOR: '1' }, tty: true },
  { env: { FORCE_COLOR: '1' }, rendering: { color: 'never' } },
  { bare: true, rendering: { color: 'always' } },
  { absent: true, rendering: { color: 'always' } },
])('theme installation leaves plain destinations and bare mappings uncolored: %j', (options) => {
  expect(palette(options)).toEqual({
    status: 0,
    stderr: '',
    stdout: 'primary|dim|highlight|success|warning|error|info',
  });
});

test('FORCE_COLOR retains precedence over NO_COLOR without a TTY', () => {
  expect(palette({ env: { FORCE_COLOR: '1', NO_COLOR: '1' }, tokens: ['success'] }).stdout).toBe(
    '\u001b[32msuccess\u001b[39m',
  );
});

test.each(['identity', 'slot'])(
  'the named theme retains the existing %s collision rule',
  (collision) => {
    const result = palette({ collision });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('@loomcli/plugins/theme');
    expect(result.stderr).toContain(
      collision === 'identity' ? 'Install each plugin once.' : 'theme slot',
    );
  },
);

test.each(['null', 'applied', 'semantic', 'reserved'])(
  'named theme rejects an invalid %s override through the core declaration boundary',
  (invalidValue) => {
    const result = palette({ invalidValue, overrides: {} });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Invalid declaration:');
    expect(result.stderr).toContain(
      invalidValue === 'reserved'
        ? 'shadows a built-in style member'
        : 'unapplied concrete style chain',
    );
  },
);

test('installing the named theme leaves unmarked text unchanged', () => {
  expect(
    palette({ literal: 'plain', rendering: { color: 'always', modifiers: 'always' } }),
  ).toEqual({ status: 0, stderr: '', stdout: 'plain' });
});
