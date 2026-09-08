import type { ActionHandler, Out } from '@loomcli/core';

import type { select } from '../commands/select.js';
import { formatJson } from '../json.js';
import { describeKind, isRecord } from '../kinds.js';
import { readJson } from '../read-json.js';

/**
 * Fields are top-level keys, so a repeated field keeps its first position and reports once. A
 * missing field leaves the rest of the selection intact, so it warns rather than ending the run.
 */
async function collect(record: Record<string, unknown>, fields: readonly string[], out: Out) {
  const selected = new Map<string, unknown>();
  const seen = new Set<string>();
  for (const field of fields) {
    if (!seen.has(field)) {
      seen.add(field);
      if (Object.hasOwn(record, field)) {
        selected.set(field, record[field]);
      } else {
        await out.warn(`Field not found: ${field}`);
      }
    }
  }
  return Object.fromEntries(selected);
}

export const selectFields: ActionHandler<typeof select> = async ({ options, host, out }) => {
  const document = await readJson(options.file, host, out);
  const record = isRecord(document)
    ? document
    : out.fatal(`Expected an object at the root; found ${describeKind(document)}`);
  await out.print(formatJson(await collect(record, options.field, out)));
};
