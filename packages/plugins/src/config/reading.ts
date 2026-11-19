import { isRecord } from '../plain-data.js';
import type { Position } from './text.js';

/** The clause that says why a file cannot be used, after its name in a warning or a failure. */
type Clause =
  | 'does not exist.'
  | 'could not be read.'
  | 'is not valid JSON.'
  | 'does not hold a JSON object.'
  | 'is not valid TOML.'
  | 'is not valid YAML.'
  | 'does not hold a YAML mapping.';

/**
 * What reading one file found: its top-level object, or the clause that says why it is skipped,
 * with the position where the file stops parsing when its parser names one.
 */
type Reading =
  | { kind: 'usable'; object: Record<string, unknown> }
  | { kind: 'unusable'; clause: Clause; at?: Position };

/**
 * The format a configuration reader reads beyond JSON, which the plugin reads itself. `TOML` reads
 * `.toml` files, and `YAML` reads `.yaml` and `.yml` files.
 *
 * @public
 */
type ReaderFormat = 'TOML' | 'YAML';

/** Phantom key. It brands a configuration reader and holds no runtime value. */
declare const configurationReader: unique symbol;

/**
 * A configuration reader: the parser of one format beyond JSON, which an application passes to
 * `configuration()` in `formats`. The pack exports one per format, `toml` from
 * `@loomcli/plugins/config/toml` and `yaml` from `@loomcli/plugins/config/yaml`, so an application
 * imports, and bundles, only the parsers of the formats it reads. Only the pack makes one: the
 * value carries its format, and the plugin finds its parser by the value itself.
 *
 * @public @sealed
 */
interface ConfigurationReader {
  /** The format it reads, which chooses the extensions it reads and names it in a sentence. */
  readonly format: ReaderFormat;
  /** The brand that keeps an object an author writes by hand out of `formats`. It holds no runtime value. */
  readonly [configurationReader]: true;
}

/** One reader's parser: a file's text, a leading byte order mark already removed, read into a reading. */
type Parse = (text: string) => Promise<Reading>;

/**
 * The parser of each reader the pack made. The public type carries the format alone, so the
 * plugin's reading of a file stays internal, and a value the pack did not make has no parser.
 */
const parsers = new WeakMap<ConfigurationReader, Parse>();

/** The runtime value of a reader the pack makes. Its parser lives in the registry above. */
class ReaderDeclaration implements ConfigurationReader {
  /** The brand that makes the public reader type opaque. It holds no runtime value. */
  declare readonly [configurationReader]: true;
  readonly format: ReaderFormat;

  constructor(format: ReaderFormat) {
    this.format = format;
    Object.freeze(this);
  }
}

/** A frozen reader of one format, whose parser the plugin finds through `readerParser`. */
function defineReader(format: ReaderFormat, parse: Parse): ConfigurationReader {
  const reader = new ReaderDeclaration(format);
  parsers.set(reader, parse);
  return reader;
}

/** The parser of a reader the pack made, or `undefined` for any other value. */
function readerParser(reader: ConfigurationReader): Parse | undefined {
  return parsers.get(reader);
}

/**
 * A file whose extension names a format the application passes no reader for: that format, and the
 * formats the application reads, JSON first.
 */
interface Unread {
  readonly kind: 'unread';
  readonly format: ReaderFormat;
  readonly formats: readonly string[];
}

/** The reading of a parsed value: usable when it is an object, and otherwise the clause given. */
function readingOf(value: unknown, notObject: Clause): Reading {
  return isRecord(value)
    ? { kind: 'usable', object: value }
    : { clause: notObject, kind: 'unusable' };
}

export { defineReader, readerParser, readingOf };
export type { Clause, ConfigurationReader, Parse, Reading, ReaderFormat, Unread };
