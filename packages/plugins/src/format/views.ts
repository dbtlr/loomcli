import type { View } from '@loomcli/core';

import { encodeText } from '../encode.js';

/** `JSON.stringify`'s indent for `json()`'s whole document. `jsonl()` passes no indent. */
const jsonIndentSpaces = 2;

/** The identity mapping a view falls back to when the author supplies no `map`. */
function identity<Data>(data: Readonly<Data>): unknown {
  return data;
}

/** Runs `JSON.stringify`, wrapping a thrown error in one plain message with its cause attached. */
function tryStringify(value: unknown, indent: number | undefined): string | undefined {
  try {
    return JSON.stringify(value, undefined, indent);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'An unknown error occurred';
    throw new Error(`The value cannot be encoded as JSON: ${reason}.`, { cause: error });
  }
}

/** `JSON.stringify`, with an `undefined` result turned into the same plain message as a throw. */
function stringify(value: unknown, indent?: number): string {
  const encoded = tryStringify(value, indent);
  if (encoded === undefined) {
    throw new Error('The value cannot be encoded as JSON: the value is undefined.');
  }
  return encoded;
}

/** Configuration both views share: how to reshape the received data before encoding it. */
export interface EncodingConfig<Data> {
  readonly map?: (data: Readonly<Data>) => unknown;
}

/**
 * A whole view over one JSON document: the mapped data, indented two spaces, with one trailing
 * newline. A bare pack view, so two calls with one configuration are two distinct views.
 */
export function json<Data>(config: EncodingConfig<Data> = {}): View<Data> {
  const map = config.map ?? identity<Data>;
  return {
    render: (data, context) => encodeText(`${stringify(map(data), jsonIndentSpaces)}\n`, context),
  };
}

/**
 * A whole view over JSON Lines: one compact `JSON.stringify` line per element when the mapped data
 * is an array, and one such line otherwise. An empty array prints nothing. A bare pack view, so two
 * calls with one configuration are two distinct views.
 */
export function jsonl<Data>(config: EncodingConfig<Data> = {}): View<Data> {
  const map = config.map ?? identity<Data>;
  return {
    render: (data, context) => {
      const mapped = map(data);
      if (Array.isArray(mapped)) {
        const lines = mapped.map((element) => `${stringify(element)}\n`).join('');
        return encodeText(lines, context);
      }
      return encodeText(`${stringify(mapped)}\n`, context);
    },
  };
}
