import type { Reading } from './reading.js';

/**
 * The tokens the date scan reads, left to right: a comment, a string in each of TOML's four forms,
 * and a date, date-time, or time literal as `smol-toml` reads one. A basic string honors a
 * backslash before any character, and a multi-line string may hold one or two quotes of its own
 * right before its closing delimiter. A literal starts only where a token starts and ends where
 * one ends, so the digits of a bare key or a number never match.
 */
const tokens =
  /#[^\n]*|"""(?:\\.|[^\\])*?"{3,5}|'''.*?'{3,5}|"(?:\\.|[^\\"\n])*"|'[^'\n]*'|(?<![\w.+:-])(?:\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})?)?|\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)(?![\w-])/gsu;

/** A comment or a string, which the scan copies as it is. */
const copied = /^["'#]/u;

/**
 * The document with every date, date-time, and time literal written as a basic string of its own
 * text, so the parser hands back the text the file wrote. A local date in a key position is quoted
 * too, which names the same key, since a quoted key and a bare key of the same text are one key.
 */
function quoteDates(text: string): string {
  return text.replaceAll(tokens, (token) => (copied.test(token) ? token : `"${token}"`));
}

/**
 * The table a TOML document holds, read through `smol-toml`, which loads only here. An integer
 * beyond the safe range reads as a `bigint`, so it neither rounds nor fails the document. The
 * parser reads a date or time as a date object that keeps no source text, so once the document
 * as written parses, which judges every literal, it is parsed again with each date literal
 * quoted, and the value is the text the file wrote. A TOML document is always a table.
 */
export async function readToml(text: string): Promise<Reading> {
  const { parse } = await import('smol-toml');
  const read = (source: string) => parse(source, { integersAsBigInt: 'asNeeded' });
  try {
    const table = read(text);
    const quoted = quoteDates(text);
    return { kind: 'usable', object: quoted === text ? table : read(quoted) };
  } catch {
    return { clause: 'is not valid TOML.', kind: 'unusable' };
  }
}
