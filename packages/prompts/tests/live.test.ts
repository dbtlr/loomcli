import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { terminal as realTerminal } from './terminal.js';

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
  expect(run.notes.drawn).toEqual([
    JSON.stringify('\u001b[?25l\u001b[?2004h'),
    JSON.stringify('\u001b[?25l'),
    JSON.stringify('\u001b[?25h\u001b[?2004l'),
  ]);
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
  async (_case, scenario, message, _width) => {
    await expect(lines(await live(scenario), 'key')).resolves.toEqual([
      'ℹ earlier output',
      ...(_case === 'narrowing'
        ? ['? › x']
        : [`? ${message[0]?.repeat(9)}…${message[0]?.repeat(9)} › x`]),
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
    `? ${'g'.repeat(9)}…${'g'.repeat(7)}界 › x`,
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

// These scenarios exercise the real kernel terminal through the shared zpty driver.
test('a real terminal edits a line, recognizes split keys, and survives a lone Escape', async () => {
  const tty = realTerminal('editing', { NO_COLOR: '1' });
  try {
    const first = await tty.expect('Edit value');
    tty.send(String.raw`abcd\e[D\x7fX`);
    await tty.expect('abX*d');
    tty.send(String.raw`\e`);
    // The pause leaves the application time to read the ESC alone even on a loaded machine.
    // A shorter one lets the terminal deliver ESC and Z in one read, which is Alt-Z.
    await new Promise((resolve) => setTimeout(resolve, 400));
    tty.send(String.raw`Z\e[`);
    await new Promise((resolve) => setTimeout(resolve, 10));
    tty.send(String.raw`HZ\r`);
    const result = await tty.expect('EXIT:0 cooked:true');
    expect(result).toContain('ANSWER:"ZabXZd"');
    expect(first).toContain('\u001b[?2004h');
    expect(result).toContain('\u001b[?2004l');
  } finally {
    await tty.close();
  }
});

test('a real terminal brackets a multiline paste without submitting it', async () => {
  const tty = realTerminal('editing', { NO_COLOR: '1' });
  try {
    await tty.expect('Edit value');
    tty.send(String.raw`\e[200~first\nsecond\e`);
    await new Promise((resolve) => setTimeout(resolve, 80));
    tty.send('[201~');
    await tty.expect('first');
    tty.send(String.raw`\r`);
    const result = await tty.expect('EXIT:0 cooked:true');
    expect(result).toContain('ANSWER:"first"');
    expect(result).toContain('\u001b[?2004l');
  } finally {
    await tty.close();
  }
});

test('a real terminal restores paste mode and cursor after Ctrl-C on a long line', async () => {
  const tty = realTerminal('editing', { COLUMNS: '24', NO_COLOR: '1' });
  try {
    await tty.expect('E…e');
    tty.send('x'.repeat(100));
    await tty.expect('…');
    tty.send(String.raw`\x03`);
    const result = await tty.expect('EXIT:130 cooked:true');
    expect(result).toContain('\u001b[?2004l');
    expect(result).toContain('\u001b[?25h');
  } finally {
    await tty.close();
  }
});

test('a real terminal searches a list and Escape clears its term', async () => {
  const tty = realTerminal('list-search', { NO_COLOR: '1' });
  try {
    await tty.expect('Features');
    tty.send('bet');
    await tty.expect('bet');
    tty.send(String.raw`\e`);
    await new Promise((resolve) => setTimeout(resolve, 400));
    tty.send(String.raw`\r`);
    await expect(tty.expect('EXIT:0 cooked:true')).resolves.toContain('ANSWER:"Alpha"');
  } finally {
    await tty.close();
  }
});

test('a real terminal toggles hidden selections with Tab and submits in order', async () => {
  const tty = realTerminal('list-multi', { NO_COLOR: '1' });
  try {
    await tty.expect('Features');
    tty.send(String.raw`\e[B\tAlpha\t\r`);
    await expect(tty.expect('EXIT:0 cooked:true')).resolves.toContain('ANSWER:["beta","Alpha"]');
  } finally {
    await tty.close();
  }
});

test('editor hands a real cooked terminal to the child and restores raw mode on rejection', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'editor-live-'));
  const script = join(folder, 'edit.sh');
  writeFileSync(
    script,
    'stty -a >&2\nprintf "CHILD-OUTPUT\\n" >&2\nif [ -f "$1.once" ]; then printf good > "$1"; else touch "$1.once"; printf bad > "$1"; fi\n',
  );
  const tty = realTerminal('editor', {
    EDITOR: `sh '${script}'`,
    NO_COLOR: '1',
    TMPDIR: folder,
    VISUAL: '',
  });
  try {
    await tty.expect('Press Enter to open your editor');
    tty.send(String.raw`\r`);
    const rejected = await tty.expect('Try again.');
    expect(rejected).toContain('icanon');
    expect(rejected).not.toContain('-icanon');
    expect(rejected).toContain('CHILD-OUTPUT');
    expect(rejected).toContain('\u001b[?2004l');
    expect(rejected).toContain('\u001b[?25h');
    expect(rejected).toContain('\u001b[?2004h');
    tty.send(String.raw`\r`);
    await tty.expect('ANSWER:"good" RAW:false');
  } finally {
    await tty.close();
    rmSync(folder, { force: true, recursive: true });
  }
});

test('missing editor keeps the shell diagnostic above the failure in a real terminal', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'editor-live-'));
  const tty = realTerminal('editor', {
    EDITOR: 'loom-missing-editor-462',
    NO_COLOR: '1',
    TMPDIR: folder,
    VISUAL: '',
  });
  try {
    await tty.expect('Press Enter to open your editor');
    tty.send(String.raw`\r`);
    const output = await tty.expect('could not start');
    expect(output).toContain('exec: loom-missing-editor-462: not found');
    expect(output.indexOf('not found')).toBeLessThan(output.indexOf('could not start'));
  } finally {
    await tty.close();
    rmSync(folder, { force: true, recursive: true });
  }
});
