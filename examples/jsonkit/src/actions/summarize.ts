import type { ActionHandler } from '@loomcli/core';

import type { jsonkit } from '../application.js';
import { describeKind, isRecord } from '../kinds.js';
import type { Member } from '../member.js';
import { readJson } from '../read-json.js';

export const summarize: ActionHandler<typeof jsonkit> = async ({ options, host, out }) => {
  const document = await readJson(options.file, host);
  await out.info(describeKind(document));
  const members: Member[] = isRecord(document)
    ? Object.entries(document).map(([key, value]) => ({ key, kind: describeKind(value) }))
    : [];
  await out.results(members);
};
