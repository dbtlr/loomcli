/**
 * The line terminators help recognizes, spelled once. The schema that rejects a value holding one
 * and the page that splits prose or escapes a rendered default have to agree on which characters
 * end a line, so both other spellings below derive from the character class of the first.
 */

/** One line terminator, wherever it appears. */
const terminator = /[\n\v\f\r\u0085\u2028\u2029]/u;

/** Every line terminator in a text, for a replacement that visits each one. */
const terminators = new RegExp(terminator.source, 'gu');

/** CRLF or one terminator: the split the prose schema and the page renderer share. */
const breaks = new RegExp(String.raw`\r\n|${terminator.source}`, 'u');

export { breaks, terminator, terminators };
