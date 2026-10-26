// Acceptance plan: see packages/prompts/tests/interactive.test.ts.

import { Application, FatalError } from '@loomcli/core';
import type { ActionContext, RegionOptions, View } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

import { replay, until } from '../../../scripts/test-screen.js';
import type { Recorded } from '../../../scripts/test-screen.js';
import { confirm, secret, select, text } from '../src/index.js';
import { questionFrame } from '../src/views.js';
import { observing, recording } from './support.js';

interface Run {
  answers: unknown[];
  code: number;
  events: Recorded[];
  notes: Record<string, unknown>;
}

/** What a scenario's action reads and writes while it runs on the recorded terminal. */
interface Scene {
  answers: unknown[];
  readonly ending: string;
  readonly notes: Record<string, unknown>;
  readonly screen: ReturnType<typeof recording>;
  readonly signals: { raise(signal: 'SIGINT'): void };
}

type Context = ActionContext<unknown>;

/** The keys a scenario types, and the key it ends with when Ctrl-C is not raised as a signal. */
const typed: Record<string, (ending: string) => string[]> = {
  kinds: () => ['\r', '\r', '\r', '\r'],
  sibling: () => [''],
  timer: () => ['8080\r'],
  together: () => ['one\rtwo\r'],
};

/**
 * A text question whose frame starts at `start` columns, then the terminal resizes to `width`, a
 * key is pressed and its frame drawn, and then the ending keys are pressed. The key is typed with
 * the others, so the resize happens at the first frame, before the key is read. Ctrl-C raises
 * SIGINT at the second frame, as the reader does for the key.
 */
function edge(message: string, start: number, width: number) {
  return (scene: Scene) => async (context: Context) => {
    scene.screen.resize(start);
    await context.out.info('earlier output');
    let frames = 0;
    const out = observing(context.out, async ({ view }) => {
      if (view !== questionFrame) {
        return;
      }
      frames += 1;
      if (frames === 1) {
        scene.screen.mark('first');
        if (width !== start) {
          scene.screen.resize(width);
        }
      } else if (frames === 2) {
        scene.screen.mark('key');
        if (scene.ending === 'ctrl-c') {
          scene.signals.raise('SIGINT');
        }
      }
    });
    scene.answers = [await text({ ...context, out }, { message })];
  };
}

const scenarios: Record<string, (scene: Scene) => (context: Context) => Promise<void>> = {
  /** Each kind asked once, with every out.draw call and every region it opens recorded. */
  kinds: (scene) => async (context) => {
    const drawn: string[] = [];
    const regions: unknown[] = [];
    const out = {
      ...context.out,
      draw: <Data>(data: Data, view: View<Data>) => {
        drawn.push(view === questionFrame ? 'questionFrame' : JSON.stringify(data));
        return context.out.draw(data, view);
      },
      region: (options?: RegionOptions) => {
        regions.push(options);
        return context.out.region(options);
      },
    };
    const asked = { ...context, out };
    scene.answers = [
      await text(asked, { default: 'a', message: 'Text' }),
      await secret(asked, { message: 'Secret' }),
      await confirm(asked, { default: true, message: 'Confirm' }),
      await select(asked, { choices: ['one', 'two'], message: 'Select' }),
    ];
    scene.notes.drawn = [...new Set(drawn)];
    scene.notes.regions = regions;
  },
  /** A question beside work that fails once the question's first frame is drawn. */
  sibling: () => async (context) => {
    const lookup = Promise.withResolvers<never>();
    const out = observing(context.out, () => {
      lookup.reject(new FatalError('The lookup failed.'));
    });
    await Promise.all([text({ ...context, out }, { message: 'Name?' }), lookup.promise]);
  },
  /**
   * A lane message written while a question asks. The scripted key waits behind the first frame's
   * hook, which writes the message and marks the point before the question reads it.
   */
  timer: (scene) => async (context) => {
    const out = observing(context.out, async ({ view }) => {
      if (view === questionFrame && scene.notes.asked === undefined) {
        scene.notes.asked = true;
        await context.out.info('from a timer');
        scene.screen.mark('timer');
      }
    });
    scene.answers = [await text({ ...context, out }, { message: 'Port' })];
  },
  /** Two questions started at once, with the keys for both typed in one entry. */
  together: (scene) => async (context) => {
    scene.answers = await Promise.all([
      text(context, { message: 'First' }),
      text(context, { message: 'Second' }),
    ]);
  },

  // The edge cases: `? `, ` › `, and the cursor cell add 6 columns to the message.
  /** A frame exactly as wide as the terminal, which the key makes wrap. */
  full: edge('f'.repeat(34), 40, 40),
  /** A one-row frame the terminal narrows until it wraps onto a second row. */
  narrow: edge('n'.repeat(30), 40, 20),
  /** A wide glyph that does not fit the last cell of the first row. */
  wide: edge(`${'g'.repeat(37)}界`, 40, 40),
  /** A two-row frame the terminal widens until it fits on one row. */
  widen: edge('w'.repeat(30), 20, 40),
};

