import { FatalError } from '@loomcli/core';
import type { ActionHandler } from '@loomcli/core';

import type { paths } from '../commands/paths.js';
import type { Entry } from '../entries.js';
import { describeKind, isRecord } from '../kinds.js';
import { readJson } from '../read-json.js';

/** The path of the whole document, which resolves to the document itself. */
const ROOT = '.';

/** The key a walk refuses, so one document proves what a source that throws leaves behind. */
const REFUSED = 'boom';

/** The members of one value under the segment that reaches each, in document order. */
function members(value: unknown): [string, unknown][] {
  if (Array.isArray(value)) {
    return value.map((item, index) => [String(index), item]);
  }
  return isRecord(value) ? Object.entries(value) : [];
}

/** A child is reached from its parent by one segment, and the root spells no segment of its own. */
function join(parent: string, segment: string): string {
  return parent === ROOT ? segment : `${parent}.${segment}`;
}

/**
 * One entry per reachable path, the parent before its members. Each row waits on a microtask, so
 * the walk is a real asynchronous source and the writer requests one row at a time.
 */
async function* from(path: string, value: unknown): AsyncGenerator<Entry> {
  await Promise.resolve();
  yield { kind: describeKind(value), path };
  for (const [segment, member] of members(value)) {
    if (segment === REFUSED) {
      throw new FatalError(`Cannot walk ${join(path, segment)}`);
    }
    yield* from(join(path, segment), member);
  }
}

/** The whole document, root first, which is the sequence the Command declares. */
export function walk(document: unknown): AsyncGenerator<Entry> {
  return from(ROOT, document);
}

/** The walk is the result, so core writes each row as the generator yields it. */
export const listPaths: ActionHandler<typeof paths> = async ({ options, host, out }) => {
  const document = await readJson(options.file, host);
  await out.results(walk(document));
};
