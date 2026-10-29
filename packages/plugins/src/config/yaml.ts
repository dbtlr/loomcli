import type { Document, visit } from 'yaml';

import { positionAt } from './position.js';
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
 * Where the first alias that names no preceding anchor starts, or `undefined` when every alias
 * names one. One walk in document order records each anchor as it meets it, so an alias resolves
 * when its anchor came earlier, its own enclosing collection included.
 */
function unresolvedAlias(walk: typeof visit, document: Document): number | undefined {
  const anchors = new Set<string>();
  const unresolved: number[] = [];
  walk(document, {
    Alias: (_key, alias) => {
      if (anchors.has(alias.source)) {
        return undefined;
      }
      const [aliasStart] = alias.range ?? [];
      if (aliasStart !== undefined) {
        unresolved.push(aliasStart);
      }
      return walk.BREAK;
    },
    Node: (_key, node) => {
      if (node.anchor !== undefined) {
        anchors.add(node.anchor);
      }
    },
  });
  const [first] = unresolved;
  return first;
}

/**
 * Where a document that is not valid YAML breaks: its first error, or else its first tag outside
 * the core schema, or else its first alias that names no preceding anchor. `undefined` when it has
 * none of them.
 */
function faultOffset(walk: typeof visit, document: Document): number | undefined {
  const [error] = document.errors;
  const fault = error ?? document.warnings.find(({ code }) => tagFaults.has(code));
  const [faultStart] = fault?.pos ?? [];
  return faultStart ?? unresolvedAlias(walk, document);
}

/**
 * The mapping a YAML document holds, read through `yaml`, which loads only here, under the YAML 1.2
 * core schema, and converted to plain values by the parser's own `toJS()`. The file holds one
 * document with unique keys and only the core schema's tags. The parser's own errors, a tag outside
 * the core schema, and an alias that names no preceding anchor make it not valid YAML, at the
 * position of the first error, or else of the tag, or else of the alias, which the parser does not
 * report itself, so the reader finds it before `toJS()` would throw. A throw from `toJS()` that
 * the reader did not foresee makes the file not valid YAML with no position. The `error` log level
 * keeps the parser from printing a warning, so no file content reaches the terminal. An empty document,
 * or one that holds only comments, holds no mapping. Every alias reads, with no alias count limit:
 * `toJS()` shares the value an anchor names among its aliases, so a profile reused across many
 * environments costs one value.
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
  const offset = faultOffset(yaml.visit, document);
  if (offset !== undefined) {
    return { at: positionAt(text, offset), clause: 'is not valid YAML.', kind: 'unusable' };
  }
  try {
    return readingOf(document.toJS({ maxAliasCount: -1 }), 'does not hold a YAML mapping.');
  } catch {
    return { clause: 'is not valid YAML.', kind: 'unusable' };
  }
}
