import { readerFormatOf, readFormatNames } from './extensions.js';
import { splitExtension } from './names.js';
import { readerParser, readingOf } from './reading.js';
import type { ConfigurationReader, Parse, Reading, Unread } from './reading.js';
import { positionAt, scanJson } from './text.js';

/** The code point of the byte order mark a UTF-8 file may start with, which the reading ignores. */
const byteOrderMarkCodePoint = 65_279;
const byteOrderMark = String.fromCodePoint(byteOrderMarkCodePoint);

/** A parser of one file's text, which ignores a leading byte order mark. */
interface Parser {
  readonly kind: 'parser';
  readonly parse: (text: string) => Promise<Reading>;
}

/**
 * The one JSON object a file's text holds, comments and trailing commas allowed. The scan judges
 * the text and names where it breaks, and `JSON.parse` builds the value of a text that passes.
 */
async function readJson(text: string): Promise<Reading> {
  const scan = scanJson(text);
  if ('offset' in scan) {
    return { at: positionAt(text, scan.offset), clause: 'invalid-json', kind: 'unusable' };
  }
  return readingOf(JSON.parse(scan.json), 'not-json-object');
}

/** A parser that removes a leading byte order mark before it reads. */
function parserOf(read: Parse): Parser {
  return {
    kind: 'parser',
    parse: async (text) =>
      read(text.startsWith(byteOrderMark) ? text.slice(byteOrderMark.length) : text),
  };
}

/**
 * The parser a file's extension chooses among the readers an application passes, or the format it
 * names that none of them reads. The extension is the text after the last `.` of the path's last
 * segment, unless that `.` starts the name, and compares as written: `toml` reads through the TOML
 * reader, `yaml` and `yml` through the YAML reader, and every other name as JSON, one with no
 * extension included. This module imports no reader, so a reader the application does not pass
 * never reaches its bundle.
 */
export function chooseParser(
  path: string,
  readers: readonly ConfigurationReader[],
): Parser | Unread {
  const extension = splitExtension(path)?.extension;
  const format = extension === undefined ? undefined : readerFormatOf(extension);
  if (format === undefined) {
    return parserOf(readJson);
  }
  const parse = readers
    .filter((each) => each.format === format)
    .map((each) => readerParser(each))
    .find((each) => each !== undefined);
  return parse === undefined
    ? { format, formats: readFormatNames(readers), kind: 'unread' }
    : parserOf(parse);
}
