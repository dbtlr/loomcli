/*
 * Pins the simple measures of view-measures.ts to core's `width`, so a pack view test that states a
 * width in the measures states the width core gives. A glyph the measures do not draw throws.
 */

import { Application, glyph, nowrap, pad, style, width as coreWidth } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

import { plain, width } from './view-measures.js';

const aligns = ['left', 'right', 'center'] as const;

/** What core writes to a mock terminal for marked text, with its frames resolved. */
async function written(marked: string): Promise<string> {
  const application = new Application('measures', { description: 'Print marked text.' }).action(
    async ({ out }) => out.print(marked),
  );
  const mock = mockProcess({
    argv: [],
    env: { NO_COLOR: '1' },
    terminal: { columns: 80, rows: 24 },
  });
  await application.run({ process: mock });
  expect(mock.stderr.text).toBe('');
  return mock.stdout.text.replace(/\n$/u, '');
}

/** Whether the measures draw a glyph, which they do by not throwing on it. */
function isDrawn(marked: string): boolean {
  try {
    plain(marked);
    return true;
  } catch {
    return false;
  }
}

const drawn = Object.entries(glyph).filter(([, marked]) => isDrawn(marked));

/** What the measures and core each say a marked text shows and how wide it is. */
async function comparison(marked: string): Promise<{ measures: unknown; core: unknown }> {
  const shown = await written(marked);
  return {
    core: { shown, width: coreWidth(shown) },
    measures: { shown: plain(marked), width: width(marked) },
  };
}

test.each(aligns)('a pad frame aligned %s shows and measures as core shows it', async (align) => {
  for (const size of [0, 1, 4, 9]) {
    const { core, measures } = await comparison(pad('ab', size, { align }));
    expect(measures).toEqual(core);
  }
});

test('a pad frame aligned right shows its text after the room', () => {
  expect(plain(pad('ab', 4, { align: 'right' }))).toBe('  ab');
});

test.each([
  ['a style frame', style.red('abc')],
  ['a nowrap frame', nowrap('a b')],
  ['a pad frame around a styled glyph', pad(`${style.red('x')}${glyph.bullet}`, 6)],
  [
    'a nested pad around a styled glyph',
    pad(pad(style.red(glyph.bullet), 3), 5, { align: 'right' }),
  ],
])('%s shows and measures as core shows it', async (_name, marked) => {
  const { core, measures } = await comparison(marked);
  expect(measures).toEqual(core);
});

test('the measures draw the glyphs the pack views draw, each as core shows and measures it', async () => {
  expect(drawn.map(([name]) => name).toSorted()).toEqual([
    'bullet',
    'line',
    'lineDownLeftArc',
    'lineDownRightArc',
    'lineUpLeftArc',
    'lineUpRightArc',
    'lineVertical',
  ]);
  for (const [, marked] of drawn) {
    const { core, measures } = await comparison(marked);
    expect(measures).toEqual(core);
  }
});

test('every other glyph in core fails loudly instead of resolving to a guess', () => {
  const others = Object.entries(glyph).filter(([name]) => !drawn.some(([known]) => known === name));
  expect(others.length).toBeGreaterThan(0);
  for (const [name, marked] of others) {
    expect(() => plain(marked)).toThrow(new RegExp(`glyph.*${name}`, 'u'));
  }
});

test('a frame of a kind the measures do not know fails loudly', () => {
  expect(() => plain('["bold"]text')).toThrow(/frame/u);
  expect(() => plain('["pad","wide","left"]text')).toThrow(/pad/u);
});
