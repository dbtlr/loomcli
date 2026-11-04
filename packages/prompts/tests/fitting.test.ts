/*
 * Fitting one row (docs/libs/prompts.md#fitting-one-row): the asking line of a text, secret, or
 * confirm frame at the widths and with the lines the contract's rules and examples name. Each case
 * draws the frame through `out.draw` and compares the row with the cursor block marked `[` and `]`.
 */
import { stripVTControlCharacters } from 'node:util';

import { Application } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

import { questionFrame } from '../src/views.js';
import type { QuestionFrame } from '../src/views.js';

/** The row a frame draws at `columns`, with the inverse cursor block marked `[` and `]`. */
async function row(columns: number, frame: QuestionFrame): Promise<string> {
  const app = new Application('draw').action(async ({ out }) => {
    await out.draw(frame, questionFrame);
  });
  const mock = mockProcess({ terminal: { columns, rows: 24, streams: ['stderr'] } });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  return stripVTControlCharacters(marked(mock.stderr.text));
}

/** The text with each SGR sequence that turns inverse on read as `[`, and off as `]`. */
function marked(text: string): string {
  const [first = '', ...rest] = text.split('\u001b[');
  return (
    first +
    rest
      .map((piece) => {
        const end = piece.indexOf('m');
        const params = piece.slice(0, end).split(';');
        let mark = '';
        if (params.includes('7')) {
          mark = '[';
        } else if (params.includes('27')) {
          mark = ']';
        }
        return mark + piece.slice(end + 1);
      })
      .join('')
  );
}

/** A text frame with `typed` and the cursor at `cursor`, or at its end when omitted. */
function typed(text: string, cursor?: number, message = 'Name'): QuestionFrame {
  return {
    hint: undefined,
    issue: undefined,
    kind: 'text',
    message,
    typed: text,
    ...(cursor === undefined ? {} : { cursor }),
  };
}

/** A text frame showing the question hint `hint` over an empty line. */
function hinted(hint: string): QuestionFrame {
  return { hint, issue: undefined, kind: 'text', message: 'Name', typed: '' };
}

/** An empty confirm frame with the legend for a yes prefill. */
function confirming(message: string): QuestionFrame {
  return { hint: '[Y/n]', issue: undefined, kind: 'confirm', message, typed: '' };
}

const url = 'postgres://db.local:5432/app';
const wide = '日本語のテキスト';

test.each([
  ['the head, Home', 16, typed(url, 0), '? › [p]ostgres://…'],
  ['the middle, on the l of local', 16, typed(url, 14), '? › …/db.[l]ocal:…'],
  ['the tail, End', 16, typed(url), '? › …l:5432/app[ ]'],
  ['wide graphemes in the middle', 13, typed(wide, 3), '? › …語[の]テ …'],
  ['a wide grapheme the head cuts', 12, typed(wide, 0), '? › [日]本語 …'],
  ['a wide grapheme the leading ellipsis cuts', 8, typed(`a${wide}`, 8), '? › … [ト]'],
  ['a zero-width grapheme under the cursor', 40, typed('a​b', 1), '? Name › a[​ ]b'],
  ['a zero-width grapheme before the cursor', 40, typed('a​b'), '? Name › a​ b[ ]'],
])('a typed line draws %s', async (_case, columns, frame, expected) => {
  await expect(row(columns, frame)).resolves.toBe(expected);
});

test.each([
  ['a field of w + 2E draws the window', 5, typed('abcdef', 3), '? …[d]…'],
  ['a field narrower than w + 2E draws the cursor cell alone', 4, typed('abcdef', 3), '? [d]'],
  ['a cursor grapheme wider than the field draws the ellipsis', 3, typed('日本', 0), '? […]'],
])('%s', async (_case, columns, frame, expected) => {
  await expect(row(columns, frame)).resolves.toBe(expected);
});

test.each([
  [
    'a long hint keeps the run that fits in F − E',
    16,
    hinted('localhost.example'),
    '? › [l]ocalhost.e…',
  ],
  ['a wide hint pads the column its run leaves', 16, hinted(wide), '? › [日]本語のテ …'],
  ['a hint whose first grapheme does not fit drops', 4, hinted('日本'), '? [ ]'],
])('%s', async (_case, columns, frame, expected) => {
  await expect(row(columns, frame)).resolves.toBe(expected);
});

