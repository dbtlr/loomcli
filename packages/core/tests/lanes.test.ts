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

/** The two SGR commands a red span writes removed, so a line measures as the terminal shows it. */
const unstyled = (text: string) => text.replaceAll('\u001b[31m', '').replaceAll('\u001b[39m', '');

/** Each line holds no tab and is at most `columns` wide, as the terminal shows it. */
function expectFits(output: string, columns: number): void {
  for (const line of unstyled(output).split('\n')) {
    expect(line).not.toContain('\t');
    expect(line.length).toBeLessThanOrEqual(columns);
  }
}

test('a tab expands to spaces from the start of its message line, so every line fits after the gutter', () => {
  const output = lane('warn', 'aaaaaa\tb c', 11).stderr;
  expectFits(output, 11);
  expect(output).toBe('⚠ aaaaaa  b\n  c\n');
});

test('a tab after a wrapped break expands from the start of its input line, not its output line', () => {
  const output = lane('warn', 'aaa bbbbbb\tc', 11).stderr;
  expectFits(output, 11);
  expect(output).toBe('⚠ aaa\n  bbbbbb\n  c\n');
});

test('a tab inside nowrap or a style expands too, and the frame keeps its meaning', () => {
  const unbroken = lane('warn', [{ nowrap: 'aaaaaa\tb' }, ' c'], 11).stderr;
  expectFits(unbroken, 11);
  expect(unbroken).toBe('⚠ aaaaaa  b\n  c\n');
  const styled = lane('warn', [{ red: 'aaaaaa\tb c' }], 11, { rendering: { color: 'always' } });
  expectFits(styled.stderr, 11);
  expect(styled.stderr).toBe('⚠ \u001b[31maaaaaa  b\n  c\u001b[39m\n');
});

test('a tab stays a tab off a terminal and in print', () => {
  expect(lane('warn', 'aaaaaa\tb c', null, { env: { COLUMNS: '11' } }).stderr).toBe(
    '⚠ aaaaaa\tb c\n',
  );
  expect(lane('print', 'aaaaaa\tb c', 11).stdout).toBe('aaaaaa\tb c\n');
});
