import type { ActionHandler } from '@loomcli/core';

import type { max } from '../commands/stats.js';
import { isRecord } from '../kinds.js';
import { readJson } from '../read-json.js';
import { resolvePath } from '../resolve-path.js';

/** A scalar holds no array or object. */
const SCALAR = 0;

/** Each array or object adds one level to the deepest level among its members. */
const LEVEL = 1;

/** The members of an array or object, or none for a scalar. */
function membersOf(value: unknown): readonly unknown[] | undefined {
  if (Array.isArray(value)) {
    return value;
  }
  return isRecord(value) ? Object.values(value) : undefined;
}

/** How many arrays and objects nest at a value: 0 for a scalar, 1 for an empty array or object. */
function depthOf(value: unknown): number {
  const members = membersOf(value);
  if (members === undefined) {
    return SCALAR;
  }
  const deepest = members.reduce<number>(
    (level, member) => Math.max(level, depthOf(member)),
    SCALAR,
  );
  return LEVEL + deepest;
}

/** An omitted path measures the whole document. */
export const maxDepth: ActionHandler<typeof max> = async ({ args, options, out, style }) => {
  const document = await readJson({ options, out, style });
  const path: string | undefined = args.path;
  const value = path === undefined ? document : resolvePath(document, path);
  await out.print(String(depthOf(value)));
};
