import { glyph } from '../src/glyphs.generated.js';
import { nowrap, pad, style } from '../src/style.js';

/**
 * Generated texts for the tests of how text is measured and broken: pieces that make a naive
 * width sum wrong, joined at random, with and without frames.
 */

type Next = (below: number) => number;

/** A seeded generator, so a failing text rebuilds from its seed. */
function seeded(seed: number): Next {
  let state = seed;
  return (below) => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return Math.floor((state / 2 ** 32) * below);
  };
}

/** The characters with these code points, so a test names what it joins. */
const chars = (...codePoints: number[]): string => String.fromCodePoint(...codePoints);

const space = 0x20;
const mark = 0x3_01;
const joiner = 0x20_0d;
const selector = 0xfe_0f;
const escape = 0x1b;

/** Pieces of text that break a naive width sum, each for its own reason. */
const pieces = [
  // Words, the spaces and line endings between them, and tabs.
  'a',
  'bb',
  'word',
  'hello',
  'abcdefghijklmnopqrstuvwxyz0123456789',
  ' ',
  ' ',
  ' ',
  '  ',
  '   ',
  '\n',
  '\r\n',
  '\r',
  '\t',
  '\ta',
  // A cluster that starts on a space, or on a mark that a space can hold.
  chars(space, mark),
  chars(space, joiner),
  chars(space, 0x9_03),
  chars(0x65, mark),
  chars(mark),
  chars(joiner),
  chars(selector),
  // Emoji and ZWJ sequences, modifiers, variation selectors, and regional-indicator flags.
  chars(0x1_f4_68, joiner, 0x1_f4_69, joiner, 0x1_f4_67),
  chars(0x1_f3_f3, selector, joiner, 0x1_f3_08),
  chars(0x27_64, selector),
  chars(0x27_64),
  chars(0x1_f4_4d, 0x1_f3_fd),
  chars(0x1_f1_fa, 0x1_f1_f8),
  chars(0x1_f1_fa),
  chars(0x1_f1_fa, 0x1_f1_f8, 0x1_f1_ec),
  chars(0x1_f6_00),
  // East Asian wide and fullwidth characters, Hangul jamo and syllables.
  chars(0x4f_60, 0x59_7d),
  chars(0x4e_16, 0x75_4c),
  chars(0xff_21, 0xff_22),
  chars(0x11_00, 0x11_61, 0x11_a8),
  chars(0xd5_5c, 0xae_00),
  chars(0x30_ab, 0x30_ca),
  // Prepend characters and spacing marks, which attach across a space.
  chars(0x6_00),
  chars(0x6_00, 0x61),
  chars(0x6_00, space),
  chars(0xd_4e),
  chars(0x9_15, 0x9_4d, 0x9_37),
  chars(0xe_33),
  // Characters new in recent Unicode versions, and lone surrogates.
  chars(0x1_fa_c8),
  chars(0x1_fa_dc),
  chars(0x3_23_b0),
  '\uD83D',
  '\uDE00',
  // Control characters, ANSI commands (one with a space inside), and unfinished ones.
  chars(0x07),
  chars(0x9b),
  `${chars(escape)}[31m`,
  `${chars(escape)}[0m`,
  `${chars(escape)}]8;;http://a b${chars(escape)}\\`,
  `${chars(escape)}]0;t t\u0007`,
  `${chars(escape)}[`,
  `${chars(escape)}[3`,
  `${chars(escape)}(B`,
  `${chars(escape)}Pdata${chars(escape)}\\`,
  `${chars(0x9b)}31m`,
  // Frame bytes outside a frame, which stay literal.
  chars(0xe0_02),
  chars(0xe0_00),
  `${chars(0xe0_00)}["bad"]${chars(0xe0_01)}`,
];

const glyphs = Object.values(glyph);
const alignments = ['left', 'right', 'center'] as const;

/** Marked text: pieces joined, some wrapped in a style, no-wrap, or padding frame, or a glyph. */
function marked(next: Next, depth: number): string {
  const parts = Array.from({ length: 1 + next(9) }, () => {
    const choice = next(depth > 0 ? 12 : 8);
    if (choice < 8) {
      return pieces[next(pieces.length)] ?? '';
    }
    const inner = marked(next, depth - 1);
    if (choice === 8) {
      return style.red(inner);
    }
    if (choice === 9) {
      return nowrap(inner);
    }
    if (choice === 10) {
      return pad(inner, next(14), { align: alignments[next(alignments.length)] ?? 'left' });
    }
    return glyphs[next(glyphs.length)] ?? '';
  });
  return parts.join(next(5) === 0 ? ' ' : '');
}

/** The pieces joined as raw text, with no frame to read. */
function raw(next: Next): string {
  const literal = pieces.filter((piece) => !/[-]/u.test(piece));
  return Array.from({ length: 1 + next(12) }, () => literal[next(literal.length)] ?? '').join('');
}

/** Ordinary prose, where the one reading answers nearly every span. */
function prose(next: Next, length: number): string {
  const words = ['a', 'the', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog', 'wrapping'];
  let text = '';
  while (text.length < length) {
    text += `${words[next(words.length)] ?? ''}${' '.repeat(next(9) === 0 ? 2 : 1)}`;
  }
  return text;
}

export { chars, escape, joiner, mark, marked, pieces, prose, raw, seeded, selector, space };
export type { Next };
