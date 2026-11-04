/*
 * List frames (docs/libs/prompts.md#frames-and-views, #fitting-a-list): the bytes the default view
 * draws for select and multiselect frame data. `drawn` strips styles and marks the cursor block `[`
 * and `]`; `styled` keeps the styles, with dim drawn faint and highlight drawn underlined, so a test
 * reads which parts carry them.
 */
import { stripVTControlCharacters } from 'node:util';

import { Application, style } from '@loomcli/core';
import { theme } from '@loomcli/plugins/theme';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

import { questionFrame } from '../src/views.js';
import type { ChoiceRow, ListFrame, QuestionFrame } from '../src/views.js';

/** What the default view writes for `frame` on a terminal of `columns`, with every style. */
async function styled(columns: number, frame: QuestionFrame): Promise<string> {
  const app = new Application('draw', {
    plugins: [theme({ dim: style.faint, highlight: style.underline })],
  }).action(async ({ out }) => {
    await out.draw(frame, questionFrame);
  });
  const mock = mockProcess({ terminal: { columns, rows: 24, streams: ['stderr'] } });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  return mock.stderr.text;
}

/** The frame's text with styles stripped and the inverse cursor block marked `[` and `]`. */
async function drawn(columns: number, frame: QuestionFrame): Promise<string> {
  const text = await styled(columns, frame);
  return stripVTControlCharacters(text.replaceAll('\u001b[7m', '[').replaceAll('\u001b[27m', ']'));
}

/** A choice row that is neither disabled nor selected, with `details` over it. */
function choice(label: string, details: Partial<ChoiceRow> = {}): ChoiceRow {
  return {
    description: undefined,
    disabled: false,
    kind: 'choice',
    label,
    reason: undefined,
    selected: false,
    ...details,
  };
}

/** A select frame over `labels` with the highlight on `highlighted`, drawn in `rows`. */
function selecting(
  labels: readonly string[],
  highlighted: number | undefined,
  rows: number,
  message = 'Pick',
): ListFrame & { readonly kind: 'select' } {
  return {
    above: 0,
    below: 0,
    choices: labels.map((label) => choice(label)),
    highlighted,
    issue: undefined,
    kind: 'select',
    message,
    rows,
  };
}

test.each([
  [60, '❯ PostgreSQL · ? Storage backend · ↑↓ Enter · ↓ 1 more'],
  [30, '❯ P…eSQL · ? St…end · ↑↓ …more'],
])('a one-row frame at %s columns clips each part it shares', async (columns, expected) => {
  await expect(
    drawn(columns, selecting(['PostgreSQL', 'SQLite'], 0, 1, 'Storage backend')),
  ).resolves.toBe(expected);
});

test('a two-row frame shares its first row between the choice and the title, each clipped', async () => {
  await expect(
    drawn(30, selecting(['A PostgreSQL server you run', 'SQLite'], 0, 2, 'Storage backend')),
  ).resolves.toBe('❯ A Po…you run · ? Stora…ckend\n↑↓ Enter · ↓ 1 more');
});

test('a one-row frame keeps its issue in the key help’s place', async () => {
  await expect(
    drawn(40, { ...selecting(['alpha', 'beta'], 0, 1), issue: 'Choose again.' }),
  ).resolves.toBe('❯ alpha · ? Pick · ✘ Choose again.');
});

test('markers that join the key help keep their order', async () => {
  await expect(drawn(80, selecting(['c1', 'c2', 'c3', 'c4', 'c5'], 2, 3))).resolves.toBe(
    '? Pick\n❯ c3\n↑↓ move · Enter select · ↑ 2 more · ↓ 2 more',
  );
});

test('the key help abbreviates when the markers that join it do not fit', async () => {
  await expect(drawn(24, selecting(['c1', 'c2', 'c3'], 0, 3))).resolves.toBe(
    '? Pick\n❯ c1\n↑↓ Enter · ↓ 2 more',
  );
});

test('a multiselect keeps its count when the markers that join its key help abbreviate it', async () => {
  await expect(
    drawn(55, {
      ...selecting(['c1', 'c2', 'c3'], 0, 3),
      count: 1,
      kind: 'multiselect',
      max: 3,
      min: 0,
    }),
  ).resolves.toBe('? Pick\n❯ ◯ c1\n↑↓ Space Enter · 1/3 selected · ↓ 2 more');
});

test('the compact title clips the message to the columns the mark leaves', async () => {
  await expect(drawn(12, selecting(['c1', 'c2', 'c3'], 0, 3, 'abcdefghijklmnop'))).resolves.toBe(
    '? abcd…lmnop\n❯ c1\n↑↓ En…2 more',
  );
});

test('the height estimate counts a line as wide as the columns as two rows', async () => {
  await expect(drawn(12, selecting(['a', 'b'], 0, 5, 'abcdefghij'))).resolves.toBe(
    '? abcdefghij\n❯ a\n↓ 1 more\n↑↓ Enter',
  );
});

test('a search with no rows draws No matches, and a loading one draws Searching… alone', async () => {
  const empty: QuestionFrame = { ...selecting([], undefined, 24), term: 'zz' };
  await expect(drawn(80, empty)).resolves.toBe(
    '? Pick › zz[ ]\n  No matches\n↑↓ move · type to search · Enter select',
  );
  await expect(drawn(80, { ...empty, loading: true, term: '' })).resolves.toBe(
    '? Pick › [ ]\nSearching…',
  );
});

test('a disabled choice without a reason draws (disabled)', async () => {
  await expect(
    drawn(80, {
      ...selecting(['sqlite'], 0, 24),
      choices: [choice('sqlite'), choice('Neon', { disabled: true })],
    }),
  ).resolves.toBe('? Pick\n❯ sqlite\n  Neon (disabled)\n↑↓ move · Enter select');
});

test('a choice a full max keeps out draws its mark and label dim, and its pointer highlighted', async () => {
  const frame: QuestionFrame = {
    ...selecting([], 1, 24),
    choices: [choice('Backups', { selected: true }), choice('Telemetry'), choice('Logs')],
    count: 1,
    kind: 'multiselect',
    max: 1,
    min: 0,
  };
  await expect(styled(80, frame)).resolves.toBe(
    [
      '\u001b[1m?\u001b[22m \u001b[1mPick\u001b[22m',
      '  \u001b[4m◉\u001b[24m Backups',
      '\u001b[4m❯ \u001b[24;2m◯ Telemetry\u001b[22m',
      '  \u001b[2m◯ Logs\u001b[22m',
      '\u001b[2m↑↓ move · Space toggle · Enter submit · 1/1 selected\u001b[22m',
    ].join('\n'),
  );
  await expect(styled(80, { ...frame, rows: 3 })).resolves.toBe(
    [
      '\u001b[1m?\u001b[22m \u001b[1mPick\u001b[22m',
      '\u001b[4m❯\u001b[24;2m ◯ Telemetry\u001b[22m',
      '\u001b[2m↑↓ move · Space toggle · Enter submit · 1/1 selected · ↑ 1 more · ↓ 1 more\u001b[22m',
    ].join('\n'),
  );
});
