import { readingOf } from './reading.js';
import type { Reading } from './reading.js';

/** The warnings that mean a tag the core schema does not define, which make the file not valid YAML. */
const tagFaults = new Set(['BAD_COLLECTION_TYPE', 'TAG_RESOLVE_FAILED']);

/**
 * The debug variables the `yaml` package reads from the process environment. With either set, it
 * prints each token of the text it parses to the console, file content included.
 */
const debugVariables = ['LOG_STREAM', 'LOG_TOKENS'];

/**
 * Runs a synchronous parse with the `yaml` package's debug variables removed from the process
 * environment, and restores each to its prior state, its value or its absence, afterward. The
 * package reads them from the process environment and prints the parsed file to the console, so
 * an operator's variable would put file content on the terminal. The parse is synchronous, so no
 * other code observes the change.
 */
function withoutDebugVariables<Parsed>(parse: () => Parsed): Parsed {
  const saved = debugVariables.flatMap((name) => {
    const value = process.env[name];
    return value === undefined ? [] : [{ name, value }];
  });
  for (const name of debugVariables) {
    Reflect.deleteProperty(process.env, name);
  }
  try {
    return parse();
  } finally {
    for (const { name, value } of saved) {
      process.env[name] = value;
    }
  }
}

/**
 * The mapping a YAML document holds, read through `yaml`, which loads only here, under the YAML 1.2
 * core schema, and converted to plain values by the parser's own `toJS()`. The file holds one
 * document with unique keys and only the core schema's tags. The parser's own errors, a tag outside
 * the core schema, and an alias that names no preceding anchor, which `toJS()` throws for, make it
 * not valid YAML. The `error` log level keeps the parser from printing a warning, so no file
 * content reaches the terminal. An empty document, or one that holds only comments, holds no
 * mapping.
 */
export async function readYaml(text: string): Promise<Reading> {
  const yaml = await import('yaml');
  const document = withoutDebugVariables(() =>
    yaml.parseDocument(text, {
      logLevel: 'error',
      resolveKnownTags: false,
      schema: 'core',
      version: '1.2',
    }),
  );
  const [error] = document.errors;
  if (error !== undefined || document.warnings.some(({ code }) => tagFaults.has(code))) {
    return { clause: 'is not valid YAML.', kind: 'unusable' };
  }
  try {
    return readingOf(document.toJS(), 'does not hold a YAML mapping.');
  } catch {
    return { clause: 'is not valid YAML.', kind: 'unusable' };
  }
}
