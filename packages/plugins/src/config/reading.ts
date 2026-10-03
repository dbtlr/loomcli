/** The clause that says why a file cannot be used, after its name in a warning or a failure. */
export type Clause =
  | 'does not exist.'
  | 'could not be read.'
  | 'is not valid JSON.'
  | 'does not hold a JSON object.'
  | 'is not valid TOML.'
  | 'is not valid YAML.'
  | 'does not hold a YAML mapping.';

/** What reading one file found: its top-level object, or the clause that says why it is skipped. */
export type Reading =
  | { kind: 'usable'; object: Record<string, unknown> }
  | { kind: 'unusable'; clause: Clause };

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The reading of a parsed value: usable when it is an object, and otherwise the clause given. */
export function readingOf(value: unknown, notObject: Clause): Reading {
  return isPlainObject(value)
    ? { kind: 'usable', object: value }
    : { clause: notObject, kind: 'unusable' };
}