test.each([
  [31, '? abcdefghij › [ ]'],
  [27, '? ab…hij › [ ]'],
  [22, '? … › [ ]'],
  [21, '? › [ ]'],
  [8, '? › [ ]'],
  [7, '? [ ]'],
  [3, '? [ ]'],
  [2, '?[ ]'],
  [1, '[ ]'],
])('a text frame at %s columns draws %j', async (columns, expected) => {
  await expect(row(columns, typed('', undefined, 'abcdefghij'))).resolves.toBe(expected);
});

test.each([
  [8, typed('abcdef'), '? › …ef[ ]'],
  [7, typed('abcdef'), '? …def[ ]'],
  [3, typed('abc'), '? [ ]'],
  [2, typed('abc'), '?[ ]'],
  [1, typed('abc'), '[ ]'],
])('a long line at %s columns keeps the cursor in the field', async (columns, frame, expected) => {
  await expect(row(columns, frame)).resolves.toBe(expected);
});

test.each([
  [32, '? Install [Y/n] [ ]'],
  [26, '? … [Y/n] [ ]'],
  [25, '? [Y/n] [ ]'],
  [12, '? [Y/n] [ ]'],
  [11, '? [ ]'],
])('a confirm frame at %s columns draws %j', async (columns, expected) => {
  await expect(row(columns, confirming('Install'))).resolves.toBe(expected);
});

test('a secret field is the cursor block over one space at every width', async () => {
  const secret: QuestionFrame = {
    hint: undefined,
    issue: undefined,
    kind: 'secret',
    message: 'Password',
    typed: '',
  };
  await expect(row(8, secret)).resolves.toBe('? › [ ]');
  await expect(row(40, secret)).resolves.toBe('? Password › [ ]');
});

test('list frames render labels, separators, descriptions, search, and compact issues exactly', async () => {
  const frame: QuestionFrame = {
    above: 0,
    below: 0,
    choices: [
      {
        description: 'Details',
        disabled: false,
        kind: 'choice',
        label: 'Alpha',
        reason: undefined,
        selected: true,
      },
      { kind: 'separator', label: 'Group' },
      {
        description: undefined,
        disabled: true,
        kind: 'choice',
        label: 'Beta',
        reason: 'Unavailable',
        selected: false,
      },
    ],
    count: 1,
    highlighted: 0,
    issue: undefined,
    kind: 'multiselect',
    max: 2,
    message: 'Features',
    min: 0,
    rows: 24,
  };
  await expect(row(80, frame)).resolves.toBe(
    '? Features\n❯ ◉ Alpha\n  Group\n  ◯ Beta (Unavailable)\n  Details\n↑↓ move · Space toggle · Enter submit · 1/2 selected',
  );
  await expect(row(40, { ...frame, issue: 'Choose again.', rows: 1, term: 'a' })).resolves.toBe(
    '  ✘ Choose again.',
  );
  await expect(row(40, { ...frame, rows: 1, term: 'a' })).resolves.toBe('? Features › a[ ]');
});

test('a compact three-row list retains its issue within the terminal height', async () => {
  await expect(
    row(30, {
      above: 0,
      below: 0,
      choices: [
        {
          description: undefined,
          disabled: false,
          kind: 'choice',
          label: 'Alpha',
          reason: undefined,
          selected: false,
        },
      ],
      highlighted: 0,
      issue: 'Choose again.',
      kind: 'select',
      message: 'Pick',
      rows: 3,
    }),
  ).resolves.toBe('? Pick\n❯ Alpha\n  ✘ Choose again.');
});

test('a searching select advertises typing in its full key help', async () => {
  await expect(
    row(80, {
      above: 0,
      below: 0,
      choices: [
        {
          description: undefined,
          disabled: false,
          kind: 'choice',
          label: 'Alpha',
          reason: undefined,
          selected: false,
        },
      ],
      highlighted: 0,
      issue: undefined,
      kind: 'select',
      message: 'Pick',
      rows: 24,
      term: '',
    }),
  ).resolves.toBe('? Pick › [ ]\n❯ Alpha\n↑↓ move · type to search · Enter select');
});
