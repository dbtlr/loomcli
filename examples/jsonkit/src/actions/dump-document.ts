import type { ActionHandler } from '@loomcli/core';

import type { debug } from '../commands/debug.js';
import { formatJson } from '../json.js';
import { readJson } from '../read-json.js';

export const dumpDocument: ActionHandler<typeof debug> = async ({ options, host, out }) => {
  const document = await readJson(options.file, host, out);
  await out.print(formatJson(document));
};
