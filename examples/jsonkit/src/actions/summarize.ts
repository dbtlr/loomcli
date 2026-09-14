import type { ActionHandler } from '@loomcli/core';

import type { jsonkit } from '../application.js';
import { describeKind, isRecord } from '../kinds.js';
import { readJson } from '../read-json.js';

export const summarize: ActionHandler<typeof jsonkit> = async ({ options, host, out, style }) => {
  const document = await readJson(options.file, host);
  await out.print(describeKind(document));
  if (isRecord(document)) {
    for (const [key, value] of Object.entries(document)) {
      await out.print(`${style.escape(key)}\t${describeKind(value)}`);
    }
  }
};
