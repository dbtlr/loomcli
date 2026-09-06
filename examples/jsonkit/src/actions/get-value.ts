import type { ActionHandler } from '@loom/core';

import type { get } from '../commands/get.js';
import { isRecord } from '../kinds.js';
import { readJson } from '../read-json.js';

const INDENT = 2;
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

/** Digit segments index arrays; on an object every segment, digits included, is a key. */
function resolvePath(document: unknown, path: string): { value: unknown } | undefined {
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

export const getValue: ActionHandler<typeof get> = async ({ args, options, host, out }) => {
  const document = await readJson(options.file, host, out);
  const found = resolvePath(document, args.path) ?? out.fatal(`Path not found: ${args.path}`);
  // Objects and arrays print indented; scalars have no members to indent, so they stay compact.
  await out.print(JSON.stringify(found.value, undefined, INDENT));
};
