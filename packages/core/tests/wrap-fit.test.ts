import { expect, test } from 'vite-plus/test';

import { glyph } from '../src/glyphs.generated.js';
import type { Capabilities } from '../src/rendering.js';
import { isControl, scanAnsi } from '../src/style-ansi.js';
import { blockWidth, layout } from '../src/style-layout.js';
import {
  breakableMarked,
  breakablePlain,
  linesOf,
  measure,
  measurerFor,
  padTracker,
  plainCaps,
  runsOf,
  visibleOf,
  wrapMarked,
  wrapPlain,
} from '../src/style-wrap.js';
import type { Breakable } from '../src/style-wrap.js';
import { nowrap, pad, style } from '../src/style.js';
import {
  chars,
  escape,
  joiner,
  mark,
  marked,
  pieces,
  prose,
  raw,
  seeded,
  selector,
  space,
} from './text-corpus.js';

/**
 * Wrap reads each line's clusters once and answers each span it measures from that reading. These
 * tests hold the reading to the exact measurement of a span, and the wrapped text to the rule
 * greedy fitting follows, over generated texts and the constructions that make a sum of word
 * widths wrong.
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

const palette = new Map();

/** The constructions that make a sum of word widths wrong, one text each. */
const constructions = [
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

/** Each reading of a text that line breaking makes: marked for each destination, and plain. */
function readings(text: string): Breakable[] {
  return [
    ...destinations.map((caps) => breakableMarked(text, { caps, palette })),
    breakablePlain(text),
  ];
}

interface Failure {
  detail: string;
  text: string;
}

/**
 * Every span greedy fitting could ask `measurerFor` about, a word and the one after it from any
 * earlier start on the line, where the measurer and `measure` give different widths.
 */
function measurerFailures(text: string): Failure[] {
  const failures: Failure[] = [];
  for (const breakable of readings(text)) {
    const visible = visibleOf(breakable);
    const enclosingPads = padTracker(breakable.parsed);
    const withRuns = linesOf(breakable)
      .map((line) => ({ line, runs: runsOf(breakable, line) }))
      .filter(({ runs }) => runs.length > 0);
    for (const { line, runs } of withRuns) {
      const enclosing = enclosingPads(line.start);
      const widthOf = measurerFor(breakable, line, visible);
      const starts = [line.start, ...runs.map((run) => run.end)];
      for (const [index, run] of runs.entries()) {
        const end = runs[index + 1]?.start ?? line.end;
        for (const start of starts.filter((each) => each <= run.start)) {
          const span = { enclosing: start === line.start ? enclosing : [], end, start };
          const [fast, exact] = [widthOf(span), measure(breakable, span)];
          if (fast !== exact) {
            failures.push({
              detail: `${JSON.stringify(span)}: ${String(fast)}, not ${String(exact)}`,
              text,
            });
          }
        }
      }
    }
  }
  return failures;
}

test('the measurer gives the width measure gives, for every span of generated texts', () => {
  const next = seeded(95);
  const found = Array.from({ length: 400 }, () => measurerFailures(marked(next, 3))).flat();
  expect(found).toEqual([]);
});

test('the measurer gives the width measure gives, for every span of plain texts and prose', () => {
  const next = seeded(96);
  const found = [
    ...Array.from({ length: 400 }, () => measurerFailures(raw(next))),
    ...Array.from({ length: 4 }, () => measurerFailures(prose(next, 400))),
  ].flat();
  expect(found).toEqual([]);
});

test('the measurer gives the width measure gives, for the constructions that break a sum', () => {
  expect(constructions.flatMap(measurerFailures)).toEqual([]);
});

/**
 * Each line of wrapped output wider than `columns` that holds a break opportunity. The widths come
 * from the layout, not from the measurer wrap reads, and a line of one unit may be wider.
 */
function wideLines(breakable: Breakable, columns: number): string[] {
  const { lines } = layout(scanAnsi(breakable.parsed, breakable.caps));
  return linesOf(breakable).flatMap((line, index) => {
    const width = lines[index]?.content.advance[0] ?? 0;
    return width > columns && runsOf(breakable, line).length > 0
      ? [`line ${String(index)} is ${String(width)} wide`]
      : [];
  });
}

/** Each width at which wrapping a text leaves a line wider than the width with a place to break. */
function fitFailures(text: string): Failure[] {
  return columnsToTry.flatMap((columns) =>
    [
      ...destinations.map((caps) =>
        breakableMarked(wrapMarked(text, columns, { caps, palette }), { caps, palette }),
      ),
      breakablePlain(wrapPlain(text, columns)),
    ].flatMap((wrapped) =>
      wideLines(wrapped, columns).map((detail) => ({
        detail: `${String(columns)}: ${detail}`,
        text,
      })),
    ),
  );
}

test('no wrapped line is wider than the width unless it is one unit, over generated texts', () => {
  const next = seeded(97);
  const found = [
    ...Array.from({ length: 300 }, () => fitFailures(marked(next, 3))),
    ...Array.from({ length: 300 }, () => fitFailures(raw(next))),
    ...Array.from({ length: 4 }, () => fitFailures(prose(next, 400))),
    ...constructions.map(fitFailures),
  ].flat();
  expect(found).toEqual([]);
});

/** Whether a code unit is a space, a control character, or a frame byte. */
const breaksSingleSpacing = (code: number): boolean =>
  code === 0x20 || isControl(code) || (code >= 0xe0_00 && code <= 0xe0_03);

/** Pieces with no space, control character, or frame byte, which join with single spaces. */
const words = pieces.filter(
  (piece) =>
    !Array.from({ length: piece.length }, (_unit, index) => piece.charCodeAt(index)).some(
      breaksSingleSpacing,
    ),
);

/** Words joined by one space, or by nothing, so a break drops exactly one space. */
function spoken(next: (below: number) => number): string {
  return Array.from({ length: 2 + next(14) }, () => words[next(words.length)] ?? '').join(
    next(4) === 0 ? '' : ' ',
  );
}

const widthOf = (text: string): number => {
  const breakable = breakablePlain(text);
  return blockWidth(layout(scanAnsi(breakable.parsed, plainCaps)));
};

test('a wrapped line could not take the first word of the next, measured as the layout does', () => {
  const next = seeded(98);
  const found = Array.from({ length: 400 }, () => spoken(next)).flatMap((text) =>
    columnsToTry.flatMap((columns) => {
      const lines = wrapPlain(text, columns).split('\n');
      return lines.slice(0, -1).flatMap((line, index) => {
        const word = (lines[index + 1] ?? '').split(' ')[0] ?? '';
        return widthOf(`${line} ${word}`) > columns
          ? []
          : [{ detail: `${String(columns)}: line ${String(index)} fits ${word}`, text }];
      });
    }),
  );
  expect(found).toEqual([]);
});
