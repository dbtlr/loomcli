import type { ActionHandler } from '@loom/core';

import type { keys } from '../commands/keys.js';
import { describeKind, isRecord } from '../kinds.js';
import { readJson } from '../read-json.js';

export const listKeys: ActionHandler<typeof keys> = async ({ options, host, out }) => {
  const document = await readJson(options.file, host, out);
  const record = isRecord(document)
    ? document
    : out.fatal(`Expected an object at the root; found ${describeKind(document)}`);
  for (const key of Object.keys(record)) {
    await out.print(key);
  }
};
