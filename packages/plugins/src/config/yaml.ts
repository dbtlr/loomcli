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

/** Thrown inside the conversion when a key breaks the rules, which makes the file not valid YAML. */
class InvalidKeyError extends Error {
  override name = 'InvalidKeyError';
}

/**
 * The converter from one parsed document's nodes to plain values. A scalar reads as the value the
 * core schema resolved, an alias as the value of the node its anchor names, a sequence as an array,
 * and a mapping as an object. A mapping key is a scalar, or an alias of one, and reads as its
 * string, or as its text as written when it is not a string; a key that is a mapping or a sequence,
 * and two keys of the same text, throw. Each collection converts once, so an alias shares the value
 * its anchor names and a recursive alias closes on it.
 */
function converter(yaml: Yaml, document: Document): (node: unknown) => unknown {
  const converted = new Map<unknown, unknown>();

  function keyText(key: unknown): string {
    const node = yaml.isAlias(key) ? key.resolve(document) : key;
    if (node === null || node === undefined) {
      return '';
    }
    if (!yaml.isScalar(node)) {
      throw new InvalidKeyError('A YAML key is a mapping or a sequence.');
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
        throw new InvalidKeyError('A YAML mapping repeats a key.');
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
      return convert(node.resolve(document));
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
 * The mapping a YAML document holds, read through `yaml`, which loads only here, under the YAML 1.2
 * core schema. The file holds one document with unique keys and only the core schema's tags. The
 * parser's own errors, a tag outside the core schema, and a key that breaks the rules make it not
 * valid YAML, and the parser's warnings never print. An empty document, or one that holds only
 * comments, holds no mapping.
 */
export async function readYaml(text: string): Promise<Reading> {
  const yaml = await import('yaml');
  const document = yaml.parseDocument(text, {
    resolveKnownTags: false,
    schema: 'core',
    version: '1.2',
  });
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
