/*
 * Acceptance plan for a streamed message whose chunks cut through an escape sequence
 * (docs/core/output.md#a-streamed-message, ADR-0163).
 *
 * Before its end, a streamed message holds back an escape sequence its text so far has not
 * finished: a lone ESC, a CSI still waiting for its final byte, and an OSC or another control
 * string still waiting for its terminator. It writes the sequence once the chunk that finishes it
 * arrives, and at the iterable's end what the method writes for the joined text.
 *
 * - On a terminal 16 columns wide, a `print` and an `info` cut inside an OSC 8 link close, inside a
 *   CSI SGR, after a lone ESC, and inside an OSC 8 open end on the screen the joined text draws,
 *   the text after the cut included, and no write holds part of an escape sequence, so none ends
 *   inside one.
 * - Cut at every offset into two chunks, each of those texts, and one whose OSC is never
 *   terminated, does the same on a terminal, and off a terminal writes the bytes of the joined
 *   text.
 * - A text whose OSC is never terminated ends as the joined text does, on a terminal and off one.
 * - A sequence cut between two chunks that are each wrapped in a style call has frame markup
 *   between its bytes, which resolution joins into a whole sequence, so the message does not hold
 *   it back. On a terminal, a `print` and an `info` show at each chunk what the text so far shows
 *   whole, and off a terminal each line is written once the chunk that finishes it arrives, before
 *   a write the iterable issues after that chunk.
 * - Such a cut followed by many finished lines is scanned in work that grows with the text's
 *   length, not its square.
 * - Such a cut followed on the same line by a sequence a later chunk boundary leaves unfinished,
 *   and a style call that spans a finished line and ends inside a CSI, end on a terminal on the
 *   joined screen, and no write holds part of a sequence.
 * - Under the policy that keeps terminal controls, a `print` and an `info` cut at every offset of a
 *   DCS, an SOS, a PM, an APC, and a CSI that is not SGR end on a terminal on the joined screen,
 *   and no write holds part of a sequence. The default policy strips those sequences from every
 *   write, so only this policy shows a write that holds part of one.
 * - Under the policy that keeps terminal controls, a title after the last line break, which no row
 *   holds, still reaches the terminal at the message's end, so a streamed `print` writes the bytes
 *   of the joined text. So does a title that holds a line feed, last or followed by text, and a
 *   bell after the last line break, with the line break the joined text writes after it.
 *
 * The cases run an Application through public APIs on a mock process in the test's own process,
 * and read what a terminal shows through a headless terminal emulator. A write that holds part of an
 * escape sequence is found by a pattern of its own, apart from core's scanner. The cost case runs an
 * Application from source and counts the characters core's escape scanner reads through a mock of
 * its module that wraps each call.
 */
import { Application, style } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test, vi } from 'vite-plus/test';

import { replay } from '../../../scripts/test-screen.js';
import { Application as SourceApplication } from '../src/index.js';

/** The characters core's escape scanner has read from source, counted over every call to it. */
const scanned = vi.hoisted(() => ({ characters: 0 }));

vi.mock(import('../src/style/ansi.js'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    command: (text: string, cursor: number) => {
      const found = actual.command(text, cursor);
      scanned.characters += (found?.end ?? cursor + 1) - cursor;
      return found;
    },
  };
});

/** An async iterable that yields each part in turn. */
async function* chunks(...parts: readonly string[]): AsyncGenerator<string> {
  yield* parts;
}

/** The lanes under test: `print`, which grows at the cursor, and `info`, which keeps an unfinished row. */
const lanes = ['print', 'info'] as const;

type Lane = (typeof lanes)[number];

const columns = 16;

const escape = '\u001B';
const bell = '\u0007';

/** The rendering policy a run takes. */
type Rendering = NonNullable<NonNullable<Parameters<Application['run']>[0]>['rendering']>;

