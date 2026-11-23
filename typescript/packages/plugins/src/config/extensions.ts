import type { ConfigurationReader, ReaderFormat } from './reading.js';

/**
 * Which extension reads in which format. JSON is built in and reads `.json`, `.jsonc`, and every
 * name no reader claims. TOML and YAML read only through the reader an application passes, so the
 * plugin knows their extensions without importing either reader.
 */

/** One format a reader adds: the extensions it reads, and the name of the reader's export. */
interface ReaderFacts {
  readonly extensions: readonly string[];
  readonly reader: string;
}

/** The formats a reader adds, in the order `*` tries their extensions, before JSON's. */
const readerFormats: Readonly<Record<ReaderFormat, ReaderFacts>> = {
  TOML: { extensions: ['toml'], reader: 'toml' },
  YAML: { extensions: ['yaml', 'yml'], reader: 'yaml' },
};

const formatOrder: readonly ReaderFormat[] = ['TOML', 'YAML'];

/** The extensions JSON reads by name, which `*` tries after every reader's. */
const jsonExtensions: readonly string[] = ['json', 'jsonc'];

/** The format a reader adds that an extension names, or `undefined` for an extension JSON reads. */
function readerFormatOf(extension: string): ReaderFormat | undefined {
  return formatOrder.find((format) => readerFormats[format].extensions.includes(extension));
}

/** The formats the readers passed add, each once, in the order `*` tries them. */
function passedFormats(readers: readonly ConfigurationReader[]): ReaderFormat[] {
  return formatOrder.filter((format) => readers.some((reader) => reader.format === format));
}

/** The extensions the formats read, in the order given, then `json` and `jsonc`. */
function extensionsOf(formats: readonly ReaderFormat[]): string[] {
  return [...formats.flatMap((format) => readerFormats[format].extensions), ...jsonExtensions];
}

/**
 * The extensions an application reads: each passed reader's, in the plugin's order whatever the
 * order of `formats`, then `json` and `jsonc`. This is what `*` names.
 */
function readExtensions(readers: readonly ConfigurationReader[]): string[] {
  return extensionsOf(passedFormats(readers));
}

/** Every extension a brace list may list: JSON's and every reader's, passed or not. */
function knownExtensions(): string[] {
  return extensionsOf(formatOrder);
}

/** The formats an application reads, as a sentence names them: JSON, then each passed reader's. */
function readFormatNames(readers: readonly ConfigurationReader[]): string[] {
  return ['JSON', ...passedFormats(readers)];
}

/** The name of the export a format's reader is, which a fault names. */
function readerName(format: ReaderFormat): string {
  return readerFormats[format].reader;
}

export { knownExtensions, readerFormatOf, readerName, readExtensions, readFormatNames };
