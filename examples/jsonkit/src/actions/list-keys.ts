import type { ActionHandler } from '@loom/core';

import type { keys } from '../commands/keys.js';
import { describeKind, isRecord } from '../kinds.js';
import { readJson } from '../read-json.js';
import { resolvePath } from '../resolve-path.js';

/** An omitted path selects the whole document, so the root keeps its own wording. */
export const listKeys: ActionHandler<typeof keys> = async ({ args, options, host, out }) => {
  const document = await readJson(options.file, host, out);
  const path: string | undefined = args.path;
  const found =
    path === undefined
      ? { value: document }
      : (resolvePath(document, path) ?? out.fatal(`Path not found: ${path}`));
  const where = path === undefined ? 'the root' : path;
  const record = isRecord(found.value)
    ? found.value
    : out.fatal(`Expected an object at ${where}; found ${describeKind(found.value)}`);
  for (const key of Object.keys(record)) {
    await out.print(key);
  }
};