/** A pipe's policy that writes every style, link, and control. */
const everything: Rendering = {
  color: 'always',
  hyperlinks: 'always',
  modifiers: 'always',
  terminalControls: 'preserve',
};

/**
 * Every complete escape sequence: a CSI with its final byte, an OSC with its terminator, a DCS,
 * SOS, PM, or APC with its terminator, and an ESC with its intermediate and final bytes.
 */
const completeSequence = new RegExp(
  `${escape}(?:\\[[0-?]*[ -/]*[@-~]|\\][^${bell}${escape}]*(?:${bell}|${escape}\\\\)|[PX^_][^${escape}]*${escape}\\\\|(?![[\\]PX^_])[ -/]*[0-~])`,
  'gu',
);

/** Whether a write holds part of an escape sequence: an ESC no complete sequence starts with. */
function holdsPartOfSequence(write: string): boolean {
  return write.replaceAll(completeSequence, '').includes(escape);
}

test.each([
  ['\u001b[31m', false],
  ['\u001b]0;Build\u0007', false],
  ['\u001bPq#0\u001b\\', false],
  ['\u001b7', false],
  ['\u001b[31', true],
  ['\u001b]0;Build', true],
  ['\u001bPq#0', true],
  ['\u001b', true],
])('the oracle reads %j as holding part of a sequence: %s', (write, held) => {
  expect(holdsPartOfSequence(write)).toBe(held);
});

/** A mock process whose stdout and stderr are a terminal 16 columns wide, or pipes. */
function processFor({ terminal }: { terminal: boolean }) {
  return terminal
    ? mockProcess({
        env: { TERM: 'xterm-256color' },
        terminal: { columns, rows: 24, streams: ['stdout', 'stderr'] },
      })
    : mockProcess({ env: {} });
}

/** What a run that writes `text` on `lane`, whole or as the chunks `parts`, wrote, write by write. */
async function run(
  lane: Lane,
  text: string | readonly string[],
  { terminal }: { terminal: boolean },
): Promise<readonly string[]> {
  const mock = processFor({ terminal });
  const code = await new Application('sequences')
    .action(async ({ out }) =>
      typeof text === 'string' ? out[lane](text) : out[lane](chunks(...text)),
    )
    .run({ process: mock, rendering: terminal ? {} : everything });
  expect(code).toBe(0);
  return mock.transcript.map(({ text: written }) => written);
}

/** What a terminal 16 columns wide shows for the writes. */
async function screen(writes: readonly string[]): Promise<readonly string[]> {
  const shown = await replay(
    writes.map((write) => ({ write })),
    { columns },
  );
  return shown.lines;
}

const linkClose = 'Working \u001B]8;;https://example.com\u001B\\still on it\u001B]8;;\u001B\\ x';

/** Each cut a chunk ends at, named for where it falls. */
const cuts: readonly { readonly name: string; readonly parts: readonly string[] }[] = [
  {
    name: 'inside an OSC 8 link close, before its terminator',
    parts: [linkClose.slice(0, -4), linkClose.slice(-4)],
  },
  {
    name: 'inside an OSC 8 link close, between the ESC and the backslash of its terminator',
    parts: [linkClose.slice(0, -3), linkClose.slice(-3)],
  },
  { name: 'inside a CSI SGR', parts: ['a \u001B[3', '1mred\u001B[0m b'] },
  { name: 'after a lone ESC', parts: ['a \u001B', '[31mred\u001B[0m b'] },
  {
    name: 'inside an OSC 8 open',
    parts: ['see \u001B]8;;https://exa', 'mple.com\u001B\\link\u001B]8;;\u001B\\ x'],
  },
];

test.each(lanes.flatMap((lane) => cuts.map((cut) => ({ ...cut, lane }))))(
  'on a terminal, a streamed $lane cut $name ends on the joined screen, and no write holds part of a sequence',
  async ({ lane, parts }) => {
    const streamed = await run(lane, parts, { terminal: true });
    expect(streamed.filter(holdsPartOfSequence)).toEqual([]);
    await expect(screen(streamed)).resolves.toEqual(
      await screen(await run(lane, parts.join(''), { terminal: true })),
    );
  },
);

