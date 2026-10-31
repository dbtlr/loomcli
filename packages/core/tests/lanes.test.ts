import { expect, test } from 'vite-plus/test';

import { invoke as invokeFixture } from './run-fixture.ts';

type Part = string | { nowrap: string } | { red: string };

/** What one lane writes on a terminal `columns` wide, or off a terminal when `columns` is null. */
async function lane(
  name: string,
  message: string | readonly Part[],
  columns: number | null,
  options: Record<string, unknown> = {},
) {
  return await invokeFixture(new URL('fixtures/lanes.mjs', import.meta.url), [
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
  async (name, mark) => {
    await expect(lane(name, long, 20)).resolves.toEqual({
      status: 0,
      stderr: `${mark} one two three four\n  five six\n`,
      stdout: '',
    });
  },
);

test('an authored line break keeps its gutter, and each authored line wraps alone', async () => {
  await expect(
    lane('warn', `${long}\nseven eight nine`, 12).then((fixtureResult) => fixtureResult.stderr),
  ).resolves.toBe('⚠ one two\n  three four\n  five six\n  seven\n  eight nine\n');
});

test('a lane leaves the message unwrapped off a terminal', async () => {
  await expect(
    lane('warn', long, null, { env: { COLUMNS: '10' } }).then(
      (fixtureResult) => fixtureResult.stderr,
    ),
  ).resolves.toBe(`⚠ ${long}\n`);
});

test('a lane leaves the message unwrapped when no column is left after the gutter', async () => {
  await expect(lane('warn', long, 2).then((fixtureResult) => fixtureResult.stderr)).resolves.toBe(
    `⚠ ${long}\n`,
  );
  await expect(lane('warn', 'a b', 3).then((fixtureResult) => fixtureResult.stderr)).resolves.toBe(
    '⚠ a\n  b\n',
  );
});

test('COLUMNS narrows the width a lane wraps at', async () => {
  await expect(
    lane('info', long, 100, { env: { COLUMNS: '20' } }).then(
      (fixtureResult) => fixtureResult.stderr,
    ),
  ).resolves.toBe('ℹ one two three four\n  five six\n');
});

test('print never wraps', async () => {
  await expect(lane('print', long, 10)).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: `${long}\n`,
  });
});

test('a no-wrap path stays on one line and the text around it wraps', async () => {
  const path = '/Users/a/Library/Application Support/x';
  await expect(
    lane('info', ['Wrote ', { nowrap: path }], 32).then((fixtureResult) => fixtureResult.stderr),
  ).resolves.toBe(`ℹ Wrote\n  ${path}\n`);
});

test('a style that spans a wrapped break continues across it, gutter included', async () => {
  await expect(
    lane('warn', [{ red: 'aaa bbb' }], 5, { rendering: { color: 'always' } }).then(
      (fixtureResult) => fixtureResult.stderr,
    ),
  ).resolves.toBe('⚠ \u001b[31maaa\n  bbb\u001b[39m\n');
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

test('a tab expands to spaces from the start of its message line, so every line fits after the gutter', async () => {
  const output = await lane('warn', 'aaaaaa\tb c', 11).then(
    (fixtureResult) => fixtureResult.stderr,
  );
  expectFits(output, 11);
  expect(output).toBe('⚠ aaaaaa  b\n  c\n');
});

test('a tab after a wrapped break expands from the start of its input line, not its output line', async () => {
  const output = await lane('warn', 'aaa bbbbbb\tc', 11).then(
    (fixtureResult) => fixtureResult.stderr,
  );
  expectFits(output, 11);
  expect(output).toBe('⚠ aaa\n  bbbbbb\n  c\n');
});

test('a tab inside nowrap or a style expands too, and the frame keeps its meaning', async () => {
  const unbroken = await lane('warn', [{ nowrap: 'aaaaaa\tb' }, ' c'], 11).then(
    (fixtureResult) => fixtureResult.stderr,
  );
  expectFits(unbroken, 11);
  expect(unbroken).toBe('⚠ aaaaaa  b\n  c\n');
  const styled = await lane('warn', [{ red: 'aaaaaa\tb c' }], 11, {
    rendering: { color: 'always' },
  });
  expectFits(styled.stderr, 11);
  expect(styled.stderr).toBe('⚠ \u001b[31maaaaaa  b\n  c\u001b[39m\n');
});

test('a tab stays a tab off a terminal and in print', async () => {
  await expect(
    lane('warn', 'aaaaaa\tb c', null, { env: { COLUMNS: '11' } }).then(
      (fixtureResult) => fixtureResult.stderr,
    ),
  ).resolves.toBe('⚠ aaaaaa\tb c\n');
  await expect(
    lane('print', 'aaaaaa\tb c', 11).then((fixtureResult) => fixtureResult.stdout),
  ).resolves.toBe('aaaaaa\tb c\n');
});
