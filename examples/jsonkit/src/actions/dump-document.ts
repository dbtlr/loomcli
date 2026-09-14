import type { ActionHandler } from '@loomcli/core';

import type { debug } from '../commands/debug.js';
import { formatJson } from '../json.js';
import { readJson } from '../read-json.js';

export const dumpDocument: ActionHandler<typeof debug> = async ({ options, host, out, style }) => {
  const document = await readJson(options.file, { host, out, style });
  await out.print(style.escape(formatJson(document)));
};
