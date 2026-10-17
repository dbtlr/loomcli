import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

test.each([
  [80, 5],
  [8, 10],
  [40, 5],
  [8, 5],
  [80, 3],
  [80, 1],
])(
  'the default select frame fits %i columns and %i rows including its cursor row',
  (columns, rows) => {
    const result = invoke(new URL('fixtures/viewport.mjs', import.meta.url), [
      String(columns),
      String(rows),
      'Which database should store this workspace’s tasks?',
      'flow',
    ]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ answer: 'choice-3', code: 0 });
    expect(JSON.parse(result.stdout).advanced).toBeLessThan(rows);
  },
);

/** The lines of the last frame a one-shot select draw wrote, with terminal controls removed. */
function frameLines(drawn: string): string[] {
  // oxlint-disable-next-line no-control-regex
  const text = drawn.replaceAll(/\u001B\[[0-9;?]*[A-Za-z]/gu, '');
  return text.replaceAll('\r', '').split('\n');
}

const longMessage =
  'Which database should store this workspace’s tasks, now and for every project in the future?';

/** The compact frame clips its title to the width the view context reads. */
function titleWidth(columns: string, comma?: string): number {
  const result = invoke(new URL('fixtures/viewport.mjs', import.meta.url), [
    columns,
    '3',
    longMessage,
    'once',
    ...(comma === undefined ? [] : [comma]),
  ]);
  expect(result.status).toBe(0);
  return (frameLines(JSON.parse(result.stdout).drawn)[0] ?? '').length;
}

test('the compact select frame clips at the context columns, narrowed by COLUMNS', () => {
  expect(titleWidth('100')).toBe(`? ${longMessage}`.length);
  expect(titleWidth('100', '60')).toBeLessThanOrEqual(60);
  expect(titleWidth('100', '60')).toBeGreaterThan(40);
});

test('the compact select frame clips at 80 columns when the terminal reports none', () => {
  const width = titleWidth('unreported');
  expect(width).toBeLessThanOrEqual(80);
  expect(width).toBeGreaterThan(60);
});

test('the select window reads the rows at each frame, so its count follows a resize', () => {
  const result = invoke(new URL('fixtures/resize.mjs', import.meta.url));
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    code: 0,
    shown: [
      { above: 0, choices: 7, rows: 30 },
      { above: 0, choices: 2, rows: 6 },
      { above: 0, choices: 7, rows: 30 },
    ],
  });
});

/*
 * At most seven choices show, fewer when stderr has fewer rows. At 6 rows the window shows two, so
 * eight presses of Down scroll it to the ninth choice with seven above. When the window grows to
 * 30 rows and Up moves to the eighth choice, seven choices fit again, and the window holds the last
 * seven, three above them and none below, rather than the three it scrolled to.
 */
test('a window that grows after scrolling shows as many choices as fit, ending at the last', () => {
  const steps = [...Array.from({ length: 8 }, () => ({ key: 'down' })), { key: 'up', rows: 30 }];
  const result = invoke(new URL('fixtures/resize.mjs', import.meta.url), [
    JSON.stringify({ rows: 6, steps }),
  ]);
  expect(result.status).toBe(0);
  const { shown } = JSON.parse(result.stdout);
  expect(shown.at(-2)).toEqual({ above: 7, choices: 2, rows: 6 });
  expect(shown.at(-1)).toEqual({ above: 3, choices: 7, rows: 30 });
});
