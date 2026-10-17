import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

type Part = string | { nowrap: string } | { red: string };

/** What one lane writes on a terminal `columns` wide, or off a terminal when `columns` is null. */
function lane(
  name: string,
  message: string | readonly Part[],
  columns: number | null,
  options: Record<string, unknown> = {},
) {
  return invoke(new URL('fixtures/lanes.mjs', import.meta.url), [
    JSON.stringify({ columns, lane: name, message: [message].flat(), ...options }),
  ]);
}

const long = 'one two three four five six';

test.each([
  ['info', 'ℹ'],
  ['success', '✔'],
  ['warn', '⚠'],
  ['error', '✘'],
])(
  'the %s lane wraps at columns minus its gutter, and each continuation carries it',
  (name, mark) => {
    expect(lane(name, long, 20)).toEqual({
      status: 0,
      stderr: `${mark} one two three four\n  five six\n`,
      stdout: '',
    });
  },
);

test('an authored line break keeps its gutter, and each authored line wraps alone', () => {
  expect(lane('warn', `${long}\nseven eight nine`, 12).stderr).toBe(
    '⚠ one two\n  three four\n  five six\n  seven\n  eight nine\n',
  );
});

test('a lane leaves the message unwrapped off a terminal', () => {
  expect(lane('warn', long, null, { env: { COLUMNS: '10' } }).stderr).toBe(`⚠ ${long}\n`);
});

test('a lane leaves the message unwrapped when no column is left after the gutter', () => {
  expect(lane('warn', long, 2).stderr).toBe(`⚠ ${long}\n`);
  expect(lane('warn', 'a b', 3).stderr).toBe('⚠ a\n  b\n');
});

test('COLUMNS narrows the width a lane wraps at', () => {
  expect(lane('info', long, 100, { env: { COLUMNS: '20' } }).stderr).toBe(
    'ℹ one two three four\n  five six\n',
  );
});

test('print never wraps', () => {
  expect(lane('print', long, 10)).toEqual({ status: 0, stderr: '', stdout: `${long}\n` });
});

test('a no-wrap path stays on one line and the text around it wraps', () => {
  const path = '/Users/a/Library/Application Support/x';
  expect(lane('info', ['Wrote ', { nowrap: path }], 32).stderr).toBe(`ℹ Wrote\n  ${path}\n`);
});

test('a style that spans a wrapped break continues across it, gutter included', () => {
  expect(lane('warn', [{ red: 'aaa bbb' }], 5, { rendering: { color: 'always' } }).stderr).toBe(
    '⚠ \u001b[31maaa\n  bbb\u001b[39m\n',
  );
});
