import { DeclarationError } from './errors.js';

/**
 * Every character that ends a line, so a description a projection prints on one line holds none.
 */
const lineTerminator = /[\n\r\u2028\u2029]/u;

/**
 * The `description` core fact: one line of prose every projection reads. A value that is not a
 * string fails the same way a blank one does, because the author reads one rule for one fact.
 * An omitted description is absent, not a fault, so it passes through as `undefined`.
 */
export function checkDescription(subject: string, value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || !/\S/u.test(value) || lineTerminator.test(value)) {
    throw new DeclarationError(
      `${subject} description must hold a character other than whitespace and no line terminator. Supply a one-line summary.`,
    );
  }
  return value;
}

/**
 * The `version` core fact, which the Application alone carries. Core reads it as an opaque string,
 * because the convention is the package manifest's own field and no scheme is imposed on it.
 */
export function checkVersion(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new DeclarationError(
      'The Application version must be a string. Supply a string such as "1.2.0".',
    );
  }
  return value;
}

/**
 * A structural value core reads as plain data: an object literal, and never a declaration that
 * carries state of its own. The options slots read it to reject a value that is not an options
 * object, and inspection reads it to copy a declared value faithfully.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
