import { check, pipe, string } from 'valibot';

/**
 * The line terminators the pack recognizes, spelled once, and the text rules built on them.
 * Help's schema, help's page, the manifest, MCP, man pages, completion, and the service unit have to
 * agree on which characters end a line, so every other spelling below derives from the character
 * class of the first. This module belongs to no subpath: each of those plugins imports it, and none
 * imports another's.
 */

/** One line terminator, wherever it appears. */
const terminator = /[\n\v\f\r\u0085\u2028\u2029]/u;

/** Every line terminator in a text, for a replacement that visits each one. */
const terminators = new RegExp(terminator.source, 'gu');

/** CRLF or one terminator: the split the prose schema and the page view share. */
const breaks = new RegExp(String.raw`\r\n|${terminator.source}`, 'u');

/** Every line break in a text, CRLF or one terminator, for a replacement that visits each one. */
const allBreaks = new RegExp(breaks.source, 'gu');

/**
 * A text with each line break turned into one space, so a description or a deprecation message an
 * author wrote across lines prints on the one line every projection gives it.
 */
function singleLine(text: string): string {
  return text.replaceAll(allBreaks, ' ');
}

/** The single-line form of an optional text, absent where the text is. */
function singleLineOf(text: string | undefined): string | undefined {
  return text === undefined ? undefined : singleLine(text);
}

/** One line that holds a character other than whitespace, such as an example's command. */
const line = pipe(
  string(),
  check(
    (value) => /\S/u.test(value) && !terminator.test(value),
    'Supply one line that holds a character other than whitespace.',
  ),
);

/** Prose whose every line holds a character other than whitespace, with its line breaks kept. */
const prose = pipe(
  string(),
  check(
    (value) => value.split(breaks).every((each) => /\S/u.test(each)),
    'Supply prose whose every line holds a character other than whitespace.',
  ),
);

/** Markdown may hold blank lines and a final terminator, but is never whitespace alone. */
const markdown = pipe(
  string(),
  check(
    (value) => /\S/u.test(value),
    'Supply Markdown that holds a character other than whitespace.',
  ),
);

export { breaks, line, markdown, prose, singleLine, singleLineOf, terminator, terminators };
