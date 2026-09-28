import { EX_DATAERR, FatalError } from '@loomcli/core';

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
 * A path the document does not hold. The document was read, so its data holds no value there,
 * which `EX_DATAERR` reports and `EX_NOINPUT` would misreport as a missing input file.
 */
export class PathNotFoundError extends FatalError {
  static override readonly exitCode = EX_DATAERR;

  constructor(path: string) {
    super(`Path not found: ${path}`);
    this.name = 'PathNotFoundError';
  }
}

/**
 * The value at a path, or `PathNotFoundError` when the document holds none. Digit segments index
 * arrays; on an object every segment, digits included, is a key. Every Command that takes a path
 * resolves it here, so one syntax and one failure serve the whole application.
 */
export function resolvePath(document: unknown, path: string): unknown {
  let current = document;
  for (const segment of path.split('.')) {
    const found = resolveSegment(current, segment);
    if (found === undefined) {
      throw new PathNotFoundError(path);
    }
    current = found.value;
  }
  return current;
}
