// Acceptance plan: see packages/plugins/tests/list.test.ts.
import { expect, test } from 'vite-plus/test';

import { lines } from './fit-render.js';
import { render } from './pack-render.js';

const line = '─';

test('a labelled rule spans 60 columns on a terminal and 80 when piped', () => {
  expect(render({ data: 'Checks', view: 'rule', widths: [60, null] })).toBe(
    lines(`── Checks ${line.repeat(50)}`, '--', `── Checks ${line.repeat(70)}`),
  );
});

test('a bare rule spans 60 columns on a terminal and 80 when piped', () => {
  expect(render({ data: '', view: 'rule', widths: [60, null] })).toBe(
    lines(line.repeat(60), '--', line.repeat(80)),
  );
});

test('rule() renders as the default view of a declared string result', () => {
  expect(render({ data: 'Checks', declared: true, view: 'rule', widths: [60] })).toBe(
    lines(`── Checks ${line.repeat(50)}`),
  );
});

test('a label wrapped at a narrow width continues under the label, with the line on its last line alone', () => {
  expect(render({ data: 'Checks for the staging cluster', view: 'rule', widths: [20] })).toBe(
    lines('── Checks for the', `   staging cluster ${line}`),
  );
});

test('a label word too wide to fit overflows with one line glyph after it', () => {
  expect(render({ data: 'Extraordinary', view: 'rule', widths: [12] })).toBe(
    lines(`── Extraordinary ${line}`),
  );
});

test('an authored line break in a piped label takes the wrapped layout', () => {
  expect(render({ data: 'Checks\nstaging', view: 'rule', widths: [null] })).toBe(
    lines('── Checks', `   staging ${line.repeat(69)}`),
  );
});

test('a blank line inside a label carries no indent and stays empty, on a terminal and piped', () => {
  expect(render({ data: 'Checks\n\nstaging', view: 'rule', widths: [30, null] })).toBe(
    lines(
      '── Checks',
      '',
      `   staging ${line.repeat(19)}`,
      '--',
      '── Checks',
      '',
      `   staging ${line.repeat(69)}`,
    ),
  );
});

test.each(['@@red-empty@@', '@@nowrap-empty@@'])(
  'a rule over %s, which resolves to no character, draws a bare line',
  (data) => {
    expect(render({ data, view: 'rule', widths: [30, null] })).toBe(
      lines(line.repeat(30), '--', line.repeat(80)),
    );
  },
);

test('a blank last label line carries the line after it', () => {
  expect(render({ data: 'a\n\n', view: 'rule', widths: [20] })).toBe(
    lines('── a', `    ${line.repeat(16)}`),
  );
});

test('a rule styles its lines dim and adds no style to its label', () => {
  const rendering = { color: 'always', modifiers: 'always' } as const;
  expect(render({ data: 'Hi', rendering, theme: true, view: 'rule', widths: [12] })).toBe(
    '\u001B[90m── \u001B[39mHi\u001B[90m ──────\u001B[39m\n',
  );
});

test('an invocation by name has no width, so the rule draws 80', () => {
  expect(render({ data: 'Checks', invoke: true, view: 'rule', widths: [null] })).toBe(
    lines(`── Checks ${line.repeat(70)}`),
  );
});

test('a tab in a label expands on a terminal', () => {
  expect(render({ data: 'a\tb', view: 'rule', widths: [30] })).toBe(
    lines(`── a       b ${line.repeat(17)}`),
  );
});
