import type { Document, isAlias, isMap, isScalar, isSeq, Pair } from 'yaml';

import { readingOf } from './reading.js';
import type { Reading } from './reading.js';

/** The node tests of the `yaml` module, which loads only when the plugin reads a YAML file's text. */
interface Yaml {
  readonly isAlias: typeof isAlias;
  readonly isMap: typeof isMap;
  readonly isScalar: typeof isScalar;
  readonly isSeq: typeof isSeq;
}

/** The warnings that mean a tag the core schema does not define, which make the file not valid YAML. */
const tagFaults = new Set(['BAD_COLLECTION_TYPE', 'TAG_RESOLVE_FAILED']);

/**
 * The debug variables the `yaml` package reads from the process environment. With either set, it
 * prints each token of the text it parses to the console, file content included.
 */
const debugVariables = ['LOG_STREAM', 'LOG_TOKENS'];

/**
 * Thrown inside the conversion when a key or an alias breaks the rules, which makes the file not
 * valid YAML.
 */
class InvalidYamlError extends Error {
  override name = 'InvalidYamlError';
}

/**
 * The converter from one parsed document's nodes to plain values. It builds them from the nodes
 * rather than through the parser's `toJS()`, which prints a process warning for a mapping key that
 * is a collection and writes a non-string key as JavaScript does rather than as the file did. A
 * scalar reads as the value the core schema resolved, an alias as the value of the node its anchor
 * names, a sequence as an array, and a mapping as an object. A mapping key is a scalar, or an alias
 * of one, and reads as its string, or as its text as written when it is not a string; a key that
 * is a mapping or a sequence, two keys of the same text, and an alias that names no preceding
 * anchor throw. Each collection converts once, so an alias shares the value its anchor names and a
 * recursive alias closes on it.
 */
function converter(yaml: Yaml, document: Document): (node: unknown) => unknown {
  const converted = new Map<unknown, unknown>();

  /** The node an alias names, which a misspelled or forward alias does not have. */
  function target(node: unknown): unknown {
    if (!yaml.isAlias(node)) {
      return node;
    }
    const resolved = node.resolve(document);
    if (resolved === undefined) {
      throw new InvalidYamlError('A YAML alias names no preceding anchor.');
    }
    return resolved;
  }

  function keyText(key: unknown): string {
    const node = target(key);
    if (node === null || node === undefined) {
      return '';
    }
    if (!yaml.isScalar(node)) {
      throw new InvalidYamlError('A YAML key is a mapping or a sequence.');
    }
    return typeof node.value === 'string' ? node.value : (node.source ?? String(node.value));
  }

  function convertSequence(items: readonly unknown[], array: unknown[]): unknown[] {
    for (const item of items) {
      array.push(convert(item));
    }
    return array;
  }

  function convertMapping(
    pairs: readonly Pair[],
    object: Record<string, unknown>,
  ): Record<string, unknown> {
    for (const { key, value } of pairs) {
      const text = keyText(key);
      if (Object.hasOwn(object, text)) {
        throw new InvalidYamlError('A YAML mapping repeats a key.');
      }
      // A data property, so a key named __proto__ is an own key and not the prototype.
      Object.defineProperty(object, text, {
        configurable: true,
        enumerable: true,
        value: convert(value),
        writable: true,
      });
    }
    return object;
  }

  function convert(node: unknown): unknown {
    if (yaml.isAlias(node)) {
      return convert(target(node));
    }
    if (yaml.isScalar(node)) {
      return node.value;
    }
    return converted.has(node) ? converted.get(node) : convertCollection(node);
  }

  function convertCollection(node: unknown): unknown {
    if (yaml.isSeq(node)) {
      const array: unknown[] = [];
      converted.set(node, array);
      return convertSequence(node.items, array);
    }
    if (yaml.isMap(node)) {
      const object: Record<string, unknown> = {};
      converted.set(node, object);
      return convertMapping(node.items, object);
    }
    // An empty document holds no node, which holds no mapping.
    return undefined;
  }

  return convert;
}

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
 * core schema. The file holds one document with unique keys and only the core schema's tags. The
 * parser's own errors, a tag outside the core schema, a key that breaks the rules, and an alias
 * that names no preceding anchor make it not valid YAML, and the parser's warnings never print. An empty document, or one that holds only
 * comments, holds no mapping.
 */
export async function readYaml(text: string): Promise<Reading> {
  const yaml = await import('yaml');
  const document = withoutDebugVariables(() =>
    yaml.parseDocument(text, { resolveKnownTags: false, schema: 'core', version: '1.2' }),
  );
  const [error] = document.errors;
  if (error !== undefined || document.warnings.some(({ code }) => tagFaults.has(code))) {
    return { clause: 'is not valid YAML.', kind: 'unusable' };
  }
  try {
    return readingOf(converter(yaml, document)(document.contents), 'does not hold a YAML mapping.');
  } catch {
    return { clause: 'is not valid YAML.', kind: 'unusable' };
  }
}
