import type { ActionHandler } from '@loomcli/core';

import type { keys } from '../commands/keys.js';
import { describeKind, isRecord } from '../kinds.js';
import { readJson } from '../read-json.js';
import { resolvePath } from '../resolve-path.js';

/** An omitted path selects the whole document, so the root keeps its own wording. */
export const listKeys: ActionHandler<typeof keys> = async ({ args, options, host, out, style }) => {
  const document = await readJson(options.file, { host, out, style });
  const path: string | undefined = args.path;
  const found =
    path === undefined
      ? { value: document }
      : (resolvePath(document, path) ?? out.fatal(`Path not found: ${style.escape(path)}`));
  const where = path === undefined ? 'the root' : path;
  const record = isRecord(found.value)
    ? found.value
    : out.fatal(`Expected an object at ${style.escape(where)}; found ${describeKind(found.value)}`);
  for (const key of Object.keys(record)) {
    await out.print(style.escape(key));
  }
};
