import type { RowView, View, ViewContext } from '@loomcli/core';
import { viewContext } from '@loomcli/testing';
import type { ViewValues } from '@loomcli/testing';

/*
 * The measures a pack view's unit tests state through viewContext. They are simple on purpose, so a
 * test reads which branch a view took and what it printed, not core's layout: every character is one
 * column, `wrap` breaks only at spaces, `expandTabs` turns a tab into four spaces, and `plain`
 * resolves Loom's frames: a `pad` frame to its padded width, a glyph to one character, and a style or
 * `nowrap` frame to its body. A frame or glyph it does not know throws, so a view that draws
 * something new fails the test loudly.
 */

/** The character each glyph the pack views draw shows as,; the measures draw no other glyph. */
const glyphs: Readonly<Record<string, string>> = {
  bullet: '●',
  line: '─',
  lineDownLeftArc: '╮',
  lineDownRightArc: '╭',
  lineUpLeftArc: '╯',
  lineUpRightArc: '╰',
  lineVertical: '│',
};

/** One Loom frame that holds no other: its JSON header and its body. */
const innermostFrame = /(?<header>[^-]*)(?<body>[^]*)/u;

/** A frame's opening or closing left by a split that cut the frame in two. */
const strayMarks = /[^]*|/gu;

/** The four spaces a tab becomes. */
const TAB = '    ';

/** The spaces before a line padded by `room` spaces under an alignment. */
function spacesBefore(room: number, align: string): number {
  if (align === 'right') {
    return room;
  }
  return align === 'center' ? Math.floor(room / 2) : 0;
}

/** Each line of a body padded with spaces to `size` characters, by its alignment. */
function padded(body: string, size: number, align: string): string {
  return body
    .split('\n')
    .map((line) => {
      const room = Math.max(0, size - line.length);
      const before = spacesBefore(room, align);
      return `${' '.repeat(before)}${line}${' '.repeat(room - before)}`;
    })
    .join('\n');
}

/** The shown text of one innermost frame, or an error when the frame is not one the views draw. */
function resolved(header: string, body: string): string {
  const [kind, detail, align]: unknown[] = JSON.parse(header);
  if (kind === 'pad') {
    if (typeof detail !== 'number') {
      throw new TypeError(`A pad frame needs a numeric width, not ${header}`);
    }
    return padded(body, detail, String(align));
  }
  if (kind === 'glyph') {
    const shown = typeof detail === 'string' ? glyphs[detail] : undefined;
    if (shown === undefined) {
      throw new TypeError(`The measures do not draw the glyph ${header}`);
    }
    return shown;
  }
  if (kind === 'style' || kind === 'nowrap') {
    return body;
  }
  throw new TypeError(`The measures do not know the frame ${header}`);
}

/** Marked text resolved to what it shows: each `pad` frame padded, and every other frame its body. */
function plain(text: string): string {
  let current = text;
  for (let found = innermostFrame.exec(current); found; found = innermostFrame.exec(current)) {
    const [whole] = found;
    const { body = '', header = '[]' } = found.groups ?? {};
    const shown = resolved(header, body);
    current = current.replace(whole, () => shown);
  }
  return current.replaceAll(strayMarks, '');
}

/** The characters, counted as UTF-16 units, in the widest line of the resolved text. */
function width(text: string): number {
  return Math.max(
    ...plain(text)
      .split('\n')
      .map((line) => line.length),
  );
}

/**
 * One input line broken at spaces into lines of at most `limit` characters where its words allow.
 * The line's leading spaces stay with its first word and its trailing spaces with its last.
 */
function wrapLine(line: string, limit: number): string {
  const units = [...line.matchAll(/(?<gap> *)(?<word>\S+)/gu)].map(({ groups }) => ({
    gap: groups?.gap ?? '',
    word: groups?.word ?? '',
  }));
  const [first, ...rest] = units;
  if (first === undefined) {
    return line;
  }
  const trailing = / *$/u.exec(line)?.[0] ?? '';
  const last = rest.at(-1) ?? first;
  last.word = `${last.word}${trailing}`;
  const lines: string[] = [];
  let current = `${first.gap}${first.word}`;
  for (const { gap, word } of rest) {
    if (width(`${current}${gap}${word}`) <= limit) {
      current = `${current}${gap}${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  return [...lines, current].join('\n');
}

/** Text broken at spaces to `limit` characters, line by line, or as it is with no limit. */
function wrap(text: string, limit: number | undefined): string {
  return limit === undefined
    ? text
    : text
        .split('\n')
        .map((line) => wrapLine(line, limit))
        .join('\n');
}

/** Text with each tab turned into four spaces. */
function expandTabs(text: string): string {
  return text.replaceAll('\t', TAB);
}

/** The context a view renders with on a terminal `columns` wide, or on a pipe when undefined. */
function measured(
  view: View<never> | RowView<never>,
  columns: number | undefined,
  values: ViewValues = {},
): ViewContext {
  return viewContext(view, { columns, expandTabs, plain, width, wrap, ...values });
}

/** The lines a render shows, its frames resolved, without the empty string after a final break. */
function linesOf(output: string): string[] {
  const lines = plain(output).split('\n');
  return output.endsWith('\n') ? lines.slice(0, -1) : lines;
}

/** The columns before a shown line's first character other than a space. */
function indentOf(shown: string): number {
  return shown.length - shown.trimStart().length;
}

/** The words a render shows, in order. */
function wordsOf(output: string): string[] {
  return plain(output)
    .split(/\s+/u)
    .filter((word) => word !== '');
}

export { TAB, expandTabs, indentOf, linesOf, measured, plain, width, wordsOf, wrap };