test.each(lanes)(
  'on a terminal, a streamed %s cut inside the link close shows the text after the link',
  async (lane) => {
    const streamed = await run(lane, [linkClose.slice(0, -4), linkClose.slice(-4)], {
      terminal: true,
    });
    const shown = await screen(streamed);
    expect(shown.at(-1)).toMatch(/ x$/u);
  },
);

const neverTerminated = 'title \u001B]0;never closed';

/** Every text cut at each of its offsets into two chunks. */
const everyCut = [...cuts.map(({ parts }) => parts.join('')), neverTerminated].flatMap((text) =>
  Array.from({ length: text.length - 1 }, (_unused, offset) => [
    text.slice(0, offset + 1),
    text.slice(offset + 1),
  ]),
);

test.each(lanes)(
  'on a terminal, a streamed %s cut anywhere ends on the joined screen, and no write holds part of a sequence',
  async (lane) => {
    for (const parts of everyCut) {
      const streamed = await run(lane, parts, { terminal: true });
      const whole = await run(lane, parts.join(''), { terminal: true });
      expect({
        inside: streamed.filter(holdsPartOfSequence),
        parts,
        shown: await screen(streamed),
      }).toEqual({ inside: [], parts, shown: await screen(whole) });
    }
  },
);

test.each(lanes)(
  'off a terminal, a streamed %s cut anywhere writes the bytes of the joined text',
  async (lane) => {
    for (const parts of everyCut) {
      const streamed = await run(lane, parts, { terminal: false });
      const whole = await run(lane, parts.join(''), { terminal: false });
      expect({ bytes: streamed.join(''), parts }).toEqual({ bytes: whole.join(''), parts });
    }
  },
);

test.each(lanes)(
  'a streamed %s whose OSC is never terminated ends as the joined text does, on a terminal and off one',
  async (lane) => {
    const parts = ['title \u001B]0;nev', 'er closed'];
    const piped = await run(lane, parts, { terminal: false });
    const pipedWhole = await run(lane, parts.join(''), { terminal: false });
    expect(piped.join('')).toBe(pipedWhole.join(''));
    const streamed = await run(lane, parts, { terminal: true });
    const whole = await run(lane, parts.join(''), { terminal: true });
    await expect(screen(streamed)).resolves.toEqual(await screen(whole));
  },
);

/** What a run streaming `parts` on `lane` wrote, and how many writes it had made after each chunk. */
async function checkpointed(
  lane: Lane,
  parts: readonly string[],
  { terminal }: { terminal: boolean },
): Promise<{ readonly checkpoints: readonly number[]; readonly writes: readonly string[] }> {
  const mock = processFor({ terminal });
  const checkpoints: number[] = [];
  async function* counted(): AsyncGenerator<string> {
    for (const part of parts) {
      yield part;
      checkpoints.push(mock.transcript.length);
    }
  }
  const code = await new Application('sequences')
    .action(async ({ out }) => out[lane](counted()))
    .run({ process: mock, rendering: everything });
  expect(code).toBe(0);
  return { checkpoints, writes: mock.transcript.map(({ text: written }) => written) };
}

/** What a run that writes `text` whole on `lane` wrote under the policy that keeps every control. */
async function wholeKept(lane: Lane, text: string, { terminal }: { terminal: boolean }) {
  const mock = processFor({ terminal });
  const code = await new Application('sequences')
    .action(async ({ out }) => out[lane](text))
    .run({ process: mock, rendering: everything });
  expect(code).toBe(0);
  return mock.transcript.map(({ text: written }) => written);
}

const linkOpen = '\u001B]8;;https://example.com\u001B\\';
const linkEnd = '\u001B]8;;\u001B\\';

