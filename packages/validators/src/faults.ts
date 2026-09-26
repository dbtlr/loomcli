import { DeclarationError } from '@loomcli/core';

import { isPlainObject } from './data.js';

/**
 * A factory argument that can never work.
 * The message names the factory and the argument, states the problem, then the correction.
 */
function fault(message: string): DeclarationError {
  return new DeclarationError(message);
}

/** A declared value as a fault message quotes it: a string in quotes, a primitive as printed. */
function quote(value: unknown): string {
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint' ||
    value === null ||
    value === undefined
  ) {
    return String(value);
  }
  return `a value of type ${typeof value}`;
}

/**
 * A factory's options read as unknown values, because a JavaScript caller can pass anything.
 * Omitted options read as an empty record.
 */
function readOptions(factory: string, options: unknown): Readonly<Record<string, unknown>> {
  if (options === undefined) {
    return {};
  }
  if (!isPlainObject(options)) {
    throw fault(`${factory}() options is not a plain object. Supply an object or leave it out.`);
  }
  return options;
}

export { fault, quote, readOptions };
