import { splitExtension } from './names.js';
import { readingOf } from './reading.js';
import type { Reading } from './reading.js';
import { readToml } from './toml.js';
import { readYaml } from './yaml.js';

/** The code point of the byte order mark a UTF-8 file may start with, which the reading ignores. */
const byteOrderMarkCodePoint = 65_279;
const byteOrderMark = String.fromCodePoint(byteOrderMarkCodePoint);

/**
 * The parser a file's extension chooses. The extension is the text after the last `.` of the
 * path's last segment, unless that `.` starts the name, and compares as written: `toml` reads as
 * TOML, `yaml` and `yml` as YAML, and every other name as JSON, one with no extension included.
 */
function parserOf(path: string): (text: string) => Promise<Reading> | Reading {
  const extension = splitExtension(path)?.extension;
  if (extension === 'toml') {
    return readToml;
  }
  return extension === 'yaml' || extension === 'yml' ? readYaml : readJson;
}

/** The one JSON object a file's text holds. */
function readJson(text: string): Reading {
  try {
    return readingOf(JSON.parse(text), 'does not hold a JSON object.');
  } catch {
    return { clause: 'is not valid JSON.', kind: 'unusable' };
  }
}

/**
 * What one file's text holds, parsed by its path's extension with a leading byte order mark
 * ignored. A TOML or YAML parser loads only when this reads the text of a file of its kind.
 */
export async function parseFile(path: string, text: string): Promise<Reading> {
  const body = text.startsWith(byteOrderMark) ? text.slice(byteOrderMark.length) : text;
  return parserOf(path)(body);
}