/**
 * Texts whose escape sequence is cut between two chunks that are each wrapped in a style call, so
 * frame markup falls between the sequence's bytes, with what a pipe gets after each chunk: the
 * writes and the count of them made by each chunk's end.
 */
const framed: readonly {
  readonly name: string;
  readonly parts: readonly string[];
  readonly piped: Readonly<Record<Lane, { checkpoints: number[]; writes: string[] }>>;
}[] = [
  {
    name: 'a link open cut before the backslash of its terminator, its label unfinished',
    parts: [
      style.bold(`ready ${linkOpen.slice(0, -1)}`),
      style.bold(String.raw`\link`),
      style.bold(`${linkEnd} x`),
    ],
    piped: {
      info: {
        checkpoints: [0, 0, 0],
        writes: [`ℹ \u001B[1mready ${linkOpen}link${linkEnd} x\u001B[22m\n`],
      },
      print: {
        checkpoints: [0, 0, 0],
        writes: [`\u001B[1mready ${linkOpen}link${linkEnd} x\u001B[22m\n`],
      },
    },
  },
  {
    name: 'a link open cut before the backslash of its terminator, its label line finished',
    parts: [
      style.bold(`ready ${linkOpen.slice(0, -1)}`),
      style.bold('\\link\n'),
      style.bold(`${linkEnd} x`),
    ],
    piped: {
      info: {
        checkpoints: [0, 1, 1],
        writes: [`ℹ \u001B[1mready ${linkOpen}link\n`, `  ${linkEnd} x\u001B[22m\n`],
      },
      print: {
        checkpoints: [0, 1, 1],
        writes: [`\u001B[1mready ${linkOpen}link\n`, `${linkEnd} x\u001B[22m\n`],
      },
    },
  },
  {
    name: 'a title cut before the backslash of its terminator, a finished line after it',
    parts: [
      style.bold('ready \u001B]0;Build\u001B'),
      style.bold('\\ complete\n'),
      style.bold('more'),
    ],
    piped: {
      info: {
        checkpoints: [0, 1, 1],
        writes: ['ℹ \u001B[1mready \u001B]0;Build\u001B\\ complete\n', '  more\u001B[22m\n'],
      },
      print: {
        checkpoints: [0, 1, 1],
        writes: ['\u001B[1mready \u001B]0;Build\u001B\\ complete\n', 'more\u001B[22m\n'],
      },
    },
  },
  {
    name: 'a CSI cut before its final parameter',
    parts: [style.bold('ready \u001B[3'), style.bold('1mred'), style.bold('\u001B[0m x')],
    piped: {
      info: {
        checkpoints: [0, 0, 0],
        writes: ['ℹ \u001B[1mready \u001B[31mred\u001B[39m x\u001B[22m\n'],
      },
      print: {
        checkpoints: [0, 0, 0],
        writes: ['\u001B[1mready \u001B[31mred\u001B[39m x\u001B[22m\n'],
      },
    },
  },
];

/** Each framed cut on each lane. */
const framedRuns = lanes.flatMap((lane) =>
  framed.map(({ name, parts, piped }) => ({ lane, name, parts, piped })),
);

test.each(framedRuns)(
  'on a terminal, a streamed $lane of styled chunks with $name shows, at each chunk, what the text so far shows whole',
  async ({ lane, parts }) => {
    const { checkpoints, writes } = await checkpointed(lane, parts, { terminal: true });
    const shown = await Promise.all(
      checkpoints.map(async (count) => screen(writes.slice(0, count))),
    );
    const whole = await Promise.all(
      parts.map(async (_part, index) =>
        screen(await wholeKept(lane, parts.slice(0, index + 1).join(''), { terminal: true })),
      ),
    );
    expect(shown.slice(1)).toEqual(whole.slice(1));
    await expect(screen(writes)).resolves.toEqual(whole.at(-1));
  },
);

