import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { replay } from '../../../scripts/test-screen.js';
import type { ScreenEvent } from '../../../scripts/test-screen.js';

const fixture = new URL('fixtures/live.mjs', import.meta.url);

type Recorded = ScreenEvent | { readonly mark: string };

interface Run {
  answers: unknown[];
  code: number;
  events: Recorded[];
  notes: Record<string, unknown>;
}

/** One run of a scenario, with the keys it presses last. */
function live(scenario: string, ending = 'enter'): Run {
  const result = invoke(fixture, [scenario, ending], {
    env: { FORCE_COLOR: undefined, NO_COLOR: '1', TERM: 'xterm' },
  });
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout);
}

/** The rows the emulator shows once it has taken every event up to the mark, or all of them. */
async function lines(run: Run, until?: string): Promise<readonly string[]> {
  const end =
    until === undefined
      ? run.events.length
      : run.events.findIndex((event) => 'mark' in event && event.mark === until);
  expect(end).toBeGreaterThanOrEqual(0);
  const events = run.events
    .slice(0, end)
    .filter((event): event is ScreenEvent => !('mark' in event));
  const first = events.find((event): event is { resize: number } => 'resize' in event);
  const shown = await replay(events, { columns: first?.resize ?? 40 });
  return shown.lines;
}

/** A line cut into the rows a terminal of `columns` wraps it onto, for text one column per character. */
function rows(line: string, columns: number): string[] {
  const cut: string[] = [];
  for (let start = 0; start < line.length; start += columns) {
    cut.push(line.slice(start, start + columns));
  }
  return cut;
}

test('each kind draws in an input region and writes no frame through out.draw', () => {
  const run = live('kinds');
  expect(run.code).toBe(0);
  expect(run.answers).toEqual(['a', '', true, 'one']);
  expect(run.notes.regions).toEqual([
    { input: true },
    { input: true },
    { input: true },
    { input: true },
  ]);
  expect(run.notes.drawn).toEqual([JSON.stringify('\u001b[?25l'), JSON.stringify('\u001b[?25h')]);
});

test('a lane message a timer writes while a question asks lands above the whole frame', async () => {
  const run = live('timer');
  await expect(lines(run, 'timer')).resolves.toEqual(['ℹ from a timer', '? Port ›']);
  await expect(lines(run)).resolves.toEqual(['ℹ from a timer', '? Port · 8080']);
});

test('two questions started at once ask one after the other, each with its own keys', async () => {
  const run = live('together');
  expect(run.answers).toEqual(['one', 'two']);
  await expect(lines(run)).resolves.toEqual(['? First · one', '? Second · two']);
});

/** Each edge case: the message, the width the frame first draws at, and the width after. */
const edges = [
  ['narrowing', 'narrow', 'n'.repeat(30), 20],
  ['widening', 'widen', 'w'.repeat(30), 40],
  ['an exactly full line', 'full', 'f'.repeat(34), 40],
] as const;

test.each(edges)(
  'after %s, a key redraws the frame whole below the earlier output',
  async (_case, scenario, message, width) => {
    await expect(lines(live(scenario), 'key')).resolves.toEqual([
      'ℹ earlier output',
      ...rows(`? ${message} › x`, width),
    ]);
  },
);

test.each(edges)(
  'after %s and a key, Enter leaves the earlier output and the answered line alone',
  async (_case, scenario, message, width) => {
    const run = live(scenario, 'enter');
    expect(run.code).toBe(0);
    await expect(lines(run)).resolves.toEqual([
      'ℹ earlier output',
      ...rows(`? ${message} · x`, width),
    ]);
  },
);

test.each(edges)(
  'after %s and a key, Ctrl-C leaves the earlier output and the cancelled line alone',
  async (_case, scenario, message, width) => {
    const run = live(scenario, 'ctrl-c');
    expect(run.code).toBe(130);
    await expect(lines(run)).resolves.toEqual([
      'ℹ earlier output',
      ...rows(`? ${message} · cancelled`, width),
    ]);
  },
);

/** The wide-glyph frame: 37 columns of message after `? `, so the glyph wraps from the last cell. */
const wideMessage = `${'g'.repeat(37)}界`;

test('a wide glyph at the edge wraps whole, and a key redraws the frame with no stray row', async () => {
  await expect(lines(live('wide'), 'key')).resolves.toEqual([
    'ℹ earlier output',
    `? ${'g'.repeat(37)}`,
    '界 › x',
  ]);
});

test.each([
  ['enter', 0, `${wideMessage} · x`],
  ['ctrl-c', 130, `${wideMessage} · cancelled`],
] as const)(
  'a wide glyph at the edge, a key, then %s leaves one last line',
  async (ending, code, line) => {
    const run = live('wide', ending);
    expect(run.code).toBe(code);
    await expect(lines(run)).resolves.toEqual([
      'ℹ earlier output',
      `? ${'g'.repeat(37)}`,
      line.slice(37),
    ]);
  },
);
