import type { ActionHandler } from '@loom/core';

import type { get } from '../commands/get.js';
import { readJson } from '../read-json.js';
import { resolvePath } from '../resolve-path.js';

const INDENT = 2;

export const getValue: ActionHandler<typeof get> = async ({ args, options, host, out }) => {
  const document = await readJson(options.file, host, out);
  const found = resolvePath(document, args.path) ?? out.fatal(`Path not found: ${args.path}`);
  // Objects and arrays print indented; scalars have no members to indent, so they stay compact.
  await out.print(JSON.stringify(found.value, undefined, INDENT));
};
