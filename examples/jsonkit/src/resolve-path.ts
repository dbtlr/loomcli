import { isRecord } from './kinds.js';

const DIGITS = /^[0-9]+$/u;

/** A found value is wrapped, so a resolved `null` stays distinct from an unresolved path. */
function resolveSegment(current: unknown, segment: string): { value: unknown } | undefined {
  if (Array.isArray(current) && DIGITS.test(segment)) {
    const index = Number(segment);
    return index < current.length ? { value: current[index] } : undefined;
  }
  if (isRecord(current) && Object.hasOwn(current, segment)) {
    return { value: current[segment] };
  }
  return undefined;
}

/**
 * Digit segments index arrays; on an object every segment, digits included, is a key. Every
 * Command that takes a path resolves it here, so one syntax serves the whole application.
 */
export function resolvePath(document: unknown, path: string): { value: unknown } | undefined {
  let current = document;
  for (const segment of path.split('.')) {
    const found = resolveSegment(current, segment);
    if (found === undefined) {
      return undefined;
    }
    current = found.value;
  }
  return { value: current };
}
