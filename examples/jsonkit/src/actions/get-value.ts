import type { ActionHandler } from '@loom/core';

import type { get } from '../commands/get.js';
import { formatJson } from '../json.js';
import { readJson } from '../read-json.js';
import { resolvePath } from '../resolve-path.js';

export const getValue: ActionHandler<typeof get> = async ({ args, options, host, out }) => {
  const document = await readJson(options.file, host, out);
  const found = resolvePath(document, args.path) ?? out.fatal(`Path not found: ${args.path}`);
  await out.print(formatJson(found.value));
};