/** One run of a scenario on a recorded terminal, with the ending its edge cases press last. */
async function live(scenario: string, ending = 'enter'): Promise<Run> {
  const keys = typed[scenario]?.(ending) ?? [ending === 'enter' ? 'x\r' : 'x'];
  const mock = mockProcess({ terminal: { columns: 40, keys, rows: 24, streams: ['stderr'] } });
  const scene: Scene = {
    answers: [],
    ending,
    notes: {},
    screen: recording(mock),
    signals: mock.signals,
  };
  const action = scenarios[scenario]?.(scene);
  if (action === undefined) {
    throw new Error(`No scenario named ${scenario}.`);
  }
  const code = await new Application('live', { description: 'Ask on a recorded terminal.' })
    .action(action)
    .run({ process: mock });
  expect(mock.stdout.text).toBe('');
  scene.notes.dataListeners = mock.stdin.listenerCount('data');
  scene.notes.raw = mock.stdin.isRaw;
  return { answers: scene.answers, code, events: scene.screen.events(), notes: scene.notes };
}

/** The rows the emulator shows once it has taken every event up to the mark, or all of them. */
async function lines(run: Run, mark?: string): Promise<readonly string[]> {
  const events = until(run.events, mark);
  const first = events.find((event): event is { readonly resize: number } => 'resize' in event);
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

test('each kind draws in an input region and writes no frame through out.draw', async () => {
  const run = await live('kinds');
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
  const run = await live('timer');
  await expect(lines(run, 'timer')).resolves.toEqual(['ℹ from a timer', '? Port ›']);
  await expect(lines(run)).resolves.toEqual(['ℹ from a timer', '? Port · 8080']);
});

test('a question whose region a failure closes leaves raw mode, removes its listener, and shows the cursor after its cancelled line', async () => {
  const run = await live('sibling');
  expect(run.code).toBe(1);
  expect(run.notes).toMatchObject({ dataListeners: 0, raw: false });
  const written = run.events.map((event) => ('write' in event ? event.write : '')).join('');
  expect(written.lastIndexOf('\u001b[?25h')).toBeGreaterThan(written.indexOf('· cancelled'));
  await expect(lines(run)).resolves.toEqual(['? Name? · cancelled', 'The lookup failed.']);
});

test('two questions started at once ask one after the other, each with its own keys', async () => {
  const run = await live('together');
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
    await expect(lines(await live(scenario), 'key')).resolves.toEqual([
      'ℹ earlier output',
      ...rows(`? ${message} › x`, width),
    ]);
  },
);

test.each(edges)(
  'after %s and a key, Enter leaves the earlier output and the answered line alone',
  async (_case, scenario, message, width) => {
    const run = await live(scenario, 'enter');
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
    const run = await live(scenario, 'ctrl-c');
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
  await expect(lines(await live('wide'), 'key')).resolves.toEqual([
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
    const run = await live('wide', ending);
    expect(run.code).toBe(code);
    await expect(lines(run)).resolves.toEqual([
      'ℹ earlier output',
      `? ${'g'.repeat(37)}`,
      line.slice(37),
    ]);
  },
);
