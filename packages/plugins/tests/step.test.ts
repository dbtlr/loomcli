/*
 * Acceptance plan for the step view (docs/plugins/pack-views.md#step).
 *
 * The step is proven when a real run renders it through `out.print`, as a semantic method draws a
 * message, and through `out.render`, under Node and Bun:
 *
 * - Form. The pointer, one space, and the text, ending with one line break, so the method that
 *   writes it adds none. With color on, the pointer is `primary` and the text `bold`, and the
 *   author's own styling stays inside the bold frame.
 * - Wrapping. On a terminal the text wraps at `columns` minus the gutter, and each continuation
 *   line, authored or wrapped, sits under the text, a blank line among them bare. Off a terminal
 *   nothing wraps and an authored line break takes the same layout.
 * - Glyph forms. On the Linux console the pointer takes its compatibility form, and the gutter is
 *   measured in it.
 * - Empty. A text that resolves to no character renders the empty string.
 */
import { nowrap, style } from '@loomcli/core';
import { expect, test } from 'vite-plus/test';

import { step } from '../src/step.js';
import { renderEach } from './fixtures/view-run.ts';
import { measured } from './view-measures.js';

const long = 'Running the test suite against the built packages, with coverage';

test('a step is the pointer, one space, and its text, ending with one line break', async () => {
  await expect(
    renderEach({ widths: [80, null] }, (out) => out.print('Building 3 packages', step())),
  ).resolves.toBe('❯ Building 3 packages\n--\n❯ Building 3 packages\n');
});

test('out.render writes the same step as a semantic method, with its own line break', async () => {
  await expect(
    renderEach({ widths: [80] }, (out) => out.render('Building 3 packages', step())),
  ).resolves.toBe('❯ Building 3 packages\n');
});

test('on a terminal a step wraps at columns minus its gutter, each continuation under the text', async () => {
  await expect(renderEach({ widths: [44] }, (out) => out.print(long, step()))).resolves.toBe(
    '❯ Running the test suite against the built\n  packages, with coverage\n',
  );
});

test('off a terminal a step does not wrap, and an authored line break keeps the layout', async () => {
  await expect(
    renderEach({ env: { COLUMNS: '20' }, widths: [null] }, (out) =>
      out.print(`${long}\nsecond line\n\nafter a blank`, step()),
    ),
  ).resolves.toBe(`❯ ${long}\n  second line\n\n  after a blank\n`);
});

test('with color on, the pointer is primary and the text bold, its own styling kept', async () => {
  const rendering = { color: 'always', modifiers: 'always' } as const;
  await expect(
    renderEach({ rendering, theme: true, widths: [80] }, (out) =>
      out.print(`Building ${style.red('core')}`, step()),
    ),
  ).resolves.toBe('\u001B[36m❯\u001B[39m \u001B[1mBuilding \u001B[31mcore\u001B[39;22m\n');
});

test('on the Linux console the pointer takes its compatibility form', async () => {
  await expect(
    renderEach({ env: { TERM: 'linux' }, widths: [12] }, (out) =>
      out.print('Build all packages', step()),
    ),
  ).resolves.toBe('> Build all\n  packages\n');
});

test.each([
  ['the empty string', ''],
  ['a style frame around nothing', style.red('')],
  ['a nowrap frame around nothing', nowrap('')],
])('a step over %s renders the empty string', (_name, text) => {
  const view = step();
  expect(view.render(text, measured(view, 30))).toBe('');
  expect(view.render(text, measured(view, undefined))).toBe('');
});