test.each(framedRuns)(
  'off a terminal, a streamed $lane of styled chunks with $name writes each line once the chunk that finishes it arrives',
  async ({ lane, parts, piped }) => {
    await expect(checkpointed(lane, parts, { terminal: false })).resolves.toEqual(piped[lane]);
  },
);

test.each(lanes)(
  'off a terminal, a write issued inside a streamed %s lands after the line a styled chunk finished',
  async (lane) => {
    const mock = mockProcess({ env: {} });
    const code = await new Application('sequences')
      .action(async ({ out }) => {
        await out[lane](
          (async function* withProgress() {
            yield style.bold(`ready ${linkOpen.slice(0, -1)}`);
            yield style.bold('\\link\n');
            await out[lane]('progress checkpoint');
            yield style.bold(`${linkEnd} x`);
          })(),
        );
      })
      .run({ process: mock, rendering: everything });
    expect(code).toBe(0);
    const lead = lane === 'info' ? 'ℹ ' : '';
    const indent = lane === 'info' ? '  ' : '';
    expect(mock.transcript.map(({ text }) => text)).toEqual([
      `${lead}\u001B[1mready ${linkOpen}link\n`,
      `${lead}progress checkpoint\n`,
      `${indent}${linkEnd} x\u001B[22m\n`,
    ]);
  },
);

test.each(lanes)(
  'on a terminal, a streamed %s that ends with a title after its last line break writes the title, as the joined text does',
  async (lane) => {
    const parts = ['ready\n\u001B]0;Bui', 'ld\u001B\\'];
    const { writes } = await checkpointed(lane, parts, { terminal: true });
    const whole = await wholeKept(lane, parts.join(''), { terminal: true });
    expect(writes.join('')).toContain('\u001B]0;Build\u001B\\');
    await expect(screen(writes)).resolves.toEqual(await screen(whole));
  },
);

test('on a terminal, a streamed print that ends with a title after its last line break writes the bytes of the joined text', async () => {
  const parts = ['ready\n\u001B]0;Bui', 'ld\u001B\\'];
  const { writes } = await checkpointed('print', parts, { terminal: true });
  const whole = await wholeKept('print', parts.join(''), { terminal: true });
  expect(writes.join('')).toBe(whole.join(''));
});

/**
 * Streams on the `info` lane of an Application built from source, on a terminal, a styled title
 * cut before the backslash of its terminator and then `lines` finished lines, and answers the
 * length of the text and the characters core's escape scanner read over the whole message.
 */
async function scannedFor(lines: number) {
  const parts = [
    style.bold('prep \u001B]0;Build\u001B'),
    style.bold('\\ready\n'),
    ...Array.from({ length: lines }, () => 'build ok\n'),
  ];
  const mock = mockProcess({
    env: { TERM: 'xterm-256color' },
    terminal: { columns: 100, rows: 24, streams: ['stdout', 'stderr'] },
  });
  scanned.characters = 0;
  const code = await new SourceApplication('scanned')
    .action(async ({ out }) => out.info(chunks(...parts)))
    .run({ process: mock, rendering: everything });
  expect(code).toBe(0);
  return { characters: scanned.characters, length: parts.join('').length };
}

test('a streamed message whose styled chunks cut a sequence scans in work that grows with its length, not its square', async () => {
  const single = await scannedFor(100);
  const double = await scannedFor(200);
  expect(single.characters).toBeLessThan(single.length * 12);
  expect(double.characters).toBeLessThan(single.characters * 2.2);
});

/**
 * Texts whose chunks cut, on one line, a sequence that frame markup separates and then a sequence
 * no markup separates: the first resolution joins, and the second the message holds back.
 */
