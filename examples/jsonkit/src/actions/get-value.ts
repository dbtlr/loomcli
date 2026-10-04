import type { ActionHandler } from '@loomcli/core';

import type { get } from '../commands/get.js';
import { formatJson } from '../json.js';
import { readJson } from '../read-json.js';
import { resolvePath } from '../resolve-path.js';

export const getValue: ActionHandler<typeof get> = async ({ args, options, host, out, style }) => {
  const document = await readJson({ host, options, out, style });
  const value = resolvePath(document, args.path);
  await out.print(style.escape(formatJson(value)));
};
