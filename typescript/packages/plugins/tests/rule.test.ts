// Acceptance plan: see packages/plugins/tests/list.test.ts.
import { glyph, nowrap, style } from '@loomcli/core';
import { expect, test, vi } from 'vite-plus/test';

import { rule } from '../src/rule.js';
import { lines } from './fit-render.js';
import { renderEach, renderResult } from './fixtures/view-run.ts';
import {
  TAB,
  expandTabs,
  indentOf,
  linesOf,
  measured,
  plain,
  width,
  wordsOf,
} from './view-measures.js';

/** The line glyph as a render shows it. */
const line = plain(glyph.line);

/** Whether a shown line is line glyphs and nothing else. */
const isBare = (shown: string | undefined): boolean =>
  shown !== undefined && shown.length > 0 && shown.replaceAll(line, '') === '';

test.each([
  [60, 60],
  [undefined, 80],
])('a labelled rule spans %s columns, %s wide, with its label after the lead', (columns, spans) => {
  const view = rule();
  const shown = linesOf(view.render('Checks', measured(view, columns)));
  expect(shown).toHaveLength(1);
  expect(shown[0]?.startsWith(`${line}${line} Checks ${line}`)).toBe(true);
  expect(width(shown[0] ?? '')).toBe(spans);
});

test.each([
  [60, 60],
  [undefined, 80],
])('a bare rule spans %s columns, %s wide, and styles its line dim', (columns, spans) => {
  const view = rule();
  const context = measured(view, columns);
  const dim = vi.spyOn(context.style, 'dim');
  const shown = linesOf(view.render('', context));
  expect(shown).toHaveLength(1);
  expect(isBare(shown[0])).toBe(true);
  expect(width(shown[0] ?? '')).toBe(spans);
  expect(dim).toHaveBeenCalledWith(glyph.line.repeat(spans));
});

test('rule() renders as the default view of a declared string result', async () => {
  const run = { widths: [60] };
  await expect(renderResult(run, 'Checks', rule())).resolves.toBe(
    await renderEach(run, (out) => out.render('Checks', rule())),
  );
});

test('a label wrapped at a narrow width hangs its later lines under the label, and only its last line carries the line', () => {
  const view = rule();
  const label = 'Checks for the staging cluster';
  const shown = linesOf(view.render(label, measured(view, 20)));
  expect(shown.length).toBeGreaterThan(1);
  expect(wordsOf(shown.join('\n')).filter((word) => !isBare(word))).toEqual(label.split(' '));
  expect(shown[0]?.startsWith(`${line}${line} Checks`)).toBe(true);
  expect(Math.max(...shown.map(width))).toBeLessThanOrEqual(20);
  expect(shown.map((each) => each.endsWith(line))).toEqual(
    shown.map((_each, index) => index === shown.length - 1),
  );
  expect(
    shown.slice(1).every((each) => indentOf(each) === (shown[0] ?? '').indexOf('Checks')),
  ).toBe(true);
});

test('a label word too wide to fit overflows with one line glyph after it', () => {
  const view = rule();
  const shown = linesOf(view.render('Extraordinary', measured(view, 12)));
  expect(shown).toHaveLength(1);
  expect(shown[0]?.endsWith(`Extraordinary ${line}`)).toBe(true);
  expect(shown[0]?.endsWith(`${line}${line}`)).toBe(false);
});

test('an authored line break in a piped label takes the wrapped layout, the last line spanning 80', () => {
  const view = rule();
  const [first = '', last = '', ...rest] = linesOf(
    view.render('Checks\nstaging', measured(view, undefined)),
  );
  expect(rest).toEqual([]);
  expect(first).toBe(`${line}${line} Checks`);
  expect(last.trimStart().startsWith('staging')).toBe(true);
  expect(last.indexOf('staging')).toBe(first.indexOf('Checks'));
  expect(width(last)).toBe(80);
});

test.each([30, undefined])(
  'a blank line inside a label carries no indent and stays empty, at %s columns',
  (columns) => {
    const view = rule();
    const shown = linesOf(view.render('Checks\n\nstaging', measured(view, columns)));
    expect(shown).toHaveLength(3);
    expect(shown[1]).toBe('');
  },
);

test.each([
  ['a style frame', style.red('')],
  ['a nowrap frame', nowrap('')],
])(
  'a rule over %s around nothing, which resolves to no character, draws a bare line',
  (_name, data) => {
    const view = rule();
    for (const [columns, spans] of [
      [30, 30],
      [undefined, 80],
    ] as const) {
      const shown = linesOf(view.render(data, measured(view, columns)));
      expect(shown).toHaveLength(1);
      expect(isBare(shown[0])).toBe(true);
      expect(width(shown[0] ?? '')).toBe(spans);
    }
  },
);

test('a blank last label line carries the line after it', () => {
  const view = rule();
  const shown = linesOf(view.render('a\n\n', measured(view, 20)));
  expect(shown).toHaveLength(2);
  expect(shown[0]).toBe(`${line}${line} a`);
  expect(isBare(shown[1]?.trimStart())).toBe(true);
});

test('a rule styles its lines dim and adds no style to its label', async () => {
  const rendering = { color: 'always', modifiers: 'always' } as const;
  await expect(
    renderEach({ rendering, theme: true, widths: [12] }, (out) => out.render('Hi', rule())),
  ).resolves.toBe('\u001B[90m── \u001B[39mHi\u001B[90m ──────\u001B[39m\n');
});

test('an invocation by name has no width, so the rule draws 80', async () => {
  await expect(
    renderEach({ invoke: true, widths: [null] }, (out) => out.render('Checks', rule())),
  ).resolves.toBe(lines(`── Checks ${line.repeat(70)}`));
});

test('a tab in a label expands on a terminal', () => {
  const view = rule();
  const tabs = vi.fn(expandTabs);
  const shown = linesOf(view.render('a\tb', measured(view, 30, { expandTabs: tabs })));
  expect(tabs).toHaveBeenCalledWith('a\tb');
  expect(shown[0]).toContain(`a${TAB}b`);
  expect(shown[0]).not.toContain('\t');
});