const thenUnfinished: readonly { readonly name: string; readonly parts: readonly string[] }[] = [
  {
    name: 'a styled link open cut before its backslash, then a link close cut before its backslash',
    parts: [
      style.bold('ready \u001B]8;;https://x\u001B'),
      style.bold(String.raw`\link`),
      '\u001B]8;;\u001B',
      '\\ done\n',
    ],
  },
  {
    name: 'a styled link open cut before its backslash, then a link close cut before its terminator',
    parts: [
      style.bold('ready \u001B]8;;https://x\u001B'),
      style.bold('\\link \u001B]8;;'),
      '\u001B\\ done\n',
    ],
  },
];

test.each(
  lanes.flatMap((lane) => thenUnfinished.map(({ name, parts }) => ({ lane, name, parts }))),
)(
  'on a terminal, a streamed $lane with $name ends on the joined screen, and no write holds part of a sequence',
  async ({ lane, parts }) => {
    const streamed = await run(lane, parts, { terminal: true });
    expect(streamed.filter(holdsPartOfSequence)).toEqual([]);
    await expect(screen(streamed)).resolves.toEqual(
      await screen(await run(lane, parts.join(''), { terminal: true })),
    );
  },
);

/** Texts whose last line, or a title inside them, holds only terminal controls or a line break. */
const controlEnds: readonly { readonly name: string; readonly parts: readonly string[] }[] = [
  {
    name: 'a title holding a line feed ends its only line',
    parts: ['ready ', '\u001B]0;Build\n\u0007'],
  },
  {
    name: 'a title holding a line feed follows the last line break',
    parts: ['ready\n', '\u001B]0;Build\nok\u0007'],
  },
  {
    name: 'a title holding a line feed is followed by text',
    parts: ['ready\n', '\u001B]0;Build\nok\u0007', 'done'],
  },
  { name: 'a bell follows the last line break', parts: ['ready\n', '\u0007'] },
];

test.each(controlEnds)(
  'on a terminal, a streamed print where $name writes the bytes of the joined text',
  async ({ parts }) => {
    const { writes } = await checkpointed('print', parts, { terminal: true });
    const whole = await wholeKept('print', parts.join(''), { terminal: true });
    expect(writes.join('')).toBe(whole.join(''));
  },
);

test.each(lanes)(
  'on a terminal, a streamed %s whose style call spans a finished line and ends inside a CSI ends on the joined screen, and no write holds part of a sequence',
  async (lane) => {
    const parts = [style.bold('one\ntwo \u001B[3'), '1mred\u001B[0m x'];
    const streamed = await run(lane, parts, { terminal: true });
    expect(streamed.filter(holdsPartOfSequence)).toEqual([]);
    await expect(screen(streamed)).resolves.toEqual(
      await screen(await run(lane, parts.join(''), { terminal: true })),
    );
  },
);

/** Texts that hold a control string or a CSI that is not SGR, which the default policy strips. */
const keptControls: readonly { readonly name: string; readonly text: string }[] = [
  { name: 'a DCS', text: 'a \u001BP1;2|data\u001B\\ b' },
  { name: 'an SOS', text: 'a \u001BXhidden\u001B\\ b' },
  { name: 'a PM', text: 'a \u001B^private\u001B\\ b' },
  { name: 'an APC', text: 'a \u001B_app\u001B\\ b' },
  { name: 'a CSI that hides the cursor', text: 'a \u001B[?25l b' },
];

test.each(lanes.flatMap((lane) => keptControls.map(({ name, text }) => ({ lane, name, text }))))(
  'on a terminal that keeps terminal controls, a streamed $lane holding $name cut anywhere ends on the joined screen, and no write holds part of a sequence',
  async ({ lane, text }) => {
    const whole = await screen(await wholeKept(lane, text, { terminal: true }));
    for (let offset = 1; offset < text.length; offset += 1) {
      const parts = [text.slice(0, offset), text.slice(offset)];
      const { writes } = await checkpointed(lane, parts, { terminal: true });
      expect({
        inside: writes.filter(holdsPartOfSequence),
        parts,
        shown: await screen(writes),
      }).toEqual({ inside: [], parts, shown: whole });
    }
  },
);
