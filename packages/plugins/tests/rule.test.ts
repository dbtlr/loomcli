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
