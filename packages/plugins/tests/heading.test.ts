// Acceptance plan: see packages/plugins/tests/list.test.ts.
import { glyph, nowrap, style } from '@loomcli/core';
import { expect, test, vi } from 'vite-plus/test';

import { heading } from '../src/heading.js';
import { renderEach, renderResult } from './fixtures/view-run.ts';
import { linesOf, measured, plain, width } from './view-measures.js';

/** The line glyph as a render shows it. */
const line = plain(glyph.line);

/** A measure that counts each kana and CJK character as two columns, as a terminal shows it. */
const wide = (text: string): number => width(text) + (plain(text).match(/[぀-鿿]/gu) ?? []).length;

/** Whether a shown line is an underline: line glyphs and nothing else. */
const isUnderline = (shown: string | undefined): boolean =>
  shown !== undefined && shown.length > 0 && shown.replaceAll(line, '') === '';

test.each([40, undefined])(
  'a level 1 heading prints its text dim with a dim underline as wide as the text, at %s columns',
  (columns) => {
    const view = heading();
    const context = measured(view, columns);
    const dim = vi.spyOn(context.style, 'dim');
    const [text, underline, ...rest] = linesOf(view.render('Deployment summary', context));
    expect(text).toBe('Deployment summary');
    expect(isUnderline(underline)).toBe(true);
    expect(width(underline ?? '')).toBe(width('Deployment summary'));
    expect(rest).toEqual([]);
    expect(dim).toHaveBeenCalledWith('Deployment summary');
    expect(dim).toHaveBeenCalledWith(glyph.line.repeat(width('Deployment summary')));
  },
);

test.each([40, undefined])('a level 2 heading is its text alone, at %s columns', (columns) => {
  const view = heading({ level: 2 });
  expect(linesOf(view.render('Services', measured(view, columns)))).toEqual(['Services']);
});

test('heading() renders as the default view of a declared string result', async () => {
  const run = { widths: [40] };
  await expect(renderResult(run, 'Services', heading())).resolves.toBe(
    await renderEach(run, (out) => out.render('Services', heading())),
  );
});

test('a level 1 underline is as wide as the context measures a CJK text and a styled text', () => {
  const view = heading();
  const [, cjkUnderline = ''] = linesOf(view.render('猫の手', measured(view, 40, { width: wide })));
  expect(isUnderline(cjkUnderline)).toBe(true);
  expect(cjkUnderline).toHaveLength(6);
  const [text, styledUnderline = ''] = linesOf(view.render(style.red('data'), measured(view, 40)));
  expect(text).toBe('data');
  expect(styledUnderline).toHaveLength(4);
});

test('a level 1 heading wraps at columns, and its underline matches its widest wrapped line', () => {
  const view = heading();
  const data = 'Quarterly deployment summary for staging';
  const wrapped = linesOf(view.render(data, measured(view, 20)));
  const text = wrapped.slice(0, -1);
  expect(text.length).toBeGreaterThan(1);
  expect(text.join(' ')).toBe(data);
  expect(isUnderline(wrapped.at(-1))).toBe(true);
  expect(width(wrapped.at(-1) ?? '')).toBe(Math.max(...text.map(width)));
  const piped = linesOf(view.render(data, measured(view, undefined)));
  expect(piped[0]).toBe(data);
  expect(width(piped[1] ?? '')).toBe(width(data));
});

test('a word wider than columns keeps its line whole and widens the underline past columns', () => {
  const view = heading();
  const output = linesOf(view.render('Configuration overview', measured(view, 10)));
  expect(output.slice(0, -1)).toEqual(['Configuration', 'overview']);
  expect(width(output.at(-1) ?? '')).toBe(width('Configuration'));
});

test.each([40, undefined])(
  'a heading that ends in a line break gains no empty line, and the empty string prints nothing, at %s columns',
  (columns) => {
    const view = heading();
    const output = linesOf(view.render('Services\n', measured(view, columns)));
    expect(output[0]).toBe('Services');
    expect(isUnderline(output[1])).toBe(true);
    expect(output).toHaveLength(2);
    expect(view.render('', measured(view, columns))).toBe('');
  },
);

test.each([
  ['a style frame', style.red('')],
  ['a nowrap frame', nowrap('')],
])(
  'a heading over %s around nothing, which resolves to no character, prints nothing',
  (_name, data) => {
    const view = heading();
    expect(view.render(data, measured(view, 30))).toBe('');
    expect(view.render(data, measured(view, undefined))).toBe('');
  },
);

test('a heading styles its text and underline dim and keeps its author styling', async () => {
  const data = 'Hi \uE000["style",[["foreground","red"]]]\uE001there\uE002';
  const rendering = { color: 'always', modifiers: 'always' } as const;
  await expect(
    renderEach({ rendering, theme: true, widths: [40] }, (out) => out.render(data, heading())),
  ).resolves.toBe('\u001B[90mHi \u001B[31mthere\u001B[39m\n\u001B[90m────────\u001B[39m\n');
});
