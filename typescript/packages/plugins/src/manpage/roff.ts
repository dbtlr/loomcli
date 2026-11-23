/*
 * The one writer every string of a man page passes through: roff escapes, request arguments, the
 * characters a page keeps ASCII, and font runs. A page reads the same under man-db's groff and
 * under mandoc, whether or not the man program runs preconv.
 */
import { escapeControlCharacters } from '@loomcli/core';

/** A font a run of text is written in. */
type Font = 'regular' | 'bold' | 'italic' | 'boldItalic';

/** Filled text, which man wraps and where a tab is a space, or no-fill text, which keeps a tab. */
type Fill = 'fill' | 'noFill';

/** One run of text in one font. */
interface Run {
  readonly text: string;
  readonly font: Font;
}

/** The escapes of the ASCII characters roff would otherwise read or print as something else. */
const named: Readonly<Record<string, string>> = {
  '"': String.raw`\(dq`,
  "'": String.raw`\(aq`,
  '-': String.raw`\-`,
  '\\': String.raw`\e`,
  '^': String.raw`\(ha`,
  '`': String.raw`\(ga`,
  '~': String.raw`\(ti`,
};

/** The escape that opens each font other than the regular one. */
const opening: Readonly<Record<Exclude<Font, 'regular'>, string>> = {
  bold: String.raw`\fB`,
  boldItalic: String.raw`\f(BI`,
  italic: String.raw`\fI`,
};

/** The last ASCII code point; every character above it is written as its code point. */
const lastAscii = 0x7f;
const lastC0 = 0x1f;
const firstC1 = 0x80;
const lastC1 = 0x9f;
const lineSeparator = 0x20_28;
const paragraphSeparator = 0x20_29;
const hexRadix = 16;
const hexDigits = 4;

/** Whether a code point is a control character or a line separator, which shows as its escape. */
function isControl(point: number): boolean {
  return (
    point <= lastC0 ||
    point === lastAscii ||
    (point >= firstC1 && point <= lastC1) ||
    point === lineSeparator ||
    point === paragraphSeparator
  );
}

/** The first code point of a string; an empty one reads as the null character. */
const firstIndex = 0;
const nullCharacter = 0;

/**
 * A character outside printable ASCII as a page writes it: a control character or a line
 * separator as its `\uXXXX` escape with the backslash escaped, so it shows, and any other as its
 * code point in uppercase hexadecimal.
 */
function escapeCodePoint(character: string): string {
  const point = character.codePointAt(firstIndex) ?? nullCharacter;
  if (isControl(point)) {
    return escapeControlCharacters(character).replaceAll('\\', String.raw`\e`);
  }
  if (point > lastAscii) {
    return String.raw`\[u${point.toString(hexRadix).toUpperCase().padStart(hexDigits, '0')}]`;
  }
  return character;
}

/** One character as a page writes it. */
function escapeCharacter(character: string, fill: Fill): string {
  if (character === '\t') {
    return fill === 'noFill' ? character : ' ';
  }
  return named[character] ?? escapeCodePoint(character);
}

/** Text as a page writes it: ASCII, with nothing roff reads as an escape or a request argument. */
function escapeText(text: string, fill: Fill = 'fill'): string {
  let written = '';
  for (const character of text) {
    written += escapeCharacter(character, fill);
  }
  return written;
}

/** Filled text whose every space is unbreakable, so man never wraps a line inside it. */
function escapeUnbroken(text: string): string {
  return escapeText(text).replaceAll(' ', String.raw`\ `);
}

/** Text in a font, which returns to the regular font after it, so every line ends in it. */
function inFont(text: string, font: Font, fill: Fill = 'fill'): string {
  const escaped = escapeText(text, fill);
  if (escaped === '' || font === 'regular') {
    return escaped;
  }
  return `${opening[font]}${escaped}\\fR`;
}

/** Runs of text, joined by font first, so each font opens once for each stretch of it. */
function writeRuns(runs: readonly Run[], fill: Fill = 'fill'): string {
  const joined: Run[] = [];
  for (const run of runs) {
    const last = joined.pop();
    if (last !== undefined && last.font === run.font) {
      joined.push({ font: run.font, text: last.text + run.text });
    } else {
      joined.push(...(last === undefined ? [] : [last]), ...(run.text === '' ? [] : [run]));
    }
  }
  return joined.map((run) => inFont(run.text, run.font, fill)).join('');
}

/** A text line, which starts with `\&` when it would start with a period, so it is no request. */
function textLine(content: string): string {
  return content.startsWith('.') ? `\\&${content}` : content;
}

/** A request with each argument written in double quotes, so an argument of several words is one. */
function request(name: string, args: readonly string[]): string {
  return [`.${name}`, ...args.map((arg) => `"${escapeText(arg)}"`)].join(' ');
}

export type { Fill, Font, Run };
export { escapeText, escapeUnbroken, inFont, request, textLine, writeRuns };
