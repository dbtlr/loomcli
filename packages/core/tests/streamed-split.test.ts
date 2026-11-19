/*
 * Acceptance plan for the split of a streamed message (docs/core/output.md#a-streamed-message,
 * ADR-0163): a lane view core ships lays out each chunk from the last line the message finished,
 * with a row that sets up what the lines before it leave open, and that changes no byte.
 *
 * Each text below leaves the lines after a finished line something to carry: a raw color, reset on
 * its line or left open, one whose parameter Loom passes on as it is, one that matches a style's
 * color but not its fallbacks, modifiers in an order a transition writes, a raw link, one whose address holds a line break, a lone
 * carriage return and other terminal controls, a pad or no-wrap frame on its line or across lines,
 * a raw color inside a pad, a style that names the theme's token, a header the palette rejects and
 * a stray close, a style that names a token the palette lacks, a control string and a frame header
 * that go on past a line break, tabs, and CRLF, an attribute Loom does not track set and reset on
 * every line, and raw colors that differ only at a depth the destination does not show. Each
 * streams in chunks a line, a word, three characters, and five characters long, which cut through
 * escapes and frame headers too.
 *
 * - Off a terminal, with modifiers and hyperlinks on, terminal controls kept, and color on at 16
 *   colors, 256 colors, and truecolor or turned off by `NO_COLOR`, the bytes `info` and `print`
 *   write for the stream equal the bytes they write for the joined text. A frame header that holds
 *   a line break is left out here: a chunk that ends inside it ends a line the header has not,
 *   which a style call kept inside one chunk never does.
 * - On each of those destinations, and on a terminal 30 columns wide at 16 colors, 256 colors, and
 *   truecolor, under `NO_COLOR`, and keeping terminal controls, every write the default lane view
 *   makes, in order, equals the write a lane view an author overrode with the same function makes,
 *   which lays out the whole text so far at every chunk and never splits.
 *
 * The cases run an Application through public APIs on a mock process in the test's own process.
 */
import { Application, lanes, nowrap, override, pad, plugin, style } from '@loomcli/core';
import type { Out } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

/** An async iterable that yields each part in turn. */
async function* chunks(...parts: readonly string[]): AsyncGenerator<string> {
  for (const part of parts) {
    yield part;
  }
}

/** A marked frame written by hand, as a style call writes one, for a header no style call makes. */
function framed(header: string, body: string): string {
  return `${header}${body}`;
}

const texts: readonly string[] = [
  'a \u001B[31mred\u001B[0m b and more words\nnext line here\nlast',
  'a \u001B[31mred\nstill red line and on\n\u001B[1mbold too\nend\u001B[0m tail',
  '\u001B[5mblink\u001B[0m\nafter blink\nend',
  `${style.bold('x \u001B[5mblink\nmore')}\nafter\nend`,
  '\u001B[1mone \u001B[3mtwo \u001B[22mthree\n\u001B[1mfour\nfive \u001B[0m six\nseven',
  '\u001B[31ma\u001B[32mb\u001B[33mc\u001B[39md\n\u001B[44me\u001B[49mf\n\u001B[38;5;100mg\nh\u001B[0m',
  `${style.red('red \u001B[1mbold\nstill')} plain\n\u001B[39mafter\nend`,
  'see \u001B]8;;https://example.com\u001B\\link\nstill link\u001B]8;;\u001B\\ done\nend',
  'see \u001B]8;;https://example.com\u001B\\link\u001B]8;;\u001B\\ done\nnext\nend',
  'see \u001B]8;;https://example.com/a\nb\u001B\\link\nstill\u001B]8;;\u001B\\ done\nend',
  'abc\rdef and more\nghi jkl\nmno',
  'ab\u001B[2Kcd\u0007ef\nnext line\nend',
  `${pad('ab', 6)} c\nnext\nend`,
  `x ${pad('ab\ncd ef\ngh', 8, { align: 'right' })} y\nlast`,
  `${nowrap('a b c\nd e f g h i j k l m n o p q r s')}\nend words here`,
  `${pad('\u001B[31mred\nx', 6)}\nafter\nend`,
  `${framed('["bogus"]', 'x')} y  z\nnext\nend`,
  `${framed('["style",[["token","accent"]]]', 'a b\nc d')}\ne f\ng`,
  `${framed('["style",[["token","nope"]]]', 'a\nb')}\nc\nd`,
  'title \u001B]0;window\nmore\u001B\\ rest\nnext\nend',
  `${framed('["style",\n[["modifier","bold"]]]', 'bold\ntext')}\nend`,
  `${style.rgb(1, 2, 3, { ansi16: 'red', ansi256: 17 })('a \u001B[38;2;1;2;3mb\nc')}\nd\ne`,
  'a\tb \u001B[31mc\td\ne\tf\ng',
  'a \u001B[31mb\r\nc\r\nd',
  '\u001B[5mone two\u001B[25m\n\u001B[5mthree\u001B[25m four\n\u001B[11mfive\u001B[10m\nsix',
  '\u001B[38;5;196ma\u001B[38;5;160mb\nc\u001B[1md\ne\u001B[38;5;196mf\ng',
  '\u001B[38;2;255;0;0ma\nb\u001B[38;2;250;0;0mc\u001B[48;5;17m\nd\u001B[38;2;255;0;0me\nf',
  `${style.red('a \u001B[38;5;196mb\nc')}\nd \u001B[38;5;160me\u001B[22m\nf`,
];

/** The texts whose frame headers each sit on one line, so no cut at a line break falls inside one. */
const oneLineHeaders = texts.filter((text) => !/\uE000[^\uE001]*\n/u.test(text));

