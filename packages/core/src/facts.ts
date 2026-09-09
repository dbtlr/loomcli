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
