import { expect, test } from 'vite-plus/test';

import { glyph } from '../src/glyphs.generated.js';
import type { Capabilities } from '../src/rendering.js';
import { wrapMarked, wrapPlain } from '../src/style-wrap.js';
import { nowrap, pad, style } from '../src/style.js';
import {
  chars,
  escape,
  joiner,
  mark,
  marked,
  prose,
  raw,
  seeded,
  selector,
  space,
} from './text-corpus.js';
import { wrapMarked as oracleMarked, wrapPlain as oraclePlain } from './wrap-oracle.js';

/**
 * Wrap reads each line once and answers every candidate span from that reading. These tests hold
 * it to the oracle, the line breaking from before, which lays out every span afresh, over
 * generated texts and the constructions that make a sum of word widths wrong.
 */

/** The destinations marked text wraps for: main and fallback glyph forms, controls and none. */
const destinations: readonly Capabilities[] = [
  {
    color: true,
    depth: 'truecolor',
    hyperlinks: true,
    mainGlyphs: true,
    modifiers: true,
    terminalControls: true,
  },
  {
    color: false,
    depth: 16,
    hyperlinks: false,
    mainGlyphs: false,
    modifiers: false,
    terminalControls: false,
  },
];

/** The widths each text wraps at: narrower than any word, around the usual words, and wide. */
const columnsToTry = [1, 2, 3, 4, 5, 6, 8, 9, 13, 21, 34, 55, 120];

interface Mismatch {
  columns: number;
  text: string;
}

/** Each width at which marked text wraps differently from the oracle, for any destination. */
function markedMismatches(text: string): Mismatch[] {
  const palette = new Map();
  return destinations.flatMap((caps) =>
    columnsToTry
      .filter(
        (columns) =>
          wrapMarked(text, columns, { caps, palette }) !==
          oracleMarked(text, columns, { caps, palette }),
      )
      .map((columns) => ({ columns, text })),
  );
}

/** Each width at which plain text wraps differently from the oracle. */
function plainMismatches(text: string): Mismatch[] {
  return columnsToTry
    .filter((columns) => wrapPlain(text, columns) !== oraclePlain(text, columns))
    .map((columns) => ({ columns, text }));
}

test('wrap breaks marked text where the oracle does, over generated texts', () => {
  const next = seeded(95);
  const found = Array.from({ length: 600 }, () => markedMismatches(marked(next, 3))).flat();
  expect(found).toEqual([]);
});

test('wrap breaks plain text where the oracle does, over generated texts', () => {
  const next = seeded(96);
  const found = Array.from({ length: 600 }, () => plainMismatches(raw(next))).flat();
  expect(found).toEqual([]);
});

test('wrap breaks long prose where the oracle does', () => {
  const next = seeded(97);
  const found = Array.from({ length: 6 }, () => {
    const text = prose(next, 2500);
    return [markedMismatches(text), plainMismatches(text)].flat();
  }).flat();
  expect(found).toEqual([]);
});

test('wrap breaks the constructions that make a sum of word widths wrong where the oracle does', () => {
  const cases = [
    // A cluster that starts on a break space: the space and the mark are one cluster.
    `ab ${chars(mark)}cd ef`,
    `ab ${chars(space, mark)}cd ${chars(space, joiner)}ef`,
    `ab${chars(0x6_00)} cd ${chars(0x6_00)} ef`,
    // A tab's advance depends on its column from the line start.
    'a\tb c\td e\tf g\th',
    'aaaa\tbbbb cccc\tdddd',
    // Padding frames: one unbreakable unit that still counts its minimum width.
    `ab ${pad('c', 6)} de ${pad('f g', 4, { align: 'right' })} gh ${pad('i', 3, { align: 'center' })}`,
    pad('aa bb cc dd', 5),
    `${pad('aa bb\ncc dd', 7)} ee ff`,
    `${pad('aa bb\ncc dd\nee ff gg\nhh', 12)} ii jj`,
    // No-wrap and glyph frames, style scopes, and commands that never break.
    `x ${nowrap('a b c')} y ${glyph.tick} z ${glyph.bullet}`,
    `${style.red('aa bb')} ${chars(escape)}[1mcc dd${chars(escape)}[0m ${style.blue(`ee ${style.bold('ff gg')}`)}`,
    `aa ${chars(escape)}]8;;http://x y${chars(escape)}\\bb cc${chars(escape)}]8;;${chars(escape)}\\ dd`,
    // Line endings: CRLF, LF, and a lone CR.
    'aa bb\r\ncc dd\nee ff\rgg hh\r\n',
    // Emoji sequences, flags, wide characters, and recent widths.
    [
      chars(0x1_f4_68, joiner, 0x1_f4_69),
      chars(0x1_f1_fa, 0x1_f1_f8, 0x1_f1_ec),
      chars(0x1_f4_4d, 0x1_f3_fd),
      chars(0x27_64, selector),
      chars(0x27_64),
    ].join(' '),
    [
      chars(0x4f_60, 0x59_7d),
      chars(0xff_21, 0xff_22),
      chars(0x11_00, 0x11_61, 0x11_a8),
      chars(0x1_fa_c8),
      chars(0x3_23_b0),
    ].join(' '),
  ];
  const found = cases.flatMap((text) => [markedMismatches(text), plainMismatches(text)].flat());
  expect(found).toEqual([]);
});
