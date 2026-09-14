import type { ActionHandler } from '@loomcli/core';

import type { select } from '../commands/select.js';
import { formatJson } from '../json.js';
import { describeKind, isRecord } from '../kinds.js';
import { readJson } from '../read-json.js';

/** Missing fields warn once while the remaining selection keeps its first-occurrence order. */
export const selectFields: ActionHandler<typeof select> = async ({ options, host, out, style }) => {
  const document = await readJson(options.file, host);
  const record = isRecord(document)
    ? document
    : out.fatal(`Expected an object at the root; found ${describeKind(document)}`);
  const selected = new Map<string, unknown>();
  for (const field of new Set(options.field)) {
    if (Object.hasOwn(record, field)) {
      selected.set(field, record[field]);
    } else {
      await out.warn(`Field not found: ${style.escape(field)}`);
    }
  }
  const result = formatJson(Object.fromEntries(selected));
  await out.print(style.escape(result));
};
