import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';

import { Application, style } from '@loomcli/core';
import { table } from '@loomcli/plugins/table';

/*
 * Run after building. Wrapping and fitting long text at 120 columns, one JSON line per case.
 * The time covers the wrap or the table view alone, not the rendering around it, except in the
 * `render` case, which times the whole render of the table. `elapsedMs` is
 * the first run, which is what one invocation pays. `warmMs` is the best of a few. The digest
 * covers what the case produced, so two builds compare byte for byte. Pass case names to run
 * only those.
 */
const columns = 120;
const attempts = 3;

/** A small seeded generator, so every run wraps the same text. */
function generator(seed) {
  let state = seed;
  return (below) => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state % below;
  };
}

const syllables = ['ra', 'ven', 'qui', 'tor', 'mel', 'ba', 'dun', 'ko', 'sil', 'ver', 'an', 'the'];

/** Prose of ordinary words: one to four syllables, with now and then a longer one. */
function prose(length, seed) {
  const next = generator(seed);
  const words = [];
  let used = 0;
  while (used < length) {
    const count = 1 + next(4) + (next(12) === 0 ? 4 : 0);
    const word = Array.from({ length: count }, () => syllables[next(syllables.length)]).join('');
    words.push(word);
    used += word.length + 1;
  }
  return words.join(' ').slice(0, length).trimEnd();
}

/** Wide characters in words of two to five, broken by spaces. */
function cjk(length, seed) {
  const next = generator(seed);
  const pieces = [];
  let used = 0;
  while (used < length) {
    const word = Array.from({ length: 2 + next(4) }, () =>
      String.fromCodePoint(0x4e_00 + next(0x5_00)),
    ).join('');
    pieces.push(word);
    used += word.length + 1;
  }
  return pieces.join(' ').slice(0, length).trimEnd();
}

/** The same prose with every third word in a style, so style frames run through the text. */
function styled(length, seed) {
  return prose(length, seed)
    .split(' ')
    .map((word, index) => (index % 3 === 0 ? style.red(word) : word))
    .join(' ');
}

const cells = (count, make) => Array.from({ length: count }, (_unused, index) => make(index));

/** What a case produces from its value: every text wrapped, or the table view's own text. */
const wrapped = (texts, context) => texts.map((text) => context.wrap(text, columns)).join('\n');
const tabular = (rows, context) => table().render(rows, context);

/** The cases, each with the value it renders and how a view context turns that into text. */
const cases = {
  'cells-200x1200': {
    text: wrapped,
    value: () => cells(200, (index) => prose(1200, index + 1)),
  },
  'cells-200x300': { text: wrapped, value: () => cells(200, (index) => prose(300, index + 1)) },
  'cjk-200x300': { text: wrapped, value: () => cells(200, (index) => cjk(300, index + 1)) },
  'paragraph-240000': { text: wrapped, value: () => [prose(240_000, 7)] },
  'paragraph-60000': { text: wrapped, value: () => [prose(60_000, 7)] },
  'styled-200x300': { text: wrapped, value: () => cells(200, (index) => styled(300, index + 1)) },
  'table-200x300': {
    text: tabular,
    value: () =>
      cells(200, (index) => ({ id: `row-${String(index)}`, note: prose(300, index + 1) })),
  },
  'table-render-200x300': {
    endToEnd: true,
    text: tabular,
    value: () =>
      cells(200, (index) => ({ id: `row-${String(index)}`, note: prose(300, index + 1) })),
  },
};

const requested = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(cases);
if (requested.some((name) => !(name in cases))) {
  throw new Error(`Use any of: ${Object.keys(cases).join(', ')}.`);
}

/** One run of an application that renders `input` with `view`, and the bytes it wrote. */
async function run(input, view) {
  const written = [];
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      written.push(chunk);
      callback();
    },
  });
  const app = new Application('wrap-cost', {
    description: 'Wrap and fit long text at a fixed width.',
  }).action(({ out }) => out.render(input, view));
  const status = await app.run({
    host: {
      argv: [],
      env: {},
      platform: 'linux',
      release: { build: 'distributed' },
      stdout,
      terminal: {
        stderr: { isTTY: false },
        stdin: { isTTY: false },
        stdout: { columns, isTTY: true, rows: 24 },
      },
    },
    rendering: { color: 'always', modifiers: 'always' },
  });
  return { output: Buffer.concat(written).toString(), status };
}

for (const name of requested) {
  const { endToEnd = false, text, value } = cases[name];
  const input = value();
  const timings = [];
  let produced = '';
  let status = 0;
  // A view case times the view alone and hands back nothing the rendering would have to resolve.
  const timed = {
    render: (given, context) => {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const started = performance.now();
        produced = text(given, context);
        timings.push(Math.round(performance.now() - started));
      }
      return '';
    },
  };
  if (endToEnd) {
    // An end-to-end case times the whole render: the view, resolving its text, and writing it.
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const started = performance.now();
      ({ output: produced, status } = await run(input, { render: text }));
      timings.push(Math.round(performance.now() - started));
    }
  } else {
    ({ status } = await run(input, timed));
  }
  console.log(
    JSON.stringify({
      case: name,
      elapsedMs: timings[0],
      inputUnits: JSON.stringify(input).length,
      outputBytes: Buffer.byteLength(produced),
      outputDigest: createHash('sha256').update(produced).digest('hex').slice(0, 16),
      status,
      warmMs: Math.min(...timings),
    }),
  );
}
