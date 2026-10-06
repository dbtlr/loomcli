/**
 * The checks the pack runs on values it reads as plain data, spelled once. This module belongs to
 * no subpath: the manifest, the configuration plugin, and the MCP plugin each import it, and none
 * imports another's modules.
 */

/** Whether a value is an object that is not an array, as a parsed JSON object or YAML mapping is. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether a value is plain JSON data: null, a Boolean, a finite number, a string, or arrays and
 * plain objects of these. Core copies every plain object it snapshots onto `Object.prototype`, so
 * a null-prototype object never reaches the pack. Core also copies a value that holds itself with
 * its cycle, which no JSON text can carry, so a container that is one of its own `ancestors` is not
 * plain JSON data.
 */
function isPlainJson(value: unknown, ancestors: ReadonlySet<object> = new Set()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  return (
    typeof value === 'object' &&
    value !== null &&
    !ancestors.has(value) &&
    isPlainContainer(value, ancestors)
  );
}

/** Whether an array or a plain object holds plain JSON data alone, under its `ancestors`. */
function isPlainContainer(value: object, ancestors: ReadonlySet<object>): boolean {
  const inner = new Set([...ancestors, value]);
  if (Array.isArray(value)) {
    return value.every((item: unknown) => isPlainJson(item, inner));
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return (
    prototype === Object.prototype &&
    Object.values(value).every((item: unknown) => isPlainJson(item, inner))
  );
}

export { isPlainJson, isRecord };