/** The text cut into chunks of `size` characters. */
function bySize(size: number): (text: string) => string[] {
  return (text) => text.match(new RegExp(`[^]{1,${String(size)}}`, 'gu')) ?? [];
}

const chunkings: readonly { readonly name: string; readonly cut: (text: string) => string[] }[] = [
  { cut: (text) => text.match(/[^\n]*\n|[^\n]+$/gu) ?? [], name: 'a line' },
  { cut: (text) => text.match(/\S+\s*|\s+/gu) ?? [], name: 'a word' },
  { cut: bySize(3), name: 'three characters' },
  { cut: bySize(5), name: 'five characters' },
];

/** The theme every run installs, which adds the token `accent`. */
const accent = plugin('fixture/theme', { theme: { accent: style.cyan } });

/** The rendering policy a run takes. */
type Rendering = NonNullable<NonNullable<Parameters<Application['run']>[0]>['rendering']>;

/** Where a run writes: a pipe or a terminal 30 columns wide, its environment, and its rendering policy. */
interface Destination {
  readonly name: string;
  readonly terminal: boolean;
  readonly env: Readonly<Record<string, string>>;
  readonly rendering: Rendering;
}

/** A pipe's policy that writes every style and control. */
const everything: Rendering = {
  color: 'always',
  hyperlinks: 'always',
  modifiers: 'always',
  terminalControls: 'preserve',
};

const pipes: readonly Destination[] = [
  { env: {}, name: 'a pipe at 16 colors', rendering: everything, terminal: false },
  {
    env: { TERM: 'xterm-256color' },
    name: 'a pipe at 256 colors',
    rendering: everything,
    terminal: false,
  },
  {
    env: { COLORTERM: 'truecolor' },
    name: 'a pipe in truecolor',
    rendering: everything,
    terminal: false,
  },
  {
    env: { NO_COLOR: '1' },
    name: 'a pipe under NO_COLOR',
    rendering: { hyperlinks: 'always', modifiers: 'always', terminalControls: 'preserve' },
    terminal: false,
  },
];

const terminals: readonly Destination[] = [
  {
    env: { TERM: 'xterm-256color' },
    name: 'a terminal at 256 colors',
    rendering: {},
    terminal: true,
  },
  { env: { TERM: 'xterm' }, name: 'a terminal at 16 colors', rendering: {}, terminal: true },
  {
    env: { COLORTERM: 'truecolor', TERM: 'xterm-256color' },
    name: 'a terminal in truecolor',
    rendering: {},
    terminal: true,
  },
  {
    env: { NO_COLOR: '1', TERM: 'xterm-256color' },
    name: 'a terminal under NO_COLOR',
    rendering: {},
    terminal: true,
  },
  {
    env: { TERM: 'xterm-256color' },
    name: 'a terminal that keeps terminal controls',
    rendering: { terminalControls: 'preserve' },
    terminal: true,
  },
];

/**
 * Every write `write` makes, in order, on `destination`. With `reference`, the `info` and `print`
 * lane views are overridden with their own functions, so a streamed message lays out its whole
 * text at every chunk.
 */
async function writes(
  write: (out: Out) => Promise<void>,
  { destination, reference }: { destination: Destination; reference: boolean },
): Promise<string[]> {
  const { env, rendering, terminal } = destination;
  const mock = terminal
    ? mockProcess({
        env: { ...env },
        terminal: { columns: 30, rows: 24, streams: ['stdout', 'stderr'] },
      })
    : mockProcess({ env: { ...env } });
  const views = reference
    ? [
        override(lanes.info, { render: lanes.info.render }),
        override(lanes.print, { render: lanes.print.render }),
      ]
    : [];
  const code = await new Application('split', { plugins: [accent], views })
    .action(async ({ out }) => write(out))
    .run({ process: mock, rendering });
  expect(code).toBe(0);
  return mock.transcript.map(({ stream, text }) => `${stream}:${text}`);
}

/** Each lane on each destination. */
function everyLane(destinations: readonly Destination[]) {
  return destinations.flatMap((destination) =>
    (['info', 'print'] as const).map((lane) => ({ destination, lane, name: destination.name })),
  );
}

test.each(everyLane(pipes))(
  'on $name, a stream on $lane writes the joined bytes however its chunks cut it',
  async ({ destination, lane }) => {
    for (const text of oneLineHeaders) {
      const joined = await writes((out) => out[lane](text), { destination, reference: false });
      const whole = joined.map((piece) => piece.replace(/^\w+:/u, '')).join('');
      for (const { cut, name } of chunkings) {
        const streamed = await writes((out) => out[lane](chunks(...cut(text))), {
          destination,
          reference: false,
        });
        expect({
          bytes: streamed.map((piece) => piece.replace(/^\w+:/u, '')).join(''),
          name,
          text,
        }).toEqual({
          bytes: whole,
          name,
          text,
        });
      }
    }
  },
);

test.each(everyLane([...pipes, ...terminals]))(
  'on $name, a stream on $lane makes the writes of a lane view that never splits',
  async ({ destination, lane }) => {
    for (const text of texts) {
      for (const { cut, name } of chunkings) {
        const parts = cut(text);
        const split = await writes((out) => out[lane](chunks(...parts)), {
          destination,
          reference: false,
        });
        const whole = await writes((out) => out[lane](chunks(...parts)), {
          destination,
          reference: true,
        });
        expect({ name, text, writes: split }).toEqual({ name, text, writes: whole });
      }
    }
  },
);
