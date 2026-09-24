import { z } from 'zod';

/**
 * The line terminators the pack recognizes, spelled once, and the two text rules built on them.
 * Help's schema, help's page, and the manifest's schema have to agree on which characters end a
 * line, so every other spelling below derives from the character class of the first. This module
 * belongs to no subpath: help and the manifest both import it, and neither imports the other's.
 */

/** One line terminator, wherever it appears. */
const terminator = /[\n\v\f\r\u0085\u2028\u2029]/u;

/** Every line terminator in a text, for a replacement that visits each one. */
const terminators = new RegExp(terminator.source, 'gu');

/** CRLF or one terminator: the split the prose schema and the page view share. */
const breaks = new RegExp(String.raw`\r\n|${terminator.source}`, 'u');

/** One line that holds a character other than whitespace, such as an example's command. */
const line = z.string().refine((value) => /\S/u.test(value) && !terminator.test(value), {
  message: 'Supply one line that holds a character other than whitespace.',
});

/** Prose whose every line holds a character other than whitespace, with its line breaks kept. */
const prose = z.string().refine((value) => value.split(breaks).every((each) => /\S/u.test(each)), {
  message: 'Supply prose whose every line holds a character other than whitespace.',
});

export { breaks, line, prose, terminator, terminators };
