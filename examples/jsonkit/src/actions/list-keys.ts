import type { ActionHandler } from '@loomcli/core';

import type { keys } from '../commands/keys.js';
import { describeKind, isRecord } from '../kinds.js';
import { readJson } from '../read-json.js';
import { resolvePath } from '../resolve-path.js';

/** An omitted path selects the whole document, so the root keeps its own wording. */
export const listKeys: ActionHandler<typeof keys> = async ({ args, options, host, out, style }) => {
  const document = await readJson(options.file, host);
  const path: string | undefined = args.path;
  const value = path === undefined ? document : resolvePath(document, path);
  const where = path === undefined ? 'the root' : path;
  const record = isRecord(value)
    ? value
    : out.fatal(`Expected an object at ${where}; found ${describeKind(value)}`);
  for (const key of Object.keys(record)) {
    await out.print(style.escape(key));
  }
};
